import {
  createAdHocWorkflow,
  createWorkflow,
  editTask,
  getProcess,
  getReadyTasks,
  getWorkflow,
  listProcesses,
  saveProcess,
  setTaskStatus,
  setWorkflowConfig,
  setWorkflowResult,
} from "./ProcessController.mjs";
import {
  createAgent,
  disposeAgent,
  getBlueprint,
  getNoraBlueprint,
  listBlueprints,
  setBlueprintModel,
} from "./AgentController.mjs";
import { listApprovals } from "./AuthorizationController.mjs";
import {
  addMessage,
  addWorkflow,
  createConversation as persistConversation,
  getConversation,
  setConversationNoraModel,
} from "./ConversationController.mjs";
import { recordEvent } from "./EventController.mjs";
import { runTask } from "./TaskController.mjs";
import { listSkills } from "../registry/Skills.mjs";
import { listTools } from "../registry/Tools.mjs";
import {
  createOrUpdateSkill as saveNoraSkill,
  createOrUpdateTool as saveNoraTool,
  createProcess as createNoraProcess,
  createProcessSchedule,
  ensureValidGeneratedGraph,
  executeCreationPlan,
  getNoraRequestDecisionInstruction,
} from "../services/NoraCreationService.mjs";

let providers = new Map();

const state = {
  name: "Nora",
  status: "idle",
  activeWorkflows: new Set(),
};

const errorMessage = error => error instanceof Error ? error.message : String(error);

export const setProviders = providerMap => {
  if (!(providerMap instanceof Map)) throw new Error("Providers must be supplied as a Map");
  providers = providerMap;
};

const validateSelection = ({ provider, model }) => {
  if (!provider || typeof provider !== "string") throw new Error("Provider must be a non-empty string");
  if (!model || typeof model !== "string") throw new Error("Model must be a non-empty string");
  if (!providers.has(provider)) throw new Error(`Unknown model provider: ${provider}`);

  return { provider: provider.trim(), model: model.trim() };
};

const selectionFrom = value => {
  if (!value?.provider && !value?.model) return null;
  if (!value?.provider || !value?.model) throw new Error("Provider and model must be configured together");
  return validateSelection(value);
};

const getDefaultNoraSelection = () => {
  const blueprint = getNoraBlueprint();
  if (!blueprint) throw new Error("Nora.md was not found in ObsidianVault/90-System/Agents");
  return selectionFrom(blueprint);
};

const getWorkflowNoraSelection = workflow => selectionFrom(workflow.config?.nora) ?? getDefaultNoraSelection();

const refreshNoraStatus = () => {
  let working = false;
  let blocked = false;

  for (const workflowId of [...state.activeWorkflows]) {
    const workflow = getWorkflow(workflowId);
    if (!workflow || ["completed", "cancelled", "failed"].includes(workflow.status)) {
      state.activeWorkflows.delete(workflowId);
      continue;
    }

    working = true;
    if (workflow.status === "blocked") blocked = true;
  }

  state.status = blocked ? "blocked" : working ? "working" : "idle";
  return state.status;
};

export const initializeNora = () => {
  getDefaultNoraSelection();
  refreshNoraStatus();
  return getNoraState();
};

export const getNoraState = () => {
  const blueprint = getNoraBlueprint();
  return {
    name: state.name,
    status: state.status,
    provider: blueprint?.provider ?? null,
    model: blueprint?.model ?? null,
    activeWorkflows: [...state.activeWorkflows],
  };
};

export const listModels = () => [...providers.entries()].map(([name, provider]) => ({
  provider: name,
  models: Array.isArray(provider.models) ? [...provider.models] : [],
}));

export const setAgentModel = async (name, selection) => setBlueprintModel(name, validateSelection(selection));

export const createConversation = async ({ id = null, provider = null, model = null } = {}) => {
  let selection;

  if (provider || model) {
    selection = validateSelection({ provider, model });
    await setBlueprintModel("Nora", selection);
  } else {
    selection = getDefaultNoraSelection();
  }

  return persistConversation({ id, nora: selection });
};

export const setConversationModel = async (conversationId, selection) => {
  const selected = validateSelection(selection);
  await setBlueprintModel("Nora", selected);
  const conversation = await setConversationNoraModel(conversationId, selected);

  for (const workflowId of conversation.workflows) {
    const workflow = getWorkflow(workflowId);
    if (!workflow || ["completed", "cancelled"].includes(workflow.status)) continue;
    await setWorkflowConfig(workflowId, { ...(workflow.config ?? {}), nora: structuredClone(selected) });
  }

  return conversation;
};

