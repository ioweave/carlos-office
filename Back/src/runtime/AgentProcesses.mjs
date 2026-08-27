import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

import { authorize, consumeApproval, listApprovals } from "../controllers/AuthorizationController.mjs";
import { recordEvent } from "../controllers/EventController.mjs";
import { getWorkflow } from "../controllers/ProcessController.mjs";
import { getTool } from "../registry/Tools.mjs";
import { getKnowledge } from "../services/KnowledgeService.mjs";
import {
  cleanupInvocationWorkspace,
  prepareInvocationWorkspace,
  resolveWorkspacePath,
  stageInvocationCompletion,
} from "../services/ExecutionWorkspaceService.mjs";

const agentProgram = fileURLToPath(new URL("./AgentProcess.mjs", import.meta.url));
const active = new Map();
const activeInvocationKeys = new Map();
const DEFAULT_TASK_TIMEOUT_MS = 300_000;
const MAX_DIAGNOSTIC_STRING_LENGTH = 1_000;
const MAX_DIAGNOSTIC_ARRAY_LENGTH = 20;
const MAX_DIAGNOSTIC_DEPTH = 5;
const MAX_RETAINED_TOOL_FAILURES = 100;
const SENSITIVE_KEY_PATTERN = /(?:pass(?:word)?|token|secret|api[_-]?key|authorization|cookie|private[_-]?key|credential)/i;

const invocationKey = (workflowId, taskId, invocationId) => `${workflowId}\u0000${taskId}\u0000${invocationId ?? "single"}`;
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const sameInput = (left, right) => {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
};

const sanitizeDiagnosticValue = (value, depth = 0) => {
  if (depth >= MAX_DIAGNOSTIC_DEPTH) return "[truncated]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > MAX_DIAGNOSTIC_STRING_LENGTH ? `${value.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)}…` : value;
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_DIAGNOSTIC_ARRAY_LENGTH).map(item => sanitizeDiagnosticValue(item, depth + 1));
    if (value.length > MAX_DIAGNOSTIC_ARRAY_LENGTH) items.push(`[${value.length - MAX_DIAGNOSTIC_ARRAY_LENGTH} more items]`);
    return items;
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeDiagnosticValue(item, depth + 1),
    ]));
  }
  return String(value);
};

const hasCarlosAuthority = workflowId => {
  const config = getWorkflow(workflowId)?.config;
  return Boolean(config?.conversationId && config?.sourceMessageId);
};
const approvedToolAction = ({ workflowId, taskId, invocationId, toolName, input }) => listApprovals("approved").find(
  approval => (
    approval.action === `tool:${toolName}`
    && approval.context?.workflowId === workflowId
    && approval.context?.taskId === taskId
    && (approval.context?.invocationId ?? null) === (invocationId ?? null)
    && sameInput(approval.context?.input, input)
  ),
) ?? null;
const toolMetadata = tool => ({ name: tool.name, description: tool.description ?? "", input: tool.input ?? {}, output: tool.output ?? null });
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
const diagnosticInputText = input => {
  try { return JSON.stringify(input, null, 2); } catch { return String(input); }
};

const prepareToolInput = (toolName, input, workspaceDir) => {
  const prepared = structuredClone(input ?? {});
  if (["write-file", "read-file"].includes(toolName) && typeof prepared.path === "string" && prepared.path.trim()) {
    prepared.path = resolveWorkspacePath(workspaceDir, prepared.path);
  }
  if (toolName === "run-powershell") {
    prepared.workingDirectory = typeof prepared.workingDirectory === "string" && prepared.workingDirectory.trim()
      ? resolveWorkspacePath(workspaceDir, prepared.workingDirectory)
      : workspaceDir;
  }
  if (
    toolName === "play-audio"
    && typeof prepared.source === "string"
    && prepared.source.trim()
    && !/^(?:https?:|file:)/i.test(prepared.source.trim())
  ) {
    prepared.source = resolveWorkspacePath(workspaceDir, prepared.source);
  }
  return prepared;
};

