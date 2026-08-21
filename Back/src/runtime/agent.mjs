import { randomUUID } from "node:crypto";

import config from "../config.mjs";
import { createOllamaProvider } from "../providers/OllamaProvider.mjs";
import { Agent } from "./Agent.mjs";

const pendingTools = new Map();
let running = false;

const send = message => {
  if (process.connected) process.send(message);
};

const providerFor = name => {
  if (name !== "ollama") throw new Error(`Unknown model provider: ${name}`);
  return createOllamaProvider(config.ollama);
};

const invokeTool = call => new Promise((resolve, reject) => {
  const requestId = randomUUID();
  pendingTools.set(requestId, { resolve, reject });
  send({ type: "tool", requestId, call });
});

const finish = message => {
  send(message);
  setImmediate(() => process.disconnect());
};

process.on("message", message => {
  if (message?.type === "tool-result") {
    const pending = pendingTools.get(message.requestId);
    if (!pending) return;
    pendingTools.delete(message.requestId);

    if (message.blocked) {
      const error = new Error(message.error || "Tool requires Carlos approval");
      error.code = "APPROVAL_REQUIRED";
      error.approvalId = message.approvalId ?? null;
      pending.reject(error);
      return;
    }

    if (!message.ok) {
      pending.reject(new Error(message.error || "Tool execution failed"));
      return;
    }

    pending.resolve(message.result);
    return;
  }

  if (message?.type !== "run" || running) return;
  running = true;

  void (async () => {
    try {
      const agent = new Agent({
        definition: message.definition,
        provider: providerFor(message.provider),
        model: message.model,
        tools: message.tools ?? [],
        skills: message.skills ?? [],
        invokeTool,
      });
      const output = await agent.run(message.task);
      finish({ type: "completed", output });
    } catch (error) {
      if (error?.code === "APPROVAL_REQUIRED") {
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
