import { randomUUID } from "node:crypto";

import config from "../config.mjs";
import { createOllamaProvider } from "../providers/OllamaProvider.mjs";
import { Agent } from "./Agent.mjs";

const providers = new Map();
const ollama = createOllamaProvider(config.ollama);
providers.set(ollama.name, ollama);
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
    pending.reject(error);
    return;
  }

  if (message?.type !== "run" || running) return;
  running = true;

  void (async () => {
    try {
      const provider = providers.get(message.provider);
      if (!provider) throw new Error(`Unknown model provider: ${message.provider}`);
      const agent = new Agent({
        provider,
        model: message.model,
        tools: message.tools ?? [],
        skills: message.skills ?? [],
        invokeTool,
      });
      const output = await agent.run(message.task);
      finish({ type: "completed", output });
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
      });
    }
  })();
});
