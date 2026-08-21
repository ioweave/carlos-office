const requestError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const createRouter = ({
  allowedOrigin,
  nora,
  processes,
  conversations,
  artifacts,
  authorization,
  schedules,
  events,
  agents,
  tools,
  skills,
  engine,
}) => {
  if (!allowedOrigin || typeof allowedOrigin !== "string") {
    throw new Error("Router requires one allowed frontend origin");
  }

  const readJson = async req => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (!chunks.length) return {};

    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw requestError("Invalid JSON request body");
    }
  };

  const partsFrom = pathname => pathname.split("/").filter(Boolean).map(decodeURIComponent);

  const executeWorkflow = async workflowId => {
    const wasCompleted = processes.getWorkflow(workflowId)?.status === "completed";
    const execution = await nora.runWorkflow(workflowId);
    let review = null;

    if (!wasCompleted && execution.workflow.status === "completed") {
      review = await nora.summarizeWorkflow(workflowId);
    }

    return { ...execution, workflow: processes.getWorkflow(workflowId), review };
  };

  const listRecentEvents = url => {
    const filters = {};
    for (const key of ["type", "workflowId", "conversationId", "scheduleId", "taskId"]) {
      const value = url.searchParams.get(key);
      if (value) filters[key] = value;
    }

    const rawLimit = url.searchParams.get("limit");
    if (rawLimit === null) return events.listEvents(filters).slice(-100).reverse();
    if (!/^\d+$/.test(rawLimit)) throw requestError("Event limit must be an integer from 1 to 200");

    const limit = Number(rawLimit);
    if (limit < 1 || limit > 200) throw requestError("Event limit must be an integer from 1 to 200");
    return events.listEvents(filters).slice(-limit).reverse();
  };

  const editCarlosMessage = async (conversationId, messageId, content) => {
    const conversation = await conversations.getConversation(conversationId);
    if (!conversation) throw requestError("Conversation not found", 404);

    const messageIndex = conversation.messages.findIndex(message => message.id === messageId);
    if (messageIndex === -1) throw requestError("Message not found", 404);
    const message = conversation.messages[messageIndex];
    if (message.actor !== "Carlos") throw requestError("Only Carlos messages can be edited");
    if (typeof content !== "string" || !content.trim()) throw requestError("Message content cannot be empty");

    const messagePositions = new Map(conversation.messages.map((item, index) => [item.id, index]));
    const workflowEvents = events.listEvents({ type: "nora.workflow_started", conversationId });
    const workflowStartedAt = new Map();
    for (const event of workflowEvents) workflowStartedAt.set(event.workflowId, Date.parse(event.at));

    const cutoff = Date.parse(message.at);
    const workflowIds = conversation.workflows.filter(workflowId => {
      const workflow = processes.getWorkflow(workflowId);
      const sourceMessageId = workflow?.config?.sourceMessageId;
      if (sourceMessageId && messagePositions.has(sourceMessageId)) {
        return messagePositions.get(sourceMessageId) >= messageIndex;
      }

      const startedAt = workflowStartedAt.get(workflowId);
      return Number.isFinite(startedAt) && Number.isFinite(cutoff) && startedAt >= cutoff;
    });

    const retainedMessages = conversation.messages.slice(0, messageIndex + 1);
    const retainedArtifactIds = new Set(retainedMessages.flatMap(item => item.artifacts ?? []));
    const conversationArtifacts = await artifacts.listArtifacts(conversationId);
    const artifactIds = conversationArtifacts
      .filter(artifact => {
        if (retainedArtifactIds.has(artifact.id)) return false;
        const createdAt = Date.parse(artifact.createdAt);
        return Number.isFinite(createdAt) && Number.isFinite(cutoff) && createdAt >= cutoff;
      })
      .map(artifact => artifact.id);

    const updated = await conversations.editCarlosMessage(conversationId, messageId, content, workflowIds);

    for (const workflowId of workflowIds) {
      const workflow = processes.getWorkflow(workflowId);
      engine.cancelWorkflowExecution(workflowId, "Conversation history edited by Carlos");
      if (workflow && !["completed", "cancelled", "failed"].includes(workflow.status)) {
        await processes.cancelWorkflow(workflowId);
      }
      if (processes.getWorkflow(workflowId)) await processes.deleteWorkflow(workflowId);
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

    return updated;
  };

  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const parts = partsFrom(url.pathname);
    const method = req.method ?? "GET";
    const origin = req.headers.origin ?? null;

    if (origin && origin !== allowedOrigin) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "Origin not allowed" }));
    }

    const cors = {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
      ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    };
    const sendJson = (status, data) => {
      res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
    };
    const sendError = (status, message) => sendJson(status, { error: message });

    if (method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }

    try {
      if (method === "GET" && parts[0] === "health" && parts.length === 1) {
        return sendJson(200, { ok: true });
      }

      if (method === "GET" && parts[0] === "models" && parts.length === 1) {
        return sendJson(200, nora.listModels());
      }

      if (method === "GET" && parts[0] === "nora" && parts.length === 1) {
        return sendJson(200, nora.getNoraState());
      }

      if (method === "GET" && parts[0] === "events" && parts.length === 1) {
        return sendJson(200, listRecentEvents(url));
      }

      if (method === "GET" && parts[0] === "conversations" && parts.length === 1) {
        return sendJson(200, conversations.listConversations());
      }

      if (method === "POST" && parts[0] === "conversations" && parts.length === 1) {
        const body = await readJson(req);
        const conversation = await nora.createConversation({
          id: body.id ?? null,
          provider: body.provider ?? null,
          model: body.model ?? null,
        });
        return sendJson(201, conversation);
      }

      if (method === "GET" && parts[0] === "conversations" && parts.length === 2) {
        const conversation = await conversations.getConversation(parts[1]);
        return conversation ? sendJson(200, conversation) : sendError(404, "Conversation not found");
      }

      if (method === "PATCH" && parts[0] === "conversations" && parts.length === 2) {
        const body = await readJson(req);
        const conversation = await conversations.setConversationTitle(parts[1], body.title);
        return sendJson(200, conversation);
      }

      if (method === "DELETE" && parts[0] === "conversations" && parts.length === 2) {
        const deleted = await conversations.deleteConversation(parts[1]);
        return deleted
          ? sendJson(200, { id: parts[1], deleted: true })
          : sendError(404, "Conversation not found");
      }

      if (method === "PATCH" && parts[0] === "conversations" && parts[2] === "messages" && parts.length === 4) {
        const body = await readJson(req);
        return sendJson(200, await editCarlosMessage(parts[1], parts[3], body.content));
      }

      if (method === "PATCH" && parts[0] === "conversations" && parts[2] === "model" && parts.length === 3) {
        const body = await readJson(req);
        const conversation = await nora.setConversationModel(parts[1], {
          provider: body.provider,
          model: body.model,
        });
        return sendJson(200, conversation);
      }

      if (method === "POST" && parts[0] === "conversations" && parts[2] === "requests" && parts.length === 3) {
        const body = await readJson(req);
        const result = await nora.handleCarlosRequest({
          conversationId: parts[1],
          content: body.content,
          artifacts: body.artifacts ?? [],
        });
        return sendJson(200, result);
      }

      if (method === "GET" && parts[0] === "conversations" && parts[2] === "artifacts" && parts.length === 3) {
        return sendJson(200, await artifacts.listArtifacts(parts[1]));
      }

      if (method === "POST" && parts[0] === "conversations" && parts[2] === "artifacts" && parts.length === 3) {
        const body = await readJson(req);
        const artifact = await artifacts.createArtifact({
          conversationId: parts[1],
          name: body.name,
          type: body.type,
          createdBy: body.createdBy ?? "Carlos",
          content: body.encoding === "base64"
            ? Buffer.from(body.content ?? "", "base64")
            : body.content ?? "",
        });
        return sendJson(201, artifact);
      }

      if (method === "GET" && parts[0] === "conversations" && parts[2] === "artifacts" && parts.length === 4) {
        const artifact = await artifacts.getArtifact(parts[1], parts[3]);
        if (!artifact) return sendError(404, "Artifact not found");

        const content = await artifacts.readArtifact(parts[1], parts[3]);
        res.writeHead(200, {
          ...cors,
          "Content-Type": artifact.type ?? "application/octet-stream",
          "Content-Disposition": `inline; filename="${artifact.name.replaceAll('"', "")}"`,
        });
        return res.end(content);
      }

      if (method === "GET" && parts[0] === "processes" && parts.length === 1) {
        return sendJson(200, processes.listProcesses());
      }

      if (method === "GET" && parts[0] === "processes" && parts.length === 2) {
        const process = processes.getProcess(parts[1]);
        return process ? sendJson(200, process) : sendError(404, "Process not found");
      }

      if (method === "GET" && parts[0] === "workflows" && parts.length === 1) {
        return sendJson(200, processes.listWorkflows());
      }

      if (method === "GET" && parts[0] === "workflows" && parts.length === 2) {
        const workflow = processes.getWorkflow(parts[1]);
        return workflow ? sendJson(200, workflow) : sendError(404, "Workflow not found");
      }

      if (method === "GET" && parts[0] === "workflows" && parts[2] === "inspect" && parts.length === 3) {
        const result = nora.inspectWorkflow(parts[1]);
        return result ? sendJson(200, result) : sendError(404, "Workflow not found");
      }

      if (method === "POST" && parts[0] === "workflows" && parts[2] === "run" && parts.length === 3) {
        return sendJson(200, await executeWorkflow(parts[1]));
      }

      if (method === "POST" && parts[0] === "workflows" && parts[2] === "resume" && parts.length === 3) {
        const body = await readJson(req);
        await processes.resumeWorkflow(parts[1], body.taskIds ?? null);
        const execution = await executeWorkflow(parts[1]);
        return sendJson(200, execution.workflow);
      }

      if (method === "POST" && parts[0] === "workflows" && parts[2] === "restart" && parts.length === 3) {
        await processes.restartWorkflow(parts[1]);
        const execution = await executeWorkflow(parts[1]);
        return sendJson(200, execution.workflow);
      }

      if (method === "POST" && parts[0] === "workflows" && parts[2] === "cancel" && parts.length === 3) {
        engine.cancelWorkflowExecution(parts[1], "Workflow cancelled by Carlos");
        return sendJson(200, await processes.cancelWorkflow(parts[1]));
      }

      if (method === "PATCH" && parts[0] === "workflows" && parts[2] === "inputs" && parts.length === 3) {
        return sendJson(200, await processes.setWorkflowInputs(parts[1], await readJson(req)));
      }

      if (method === "PATCH" && parts[0] === "workflows" && parts[2] === "config" && parts.length === 3) {
        return sendJson(200, await processes.setWorkflowConfig(parts[1], await readJson(req)));
      }

      if (method === "PUT" && parts[0] === "workflows" && parts[2] === "edges" && parts.length === 3) {
        const body = await readJson(req);
        return sendJson(200, await processes.setWorkflowEdges(parts[1], body.edges));
      }

      if (method === "PATCH" && parts[0] === "workflows" && parts[2] === "tasks" && parts.length === 4) {
        return sendJson(200, await processes.editTask(parts[1], parts[3], await readJson(req)));
      }

      if (method === "POST" && parts[0] === "workflows" && parts[2] === "tasks" && parts[4] === "skip" && parts.length === 5) {
        return sendJson(200, await processes.skipTask(parts[1], parts[3]));
      }

      if (method === "POST" && parts[0] === "workflows" && parts[2] === "tasks" && parts[4] === "review" && parts.length === 5) {
        return sendJson(200, await nora.reviewFailedTask(parts[1], parts[3]));
      }

      if (method === "POST" && parts[0] === "workflows" && parts[2] === "tasks" && parts.length === 4) {
        const body = await readJson(req);
        return sendJson(200, await processes.addTask(parts[1], parts[3], body.task, body.edges ?? []));
      }

      if (method === "DELETE" && parts[0] === "workflows" && parts[2] === "tasks" && parts.length === 4) {
        return sendJson(200, await processes.removeTask(parts[1], parts[3]));
      }

      if (method === "POST" && parts[0] === "workflows" && parts[2] === "promote" && parts.length === 3) {
        const body = await readJson(req);
        return sendJson(
          201,
          await nora.promoteWorkflow(parts[1], { name: body.name, purpose: body.purpose ?? null }),
        );
      }

      if (method === "GET" && parts[0] === "approvals" && parts.length === 1) {
        return sendJson(200, authorization.listApprovals(url.searchParams.get("status")));
      }

      if (method === "POST" && parts[0] === "approvals" && parts[2] === "approve" && parts.length === 3) {
        return sendJson(200, await authorization.approve(parts[1]));
      }

      if (method === "POST" && parts[0] === "approvals" && parts[2] === "reject" && parts.length === 3) {
        return sendJson(200, await authorization.reject(parts[1]));
      }

      if (method === "GET" && parts[0] === "agents" && parts.length === 1) {
        return sendJson(200, agents.listAgents());
      }

      if (method === "GET" && parts[0] === "agents" && parts[1] === "active" && parts.length === 2) {
        return sendJson(200, engine.listAgentProcesses());
      }

      if (method === "PATCH" && parts[0] === "agents" && parts[2] === "model" && parts.length === 3) {
        const body = await readJson(req);
        return sendJson(200, await nora.setAgentModel(parts[1], {
          provider: body.provider,
          model: body.model,
        }));
      }

      if (method === "GET" && parts[0] === "tools" && parts.length === 1) {
        return sendJson(200, tools.listTools().map(tool => ({
          name: tool.name,
          description: tool.description ?? "",
          input: tool.input ?? {},
          output: tool.output ?? null,
          requiresApproval: Boolean(tool.requiresApproval),
          provider: tool.provider ?? null,
          model: tool.model ?? null,
        })));
      }

      if (method === "GET" && parts[0] === "skills" && parts.length === 1) {
        return sendJson(200, skills.listSkills());
      }

      if (method === "GET" && parts[0] === "schedules" && parts.length === 1) {
        return sendJson(200, schedules.listSchedules());
      }

      if (method === "POST" && parts[0] === "schedules" && parts.length === 1) {
        return sendJson(201, await schedules.createSchedule(await readJson(req)));
      }

      if (method === "GET" && parts[0] === "schedules" && parts.length === 2) {
        const schedule = schedules.getSchedule(parts[1]);
        return schedule ? sendJson(200, schedule) : sendError(404, "Schedule not found");
      }

      if (method === "PATCH" && parts[0] === "schedules" && parts.length === 2) {
        return sendJson(200, await schedules.updateSchedule(parts[1], await readJson(req)));
      }

      if (method === "POST" && parts[0] === "schedules" && parts[2] === "trigger" && parts.length === 3) {
        const workflow = await schedules.triggerSchedule(parts[1]);
        const execution = await executeWorkflow(workflow.id);
        return sendJson(201, execution.workflow);
      }

      return sendError(404, "Route not found");
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      return sendError(status, message);
    }
  };
};
