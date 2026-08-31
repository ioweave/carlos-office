import { randomUUID } from "node:crypto";

import { getAttachment, readAttachment } from "./AttachmentController.mjs";
import { listApprovals } from "./AuthorizationController.mjs";
import {
  addMessage,
  addWorkflow,
  createConversation as persistConversation,
  getConversation,
  setConversationNoraModel,
  setConversationTitle,
  upsertNoraWorkflowMessage,
} from "./ConversationController.mjs";
import { listEvents, recordEvent } from "./EventController.mjs";
import {
  createAdHocWorkflow,
  createWorkflow,
  editTask,
  getProcess,
  getWorkflow,
  listProcesses,
  listWorkflows,
  setTaskStatus,
  setWorkflowConfig,
  setWorkflowResult,
  startWorkflow,
} from "./ProcessController.mjs";
import { getNora } from "../registry/Nora.mjs";
import { listSkills } from "../registry/Skills.mjs";
import { listTools, readToolSource } from "../registry/Tools.mjs";
import { cleanupWorkflowRuntime } from "../services/ExecutionWorkspaceService.mjs";
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
const workflowReports = new Map();
const requestJobs = new Map();
const WORKFLOW_SUMMARY_SCHEMA = Object.freeze({
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
  additionalProperties: false,
});

const TEXT_ATTACHMENT_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/xml",
  "application/sql",
  "text/javascript",
  "text/typescript",
]);
const TEXT_ATTACHMENT_EXTENSIONS = [
  ".c", ".cpp", ".css", ".go", ".h", ".html", ".ini", ".java", ".js", ".json", ".jsx",
  ".kt", ".lua", ".md", ".mjs", ".php", ".py", ".rb", ".rs", ".scss", ".sh", ".sql",
  ".swift", ".toml", ".ts", ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml",
];

const errorMessage = error => error instanceof Error ? error.message : String(error);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isCancelledError = (error, signal = null) => Boolean(
  signal?.aborted
  || error?.name === "AbortError"
  || error?.code === "nora_request_cancelled"
);

const publicRequestJob = job => ({
  id: job.id,
  conversationId: job.conversationId,
  messageId: job.messageId,
  status: job.status,
  startedAt: job.startedAt,
  workflowId: job.workflowId ?? null,
});

const validateSelection = ({ provider, model }) => {
  if (!provider || typeof provider !== "string") throw new Error("Provider must be a non-empty string");
  if (!model || typeof model !== "string") throw new Error("Model must be a non-empty string");

  const selectedProvider = provider.trim();
  const selectedModel = model.trim();
  const providerEntry = listProcessModels().find(item => item.provider === selectedProvider);
  if (!providerEntry) throw new Error(`Unknown model provider: ${selectedProvider}`);
  if (!providerEntry.models?.includes(selectedModel)) {
    throw new Error(`Unknown model selection: ${selectedProvider}/${selectedModel}`);
  }
  return { provider: selectedProvider, model: selectedModel };
};

const selectionFrom = value => {
  if (!value?.provider && !value?.model) return null;
  if (!value?.provider || !value?.model) throw new Error("Provider and model must be configured together");
  return validateSelection(value);
};

const getDefaultNoraSelection = () => {
  const definition = getNora();
  if (!definition) throw new Error("Nora.md was not found in ObsidianVault/System");
  return selectionFrom(definition);
};

const getWorkflowNoraSelection = workflow => selectionFrom(workflow.config?.nora) ?? getDefaultNoraSelection();

