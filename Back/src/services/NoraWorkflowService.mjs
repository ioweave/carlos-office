import { createAgent, disposeAgent, getBlueprint, listBlueprints } from "../controllers/AgentController.mjs";
import { listApprovals } from "../controllers/AuthorizationController.mjs";
import { recordEvent } from "../controllers/EventController.mjs";
import {
  editTask,
  getReadyTasks,
  getWorkflow,
  setTaskStatus,
  setWorkflowResult,
} from "../controllers/ProcessController.mjs";
import { runTask } from "../controllers/TaskController.mjs";
import { listSkills } from "../registry/Skills.mjs";
import { listTools } from "../registry/Tools.mjs";
import { createProcess as createNoraProcess } from "./NoraCreationService.mjs";

const errorMessage = error => error instanceof Error ? error.message : String(error);

const summarizeAgents = () => listBlueprints()
  .filter(blueprint => !blueprint.isNora)
  .map(({ name, provider, model, instructions }) => ({ name, provider, model, instructions }));

const summarizeTools = () => listTools().map(tool => ({
  name: tool.name,
  description: tool.description ?? "",
  requiresApproval: Boolean(tool.requiresApproval),
  provider: tool.provider ?? null,
  model: tool.model ?? null,
}));

const summarizeSkills = () => listSkills().map(({ name, content }) => ({ name, content }));

const selectionFrom = (value, validateModelSelection) => {
  if (!value?.provider && !value?.model) return null;
  if (!value?.provider || !value?.model) throw new Error("Provider and model must be configured together");
  return validateModelSelection(value);
};

const resolveTaskModel = (task, blueprint, noraSelection, validateModelSelection) => (
  selectionFrom(task, validateModelSelection)
  ?? selectionFrom(blueprint, validateModelSelection)
  ?? noraSelection
);

const failTaskExecutionSetup = async ({ workflowId, taskId, error }) => {
  const message = errorMessage(error);
  let persistenceError = null;
  console.error("[nora] Task execution setup failed.", { workflowId, taskId, message });

  try {
    const workflow = getWorkflow(workflowId);
    const task = workflow?.tasks?.[taskId];
    if (task?.type === "task" && !["completed", "cancelled", "failed"].includes(task.status)) {
      await setTaskStatus(workflowId, taskId, "failed");
    }
  } catch (statusError) {
    persistenceError = statusError;
    console.error("[nora] Could not persist Task setup failure state.", {
      workflowId,
      taskId,
      message: errorMessage(statusError),
    });
  }

  try {
    await recordEvent("nora.task_execution_failed", { workflowId, taskId, error: message });
  } catch (eventError) {
    console.error("[nora] Could not record Task execution setup failure.", {
      workflowId,
      taskId,
      message: errorMessage(eventError),
    });
  }

  if (persistenceError) {
    throw new Error(`Task ${taskId} failed and its failure state could not be persisted`, {
      cause: persistenceError,
    });
  }
};

