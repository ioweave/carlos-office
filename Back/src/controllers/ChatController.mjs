import * as artifacts from "./ArtifactController.mjs";
import * as attachments from "./AttachmentController.mjs";
import * as authorization from "./AuthorizationController.mjs";
import * as conversations from "./ConversationController.mjs";
import * as events from "./EventController.mjs";
import * as nora from "./NoraController.mjs";
import * as processes from "./ProcessController.mjs";
import { cleanupWorkflowRuntime } from "../services/ExecutionWorkspaceService.mjs";
import * as engine from "../services/ProcessEngine.mjs";

const requestError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const requireString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw requestError(`${label} must be a non-empty string`);
  return value.trim();
};
const requireStringList = (value, label) => {
  if (!Array.isArray(value)) throw requestError(`${label} must be an array`);
  return value.map(item => requireString(item, label));
};
const sameStringList = (left = [], right = []) => JSON.stringify(left) === JSON.stringify(right);

export const getConversation = async payload => {
  const conversationId = requireString(payload.conversationId, "Conversation ID");
  const conversation = await conversations.getConversation(conversationId);
  if (!conversation) throw requestError("Conversation not found", 404);
  const [conversationAttachments, conversationArtifacts] = await Promise.all([
    attachments.listAttachments(conversationId),
    artifacts.listArtifacts(conversationId),
  ]);
  return { conversation, attachments: conversationAttachments, artifacts: conversationArtifacts };
};

export const createConversation = payload => nora.createConversation({
  provider: payload.provider ?? null,
  model: payload.model ?? null,
});

export const renameConversation = payload => conversations.setConversationTitle(
  requireString(payload.conversationId, "Conversation ID"),
  requireString(payload.title, "Conversation title"),
);

export const deleteConversation = async payload => {
  const conversationId = requireString(payload.conversationId, "Conversation ID");
  const deleted = await conversations.deleteConversation(conversationId);
  if (!deleted) throw requestError("Conversation not found", 404);
  return { id: conversationId, deleted: true };
};

export const setConversationModel = payload => nora.setConversationModel(
  requireString(payload.conversationId, "Conversation ID"),
  { provider: requireString(payload.provider, "Provider"), model: requireString(payload.model, "Model") },
);

export const sendMessage = async payload => {
  const conversationId = requireString(payload.conversationId, "Conversation ID");
  const content = requireString(payload.content, "Message content");
  const attachmentIds = requireStringList(payload.attachments ?? [], "Message attachments");
  let messageId = payload.messageId == null ? null : requireString(payload.messageId, "Message ID");
  const current = await conversations.getConversation(conversationId);
  if (!current) throw requestError("Conversation not found", 404);

  if (messageId) {
    const existingIndex = current.messages.findIndex(message => message.id === messageId);
    if (existingIndex >= 0) {
      const existing = current.messages[existingIndex];
      const sameRequest = existing.actor === "Carlos"
        && existing.content === content
        && sameStringList(existing.attachments ?? [], attachmentIds);
      if (!sameRequest) throw requestError(`Message ID already exists: ${messageId}`, 409);
      const hasFollowUp = current.messages.slice(existingIndex + 1).some(message => message.actor === "Nora");
      if (hasFollowUp) return { action: "existing", job: null, deduplicated: true };
    } else {
      await conversations.addMessage(conversationId, {
        id: messageId,
        actor: "Carlos",
        content,
        attachments: attachmentIds,
      });
    }
  } else {
    const message = await conversations.addMessage(conversationId, {
      actor: "Carlos",
      content,
      attachments: attachmentIds,
    });
    messageId = message.id;
  }

  const running = nora.listCarlosRequests().find(job => (
    job.status === "running"
    && job.conversationId === conversationId
    && job.messageId === messageId
  ));
  const job = running ?? nora.startCarlosRequest({ conversationId, messageId });
  return { action: "accepted", job, deduplicated: Boolean(running) };
};

export const editMessage = async payload => {
  const conversationId = requireString(payload.conversationId, "Conversation ID");
  const messageId = requireString(payload.messageId, "Message ID");
  const content = requireString(payload.content, "Message content");
  const conversation = await conversations.getConversation(conversationId);
  if (!conversation) throw requestError("Conversation not found", 404);

  const messageIndex = conversation.messages.findIndex(message => message.id === messageId);
  if (messageIndex === -1) throw requestError("Message not found", 404);
  const message = conversation.messages[messageIndex];
  if (message.actor !== "Carlos") throw requestError("Only Carlos messages can be edited");

  const messagePositions = new Map(conversation.messages.map((item, index) => [item.id, index]));
  const workflowEvents = events.listEvents({ type: "nora.workflow_started", conversationId });
  const workflowStartedAt = new Map(workflowEvents.map(event => [event.workflowId, Date.parse(event.at)]));
  const cutoff = Date.parse(message.at);
  const workflowIds = conversation.workflows.filter(workflowId => {
    const workflow = processes.getWorkflow(workflowId);
    const sourceMessageId = workflow?.config?.sourceMessageId;
    if (sourceMessageId && messagePositions.has(sourceMessageId)) return messagePositions.get(sourceMessageId) >= messageIndex;
    const startedAt = workflowStartedAt.get(workflowId);
    return Number.isFinite(startedAt) && Number.isFinite(cutoff) && startedAt >= cutoff;
  });

  const retainedMessages = conversation.messages.slice(0, messageIndex + 1);
  const retainedArtifactIds = new Set(retainedMessages.flatMap(item => item.artifacts ?? []));
  const artifactIds = (await artifacts.listArtifacts(conversationId))
    .filter(artifact => {
      if (retainedArtifactIds.has(artifact.id)) return false;
      const createdAt = Date.parse(artifact.createdAt);
      return Number.isFinite(createdAt) && Number.isFinite(cutoff) && createdAt >= cutoff;
    })
    .map(artifact => artifact.id);

  const committed = await conversations.editCarlosMessage(conversationId, messageId, content, workflowIds);
  for (const workflowId of workflowIds) {
    const workflow = processes.getWorkflow(workflowId);
    engine.cancelWorkflowExecution(workflowId, "Conversation history edited by Carlos");
    if (workflow && !["completed", "cancelled", "failed"].includes(workflow.status)) await processes.cancelWorkflow(workflowId);
    if (processes.getWorkflow(workflowId)) await processes.deleteWorkflow(workflowId);
    await cleanupWorkflowRuntime(workflowId);
  }
  await authorization.deleteApprovalsForWorkflows(workflowIds);
  await artifacts.deleteArtifacts(conversationId, artifactIds);
  await events.recordEvent("conversation.message_edited", {
    conversationId,
    messageId,
    removedMessages: conversation.messages.length - messageIndex - 1,
    removedWorkflows: workflowIds.length,
    removedArtifacts: artifactIds.length,
  });

  const job = nora.startCarlosRequest({ conversationId, messageId });
  return { conversation: committed, job };
};

export const cancelRequest = async payload => {
  const conversationId = requireString(payload.conversationId, "Conversation ID");
  const requestId = requireString(payload.requestId, "Request ID");
  const cancelled = await nora.cancelCarlosRequest(requestId, conversationId);
  if (!cancelled) throw requestError("Active Nora request not found", 404);
  return { id: requestId, cancelled: true };
};

export const deleteAttachments = async payload => {
  const conversationId = requireString(payload.conversationId, "Conversation ID");
  const attachmentIds = requireStringList(payload.attachmentIds, "Attachment IDs");
  return { deleted: await attachments.deleteAttachments(conversationId, attachmentIds) };
};
