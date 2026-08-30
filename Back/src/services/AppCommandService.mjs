import { cleanupWorkflowRuntime } from "./ExecutionWorkspaceService.mjs";

const REFRESH_DOMAINS = ["nora", "models", "workflows", "approvals", "agents", "skillsRevision", "conversations"];

const requestError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const requireObject = (value, label = "Command payload") => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw requestError(`${label} must be an object`);
  return value;
};

const requireString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw requestError(`${label} must be a non-empty string`);
  return value.trim();
};

const requireStringList = (value, label) => {
  if (!Array.isArray(value)) throw requestError(`${label} must be an array`);
  return value.map(item => requireString(item, label));
};

const sameStringList = (left = [], right = []) => JSON.stringify(left) === JSON.stringify(right);

export const createAppCommandService = ({
  nora,
  processes,
  conversations,
  attachments,
  artifacts,
  authorization,
  events,
  engine,
  officeState,
}) => {
  if (!nora || !processes || !conversations || !attachments || !artifacts || !authorization || !events || !engine || !officeState) {
    throw new Error("App command service requires the complete Carlos Office command dependencies");
  }

  const conversationBundle = async conversationId => {
    const conversation = await conversations.getConversation(conversationId);
    if (!conversation) throw requestError("Conversation not found", 404);
    const [conversationAttachments, conversationArtifacts] = await Promise.all([
      attachments.listAttachments(conversationId),
      artifacts.listArtifacts(conversationId),
    ]);
    return { conversation, attachments: conversationAttachments, artifacts: conversationArtifacts };
  };

  const sendCarlosMessage = async payload => {
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
        if (hasFollowUp) return { action: "existing", message: null, workflow: null, deduplicated: true };
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

  const editCarlosMessage = async payload => {
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

  const handlers = {
    "state.refresh": async () => {
      await officeState.invalidate(REFRESH_DOMAINS);
      return { revision: officeState.revision };
    },
    "conversation.get": async payload => conversationBundle(requireString(payload.conversationId, "Conversation ID")),
    "conversation.create": async payload => nora.createConversation({
      provider: payload.provider ?? null,
      model: payload.model ?? null,
    }),
    "conversation.rename": async payload => conversations.setConversationTitle(
      requireString(payload.conversationId, "Conversation ID"),
      requireString(payload.title, "Conversation title"),
    ),
    "conversation.delete": async payload => {
      const conversationId = requireString(payload.conversationId, "Conversation ID");
      const deleted = await conversations.deleteConversation(conversationId);
      if (!deleted) throw requestError("Conversation not found", 404);
      return { id: conversationId, deleted: true };
    },
    "conversation.setModel": async payload => nora.setConversationModel(
      requireString(payload.conversationId, "Conversation ID"),
      {
        provider: requireString(payload.provider, "Provider"),
        model: requireString(payload.model, "Model"),
      },
    ),
    "conversation.send": sendCarlosMessage,
    "conversation.editMessage": editCarlosMessage,
    "conversation.cancelRequest": async payload => {
      const conversationId = requireString(payload.conversationId, "Conversation ID");
      const requestId = requireString(payload.requestId, "Request ID");
      const cancelled = await nora.cancelCarlosRequest(requestId, conversationId);
      if (!cancelled) throw requestError("Active Nora request not found", 404);
      return { id: requestId, cancelled: true };
    },
    "conversation.deleteAttachments": async payload => {
      const conversationId = requireString(payload.conversationId, "Conversation ID");
      const attachmentIds = requireStringList(payload.attachmentIds, "Attachment IDs");
      return { deleted: await attachments.deleteAttachments(conversationId, attachmentIds) };
    },
  };

  return async ({ command, payload = {} }) => {
    const commandName = requireString(command, "Command");
    const handler = handlers[commandName];
    if (!handler) throw requestError(`Unknown app command: ${commandName}`, 404);
    return handler(requireObject(payload));
  };
};
