import { randomUUID } from "node:crypto";

import { createConfiguredProviders } from "../providers/ProviderFactory.mjs";
import { Agent } from "./Agent.mjs";

const { providers } = await createConfiguredProviders();
const pendingTools = new Map();
let running = false;

const send = message => {
  if (process.connected) process.send(message);
};

const invokeTool = call => new Promise((resolve, reject) => {
  const requestId = randomUUID();
  pendingTools.set(requestId, { resolve, reject });
  send({ type: "tool", requestId, call: structuredClone(call) });
});

const finish = message => {
  send(message);
  setImmediate(() => process.exit(0));
};

const failureDiagnostics = error => ({
  phase: typeof error?.phase === "string" && error.phase ? error.phase : "agent",
  code: typeof error?.code === "string" && error.code ? error.code : "agent_failure",
  message: error instanceof Error ? error.message : String(error),
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
    pending.reject(error);
    return;
  }

  if (message?.type !== "run" || running) return;
  running = true;

  void (async () => {
    try {
      const provider = providers.get(message.provider);
      if (!provider) {
        const error = new Error(`Unknown model provider: ${message.provider}`);
        error.phase = "setup";
        error.code = "unknown_provider";
        throw error;
      }
      const execution = message.execution ?? {};
      const agent = new Agent({
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
      finish({ type: "completed", completion });
    } catch (error) {
      if (error?.blocked) {
        finish({
          type: "blocked",
          error: error.message,
          approvalId: error.approvalId ?? null,
        });
        return;
      }
      finish({
        type: "failed",
        error: error instanceof Error ? error.message : String(error),
        diagnostics: failureDiagnostics(error),
      });
    }
  })();
});
