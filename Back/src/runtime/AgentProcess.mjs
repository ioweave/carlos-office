import { randomUUID } from "node:crypto";

import { createConfiguredProviders } from "../providers/ProviderFactory.mjs";
import { Agent } from "./Agent.mjs";

const { providers } = await createConfiguredProviders();
const pendingTools = new Map();
const HEARTBEAT_MS = 15_000;
const IPC_FLUSH_TIMEOUT_MS = 2_000;
let running = false;
let heartbeat = null;

const send = (message, callback = null) => {
  if (!process.connected) {
    callback?.(new Error("Agent IPC channel is closed"));
    return false;
  }
  process.send(message, callback ?? undefined);
  return true;
};

const invokeTool = call => new Promise((resolve, reject) => {
  const requestId = randomUUID();
  pendingTools.set(requestId, { resolve, reject });
  send({ type: "tool", requestId, call: structuredClone(call) }, error => {
    if (!error) return;
    pendingTools.delete(requestId);
    reject(error);
  });
});

const finish = message => new Promise(resolve => {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;

  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    resolve();
  };
  const timer = setTimeout(done, IPC_FLUSH_TIMEOUT_MS);
  timer.unref?.();

  if (!send(message, () => {
    clearTimeout(timer);
    done();
  })) {
    clearTimeout(timer);
    done();
  }
}).finally(() => process.exit(0));

const failureDiagnostics = error => ({
  phase: typeof error?.phase === "string" && error.phase ? error.phase : "agent",
  code: typeof error?.code === "string" && error.code ? error.code : "agent_failure",
  message: error instanceof Error ? error.message : String(error),
  ...(typeof error?.retryable === "boolean" ? { retryable: error.retryable } : {}),
});

process.on("message", message => {
  if (message?.type === "tool-result") {
    const pending = pendingTools.get(message.requestId);
    if (!pending) return;
    pendingTools.delete(message.requestId);

    if (message.ok) {
      pending.resolve(message.result);
      return;
    }

    const error = new Error(message.error || "Tool execution failed");
    error.blocked = Boolean(message.blocked);
    error.approvalId = message.approvalId ?? null;
    if (typeof message.code === "string" && message.code) error.code = message.code;
    if (typeof message.retryable === "boolean") error.retryable = message.retryable;
    if (typeof message.hint === "string" && message.hint.trim()) error.hint = message.hint.trim();
    error.replaySafe = message.replaySafe === true;
    error.sideEffect = message.sideEffect ?? "unknown";
    error.attempts = message.attempts ?? 0;
    pending.reject(error);
    return;
  }

  if (message?.type !== "run" || running) return;
  running = true;
  heartbeat = setInterval(() => send({ type: "heartbeat" }), HEARTBEAT_MS);
  heartbeat.unref?.();

  void (async () => {
    let agent = null;
    try {
      const provider = providers.get(message.provider);
      if (!provider) {
        const error = new Error(`Unknown model provider: ${message.provider}`);
        error.phase = "setup";
        error.code = "unknown_provider";
        throw error;
      }
      const execution = message.execution ?? {};
      agent = new Agent({
        provider,
        model: message.model,
        tools: message.tools ?? [],
        skills: message.skills ?? [],
        invokeTool,
        maxNoProgressTurns: execution.maxNoProgressTurns,
        maxReasoningTurns: execution.maxReasoningTurns,
        maxToolCalls: execution.maxToolCalls,
      });
      const completion = await agent.run(message.task);
      await finish({ type: "completed", completion, usage: completion.usage ?? agent.getUsage() });
    } catch (error) {
      const usage = agent?.getUsage() ?? null;
      if (error?.blocked) {
        await finish({
          type: "blocked",
          error: error.message,
          approvalId: error.approvalId ?? null,
          usage,
        });
        return;
      }
      await finish({
        type: "failed",
        error: error instanceof Error ? error.message : String(error),
        diagnostics: failureDiagnostics(error),
        usage,
      });
    }
  })();
});