export const selectTaskExecution = async ({
  workflowId,
  taskId,
  askForJson,
  noraSelection,
  validateModelSelection,
}) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);

  const task = workflow.tasks?.[taskId];
  if (!task || task.type !== "task") throw new Error(`Unknown executable Task: ${taskId}`);

  const availableAgents = summarizeAgents();
  const availableTools = summarizeTools();
  const availableSkills = summarizeSkills();
  const agents = new Set(availableAgents.map(agent => agent.name));
  const tools = new Set(availableTools.map(tool => tool.name));
  const skills = new Set(availableSkills.map(skill => skill.name));

  const fixedAgent = typeof task.agent === "string" && task.agent.trim() ? task.agent : null;
  const fixedTools = Array.isArray(task.tools) ? [...task.tools] : null;
  const fixedSkills = Array.isArray(task.skills) ? [...task.skills] : null;

  if (fixedAgent && !agents.has(fixedAgent)) throw new Error(`Task requires unknown Agent Blueprint: ${fixedAgent}`);
  if (fixedTools?.some(tool => !tools.has(tool))) throw new Error("Task requires an unknown Tool");
  if (fixedSkills?.some(skill => !skills.has(skill))) throw new Error("Task requires an unknown Skill");

  let decision = {};
  if (!fixedAgent || fixedTools === null || fixedSkills === null) {
    decision = await askForJson(
      [
        "Choose the unspecified execution resources for this ready Task.",
        "",
        "Explicit Task agent, tools, and skills are authoritative constraints and must not be replaced.",
        "Choose only fields marked unspecified in the context.",
        "Agent provider/model is a reasoning default; Task provider/model overrides it.",
        "Tool provider/model belongs to Tool execution and must not be used as the Agent reasoning model.",
        "",
        "Return:",
        '{"agent":"Blueprint Name","tools":[],"skills":[]}',
      ].join("\n"),
      {
        workflow: {
          id: workflow.id,
          process: workflow.process,
          inputs: workflow.inputs,
          config: workflow.config,
        },
        task: { id: taskId, ...task },
        fixed: { agent: fixedAgent, tools: fixedTools, skills: fixedSkills },
        availableAgents,
        availableTools,
        availableSkills,
      },
      noraSelection,
    );
  }

  const agentName = fixedAgent ?? decision.agent;
  const toolNames = fixedTools ?? decision.tools;
  const skillNames = fixedSkills ?? decision.skills;

  if (!agents.has(agentName)) throw new Error(`Nora selected unknown Agent Blueprint: ${agentName}`);
  if (!Array.isArray(toolNames) || toolNames.some(tool => !tools.has(tool))) {
    throw new Error("Nora selected an invalid Tool set");
  }
  if (!Array.isArray(skillNames) || skillNames.some(skill => !skills.has(skill))) {
    throw new Error("Nora selected an invalid Skill set");
  }

  const blueprint = getBlueprint(agentName);
  const modelSelection = resolveTaskModel(task, blueprint, noraSelection, validateModelSelection);
  return { agent: agentName, tools: toolNames, skills: skillNames, ...modelSelection };
};

const runAssignedTask = async (workflowId, task, execution) => {
  let agent = null;

  try {
    agent = createAgent(execution.agent, task.id, { workflowId });
    return await runTask({
      workflowId,
      taskId: task.id,
      agentId: agent.id,
      provider: execution.provider,
      model: execution.model,
      tools: execution.tools,
      skills: execution.skills,
    });
  } catch (error) {
    await failTaskExecutionSetup({ workflowId, taskId: task.id, error });
    return null;
  } finally {
    if (agent) disposeAgent(agent.id);
  }
};

export const runWorkflow = async ({
  workflowId,
  askForJson,
  getNoraSelection,
  validateModelSelection,
}) => {
  let workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);

  const attempts = [];
  while (true) {
    workflow = getWorkflow(workflowId);
    if (["completed", "cancelled", "blocked", "failed"].includes(workflow.status)) break;

    const readyTasks = getReadyTasks(workflowId);
    if (!readyTasks.length) {
      await recordEvent("workflow.stalled", { workflowId, status: workflow.status });
      break;
    }

    const assignments = [];
    for (const task of readyTasks) {
      try {
        const currentWorkflow = getWorkflow(workflowId);
        const execution = await selectTaskExecution({
          workflowId,
          taskId: task.id,
          askForJson,
          noraSelection: getNoraSelection(currentWorkflow),
          validateModelSelection,
        });
        assignments.push({ task, execution });
      } catch (error) {
        await failTaskExecutionSetup({ workflowId, taskId: task.id, error });
      }
    }

    const batch = await Promise.all(
      assignments.map(({ task, execution }) => runAssignedTask(workflowId, task, execution)),
    );
    attempts.push(...batch.filter(Boolean));
  }

  return { workflow: getWorkflow(workflowId), attempts };
};