const requireProvider = selection => {
  const selected = validateSelection(selection);
  const provider = providers.get(selected.provider);
  if (typeof provider?.generate !== "function") {
    throw new Error(`Model provider ${selected.provider} does not expose generate()`);
  }
  return { provider, selection: selected };
};

const parseJson = content => {
  if (typeof content !== "string" || !content.trim()) throw new Error("Nora returned an empty response");

  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const source = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("Nora did not return valid JSON");
    return JSON.parse(source.slice(start, end + 1));
  }
};

const askNoraForJson = async (instruction, context, modelSelection) => {
  const { provider, selection } = requireProvider(modelSelection);
  const blueprint = getNoraBlueprint();
  const messages = [];

  if (blueprint.instructions) messages.push({ role: "system", content: blueprint.instructions });
  messages.push({
    role: "system",
    content: [
      "You are Nora, the Chief of Staff of Carlos Office.",
      "Carlos is the final human authority.",
      "Return only valid JSON for this decision.",
      "Do not wrap the JSON in explanation.",
    ].join("\n"),
  });
  messages.push({
    role: "user",
    content: [instruction, "", "Context:", JSON.stringify(context, null, 2)].join("\n"),
  });

  const response = await provider.generate({ model: selection.model, messages, tools: [] });
  return parseJson(response?.content);
};

const summarizeProcesses = () => listProcesses().map(({ name, purpose = "", inputs = [] }) => ({
  name,
  purpose,
  inputs,
}));

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

const conversationForModel = conversation => conversation.messages.map(({ actor, content, artifacts = [] }) => ({
  actor,
  content,
  artifacts,
}));

const ensureConversationSelection = async conversation => {
  const selected = selectionFrom(conversation.nora);
  if (selected) return selected;

  const fallback = getDefaultNoraSelection();
  await setConversationNoraModel(conversation.id, fallback);
  return fallback;
};

const addNoraMessage = async (conversationId, content) => addMessage(conversationId, {
  actor: "Nora",
  content,
});

const toolMetadata = tool => ({
  name: tool.name,
  description: tool.description ?? "",
  requiresApproval: Boolean(tool.requiresApproval),
  provider: tool.provider ?? null,
  model: tool.model ?? null,
});

const creationMessage = (decision, fallback) => decision.response?.trim() || fallback;

const recordRequestFailure = async ({ conversationId, phase, action, error }) => {
  const message = errorMessage(error);
  console.error("[nora] Request failed.", { conversationId, phase, action, message });

  try {
    await recordEvent("nora.request_failed", {
      conversationId,
      phase,
      action: action ?? null,
      error: message,
    });
  } catch (eventError) {
    console.error("[nora] Could not record request failure.", {
      conversationId,
      message: errorMessage(eventError),
    });
  }

  return message;
};

