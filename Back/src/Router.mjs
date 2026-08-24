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

    await conversations.editCarlosMessage(conversationId, messageId, content, workflowIds);

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

    await nora.handleCarlosRequest({ conversationId, messageId });
    return conversations.getConversation(conversationId);
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

      if (method === "DELETE" && parts[0] === "processes" && parts.length === 2) {
        const process = processes.getProcess(parts[1]);
        if (!process) return sendError(404, "Process not found");

        const deletedSchedules = await schedules.deleteSchedulesForProcess(parts[1]);
        await processes.deleteProcess(parts[1]);
        return sendJson(200, {
          name: parts[1],
          deleted: true,
          deletedSchedules,
        });
      }

      if (method === "PATCH" && parts[0] === "processes" && parts.length === 2) {
        const process = processes.getProcess(parts[1]);
        if (!process) return sendError(404, "Process not found");

        const body = await readJson(req);
        if (body.taskId) {
          if (typeof body.taskId !== "string" || !body.taskId.trim()) {
            throw requestError("Process Task ID must be a non-empty string");
          }
          const taskId = body.taskId;
          const currentTask = process.tasks?.[taskId];
          if (!currentTask) throw requestError(`Unknown Process Task: ${taskId}`, 404);
          if (currentTask.type !== "task") throw requestError("Only executable Tasks have editable configuration");
          if (!body.task || typeof body.task !== "object" || Array.isArray(body.task)) {
            throw requestError("Process Task configuration must be an object");
          }

          const text = (value, label) => {
            if (typeof value !== "string") throw requestError(`${label} must be a string`);
            return value.trim();
          };
          const optionalName = (value, label) => {
            if (value == null || value === "") return null;
            if (typeof value !== "string" || !value.trim()) throw requestError(`${label} must be a non-empty string`);
            return value.trim();
          };
          const nameList = (value, label, nullable = false) => {
            if (nullable && value === null) return null;
            if (!Array.isArray(value)) throw requestError(`${label} must be an array`);
            const result = value.map(item => {
              if (typeof item !== "string" || !item.trim()) {
                throw requestError(`${label} must contain non-empty strings`);
              }
              return item.trim();
            });
            return [...new Set(result)];
          };

          const provider = optionalName(body.task.provider, "Task provider");
          const model = optionalName(body.task.model, "Task model");
          const taskTools = nameList(body.task.tools, "Task Tools", true);
          const taskSkills = nameList(body.task.skills, "Task Skills", true);
          const inputs = nameList(body.task.inputs, "Task inputs");

          if (Boolean(provider) !== Boolean(model)) {
            throw requestError("Task provider and model must be configured together");
          }
          if (provider) {
            const providerEntry = nora.listModels().find(item => item.provider === provider);
            if (!providerEntry || !providerEntry.models?.includes(model)) {
              throw requestError(`Unknown model selection: ${provider}/${model}`);
            }
          }

          const knownTools = new Set(tools.listTools().map(tool => tool.name));
          for (const toolName of taskTools ?? []) {
            if (!knownTools.has(toolName)) throw requestError(`Unknown Tool: ${toolName}`);
          }
          const knownSkills = new Set(skills.listSkills().map(skill => skill.name));
          for (const skillName of taskSkills ?? []) {
            if (!knownSkills.has(skillName)) throw requestError(`Unknown Skill: ${skillName}`);
          }

          const updatedTask = structuredClone(currentTask);
          delete updatedTask.agent;
          delete updatedTask.tool;
          updatedTask.objective = text(body.task.objective, "Task objective");
          updatedTask.inputs = inputs;
          updatedTask.output = text(body.task.output, "Task output");
          updatedTask.completion = text(body.task.completion, "Task completion");

          if (provider) {
            updatedTask.provider = provider;
            updatedTask.model = model;
          } else {
            delete updatedTask.provider;
            delete updatedTask.model;
          }
          if (taskTools === null) delete updatedTask.tools;
          else updatedTask.tools = taskTools;
          if (taskSkills === null) delete updatedTask.skills;
          else updatedTask.skills = taskSkills;

          return sendJson(200, await processes.saveProcess({
            ...process,
            tasks: { ...process.tasks, [taskId]: updatedTask },
          }));
        }

        if (!body.layout || typeof body.layout !== "object" || Array.isArray(body.layout)) {
          throw requestError("Process update must include Task configuration or layout");
        }

        const layout = {};
        for (const [taskId, position] of Object.entries(body.layout)) {
          if (!Object.prototype.hasOwnProperty.call(process.tasks, taskId)) {
            throw requestError(`Process layout references unknown Task: ${taskId}`);
          }
          if (!position || typeof position !== "object" || Array.isArray(position)) {
            throw requestError(`Invalid Process position for Task: ${taskId}`);
          }

          const x = Number(position.x);
          const y = Number(position.y);
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
            throw requestError(`Invalid Process position for Task: ${taskId}`);
          }
          layout[taskId] = { x: Math.round(x), y: Math.round(y) };
        }

        return sendJson(200, await processes.saveProcess({ ...process, layout }));
      }

      if (method === "GET" && parts[0] === "workflows" && parts.length === 1) {
        return sendJson(200, processes.listWorkflows());
      }

      if (method === "GET" && parts[0] === "workflows" && parts.length === 2) {
        const workflow = processes.getWorkflow(parts[1]);
        return workflow ? sendJson(200, workflow) : sendError(404, "Workflow not found");
      }

      if (method === "DELETE" && parts[0] === "workflows" && parts.length === 2) {
        const workflow = processes.getWorkflow(parts[1]);
        if (!workflow) return sendError(404, "Workflow not found");
        if (workflow.status === "running") {
          throw requestError("Stop a running Workflow before deleting it", 409);
        }

        await authorization.deleteApprovalsForWorkflows([parts[1]]);
        const conversationsUpdated = await conversations.removeWorkflowReference(parts[1]);
        await processes.deleteWorkflow(parts[1]);
        return sendJson(200, {
          id: parts[1],
          deleted: true,
          conversationsUpdated,
        });
      }

      if (method === "GET" && parts[0] === "workflows" && parts[2] === "inspect" && parts.length === 3) {
        const result = nora.inspectWorkflow(parts[1]);
        return result ? sendJson(200, result) : sendError(404, "Workflow not found");
      }

      if (method === "POST" && parts[0] === "workflows" && parts[2] === "run" && parts.length === 3) {
        return sendJson(200, await executeWorkflow(parts[1]));
      }

      if (method === "POST" && parts[0] === "workflows" && parts[2] === "stop" && parts.length === 3) {
        const workflow = await processes.pauseWorkflow(parts[1]);
        engine.cancelWorkflowExecution(parts[1], "Workflow stopped by Carlos");
        return sendJson(200, workflow);
      }

      if (method === "POST" && parts[0] === "workflows" && parts[2] === "resume" && parts.length === 3) {
        const body = await readJson(req);
        await processes.resumeWorkflow(parts[1], body.taskIds ?? null);
        const execution = await executeWorkflow(parts[1]);
        return sendJson(200, execution.workflow);
      }

      if (method === "POST" && parts[0] === "workflows" && parts[2] === "restart" && parts.length === 3) {
        engine.cancelWorkflowExecution(parts[1], "Workflow restarted by Carlos");
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

      if (method === "POST" && parts[0] === "workflows" && parts[2] === "tasks" && parts[4] === "cancel" && parts.length === 5) {
        const workflow = await processes.cancelTask(parts[1], parts[3]);
        engine.cancelTaskExecution(parts[1], parts[3], "Task cancelled by Carlos");
        return sendJson(200, workflow);
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

      if (method === "GET" && parts[0] === "agents" && parts[1] === "active" && parts.length === 2) {
        return sendJson(200, engine.listAgentProcesses());
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

      if (method === "DELETE" && parts[0] === "tools" && parts.length === 2) {
        if (!tools.getTool(parts[1])) return sendError(404, "Tool not found");

        const references = processes.listProcesses().flatMap(process => Object.entries(process.tasks ?? {})
          .filter(([, task]) => task.type === "task" && (task.tools ?? []).includes(parts[1]))
          .map(([taskId]) => `${process.name}/${taskId}`));
        if (references.length) {
          throw requestError(`Tool ${parts[1]} is used by Process Tasks: ${references.join(", ")}`, 409);
        }

        await tools.deleteTool(parts[1]);
        return sendJson(200, { name: parts[1], deleted: true });
      }

      if (method === "POST" && parts[0] === "tools" && parts[2] === "run" && parts.length === 3) {
        const tool = tools.getTool(parts[1]);
        if (!tool) return sendError(404, "Tool not found");
        const input = await readJson(req);
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          throw requestError("Tool input must be a JSON object");
        }

        const result = await tool.execute(structuredClone(input), {
          workflowId: null,
          taskId: null,
          agentId: "Carlos",
          provider: tool.provider ?? null,
          model: tool.model ?? null,
          signal: new AbortController().signal,
        });
        await events.recordEvent("tool.executed", {
          tool: tool.name,
          actor: "Carlos",
          manual: true,
          provider: tool.provider ?? null,
          model: tool.model ?? null,
        });
        return sendJson(200, { tool: tool.name, result });
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