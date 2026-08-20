import {
  createAdHocWorkflow,
  createWorkflow,
  getProcess,
  getWorkflow,
  listProcesses,
  setWorkflowConfig,
} from "./ProcessController.mjs";
import { getNoraBlueprint, setBlueprintModel } from "./AgentController.mjs";
import {
  addMessage,
  addWorkflow,
  createConversation as persistConversation,
  getConversation,
  setConversationNoraModel,
} from "./ConversationController.mjs";
import { recordEvent } from "./EventController.mjs";
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
import {
  inspectWorkflow as inspectManagedWorkflow,
  promoteWorkflow as promoteManagedWorkflow,
  reviewFailedTask as reviewManagedTask,
  runWorkflow as runManagedWorkflow,
  selectTaskExecution as selectWorkflowTaskExecution,
  summarizeWorkflow as summarizeManagedWorkflow,
} from "../services/NoraWorkflowService.mjs";

let providers = new Map();
let noraDecisionQueue = Promise.resolve();

const state = {
  name: "Nora",
  status: "idle",
  activeWorkflows: new Set(),
};

const errorMessage = error => error instanceof Error ? error.message : String(error);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

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

const runNoraDecision = async (instruction, context, modelSelection) => {
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

const askNoraForJson = async (instruction, context, modelSelection) => {
  const previous = noraDecisionQueue.catch(() => {});
  const next = previous.then(() => runNoraDecision(instruction, context, modelSelection));
  noraDecisionQueue = next.then(() => undefined, () => undefined);
  return next;
};

const summarizeProcesses = () => listProcesses().map(({ name, purpose = "", inputs = [] }) => ({
  name,
  purpose,
  inputs,
}));

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

  state.status = "working";

  let phase = "intake";
  let action = null;
  let activeWorkflowId = null;
  let noraSelection = null;

  try {
    await addMessage(conversationId, { actor: "Carlos", content, artifacts });
    await recordEvent("nora.request_received", { conversationId });
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

    if (!isObject(decision)) throw new Error("Nora decision must be an object");
    if (typeof decision.action !== "string" || !decision.action.trim()) {
      throw new Error("Nora decision must include an action");
    }
    if (decision.response != null && typeof decision.response !== "string") {
      throw new Error("Nora decision response must be a string when present");
    }

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
        validateModelSelection: validateSelection,
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
        validateModelSelection: validateSelection,
      });
      const summary = results.map(result => result.name || result.id).filter(Boolean).join(", ");
      const message = await addNoraMessage(
        conversationId,
        creationMessage(decision, `Creation plan completed: ${summary || "requested capabilities saved"}.`),
      );
      refreshNoraStatus();
      return { action, message, workflow: null, plan: results };
    }

    if (decision.config != null && !isObject(decision.config)) {
      throw new Error("Nora Workflow config must be an object");
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
      workflow = await createAdHocWorkflow({ ...definition, inputs: decision.inputs ?? {}, config });
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
      message = await addNoraMessage(conversationId, `I couldn't complete that request. ${failure}`);
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

export const selectTaskExecution = async (workflowId, taskId) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);

  return selectWorkflowTaskExecution({
    workflowId,
    taskId,
    askForJson: askNoraForJson,
    noraSelection: getWorkflowNoraSelection(workflow),
    validateModelSelection: validateSelection,
  });
};

export const runWorkflow = async workflowId => {
  if (!getWorkflow(workflowId)) throw new Error(`Unknown workflow: ${workflowId}`);

  state.activeWorkflows.add(workflowId);
  refreshNoraStatus();

  try {
    return await runManagedWorkflow({
      workflowId,
      askForJson: askNoraForJson,
      getNoraSelection: getWorkflowNoraSelection,
      validateModelSelection: validateSelection,
    });
  } finally {
    refreshNoraStatus();
  }
};

export const reviewFailedTask = async (workflowId, taskId) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);

  return reviewManagedTask({
    workflowId,
    taskId,
    askForJson: askNoraForJson,
    noraSelection: getWorkflowNoraSelection(workflow),
  });
};

export const inspectWorkflow = workflowId => inspectManagedWorkflow(workflowId);

export const summarizeWorkflow = async workflowId => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);

  return summarizeManagedWorkflow({
    workflowId,
    askForJson: askNoraForJson,
    noraSelection: getWorkflowNoraSelection(workflow),
  });
};

export const createOrUpdateTool = async (name, source) => saveNoraTool(name, source);

export const createOrUpdateSkill = async (name, content) => saveNoraSkill(name, content);

export const promoteWorkflow = async (workflowId, { name, purpose = null }) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);

  return promoteManagedWorkflow({
    workflowId,
    name,
    purpose,
    askForJson: askNoraForJson,
    noraSelection: getWorkflowNoraSelection(workflow),
    validateModelSelection: validateSelection,
  });
};