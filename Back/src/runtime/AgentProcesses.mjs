import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

import { authorize, consumeApproval, listApprovals } from "../controllers/AuthorizationController.mjs";
import { recordEvent } from "../controllers/EventController.mjs";
import { getWorkflow } from "../controllers/ProcessController.mjs";
import { getTool } from "../registry/Tools.mjs";
import { getKnowledge } from "../services/KnowledgeService.mjs";

const agentProgram = fileURLToPath(new URL("./AgentProcess.mjs", import.meta.url));
const active = new Map();
const activeTaskKeys = new Map();
const DEFAULT_TASK_TIMEOUT_MS = 300_000;

const taskKey = (workflowId, taskId) => `${workflowId}\u0000${taskId}`;

const sameInput = (left, right) => {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

const hasCarlosAuthority = workflowId => {
  const config = getWorkflow(workflowId)?.config;
  return Boolean(config?.conversationId && config?.sourceMessageId);
};

const approvedToolAction = ({ workflowId, taskId, toolName, input }) => listApprovals("approved").find(
  approval => (
    approval.action === `tool:${toolName}`
    && approval.context?.workflowId === workflowId
    && approval.context?.taskId === taskId
    && sameInput(approval.context?.input, input)
  ),
) ?? null;

const toolMetadata = tool => ({
  name: tool.name,
  description: tool.description ?? "",
  input: tool.input ?? {},
  output: tool.output ?? null,
});

const sendToolResult = (child, requestId, payload) => {
  if (child.connected) child.send({ type: "tool-result", requestId, ...payload });
};

const recordAgentEvent = (type, context) => {
  void recordEvent(type, context).catch(error => {
    console.error(`[agents] Could not record ${type}.`, {
      agentId: context.agentId,
      workflowId: context.workflowId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

const runTool = async (entry, message) => {
  const { child, controller, workflowId, taskId } = entry;
  const { requestId, call } = message;

  try {
    if (!entry.toolNames.has(call?.name)) throw new Error(`Agent requested unavailable Tool: ${call?.name}`);
    const tool = getTool(call.name);
    if (!tool) throw new Error(`Unknown Tool: ${call.name}`);

    const input = call.input ?? {};
    if (tool.requiresApproval && !hasCarlosAuthority(workflowId)) {
      const approved = approvedToolAction({ workflowId, taskId, toolName: tool.name, input });

      if (!approved) {
        const authorization = await authorize({
          action: `tool:${tool.name}`,
          actor: entry.id,
          requiresApproval: true,
          context: {
            workflowId,
            taskId,
            agentId: entry.id,
            tool: tool.name,
            input: structuredClone(input),
          },
        });
        entry.status = "blocked";
        sendToolResult(child, requestId, {
          ok: false,
          blocked: true,
          approvalId: authorization.approval.id,
          error: `Carlos approval required for Tool: ${tool.name}`,
        });
        return;
      }

      await consumeApproval(approved.id);
    }

    const result = await tool.execute(structuredClone(input), {
      workflowId,
      taskId,
      agentId: entry.id,
      provider: tool.provider ?? null,
      model: tool.model ?? null,
      signal: controller.signal,
    });
    await recordEvent("tool.executed", {
      workflowId,
      taskId,
      agentId: entry.id,
      tool: tool.name,
      provider: tool.provider ?? null,
      model: tool.model ?? null,
    });
    sendToolResult(child, requestId, { ok: true, result });
  } catch (error) {
    sendToolResult(child, requestId, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const runAgentProcess = ({ workflowId, taskId, task, provider, model, tools, skills }) => {
  const key = taskKey(workflowId, taskId);
  const existingAgentId = activeTaskKeys.get(key);
  if (existingAgentId) {
    return Promise.reject(new Error(
      `Task ${taskId} in Workflow ${workflowId} already has an active Agent process (${existingAgentId})`,
    ));
  }

  activeTaskKeys.set(key, "starting");

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = fork(agentProgram, [], {
        stdio: ["ignore", "inherit", "inherit", "ipc"],
        serialization: "advanced",
      });
    } catch (error) {
      activeTaskKeys.delete(key);
      reject(error);
      return;
    }

    const controller = new AbortController();
    const id = `agent-${child.pid}`;
    const timeoutMs = task.timeoutMs === null ? null : (task.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS);
    const entry = {
      id,
      child,
      controller,
      workflowId,
      taskId,
      provider,
      model,
      tools: tools.map(tool => tool.name),
      skills: skills.map(skill => skill.name),
      status: "working",
      toolNames: new Set(tools.map(tool => tool.name)),
      settled: false,
      timeoutMs,
      timeoutTimer: null,
    };
    active.set(id, entry);
    activeTaskKeys.set(key, id);

    recordAgentEvent("agent.started", {
      workflowId,
      taskId,
      agentId: id,
      pid: child.pid,
      provider,
      model,
      timeoutMs,
    });

    const settle = result => {
      if (entry.settled) return;
      entry.settled = true;
      if (entry.timeoutTimer !== null) clearTimeout(entry.timeoutTimer);
      active.delete(id);
      if (activeTaskKeys.get(key) === id) activeTaskKeys.delete(key);
      recordAgentEvent("agent.stopped", {
        workflowId,
        taskId,
        agentId: id,
        pid: child.pid,
        status: result.status,
      });
      resolve({ ...result, agentId: id, pid: child.pid });
    };

    if (timeoutMs !== null) {
      entry.timeoutTimer = setTimeout(() => {
        if (entry.settled) return;
        const seconds = Math.round(timeoutMs / 1000);
        const error = `Task exceeded its ${seconds} second timeout`;
        controller.abort(new Error(error));
        child.kill("SIGTERM");
        settle({ status: "failed", error });
      }, timeoutMs);
    }

    child.on("message", message => {
      if (message?.type === "tool") {
        void runTool(entry, message);
        return;
      }
      if (message?.type === "completed") settle({ status: "completed", output: message.output });
      if (message?.type === "blocked") {
        settle({ status: "blocked", error: message.error, approvalId: message.approvalId ?? null });
      }
      if (message?.type === "failed") settle({ status: "failed", error: message.error });
    });

    child.on("error", error => {
      settle({ status: "failed", error: error instanceof Error ? error.message : String(error) });
    });

    child.on("exit", (code, signal) => {
      if (entry.settled) return;
      settle({
        status: controller.signal.aborted ? "cancelled" : "failed",
        error: controller.signal.aborted
          ? String(controller.signal.reason ?? "Workflow cancelled")
          : `Agent process exited unexpectedly (${signal ?? code ?? "unknown"})`,
      });
    });

    child.send({
      type: "run",
      provider,
      model,
      tools: tools.map(toolMetadata),
      skills: structuredClone(skills),
      task: {
        id: taskId,
        workflowId,
        objective: task.objective ?? "",
        completion: task.completion ?? "",
        input: structuredClone(task.input ?? {}),
        knowledge: getKnowledge(),
      },
    });
  });
};

export const listActiveAgents = () => [...active.values()].map(entry => ({
  id: entry.id,
  pid: entry.child.pid,
  name: entry.id,
  status: entry.status,
  taskId: entry.taskId,
  provider: entry.provider,
  model: entry.model,
  tools: [...entry.tools],
  skills: [...entry.skills],
  timeoutMs: entry.timeoutMs,
  context: { workflowId: entry.workflowId },
}));

const cancelAgents = (predicate, reason) => {
  let count = 0;
  for (const entry of active.values()) {
    if (!predicate(entry) || entry.settled) continue;
    entry.controller.abort(new Error(reason));
    entry.child.kill("SIGTERM");
    count += 1;
  }
  return count;
};

export const cancelTaskAgents = (workflowId, taskId, reason = "Task cancelled") => (
  cancelAgents(entry => entry.workflowId === workflowId && entry.taskId === taskId, reason)
);

export const cancelWorkflowAgents = (workflowId, reason = "Workflow cancelled") => (
  cancelAgents(entry => entry.workflowId === workflowId, reason)
);

export const stopAllAgents = reason => {
  for (const entry of active.values()) {
    if (!entry.controller.signal.aborted) entry.controller.abort(new Error(reason));
    entry.child.kill("SIGTERM");
  }
};