export const handleCarlosRequest = async ({ conversationId, content, artifacts = [] }) => {
  if (typeof content !== "string" || !content.trim()) throw new Error("Carlos request must be a non-empty string");

  let conversation = await getConversation(conversationId);
  if (!conversation) throw new Error(`Unknown conversation: ${conversationId}`);

  await addMessage(conversationId, { actor: "Carlos", content, artifacts });
  state.status = "working";
  await recordEvent("nora.request_received", { conversationId });

  let phase = "selection";
  let action = null;
  let activeWorkflowId = null;
  let noraSelection = null;

  try {
    conversation = await getConversation(conversationId);
    noraSelection = await ensureConversationSelection(conversation);
    phase = "decision";
    const decision = await askNoraForJson(
      getNoraRequestDecisionInstruction(),
      {
        conversation: conversationForModel(conversation),
        availableProcesses: summarizeProcesses(),
        availableTools: summarizeTools(),
        availableSkills: summarizeSkills(),
      },
      noraSelection,
    );

    action = decision.action;

    if (["respond", "clarify"].includes(action)) {
      if (typeof decision.response !== "string" || !decision.response.trim()) {
        throw new Error(`Nora ${action} decision requires a response`);
      }

      const message = await addNoraMessage(conversationId, decision.response);
      refreshNoraStatus();
      return { action, message, workflow: null };
    }

    phase = "creation";

    if (action === "tool") {
      const tool = await saveNoraTool(decision.name, decision.source);
      const message = await addNoraMessage(conversationId, creationMessage(decision, `Tool ${tool.name} saved.`));
      refreshNoraStatus();
      return { action, message, workflow: null, tool: toolMetadata(tool) };
    }

    if (action === "skill") {
      const skill = await saveNoraSkill(decision.name, decision.content);
      const message = await addNoraMessage(conversationId, creationMessage(decision, `Skill ${skill.name} saved.`));
      refreshNoraStatus();
      return { action, message, workflow: null, skill: { name: skill.name } };
    }

    if (action === "create_process") {
      const process = await createNoraProcess({
        process: decision.process,
        askForJson: askNoraForJson,
        modelSelection: noraSelection,
      });
      const message = await addNoraMessage(
        conversationId,
        creationMessage(decision, `Process ${process.name} saved and ready to reuse.`),
      );
      refreshNoraStatus();
      return { action, message, workflow: null, process };
    }

    if (action === "create_schedule") {
      const schedule = await createProcessSchedule(decision.schedule);
      const message = await addNoraMessage(
        conversationId,
        creationMessage(decision, `Schedule ${schedule.id} created for Process ${schedule.process}.`),
      );
      refreshNoraStatus();
      return { action, message, workflow: null, schedule };
    }

    if (action === "plan") {
      const results = await executeCreationPlan({
        steps: decision.steps,
        askForJson: askNoraForJson,
        modelSelection: noraSelection,
      });
      const summary = results.map(result => result.name || result.id).filter(Boolean).join(", ");
      const message = await addNoraMessage(
        conversationId,
        creationMessage(decision, `Creation plan completed: ${summary || "requested capabilities saved"}.`),
      );
      refreshNoraStatus();
      return { action, message, workflow: null, plan: results };
    }

    const config = { ...(decision.config ?? {}), nora: structuredClone(noraSelection) };
    let workflow;

    if (action === "process") {
      if (!getProcess(decision.process)) throw new Error(`Nora selected unknown Process: ${decision.process}`);
      workflow = await createWorkflow(decision.process, decision.inputs ?? {}, config);
    } else if (action === "adhoc") {
      const definition = await ensureValidGeneratedGraph({
        definition: decision.workflow,
        label: "ad-hoc Workflow",
        askForJson: askNoraForJson,
        modelSelection: noraSelection,
      });
      workflow = await createAdHocWorkflow({
        ...definition,
        inputs: decision.inputs ?? {},
        config,
      });
    } else {
      throw new Error(`Unknown Nora action: ${action}`);
    }

    activeWorkflowId = workflow.id;
    state.activeWorkflows.add(workflow.id);
    await addWorkflow(conversationId, workflow.id);
    await recordEvent("nora.workflow_started", {
      conversationId,
      workflowId: workflow.id,
      process: workflow.process,
    });

    phase = "workflow";
    const execution = await runWorkflow(workflow.id);
    const finalWorkflow = execution.workflow;

    if (finalWorkflow.status === "completed") {
      phase = "review";
      const result = await summarizeWorkflow(finalWorkflow.id);
      const message = await addNoraMessage(conversationId, result.summary);
      refreshNoraStatus();
      return { action, message, workflow: getWorkflow(workflow.id) };
    }

    const response = decision.response ?? (
      finalWorkflow.status === "blocked"
        ? `Workflow ${workflow.id} is blocked and requires attention.`
        : finalWorkflow.status === "failed"
          ? `Workflow ${workflow.id} stopped because a Task failed.`
          : `Workflow ${workflow.id} is active.`
    );

    const message = await addNoraMessage(conversationId, response);
    refreshNoraStatus();
    return { action, message, workflow: finalWorkflow };
  } catch (error) {
    const failure = await recordRequestFailure({ conversationId, phase, action, error });
    let message = null;

    try {
      message = await addNoraMessage(
        conversationId,
        `I couldn't complete that request. ${failure}`,
      );
    } catch (messageError) {
      console.error("[nora] Could not persist failure message.", {
        conversationId,
        message: errorMessage(messageError),
      });
    }

    refreshNoraStatus();
    if (!message) throw error;

    return {
      action: "failed",
      message,
      workflow: activeWorkflowId ? getWorkflow(activeWorkflowId) : null,
      error: { phase, message: failure },
    };
  }
};

const resolveTaskModel = (task, agentBlueprint, noraSelection) => (
  selectionFrom(task) ?? selectionFrom(agentBlueprint) ?? noraSelection
);