const refreshNoraStatus = () => {
  let working = getNoraProcessState().status === "working"
    || [...requestJobs.values()].some(job => job.status === "running");
  let blocked = false;

  for (const workflowId of [...state.activeWorkflows]) {
    const workflow = getWorkflow(workflowId);
    if (!workflow || ["completed", "cancelled", "failed", "paused", "stalled"].includes(workflow.status)) {
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

  for (const workflow of listWorkflows().filter(item => item.status === "completed" && item.config?.conversationId)) {
    try {
      await reportCompletedWorkflow(workflow.id);
    } catch (error) {
      console.error("[nora] Could not reconcile completed Workflow report.", {
        workflowId: workflow.id,
        message: errorMessage(error),
      });
    }
  }

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
    activeRequests: [...requestJobs.values()]
      .filter(job => job.status === "running")
      .map(publicRequestJob),
  };
};

export const listCarlosRequests = () => [...requestJobs.values()].map(publicRequestJob);

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

const askNoraForJson = (instruction, context, modelSelection, signal = null) => decideInNoraProcess({
  definition: getNora(),
  selection: validateSelection(modelSelection),
  instruction,
  context,
  signal,
});

const summarizeProcesses = () => listProcesses().map(({ name, purpose = "", inputs = [] }) => ({
  name,
  purpose,
  inputs,
}));

const summarizeTools = async () => Promise.all(listTools().map(async tool => ({
  name: tool.name,
  description: tool.description ?? "",
  requiresApproval: Boolean(tool.requiresApproval),
  provider: tool.provider ?? null,
  model: tool.model ?? null,
  input: structuredClone(tool.input ?? {}),
  source: await readToolSource(tool.name),
})));

const skillDescription = content => String(content ?? "")
  .split(/\r?\n/)
  .map(line => line.trim())
  .find(Boolean)
  ?.replace(/^#+\s*/, "") ?? "";

const summarizeSkills = () => listSkills().map(({ name, content }) => ({
  name,
  description: skillDescription(content),
}));

const conversationForModel = conversation => conversation.messages.map(({
  actor,
  content,
  attachments = [],
  artifacts = [],
}) => ({ actor, content, attachments, artifacts }));

const isTextAttachment = attachment => {
  const type = String(attachment.type ?? "").toLowerCase();
  const name = String(attachment.name ?? "").toLowerCase();
  return type.startsWith("text/")
    || TEXT_ATTACHMENT_TYPES.has(type)
    || TEXT_ATTACHMENT_EXTENSIONS.some(extension => name.endsWith(extension));
};

const loadRequestAttachments = async (conversationId, attachmentIds) => Promise.all(
  attachmentIds.map(async attachmentId => {
    const attachment = await getAttachment(conversationId, attachmentId);
    if (!attachment) throw new Error(`Unknown attachment: ${attachmentId}`);

    let content = null;
    if (isTextAttachment(attachment)) {
      const bytes = await readAttachment(conversationId, attachmentId);
      content = bytes?.toString("utf8") ?? "";
    }

    return { id: attachment.id, name: attachment.name, type: attachment.type, content };
  }),
);

const ensureConversationSelection = async conversation => {
  const selected = selectionFrom(conversation.nora);
  if (selected) return selected;

  const fallback = getDefaultNoraSelection();
  await setConversationNoraModel(conversation.id, fallback);
  return fallback;
};

const addNoraMessage = async (
  conversationId,
  content,
  workflowId = null,
  artifacts = [],
) => addMessage(conversationId, {
  actor: "Nora",
  content,
  artifacts,
  workflowId,
});

const addWorkflowNoraMessage = async (
  conversationId,
  workflowId,
  content,
  artifacts = [],
) => {
  const conversation = await getConversation(conversationId);
  if (!conversation?.workflows?.includes(workflowId)) return null;
  return upsertNoraWorkflowMessage(conversationId, workflowId, content, artifacts);
};

const currentWorkflowRunStartedAt = workflow => {
  const restarted = listEvents({ type: "workflow.restarted", workflowId: workflow.id }).at(-1)?.at;
  const started = listEvents({ type: "workflow.started", workflowId: workflow.id }).at(-1)?.at;
  const candidates = [restarted, started]
    .map(value => Date.parse(value ?? ""))
    .filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : null;
};

const workflowArtifactIds = workflow => {
  const runStartedAt = currentWorkflowRunStartedAt(workflow);
  return [...new Set(
    Object.values(workflow.tasks ?? {})
      .flatMap(task => task?.type === "task" ? (task.attempts ?? []) : [])
      .filter(attempt => (
        attempt.status === "completed"
        && (
          runStartedAt === null
          || (Number.isFinite(Date.parse(attempt.endedAt ?? "")) && Date.parse(attempt.endedAt) >= runStartedAt)
        )
      ))
      .flatMap(attempt => attempt.artifacts ?? []),
  )];
};

const workflowCompletionAt = workflow => {
  const completedEvent = listEvents({ type: "workflow.completed", workflowId: workflow.id }).at(-1);
  if (completedEvent?.at) return completedEvent.at;

  const attemptTimes = Object.values(workflow.tasks ?? {})
    .flatMap(task => task?.type === "task" ? (task.attempts ?? []) : [])
    .filter(attempt => attempt.status === "completed" && attempt.endedAt)
    .map(attempt => attempt.endedAt)
    .sort();
  return attemptTimes.at(-1) ?? null;
};

const hasCompletionFollowUp = (conversation, workflow) => {
  const completedAt = workflowCompletionAt(workflow);
  const threshold = Date.parse(completedAt ?? "");
  if (!Number.isFinite(threshold)) return false;

  return (conversation?.messages ?? []).some(message => (
    message.actor === "Nora"
    && message.workflowId === workflow.id
    && Number.isFinite(Date.parse(message.at))
    && Date.parse(message.at) >= threshold
  ));
};

const reportCompletedWorkflow = async workflowId => {
  const previous = workflowReports.get(workflowId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const workflow = getWorkflow(workflowId);
    if (!workflow || workflow.status !== "completed") return null;

    const conversationId = workflow.config?.conversationId;
    if (!conversationId) return null;

    let conversation = await getConversation(conversationId);
    if (!conversation?.workflows?.includes(workflowId)) return null;
    if (hasCompletionFollowUp(conversation, workflow)) return null;

    const result = await summarizeWorkflow(workflowId);
    const completedWorkflow = getWorkflow(workflowId) ?? workflow;
    conversation = await getConversation(conversationId);
    if (hasCompletionFollowUp(conversation, completedWorkflow)) return null;

    const artifacts = workflowArtifactIds(completedWorkflow);
    const message = await addWorkflowNoraMessage(
      conversationId,
      workflowId,
      result.summary,
      artifacts,
    );
    if (message) {
      await recordEvent("nora.workflow_reported", {
        conversationId,
        workflowId,
        messageId: message.id,
        status: "completed",
        artifacts,
      });
    }
    return message;
  });

  workflowReports.set(workflowId, next);
  try {
    return await next;
  } finally {
    if (workflowReports.get(workflowId) === next) workflowReports.delete(workflowId);
  }
};

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
    if (!finalWorkflow || finalWorkflow.status === "completed") return;

    const response = finalWorkflow.status === "blocked"
      ? `Workflow ${workflowId} is blocked and requires attention.`
      : finalWorkflow.status === "failed"
        ? `Workflow ${workflowId} stopped because a Task failed.`
        : finalWorkflow.status === "paused"
          ? `Workflow ${workflowId} was stopped and can be edited or resumed.`
          : finalWorkflow.status === "stalled"
            ? `Workflow ${workflowId} stalled because no Task can make progress. Open Operations to inspect its dependency diagnostics.`
            : finalWorkflow.status === "cancelled"
              ? `Workflow ${workflowId} was cancelled.`
              : `Workflow ${workflowId} stopped in state ${finalWorkflow.status}.`;
    await addWorkflowNoraMessage(conversationId, workflowId, response);
  } catch (error) {
    const failure = await recordRequestFailure({
      conversationId,
      workflowId,
      phase: "workflow",
      action,
      error,
    });

    try {
      await addWorkflowNoraMessage(conversationId, workflowId, `Workflow ${workflowId} could not complete. ${failure}`);
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

export const handleCarlosRequest = async ({
  conversationId,
  content = null,
  attachments = [],
  messageId = null,
  signal = null,
}) => {
  let conversation = await getConversation(conversationId);
  if (!conversation) throw new Error(`Unknown conversation: ${conversationId}`);

  let carlosMessage = null;
  if (messageId) {
    carlosMessage = conversation.messages.find(message => message.id === messageId);
    if (!carlosMessage || carlosMessage.actor !== "Carlos") {
      throw new Error(`Unknown Carlos message: ${messageId}`);
    }
    content = carlosMessage.content;
    attachments = carlosMessage.attachments ?? [];
  }

  if (typeof content !== "string" || !content.trim()) throw new Error("Carlos request must be a non-empty string");
  if (!Array.isArray(attachments)) throw new Error("Carlos request attachments must be an array");

  state.status = "working";
  let phase = "intake";
  let action = null;
  let activeWorkflowId = null;
  const requestAskNoraForJson = (instruction, context, modelSelection) => (
    askNoraForJson(instruction, context, modelSelection, signal)
  );
  const ensureNotCancelled = () => {
    if (signal?.aborted) throw Object.assign(new Error("Nora request cancelled"), { name: "AbortError", code: "nora_request_cancelled" });
  };

  try {
    ensureNotCancelled();
    if (!carlosMessage) {
      carlosMessage = await addMessage(conversationId, { actor: "Carlos", content, attachments });
    }
    await recordEvent("nora.request_received", {
      conversationId,
      messageId: carlosMessage.id,
      replayed: Boolean(messageId),
    });

    ensureNotCancelled();
    const requestAttachments = await loadRequestAttachments(conversationId, attachments);
    conversation = await getConversation(conversationId);
    const noraSelection = await ensureConversationSelection(conversation);
    const needsConversationTitle = !conversation.title
      && conversation.messages.filter(message => message.actor === "Carlos").length === 1;
    const decisionInstruction = needsConversationTitle
      ? [
        getNoraRequestDecisionInstruction(),
        "",
        "This is the first Carlos message in an untitled Conversation.",
        'Add a "conversationTitle" property to the same JSON decision object you return.',
        "The title must summarize the actual subject or intent, not copy the request verbatim.",
        "Use 3-7 concise words, omit URLs, and do not prefix it with Chat, Conversation, Carlos, or Nora.",
      ].join("\n")
      : getNoraRequestDecisionInstruction();
    phase = "decision";

    const decision = await requestAskNoraForJson(
      decisionInstruction,
      {
        conversation: conversationForModel(conversation),
        requestAttachments,
        availableProcesses: summarizeProcesses(),
        availableTools: await summarizeTools(),
        availableSkills: summarizeSkills(),
      },
      noraSelection,
    );
    ensureNotCancelled();

    if (!isObject(decision)) throw new Error("Nora decision must be an object");
    if (typeof decision.action !== "string" || !decision.action.trim()) {
      throw new Error("Nora decision must include an action");
    }
    if (decision.response != null && typeof decision.response !== "string") {
      throw new Error("Nora decision response must be a string when present");
    }
    if (needsConversationTitle) {
      if (typeof decision.conversationTitle !== "string" || !decision.conversationTitle.trim()) {
        throw new Error("Nora first-request decision must include a conversation title");
      }
      const title = decision.conversationTitle.replace(/\s+/g, " ").trim();
      if (title.length > 120) throw new Error("Nora conversation title cannot exceed 120 characters");
      const latestConversation = await getConversation(conversationId);
      if (!latestConversation?.title) conversation = await setConversationTitle(conversationId, title);
    }

    action = decision.action;
    if (["respond", "clarify"].includes(action)) {
      if (typeof decision.response !== "string" || !decision.response.trim()) {
        throw new Error(`Nora ${action} decision requires a response`);
      }
      ensureNotCancelled();
      const message = await addNoraMessage(conversationId, decision.response);
      refreshNoraStatus();
      return { action, message, workflow: null };
    }

    phase = "creation";
    if (action === "tool") {
      ensureNotCancelled();
      const tool = await saveNoraTool(decision.name, decision.source);
      const message = await addNoraMessage(conversationId, creationMessage(decision, `Tool ${tool.name} saved.`));
      refreshNoraStatus();
      return { action, message, workflow: null, tool: toolMetadata(tool) };
    }

    if (action === "skill") {
      ensureNotCancelled();
      const skill = await saveNoraSkill(decision.name, decision.content);
      const message = await addNoraMessage(conversationId, creationMessage(decision, `Skill ${skill.name} saved.`));
      refreshNoraStatus();
      return { action, message, workflow: null, skill: { name: skill.name } };
    }

    if (action === "create_process") {
      const process = await createNoraProcess({
        process: decision.process,
        askForJson: requestAskNoraForJson,
        modelSelection: noraSelection,
        validateModelSelection: validateSelection,
      });
      ensureNotCancelled();
      const message = await addNoraMessage(
        conversationId,
        creationMessage(decision, `Process ${process.name} saved and ready to reuse.`),
      );
      refreshNoraStatus();
      return { action, message, workflow: null, process };
    }

    if (action === "create_schedule") {
      ensureNotCancelled();
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
        askForJson: requestAskNoraForJson,
        modelSelection: noraSelection,
        validateModelSelection: validateSelection,
      });
      ensureNotCancelled();
      const summary = results.map(result => result.name || result.id).filter(Boolean).join(", ");
      const message = await addNoraMessage(
        conversationId,
        creationMessage(decision, `Creation plan completed: ${summary || "requested capabilities saved"}.`),
      );
      refreshNoraStatus();
      return { action, message, workflow: null, plan: results };
    }

    if (decision.config != null && !isObject(decision.config)) throw new Error("Nora Workflow config must be an object");
    if (decision.inputs != null && !isObject(decision.inputs)) throw new Error("Nora Workflow inputs must be an object");

    const config = {
      ...(decision.config ?? {}),
      nora: structuredClone(noraSelection),
      conversationId,
      sourceMessageId: carlosMessage.id,
    };
    const inputs = {
      ...(decision.inputs ?? {}),
      ...(requestAttachments.length ? { attachments: structuredClone(requestAttachments) } : {}),
    };
    let workflow;

    ensureNotCancelled();
    if (action === "process") {
      if (!getProcess(decision.process)) throw new Error(`Nora selected unknown Process: ${decision.process}`);
      workflow = await createWorkflow(decision.process, inputs, config);
    } else if (action === "adhoc") {
      const definition = await ensureValidGeneratedGraph({
        definition: decision.workflow,
        label: "ad-hoc Workflow",
        askForJson: requestAskNoraForJson,
        modelSelection: noraSelection,
      });
      ensureNotCancelled();
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
      workflow.id,
    );

    void finishConversationWorkflow({ conversationId, workflowId: workflow.id, action });
    refreshNoraStatus();
    return { action, message, workflow: getWorkflow(workflow.id) };
  } catch (error) {
    if (isCancelledError(error, signal)) {
      await recordEvent("nora.request_cancelled", {
        conversationId,
        messageId: carlosMessage?.id ?? messageId ?? null,
        workflowId: activeWorkflowId,
        phase,
      });
      refreshNoraStatus();
      return { action: "cancelled", message: null, workflow: activeWorkflowId ? getWorkflow(activeWorkflowId) : null };
    }

    const failure = await recordRequestFailure({
      conversationId,
      phase,
      action,
      workflowId: activeWorkflowId,
      error,
    });
    let message = null;

    try {
      message = activeWorkflowId
        ? await addWorkflowNoraMessage(conversationId, activeWorkflowId, `I couldn't complete that request. ${failure}`)
        : await addNoraMessage(conversationId, `I couldn't complete that request. ${failure}`);
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

export const startCarlosRequest = ({ conversationId, messageId, content = null, attachments = [] }) => {
  const existing = [...requestJobs.values()].find(job => (
    job.status === "running"
    && job.conversationId === conversationId
    && job.messageId === messageId
  ));
  if (existing) return publicRequestJob(existing);

  const controller = new AbortController();
  const job = {
    id: `request-${randomUUID()}`,
    conversationId,
    messageId,
    status: "running",
    startedAt: new Date().toISOString(),
    workflowId: null,
    controller,
  };
  requestJobs.set(job.id, job);
  refreshNoraStatus();

  void recordEvent("nora.request_job_started", publicRequestJob(job)).catch(() => {});
  job.promise = handleCarlosRequest({ conversationId, messageId, content, attachments, signal: controller.signal })
    .then(async result => {
      job.status = result.action === "cancelled" ? "cancelled" : "completed";
      job.workflowId = result.workflow?.id ?? null;
      await recordEvent(`nora.request_job_${job.status}`, {
        ...publicRequestJob(job),
        action: result.action,
      });
      return result;
    })
    .catch(async error => {
      job.status = isCancelledError(error, controller.signal) ? "cancelled" : "failed";
      await recordEvent(`nora.request_job_${job.status}`, {
        ...publicRequestJob(job),
        error: errorMessage(error),
      });
      return null;
    })
    .finally(() => {
      requestJobs.delete(job.id);
      refreshNoraStatus();
    });

  return publicRequestJob(job);
};

export const cancelCarlosRequest = async (requestId, conversationId = null) => {
  const job = requestJobs.get(requestId);
  if (!job || job.status !== "running") return false;
  if (conversationId && job.conversationId !== conversationId) return false;
  job.controller.abort();
  job.status = "cancelled";
  refreshNoraStatus();
  await recordEvent("nora.request_job_cancel_requested", publicRequestJob(job));
  return true;
};

export const selectTaskExecution = async (workflowId, taskId) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown Workflow: ${workflowId}`);

  return selectProcessTaskExecution({
    workflowId,
    taskId,
    decide: askNoraForJson,
    noraSelection: getWorkflowNoraSelection(workflow),
    models: listProcessModels(),
    validateModelSelection: validateSelection,
  });
};

export const runWorkflow = async workflowId => {
  let workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown Workflow: ${workflowId}`);
  if (workflow.status === "pending") workflow = await startWorkflow(workflowId);

  state.activeWorkflows.add(workflowId);
  refreshNoraStatus();

  try {
    const execution = await runProcessWorkflow({
      workflowId,
      decide: askNoraForJson,
      getNoraSelection: getWorkflowNoraSelection,
      models: listProcessModels(),
      validateModelSelection: validateSelection,
    });

    if (execution.workflow?.status === "completed") {
      await reportCompletedWorkflow(workflowId);
      await cleanupWorkflowRuntime(workflowId);
    }
    return { ...execution, workflow: getWorkflow(workflowId) };
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

const completedValue = task => {
  const attempt = [...(task?.attempts ?? [])]
    .reverse()
    .find(item => item.status === "completed" && (item.data != null || item.output != null));
  return attempt?.data != null ? attempt.data : attempt?.output;
};

const completedWorkflowResult = workflow => {
  const finalOutputs = workflow.edges
    .filter(([, to]) => to === workflow.end)
    .map(([from]) => [from, completedValue(workflow.tasks[from])])
    .filter(([, output]) => output != null);

  if (finalOutputs.length === 1) return finalOutputs[0][1];
  if (finalOutputs.length > 1) return Object.fromEntries(finalOutputs);

  const outputs = Object.entries(workflow.tasks)
    .filter(([, task]) => task.type === "task")
    .map(([taskId, task]) => [taskId, completedValue(task)])
    .filter(([, output]) => output != null);

  if (outputs.length === 1) return outputs[0][1];
  if (outputs.length > 1) return Object.fromEntries(outputs);
  return null;
};

const resultSummary = result => {
  if (typeof result === "string" && result.trim()) return result.trim();
  if (result != null) return JSON.stringify(result, null, 2);
  return "Workflow completed successfully.";
};

const readableWorkflowSummary = async (workflow, result) => {
  const fallback = resultSummary(result);
  if (typeof result === "string" && result.trim()) return fallback;
  if (result == null) return fallback;

  try {
    const response = await decideInNoraProcess({
      definition: getNora(),
      selection: getWorkflowNoraSelection(workflow),
      instruction: [
        "Write the final answer to Carlos for this completed Workflow.",
        "Use the Workflow result as the factual source. Do not invent facts that are not in it.",
        "Explain the useful conclusion in normal readable prose, not as raw JSON.",
        "Be concise but complete enough that Carlos does not need to open Operations to understand the result.",
        "Do not narrate Workflow mechanics, Task execution, or the fact that you are summarizing structured data.",
        "Return only an object with one string property named summary.",
      ].join("\n"),
      context: {
        workflow: {
          id: workflow.id,
          process: workflow.process ?? null,
          purpose: workflow.purpose ?? null,
        },
        result,
      },
      format: WORKFLOW_SUMMARY_SCHEMA,
    });
    const summary = typeof response?.summary === "string" ? response.summary.trim() : "";
    return summary || fallback;
  } catch (error) {
    console.warn("[nora] Could not synthesize readable Workflow result; using raw result.", {
      workflowId: workflow.id,
      message: errorMessage(error),
    });
    return fallback;
  }
};

export const summarizeWorkflow = async workflowId => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown Workflow: ${workflowId}`);
  if (workflow.status !== "completed") throw new Error(`Workflow ${workflowId} is not completed`);

  const result = completedWorkflowResult(workflow);
  await setWorkflowResult(workflowId, result);
  await recordEvent("workflow.result_captured", { workflowId });
  const summary = await readableWorkflowSummary(workflow, result);
  return { summary, result };
};

export const createOrUpdateTool = async (name, source) => saveNoraTool(name, source);
export const createOrUpdateSkill = async (name, content) => saveNoraSkill(name, content);

export const promoteWorkflow = async (workflowId, { name, purpose = null }) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown Workflow: ${workflowId}`);
  if (!name || typeof name !== "string") throw new Error("Promoted Process must have a name");

  const cleanTasks = Object.fromEntries(
    Object.entries(workflow.tasks).map(([taskId, task]) => {
      const {
        status: _status,
        attempts: _attempts,
        agent: _legacyAgent,
        blockedReason: _blockedReason,
        error: _error,
        resumeCheckpointAttemptId: _resumeCheckpointAttemptId,
        ...definition
      } = task;
      return [taskId, definition];
    }),
  );
  const process = await createNoraProcess({
    process: {
      name: name.trim(),
      purpose: purpose ?? workflow.purpose ?? `Promoted from ${workflow.id}`,
      inputs: Object.keys(workflow.inputs ?? {}).filter(input => input !== "attachments"),
      start: workflow.start,
      end: workflow.end,
      tasks: cleanTasks,
      edges: workflow.edges,
      groups: structuredClone(workflow.groups ?? []),
      layout: structuredClone(workflow.layout ?? {}),
    },
    askForJson: askNoraForJson,
    modelSelection: getWorkflowNoraSelection(workflow),
    validateModelSelection: validateSelection,
  });

  await recordEvent("process.promoted", { workflowId, process: process.name });
  return process;
};