import { getArtifact, readArtifact } from "./ArtifactController.mjs";
import { listApprovals } from "./AuthorizationController.mjs";
import {
  addMessage,
  addWorkflow,
  createConversation as persistConversation,
  getConversation,
  setConversationNoraModel,
} from "./ConversationController.mjs";
import { recordEvent } from "./EventController.mjs";
import {
  createAdHocWorkflow,
  createWorkflow,
  editTask,
  getProcess,
  getWorkflow,
  listProcesses,
  setTaskStatus,
  setWorkflowConfig,
  setWorkflowResult,
} from "./ProcessController.mjs";
import { getNora, setAgentModel as persistAgentModel } from "../registry/Agents.mjs";
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
  runWorkflow as runProcessWorkflow,
  selectTaskExecution as selectProcessTaskExecution,
} from "../services/ProcessEngine.mjs";
import {
  decide as decideInNoraProcess,
  getNoraProcessState,
  listModels as listProcessModels,
  startNora,
} from "../runtime/NoraProcess.mjs";

const state = {
  name: "Nora",
  status: "idle",
  activeWorkflows: new Set(),
};

const TEXT_ARTIFACT_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/xml",
  "application/sql",
  "text/javascript",
  "text/typescript",
]);
const TEXT_ARTIFACT_EXTENSIONS = [
  ".c", ".cpp", ".css", ".go", ".h", ".html", ".ini", ".java", ".js", ".json", ".jsx",
  ".kt", ".lua", ".md", ".mjs", ".php", ".py", ".rb", ".rs", ".scss", ".sh", ".sql",
  ".swift", ".toml", ".ts", ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml",
];

const errorMessage = error => error instanceof Error ? error.message : String(error);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const validateSelection = ({ provider, model }) => {
  if (!provider || typeof provider !== "string") throw new Error("Provider must be a non-empty string");
  if (!model || typeof model !== "string") throw new Error("Model must be a non-empty string");

  const knownProviders = new Set(listProcessModels().map(item => item.provider));
  if (!knownProviders.has(provider)) throw new Error(`Unknown model provider: ${provider}`);
  return { provider: provider.trim(), model: model.trim() };
};

const selectionFrom = value => {
  if (!value?.provider && !value?.model) return null;
  if (!value?.provider || !value?.model) throw new Error("Provider and model must be configured together");
  return validateSelection(value);
};

const getDefaultNoraSelection = () => {
  const definition = getNora();
  if (!definition) throw new Error("Nora.md was not found in ObsidianVault/90-System/Agents");
  return selectionFrom(definition);
};

const getWorkflowNoraSelection = workflow => selectionFrom(workflow.config?.nora) ?? getDefaultNoraSelection();

