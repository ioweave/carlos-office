import { randomUUID } from "node:crypto";

import { recordEvent } from "../controllers/EventController.mjs";
import {
  addTaskAttempt,
  getReadyTasks,
  getWorkflow,
  listTaskAttempts,
  setTaskStatus,
  updateTaskAttempt,
} from "../controllers/ProcessController.mjs";
import { getAgent, listAgents } from "../registry/Agents.mjs";
import { getSkill, listSkills } from "../registry/Skills.mjs";
import { getTool, listTools } from "../registry/Tools.mjs";
import {
  cancelWorkflowAgents,
  listActiveAgents,
  runAgentProcess,
  stopAllAgents,
} from "../runtime/AgentProcesses.mjs";

const activeRuns = new Map();

const errorMessage = error => error instanceof Error ? error.message : String(error);

const selectionFrom = (value, validateModelSelection) => {
  if (!value?.provider && !value?.model) return null;
  if (!value?.provider || !value?.model) throw new Error("Provider and model must be configured together");
  return validateModelSelection(value);
};

const resolveTaskModel = (task, definition, noraSelection, validateModelSelection) => (
  selectionFrom(task, validateModelSelection)
  ?? selectionFrom(definition, validateModelSelection)
  ?? noraSelection
);

const upstreamTaskIds = (workflow, taskId) => workflow.edges
  .filter(([, to]) => to === taskId)
  .map(([from]) => from)
  .filter(id => workflow.tasks[id]?.type === "task");

const latestCompletedAttempt = task => [...(task.attempts ?? [])]
  .reverse()
  .find(attempt => attempt.status === "completed") ?? null;

const resolveTaskInput = (workflow, taskId, task) => {
  const available = structuredClone(workflow.inputs ?? {});

  for (const upstreamId of upstreamTaskIds(workflow, taskId)) {
    const upstream = workflow.tasks[upstreamId];
    const attempt = latestCompletedAttempt(upstream);
    if (!attempt) continue;
    if (upstream.output) available[upstream.output] = structuredClone(attempt.output);
    available[upstreamId] = structuredClone(attempt.output);
  }

  if (!Array.isArray(task.inputs) || !task.inputs.length) return available;
  return Object.fromEntries(
    task.inputs
      .filter(name => Object.prototype.hasOwnProperty.call(available, name))
      .map(name => [name, available[name]]),
  );
};

const loadTools = names => names.map(name => {
  const tool = getTool(name);
  if (!tool) throw new Error(`Unknown Tool: ${name}`);
  return tool;
});

const loadSkills = names => names.map(name => {
  const skill = getSkill(name);
  if (!skill) throw new Error(`Unknown Skill: ${name}`);
  return skill;
});

const finishAttempt = (workflowId, taskId, attemptId, changes) => updateTaskAttempt(
  workflowId,
  taskId,
  attemptId,
  { ...changes, endedAt: new Date().toISOString() },
);

const failSetup = async (workflowId, taskId, error) => {
  const message = errorMessage(error);
  const workflow = getWorkflow(workflowId);
  const task = workflow?.tasks?.[taskId];
  if (task?.type === "task" && !["completed", "cancelled", "failed"].includes(task.status)) {
    await setTaskStatus(workflowId, taskId, "failed");
  }
  await recordEvent("task.execution_failed", { workflowId, taskId, error: message });
};