const enrichFailedResult = (entry, result) => {
  const baseDiagnostics = isObject(result.diagnostics) ? structuredClone(result.diagnostics) : {};
  const toolFailures = entry.toolFailures.map(failure => structuredClone(failure));
  const diagnostics = {
    phase: typeof baseDiagnostics.phase === "string" && baseDiagnostics.phase
      ? baseDiagnostics.phase
      : toolFailures.length ? "tool" : "process",
    code: typeof baseDiagnostics.code === "string" && baseDiagnostics.code
      ? baseDiagnostics.code
      : toolFailures.length ? "tool_failure" : "agent_process_failure",
    message: typeof baseDiagnostics.message === "string" && baseDiagnostics.message
      ? baseDiagnostics.message
      : result.error || "Agent process failed",
    ...(entry.toolFailureCount ? {
      toolFailureCount: entry.toolFailureCount,
      retainedToolFailureCount: toolFailures.length,
      toolFailures,
    } : {}),
  };

  const lines = [result.error || diagnostics.message, `Phase: ${diagnostics.phase}`, `Code: ${diagnostics.code}`];
  if (toolFailures.length) {
    const omitted = Math.max(0, entry.toolFailureCount - toolFailures.length);
    lines.push("", `Tool failures (${entry.toolFailureCount} total${omitted ? `; showing latest ${toolFailures.length}` : ""}):`);
    for (const failure of toolFailures) {
      lines.push(`#${failure.sequence} ${failure.tool}`);
      if (failure.code) lines.push(`Code: ${failure.code}`);
      lines.push(`Input: ${diagnosticInputText(failure.input)}`);
      lines.push(`Error: ${failure.error}`);
      if (failure.hint) lines.push(`Hint: ${failure.hint}`);
    }
  }

  return { ...result, error: lines.join("\n"), diagnostics };
};

const runTool = async (entry, message) => {
  const { child, controller, workflowId, taskId, invocationId, workspaceDir } = entry;
  const { requestId, call } = message;
  try {
    if (!entry.toolNames.has(call?.name)) throw new Error(`Agent requested unavailable Tool: ${call?.name}`);
    const tool = getTool(call.name);
    if (!tool) throw new Error(`Unknown Tool: ${call.name}`);
    const input = call.input ?? {};
    if (tool.requiresApproval && !hasCarlosAuthority(workflowId)) {
      const approved = approvedToolAction({ workflowId, taskId, invocationId, toolName: tool.name, input });
      if (!approved) {
        const authorization = await authorize({
          action: `tool:${tool.name}`,
          actor: entry.id,
          requiresApproval: true,
          context: { workflowId, taskId, invocationId, agentId: entry.id, tool: tool.name, input: structuredClone(input) },
        });
        entry.status = "blocked";
        sendToolResult(child, requestId, {
          ok: false,
          blocked: true,
          approvalId: authorization.approval.id,
          error: `Carlos approval required for Tool: ${tool.name}`,
          code: "tool_approval_required",
          retryable: true,
          hint: "Wait for Carlos approval before retrying this Tool call.",
        });
        return;
      }
      await consumeApproval(approved.id);
    }

    const executionInput = prepareToolInput(tool.name, input, workspaceDir);
    const result = await tool.execute(executionInput, {
      workflowId,
      taskId,
      invocationId,
      agentId: entry.id,
      workspaceDir,
      provider: tool.provider ?? null,
      model: tool.model ?? null,
      signal: controller.signal,
    });
    await recordEvent("tool.executed", {
      workflowId, taskId, invocationId, agentId: entry.id, tool: tool.name,
      provider: tool.provider ?? null, model: tool.model ?? null,
    });
    sendToolResult(child, requestId, { ok: true, result });
  } catch (error) {
    const code = typeof error?.code === "string" && error.code ? error.code : "tool_execution_failed";
    const retryable = typeof error?.retryable === "boolean" ? error.retryable : true;
    const hint = typeof error?.hint === "string" && error.hint.trim() ? error.hint.trim() : null;
    entry.toolFailureCount += 1;
    const failure = {
      sequence: entry.toolFailureCount,
      tool: typeof call?.name === "string" ? call.name : "unknown-tool",
      input: sanitizeDiagnosticValue(call?.input ?? {}),
      error: error instanceof Error ? error.message : String(error),
      code,
      retryable,
      ...(hint ? { hint } : {}),
      at: new Date().toISOString(),
    };
    entry.toolFailures.push(failure);
    if (entry.toolFailures.length > MAX_RETAINED_TOOL_FAILURES) {
      entry.toolFailures.splice(0, entry.toolFailures.length - MAX_RETAINED_TOOL_FAILURES);
    }

    recordAgentEvent("tool.failed", {
      workflowId, taskId, invocationId, agentId: entry.id, tool: failure.tool, sequence: failure.sequence,
      input: structuredClone(failure.input), error: failure.error, code: failure.code, retryable: failure.retryable,
      ...(failure.hint ? { hint: failure.hint } : {}),
    });
    sendToolResult(child, requestId, {
      ok: false, error: failure.error, code: failure.code, retryable: failure.retryable,
      ...(failure.hint ? { hint: failure.hint } : {}),
    });
  }
};

