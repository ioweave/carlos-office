import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

import { authorize, consumeApproval, listApprovals } from "../controllers/AuthorizationController.mjs";
import { recordEvent } from "../controllers/EventController.mjs";
import { getTool } from "../registry/Tools.mjs";

const agentProgram = fileURLToPath(new URL("./agent-process.mjs", import.meta.url));
const active = new Map();

const sameInput = (left, right) => {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
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

const runTool = async (entry, message) => {
  const { child, controller, workflowId, taskId, definition } = entry;
  const { requestId, call } = message;

  try {
    if (!entry.toolNames.has(call?.name)) throw new Error(`Agent requested unavailable Tool: ${call?.name}`);
    const tool = getTool(call.name);
    if (!tool) throw new Error(`Unknown Tool: ${call.name}`);

    const input = call.input ?? {};
    if (tool.requiresApproval) {
      const approved = approvedToolAction({
        workflowId,
        taskId,
        toolName: tool.name,
        input,
      });

      if (!approved) {
        const authorization = await authorize({
          action: `tool:${tool.name}`,
          actor: definition.name,
          requiresApproval: true,
          context: {
            workflowId,
            taskId,
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

export const runAgentProcess = ({
  definition,
  workflowId,
  taskId,
  task,
  provider,
  model,
  tools,
  skills,
}) => new Promise((resolve, reject) => {
  const child = fork(agentProgram, [], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    serialization: "advanced",
  });
  const controller = new AbortController();
  const id = `agent-${child.pid}`;
  const entry = {
    id,
    child,
    controller,
    definition: structuredClone(definition),
    workflowId,
    taskId,
    status: "working",
    toolNames: new Set(tools.map(tool => tool.name)),
    settled: false,
  };
  active.set(id, entry);

  const settle = result => {
    if (entry.settled) return;
    entry.settled = true;
    active.delete(id);
    resolve(result);
  };

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
    if (entry.settled) return;
    active.delete(id);
    entry.settled = true;
    reject(error);
  });

  child.on("exit", (code, signal) => {
    if (entry.settled) return;
    active.delete(id);
    entry.settled = true;
    resolve({
      status: controller.signal.aborted ? "cancelled" : "failed",
      error: controller.signal.aborted
        ? String(controller.signal.reason ?? "Workflow cancelled")
        : `Agent process exited unexpectedly (${signal ?? code ?? "unknown"})`,
    });
  });

  child.send({
    type: "run",
    definition: structuredClone(definition),
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
    },
  });
});

export const listActiveAgents = () => [...active.values()].map(entry => ({
  id: entry.id,
  pid: entry.child.pid,
  name: `${entry.definition.name}-${entry.child.pid}`,
  definition: entry.definition.name,
  blueprint: entry.definition.name,
  status: entry.status,
  taskId: entry.taskId,
  context: { workflowId: entry.workflowId },
}));

export const cancelWorkflowAgents = (workflowId, reason = "Workflow cancelled") => {
  let count = 0;
  for (const entry of active.values()) {
    if (entry.workflowId !== workflowId || entry.settled) continue;
    entry.controller.abort(new Error(reason));
    entry.child.kill("SIGTERM");
    count += 1;
  }
  return count;
};

export const stopAllAgents = reason => {
  for (const entry of active.values()) {
    if (!entry.controller.signal.aborted) entry.controller.abort(new Error(reason));
    entry.child.kill("SIGTERM");
  }
};