const refreshNoraStatus = () => {
  let working = getNoraProcessState().status === "working";
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

export const initializeNora = async () => {
  await startNora();
  getDefaultNoraSelection();
  refreshNoraStatus();
  return getNoraState();
};

export const getNoraState = () => {
  refreshNoraStatus();
  const definition = getNora();
  const runtime = getNoraProcessState();
  return {
    name: state.name,
    status: state.status,
    provider: definition?.provider ?? null,
    model: definition?.model ?? null,
    pid: runtime.pid,
    processRunning: runtime.running,
    activeWorkflows: [...state.activeWorkflows],
  };
};

export const listModels = () => listProcessModels();

export const setAgentModel = async (name, selection) => persistAgentModel(name, validateSelection(selection));

export const createConversation = async ({ id = null, provider = null, model = null } = {}) => {
  const selection = provider || model
    ? validateSelection({ provider, model })
    : getDefaultNoraSelection();
  return persistConversation({ id, nora: selection });
};

export const setConversationModel = async (conversationId, selection) => {
  const selected = validateSelection(selection);
  const conversation = await setConversationNoraModel(conversationId, selected);

  for (const workflowId of conversation.workflows) {
    const workflow = getWorkflow(workflowId);
    if (!workflow || ["completed", "cancelled", "failed"].includes(workflow.status)) continue;
    await setWorkflowConfig(workflowId, { ...(workflow.config ?? {}), nora: structuredClone(selected) });
  }

  return conversation;
};

const askNoraForJson = (instruction, context, modelSelection) => decideInNoraProcess({
  definition: getNora(),
  selection: validateSelection(modelSelection),
  instruction,
  context,
});

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

const skillDescription = content => String(content ?? "")
  .split(/\r?\n/)
  .map(line => line.trim())
  .find(Boolean)
  ?.replace(/^#+\s*/, "") ?? "";

const summarizeSkills = () => listSkills().map(({ name, content }) => ({
  name,
  description: skillDescription(content),
}));

const conversationForModel = conversation => conversation.messages.map(({ actor, content, artifacts = [] }) => ({
  actor,
  content,
  artifacts,
}));

const isTextArtifact = artifact => {
  const type = String(artifact.type ?? "").toLowerCase();
  const name = String(artifact.name ?? "").toLowerCase();
  return type.startsWith("text/")
    || TEXT_ARTIFACT_TYPES.has(type)
    || TEXT_ARTIFACT_EXTENSIONS.some(extension => name.endsWith(extension));
};

const loadRequestArtifacts = async (conversationId, artifactIds) => Promise.all(artifactIds.map(async artifactId => {
  const artifact = await getArtifact(conversationId, artifactId);
  if (!artifact) throw new Error(`Unknown artifact: ${artifactId}`);

  let content = null;
  if (isTextArtifact(artifact)) {
    const bytes = await readArtifact(conversationId, artifactId);
    content = bytes?.toString("utf8") ?? "";
  }

  return { id: artifact.id, name: artifact.name, type: artifact.type, content };
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

const recordRequestFailure = async ({ conversationId, phase, action, error, workflowId = null }) => {
  const message = errorMessage(error);
  console.error("[nora] Request failed.", { conversationId, phase, action, workflowId, message });

  try {
    await recordEvent("nora.request_failed", {
      conversationId,
      workflowId,
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

const finishConversationWorkflow = async ({ conversationId, workflowId, action }) => {
  try {
    const execution = await runWorkflow(workflowId);
    const finalWorkflow = execution.workflow;

    if (finalWorkflow.status === "completed") {
      const result = await summarizeWorkflow(finalWorkflow.id);
      await addNoraMessage(conversationId, result.summary);
      return;
    }

    const response = finalWorkflow.status === "blocked"
      ? `Workflow ${workflowId} is blocked and requires attention.`
      : finalWorkflow.status === "failed"
        ? `Workflow ${workflowId} stopped because a Task failed.`
        : finalWorkflow.status === "cancelled"
          ? `Workflow ${workflowId} was cancelled.`
          : `Workflow ${workflowId} stopped in state ${finalWorkflow.status}.`;
    await addNoraMessage(conversationId, response);
  } catch (error) {
    const failure = await recordRequestFailure({
      conversationId,
      workflowId,
      phase: "workflow",
      action,
      error,
    });

    try {
      await addNoraMessage(conversationId, `Workflow ${workflowId} could not complete. ${failure}`);
    } catch (messageError) {
      console.error("[nora] Could not persist background Workflow failure message.", {
        conversationId,
        workflowId,
        message: errorMessage(messageError),
      });
    }
  } finally {
    refreshNoraStatus();
  }
};

export const handleCarlosRequest = async ({ conversationId, content, artifacts = [] }) => {
  if (typeof content !== "string" || !content.trim()) throw new Error("Carlos request must be a non-empty string");
  if (!Array.isArray(artifacts)) throw new Error("Carlos request artifacts must be an array");

  let conversation = await getConversation(conversationId);
  if (!conversation) throw new Error(`Unknown conversation: ${conversationId}`);

  state.status = "working";
  let phase = "intake";
  let action = null;
  let activeWorkflowId = null;

  try {
    await addMessage(conversationId, { actor: "Carlos", content, artifacts });
    await recordEvent("nora.request_received", { conversationId });
    const requestArtifacts = await loadRequestArtifacts(conversationId, artifacts);
    conversation = await getConversation(conversationId);
    const noraSelection = await ensureConversationSelection(conversation);
    phase = "decision";

    const decision = await askNoraForJson(
      getNoraRequestDecisionInstruction(),
      {
        conversation: conversationForModel(conversation),
        requestArtifacts,
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
    if (decision.inputs != null && !isObject(decision.inputs)) {
      throw new Error("Nora Workflow inputs must be an object");
    }

    const config = {
      ...(decision.config ?? {}),
      nora: structuredClone(noraSelection),
      conversationId,
    };
    const inputs = {
      ...(decision.inputs ?? {}),
      ...(requestArtifacts.length ? { attachments: structuredClone(requestArtifacts) } : {}),
    };
    let workflow;

    if (action === "process") {
      if (!getProcess(decision.process)) throw new Error(`Nora selected unknown Process: ${decision.process}`);
      workflow = await createWorkflow(decision.process, inputs, config);
    } else if (action === "adhoc") {
      const definition = await ensureValidGeneratedGraph({
        definition: decision.workflow,
        label: "ad-hoc Workflow",
        askForJson: askNoraForJson,
        modelSelection: noraSelection,
      });
      workflow = await createAdHocWorkflow({ ...definition, inputs, config });
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

    const message = await addNoraMessage(
      conversationId,
      decision.response?.trim() || `Started Workflow ${workflow.id}. I will report back when it changes state.`,
    );

    void finishConversationWorkflow({ conversationId, workflowId: workflow.id, action });
    refreshNoraStatus();
    return { action, message, workflow: getWorkflow(workflow.id) };
  } catch (error) {
    const failure = await recordRequestFailure({
      conversationId,
      phase,
      action,
      workflowId: activeWorkflowId,
      error,
    });
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
  if (!workflow) throw new Error(`Unknown Workflow: ${workflowId}`);

  return selectProcessTaskExecution({
    workflowId,
    taskId,
    decide: askNoraForJson,
    noraSelection: getWorkflowNoraSelection(workflow),
    validateModelSelection: validateSelection,
  });
};

export const runWorkflow = async workflowId => {
  if (!getWorkflow(workflowId)) throw new Error(`Unknown Workflow: ${workflowId}`);
  state.activeWorkflows.add(workflowId);
  refreshNoraStatus();

  try {
    return await runProcessWorkflow({
      workflowId,
      decide: askNoraForJson,
      getNoraSelection: getWorkflowNoraSelection,
      validateModelSelection: validateSelection,
    });
  } finally {
    refreshNoraStatus();
  }
};

export const reviewFailedTask = async (workflowId, taskId) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown Workflow: ${workflowId}`);
  const task = workflow.tasks?.[taskId];
  if (!task || task.type !== "task") throw new Error(`Unknown executable Task: ${taskId}`);
  if (task.status !== "failed") throw new Error(`Task ${taskId} is not failed`);

  const decision = await askNoraForJson(
    [
      "Review this failed Task.",
      "Retry only if the problem is operational, safe to recover, and does not require new human authority.",
      "Return one of:",
      '{"action":"retry","reason":"...","taskChanges":{}}',
      '{"action":"escalate","reason":"..."}',
    ].join("\n\n"),
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
  if (!workflow) throw new Error(`Unknown Workflow: ${workflowId}`);
  if (workflow.status !== "completed") throw new Error(`Workflow ${workflowId} is not completed`);

  const decision = await askNoraForJson(
    [
      "Review this completed Workflow and prepare the result for Carlos.",
      "Return:",
      '{"summary":"concise useful result for Carlos","result":null}',
    ].join("\n\n"),
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
  if (!workflow) throw new Error(`Unknown Workflow: ${workflowId}`);
  if (!name || typeof name !== "string") throw new Error("Promoted Process must have a name");

  const noraSelection = getWorkflowNoraSelection(workflow);
  const decision = await askNoraForJson(
    [
      "Carlos explicitly instructed you to promote this Workflow into a reusable Process.",
      "Remove runtime-only state, attempts, timestamps, outputs, errors, and one-off values.",
      "Preserve reusable Task configuration, including explicit provider/model requirements when present.",
      "Return:",
      '{"purpose":"...","inputs":[],"start":"start","end":"end","tasks":{},"edges":[]}',
    ].join("\n\n"),
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
    askForJson: askNoraForJson,
    modelSelection: noraSelection,
    validateModelSelection: validateSelection,
  });

  await recordEvent("process.promoted", { workflowId, process: process.name });
  return process;
};