export const runAgentProcess = async ({ workflowId, taskId, attemptId = null, invocationId = null, task, provider, model, tools, skills }) => {
  const key = invocationKey(workflowId, taskId, invocationId);
  const existingAgentId = activeInvocationKeys.get(key);
  if (existingAgentId) {
    throw new Error(`Invocation ${invocationId ?? taskId} in Workflow ${workflowId} already has an active Agent process (${existingAgentId})`);
  }
  activeInvocationKeys.set(key, "starting");

  let workspaceDir;
  try {
    workspaceDir = await prepareInvocationWorkspace({ workflowId, taskId, attemptId, invocationId });
  } catch (error) {
    activeInvocationKeys.delete(key);
    throw error;
  }

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = fork(agentProgram, [], { stdio: ["ignore", "inherit", "inherit", "ipc"], serialization: "advanced" });
    } catch (error) {
      activeInvocationKeys.delete(key);
      void cleanupInvocationWorkspace(workspaceDir).catch(() => {});
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
      attemptId,
      invocationId,
      workspaceDir,
      provider,
      model,
      tools: tools.map(tool => tool.name),
      skills: skills.map(skill => skill.name),
      status: "working",
      toolNames: new Set(tools.map(tool => tool.name)),
      toolFailures: [],
      toolFailureCount: 0,
      settled: false,
      timeoutMs,
      timeoutTimer: null,
    };
    active.set(id, entry);
    activeInvocationKeys.set(key, id);

    recordAgentEvent("agent.started", {
      workflowId, taskId, invocationId, agentId: id, pid: child.pid, provider, model, timeoutMs,
    });

    const settle = async rawResult => {
      if (entry.settled) return;
      entry.settled = true;
      if (entry.timeoutTimer !== null) clearTimeout(entry.timeoutTimer);
      active.delete(id);
      if (activeInvocationKeys.get(key) === id) activeInvocationKeys.delete(key);

      let result = rawResult.status === "failed" ? enrichFailedResult(entry, rawResult) : rawResult;
      if (result.status === "completed") {
        try {
          result = {
            ...result,
            output: await stageInvocationCompletion({
              workflowId,
              taskId,
              attemptId,
              invocationId,
              workspaceDir,
              completion: result.output,
            }),
          };
        } catch (error) {
          const message = `Could not stage Agent artifacts: ${error instanceof Error ? error.message : String(error)}`;
          result = {
            status: "failed",
            error: message,
            diagnostics: { phase: "artifact", code: "artifact_staging_failure", message },
          };
        }
      } else {
        await cleanupInvocationWorkspace(workspaceDir).catch(error => {
          console.warn("[agents] Could not clean failed invocation workspace.", {
            workflowId,
            taskId,
            invocationId,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }

      recordAgentEvent("agent.stopped", {
        workflowId, taskId, invocationId, agentId: id, pid: child.pid, status: result.status,
        ...(result.status === "failed" ? { error: result.error, diagnostics: result.diagnostics } : {}),
      });
      resolve({ ...result, agentId: id, pid: child.pid, invocationId });
    };

    if (timeoutMs !== null) {
      entry.timeoutTimer = setTimeout(() => {
        if (entry.settled) return;
        const seconds = Math.round(timeoutMs / 1000);
        const error = `Task exceeded its ${seconds} second timeout`;
        controller.abort(new Error(error));
        child.kill("SIGTERM");
        void settle({ status: "failed", error, diagnostics: { phase: "timeout", code: "task_timeout", message: error } });
      }, timeoutMs);
    }

    child.on("message", message => {
      if (message?.type === "tool") {
        void runTool(entry, message);
        return;
      }
      if (message?.type === "completed") void settle({ status: "completed", output: message.output });
      if (message?.type === "blocked") void settle({ status: "blocked", error: message.error, approvalId: message.approvalId ?? null });
      if (message?.type === "failed") void settle({ status: "failed", error: message.error, diagnostics: isObject(message.diagnostics) ? message.diagnostics : null });
    });
    child.on("error", error => {
      const message = error instanceof Error ? error.message : String(error);
      void settle({ status: "failed", error: message, diagnostics: { phase: "process", code: "agent_process_error", message } });
    });
    child.on("exit", (code, signal) => {
      if (entry.settled) return;
      const cancelled = controller.signal.aborted;
      const error = cancelled ? String(controller.signal.reason ?? "Workflow cancelled") : `Agent process exited unexpectedly (${signal ?? code ?? "unknown"})`;
      void settle(cancelled
        ? { status: "cancelled", error }
        : { status: "failed", error, diagnostics: { phase: "process", code: "agent_process_exit", message: error } });
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
        workspaceDir,
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
  invocationId: entry.invocationId,
  provider: entry.provider,
  model: entry.model,
  tools: [...entry.tools],
  skills: [...entry.skills],
  timeoutMs: entry.timeoutMs,
  toolFailureCount: entry.toolFailureCount,
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