export const reviewFailedTask = async ({ workflowId, taskId, askForJson, noraSelection }) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);

  const task = workflow.tasks?.[taskId];
  if (!task || task.type !== "task") throw new Error(`Unknown executable Task: ${taskId}`);
  if (task.status !== "failed") throw new Error(`Task ${taskId} is not failed`);

  const decision = await askForJson(
    [
      "Review this failed Task.",
      "",
      "Retry only if the problem is operational, safe to recover, and does not require new human authority.",
      "",
      "Return one of:",
      '{"action":"retry","reason":"...","taskChanges":{}}',
      '{"action":"escalate","reason":"..."}',
    ].join("\n"),
    { workflowId, taskId, task },
    noraSelection,
  );

  if (decision.action === "escalate") {
    await recordEvent("nora.task_escalated", { workflowId, taskId, reason: decision.reason ?? null });
    return decision;
  }
  if (decision.action !== "retry") throw new Error(`Unknown recovery action: ${decision.action}`);

  if (decision.taskChanges && Object.keys(decision.taskChanges).length) {
    await editTask(workflowId, taskId, decision.taskChanges);
  }

  await setTaskStatus(workflowId, taskId, "pending");
  await recordEvent("nora.task_retry_requested", { workflowId, taskId, reason: decision.reason ?? null });
  return decision;
};

export const inspectWorkflow = workflowId => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) return null;

  return {
    workflow,
    approvals: listApprovals("pending").filter(approval => approval.context?.workflowId === workflowId),
  };
};

export const summarizeWorkflow = async ({ workflowId, askForJson, noraSelection }) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
  if (workflow.status !== "completed") throw new Error(`Workflow ${workflowId} is not completed`);

  try {
    const decision = await askForJson(
      [
        "Review this completed Workflow and prepare the result for Carlos.",
        "",
        "Return:",
        '{"summary":"concise useful result for Carlos","result":null}',
      ].join("\n"),
      { workflow },
      noraSelection,
    );

    if (typeof decision.summary !== "string" || !decision.summary.trim()) {
      throw new Error("Nora did not produce a Workflow summary");
    }

    await setWorkflowResult(workflowId, decision.result ?? null);
    await recordEvent("nora.workflow_reviewed", { workflowId });
    return { summary: decision.summary, result: decision.result ?? null };
  } catch (error) {
    const message = errorMessage(error);
    console.error("[nora] Workflow review failed.", { workflowId, message });

    try {
      await recordEvent("nora.workflow_review_failed", { workflowId, error: message });
    } catch (eventError) {
      console.error("[nora] Could not record Workflow review failure.", {
        workflowId,
        message: errorMessage(eventError),
      });
    }

    throw error;
  }
};

export const promoteWorkflow = async ({
  workflowId,
  name,
  purpose = null,
  askForJson,
  noraSelection,
  validateModelSelection,
}) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
  if (!name || typeof name !== "string") throw new Error("Promoted Process must have a name");

  const decision = await askForJson(
    [
      "Carlos explicitly instructed you to promote this Workflow into a reusable Process.",
      "",
      "Remove runtime-only state, attempts, timestamps, outputs, errors, and one-off values.",
      "Preserve reusable Task configuration, including explicit provider/model requirements when present.",
      "",
      "Return:",
      '{"purpose":"...","inputs":[],"start":"start","end":"end","tasks":{},"edges":[]}',
    ].join("\n"),
    { requestedName: name, requestedPurpose: purpose, workflow },
    noraSelection,
  );

  const cleanTasks = Object.fromEntries(
    Object.entries(decision.tasks ?? workflow.tasks).map(([taskId, task]) => {
      const { status: _status, attempts: _attempts, ...definition } = task;
      return [taskId, definition];
    }),
  );
  const process = await createNoraProcess({
    process: {
      name,
      purpose: purpose ?? decision.purpose ?? "",
      inputs: Array.isArray(decision.inputs) ? decision.inputs : Object.keys(workflow.inputs ?? {}),
      start: decision.start ?? workflow.start,
      end: decision.end ?? workflow.end,
      tasks: cleanTasks,
      edges: Array.isArray(decision.edges) ? decision.edges : workflow.edges,
    },
    askForJson,
    modelSelection: noraSelection,
    validateModelSelection,
  });

  await recordEvent("process.promoted", { workflowId, process: process.name });
  return process;
};