export const selectTaskExecution = async (workflowId, taskId) => {
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

  const noraSelection = getWorkflowNoraSelection(workflow);
  let decision = {};

  if (!fixedAgent || fixedTools === null || fixedSkills === null) {
    decision = await askNoraForJson(
      [
        "Choose the unspecified execution resources for this ready Task.",
        "",
        "Explicit Task agent/tools/skills are authoritative constraints and must not be replaced.",
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

  const agentBlueprint = getBlueprint(agentName);
  const modelSelection = resolveTaskModel(task, agentBlueprint, noraSelection);
  return { agent: agentName, tools: toolNames, skills: skillNames, ...modelSelection };
};

export const runWorkflow = async workflowId => {
  let workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);

  state.activeWorkflows.add(workflowId);
  refreshNoraStatus();
  const attempts = [];

  while (true) {
    workflow = getWorkflow(workflowId);
    if (["completed", "cancelled", "blocked", "failed"].includes(workflow.status)) break;

    const readyTasks = getReadyTasks(workflowId);
    if (!readyTasks.length) {
      await recordEvent("workflow.stalled", { workflowId, status: workflow.status });
      break;
    }

    const batch = await Promise.all(readyTasks.map(async task => {
      const execution = await selectTaskExecution(workflowId, task.id);
      const agent = createAgent(execution.agent, task.id, { workflowId });

      try {
        return await runTask({
          workflowId,
          taskId: task.id,
          agentId: agent.id,
          provider: execution.provider,
          model: execution.model,
          tools: execution.tools,
          skills: execution.skills,
        });
      } finally {
        disposeAgent(agent.id);
      }
    }));

    attempts.push(...batch);
  }

  workflow = getWorkflow(workflowId);
  refreshNoraStatus();
  return { workflow, attempts };
};

export const reviewFailedTask = async (workflowId, taskId) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);

  const task = workflow.tasks?.[taskId];
  if (!task || task.type !== "task") throw new Error(`Unknown executable Task: ${taskId}`);
  if (task.status !== "failed") throw new Error(`Task ${taskId} is not failed`);

  const decision = await askNoraForJson(
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
    getWorkflowNoraSelection(workflow),
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

export const summarizeWorkflow = async workflowId => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
  if (workflow.status !== "completed") throw new Error(`Workflow ${workflowId} is not completed`);

  const decision = await askNoraForJson(
    [
      "Review this completed Workflow and prepare the result for Carlos.",
      "",
      "Return:",
      '{"summary":"concise useful result for Carlos","result":null}',
    ].join("\n"),
    { workflow },
    getWorkflowNoraSelection(workflow),
  );

  if (typeof decision.summary !== "string" || !decision.summary.trim()) {
    throw new Error("Nora did not produce a Workflow summary");
  }

  await setWorkflowResult(workflowId, decision.result ?? null);
  await recordEvent("nora.workflow_reviewed", { workflowId });
  return { summary: decision.summary, result: decision.result ?? null };
};

export const createOrUpdateTool = async (name, source) => saveNoraTool(name, source);

export const createOrUpdateSkill = async (name, content) => saveNoraSkill(name, content);

export const promoteWorkflow = async (workflowId, { name, purpose = null }) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
  if (!name || typeof name !== "string") throw new Error("Promoted Process must have a name");

  const decision = await askNoraForJson(
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
    getWorkflowNoraSelection(workflow),
  );

  const cleanTasks = Object.fromEntries(
    Object.entries(decision.tasks ?? workflow.tasks).map(([taskId, task]) => {
      const { status: _status, attempts: _attempts, ...definition } = task;
      return [taskId, definition];
    }),
  );

  const graph = await ensureValidGeneratedGraph({
    definition: {
      start: decision.start ?? workflow.start,
      end: decision.end ?? workflow.end,
      tasks: cleanTasks,
      edges: Array.isArray(decision.edges) ? decision.edges : workflow.edges,
    },
    label: `promoted Process ${name}`,
    askForJson: askNoraForJson,
    modelSelection: getWorkflowNoraSelection(workflow),
  });

  const process = await saveProcess({
    name,
    purpose: purpose ?? decision.purpose ?? "",
    inputs: Array.isArray(decision.inputs) ? decision.inputs : Object.keys(workflow.inputs ?? {}),
    ...graph,
  });

  await recordEvent("process.promoted", { workflowId, process: process.name });
  return process;
};