export const selectTaskExecution = async ({
  workflowId,
  taskId,
  decide,
  noraSelection,
  validateModelSelection,
}) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown Workflow: ${workflowId}`);
  const task = workflow.tasks?.[taskId];
  if (!task || task.type !== "task") throw new Error(`Unknown executable Task: ${taskId}`);

  const availableAgents = listAgents()
    .filter(definition => !definition.isNora)
    .map(({ name, provider, model, instructions, tools, skills }) => ({
      name, provider, model, instructions, tools, skills,
    }));
  const availableTools = listTools().map(tool => ({
    name: tool.name,
    description: tool.description ?? "",
    requiresApproval: Boolean(tool.requiresApproval),
  }));
  const availableSkills = listSkills().map(({ name, content }) => ({ name, content }));
  const agentNames = new Set(availableAgents.map(agent => agent.name));
  const toolNames = new Set(availableTools.map(tool => tool.name));
  const skillNames = new Set(availableSkills.map(skill => skill.name));

  const fixedAgent = typeof task.agent === "string" && task.agent.trim() ? task.agent : null;
  const fixedTools = Array.isArray(task.tools) ? [...task.tools] : null;
  const fixedSkills = Array.isArray(task.skills) ? [...task.skills] : null;

  if (fixedAgent && !agentNames.has(fixedAgent)) throw new Error(`Task requires unknown Agent: ${fixedAgent}`);
  if (fixedTools?.some(name => !toolNames.has(name))) throw new Error("Task requires an unknown Tool");
  if (fixedSkills?.some(name => !skillNames.has(name))) throw new Error("Task requires an unknown Skill");

  let decision = {};
  if (!fixedAgent || fixedTools === null || fixedSkills === null) {
    decision = await decide(
      [
        "Choose the unspecified execution resources for this ready Task.",
        "Explicit Task agent, tools, and skills are authoritative constraints and must not be replaced.",
        "Return only:",
        '{"agent":"Agent Name","tools":[],"skills":[]}',
      ].join("\n\n"),
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
  if (!agentNames.has(agentName)) throw new Error(`Nora selected unknown Agent: ${agentName}`);
  const definition = getAgent(agentName);
  const selectedTools = fixedTools ?? (Array.isArray(decision.tools) ? decision.tools : definition.tools ?? []);
  const selectedSkills = fixedSkills ?? (Array.isArray(decision.skills) ? decision.skills : definition.skills ?? []);

  if (selectedTools.some(name => !toolNames.has(name))) throw new Error("Nora selected an invalid Tool set");
  if (selectedSkills.some(name => !skillNames.has(name))) throw new Error("Nora selected an invalid Skill set");

  return {
    agent: agentName,
    tools: selectedTools,
    skills: selectedSkills,
    ...resolveTaskModel(task, definition, noraSelection, validateModelSelection),
  };
};

const runTask = async ({ workflowId, taskId, execution }) => {
  const workflow = getWorkflow(workflowId);
  const task = workflow?.tasks?.[taskId];
  if (!task || task.type !== "task") throw new Error(`Unknown executable Task: ${taskId}`);
  if (task.status !== "ready") throw new Error(`Task ${taskId} is ${task.status}, not ready`);

  const definition = getAgent(execution.agent);
  if (!definition || definition.isNora) throw new Error(`Invalid specialist Agent: ${execution.agent}`);
  const tools = loadTools(execution.tools);
  const skills = loadSkills(execution.skills);
  const input = resolveTaskInput(workflow, taskId, task);
  const previousAttempts = listTaskAttempts(workflowId, taskId);
  const attempt = {
    id: `attempt-${randomUUID()}`,
    workflowId,
    taskId,
    attempt: previousAttempts.length + 1,
    agent: definition.name,
    provider: execution.provider,
    model: execution.model,
    status: "running",
    input: structuredClone(input),
    tools: [...execution.tools],
    skills: [...execution.skills],
    startedAt: new Date().toISOString(),
    endedAt: null,
    output: null,
    error: null,
    blockedReason: null,
  };

  await addTaskAttempt(workflowId, taskId, attempt);
  await setTaskStatus(workflowId, taskId, "running");
  await recordEvent("attempt.started", {
    workflowId,
    taskId,
    attemptId: attempt.id,
    agent: definition.name,
    provider: execution.provider,
    model: execution.model,
  });

  let result;
  try {
    result = await runAgentProcess({
      definition,
      workflowId,
      taskId,
      task: { ...task, input },
      provider: execution.provider,
      model: execution.model,
      tools,
      skills,
    });
  } catch (error) {
    result = { status: "failed", error: errorMessage(error) };
  }

  if (result.status === "completed") {
    const completed = await finishAttempt(workflowId, taskId, attempt.id, {
      status: "completed",
      output: result.output,
      error: null,
      blockedReason: null,
    });
    await setTaskStatus(workflowId, taskId, "completed");
    await recordEvent("attempt.completed", {
      workflowId,
      taskId,
      attemptId: attempt.id,
      agent: definition.name,
    });
    return completed;
  }

  if (result.status === "blocked") {
    const reason = result.error || "Carlos approval required";
    const blocked = await finishAttempt(workflowId, taskId, attempt.id, {
      status: "blocked",
      error: null,
      blockedReason: reason,
      approvalId: result.approvalId ?? null,
    });
    await setTaskStatus(workflowId, taskId, "blocked");
    await recordEvent("attempt.blocked", {
      workflowId,
      taskId,
      attemptId: attempt.id,
      agent: definition.name,
      approvalId: result.approvalId ?? null,
    });
    return blocked;
  }

  if (result.status === "cancelled" || getWorkflow(workflowId)?.status === "cancelled") {
    const cancelled = await finishAttempt(workflowId, taskId, attempt.id, {
      status: "cancelled",
      error: result.error ?? "Workflow cancelled",
    });
    await recordEvent("attempt.cancelled", {
      workflowId,
      taskId,
      attemptId: attempt.id,
      agent: definition.name,
    });
    return cancelled;
  }

  const message = result.error || "Agent process failed";
  const failed = await finishAttempt(workflowId, taskId, attempt.id, {
    status: "failed",
    error: message,
  });
  await setTaskStatus(workflowId, taskId, "failed");
  await recordEvent("attempt.failed", {
    workflowId,
    taskId,
    attemptId: attempt.id,
    agent: definition.name,
    error: message,
  });
  return failed;
};

const runWorkflowInternal = async ({
  workflowId,
  decide,
  getNoraSelection,
  validateModelSelection,
}) => {
  const attempts = [];

  while (true) {
    const workflow = getWorkflow(workflowId);
    if (!workflow) throw new Error(`Unknown Workflow: ${workflowId}`);
    if (["completed", "cancelled", "blocked", "failed"].includes(workflow.status)) break;

    const readyTasks = getReadyTasks(workflowId);
    if (!readyTasks.length) {
      await recordEvent("workflow.stalled", { workflowId, status: workflow.status });
      break;
    }

    const assignments = [];
    for (const task of readyTasks) {
      try {
        const current = getWorkflow(workflowId);
        const execution = await selectTaskExecution({
          workflowId,
          taskId: task.id,
          decide,
          noraSelection: getNoraSelection(current),
          validateModelSelection,
        });
        assignments.push({ taskId: task.id, execution });
      } catch (error) {
        await failSetup(workflowId, task.id, error);
      }
    }

    const batch = await Promise.all(assignments.map(({ taskId, execution }) => (
      runTask({ workflowId, taskId, execution })
    )));
    attempts.push(...batch);
  }

  return { workflow: getWorkflow(workflowId), attempts };
};

export const runWorkflow = options => {
  const existing = activeRuns.get(options.workflowId);
  if (existing) return existing;

  const run = runWorkflowInternal(options).finally(() => {
    if (activeRuns.get(options.workflowId) === run) activeRuns.delete(options.workflowId);
  });
  activeRuns.set(options.workflowId, run);
  return run;
};

export const cancelWorkflowExecution = (workflowId, reason = "Workflow cancelled") => (
  cancelWorkflowAgents(workflowId, reason)
);

export const listAgentProcesses = () => listActiveAgents();

export const shutdownProcessEngine = () => {
  stopAllAgents("Carlos Office platform shutting down");
};
