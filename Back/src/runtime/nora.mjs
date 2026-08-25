import config from "../config.mjs";
import { parseProviderJSON } from "../lib.mjs";
import { normalizeNoraDecision } from "../NoraActions.mjs";
import { createOllamaProvider } from "../providers/OllamaProvider.mjs";

const providers = new Map();
const ollama = createOllamaProvider(config.ollama);
providers.set(ollama.name, ollama);
const JSON_OBJECT_SCHEMA = Object.freeze({ type: "object" });
let queue = Promise.resolve();
const cancelled = new Set();
const activeControllers = new Map();

const errorMessage = error => error instanceof Error ? error.message : String(error);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const send = message => {
  if (process.connected) process.send(message);
};

const parseJson = content => {
  if (typeof content !== "string" || !content.trim()) throw new Error("Nora returned an empty response");
  const parsed = parseProviderJSON(content);
  if (!isObject(parsed)) throw new Error("Nora response must be one JSON object");
  return normalizeNoraDecision(parsed);
};

const decide = async (message, signal) => {
  const selection = message.selection;
  const provider = providers.get(selection?.provider);
  if (!provider) throw new Error(`Unknown model provider: ${selection?.provider}`);
  if (!selection?.model) throw new Error("Nora model is required");

  const messages = [];
  if (message.definition?.instructions) {
    messages.push({ role: "system", content: message.definition.instructions });
  }
  if (message.knowledge?.instructions?.trim()) {
    messages.push({
      role: "system",
      content: [
        "Standing instructions from Carlos. Apply them to every decision unless the current request explicitly supersedes them:",
        message.knowledge.instructions,
      ].join("\n\n"),
    });
  }
  if (message.knowledge?.facts?.trim()) {
    messages.push({
      role: "system",
      content: [
        "Durable facts supplied by Carlos. Treat them as persistent context and use them when relevant. Do not invent missing facts:",
        message.knowledge.facts,
      ].join("\n\n"),
    });
  }
  messages.push({
    role: "system",
    content: [
      "You are Nora, the permanent Chief of Staff process of Carlos Office.",
      "Carlos (the user) is the final human authority.",
      "Return exactly one complete JSON object and nothing else.",
      "Follow the supplied JSON schema exactly when provided.",
      "Use valid JSON only: double-quoted keys/strings, escaped special characters, no trailing commas, and balanced braces/brackets.",
      "Do not use Markdown, code fences, comments, prose outside the JSON, or partial/truncated output.",
      "The response must begin with { and end with }.",
      "Encode multiline text or source code as valid JSON strings using escaped newlines and quotes.",
    ].join("\n"),
  });
  messages.push({
    role: "user",
    content: [message.instruction, "", "Context:", JSON.stringify(message.context, null, 2)].join("\n"),
  });

  const response = await provider.generate({
    model: selection.model,
    messages,
    tools: [],
    format: message.format ?? JSON_OBJECT_SCHEMA,
    signal,
  });
  const content = response?.content ?? "";

  try {
    return parseJson(content);
  } catch (error) {
    console.error("[nora] Invalid JSON response.", {
      requestId: message.id ?? null,
      provider: selection.provider,
      model: selection.model,
      error: errorMessage(error),
      rawResponse: content,
    });
    throw error;
  }
};

try {
  await ollama.refreshModels();
} catch (error) {
  console.warn(`[nora] Ollama model discovery failed: ${error.message}`);
}

send({
  type: "ready",
  pid: process.pid,
  models: [...providers.entries()].map(([provider, instance]) => ({
    provider,
    models: Array.isArray(instance.models) ? [...instance.models] : [],
  })),
});

process.on("message", message => {
  if (message?.type === "cancel") {
    if (typeof message.id !== "string") return;
    cancelled.add(message.id);
    activeControllers.get(message.id)?.abort();
    return;
  }
  if (message?.type !== "decide") return;

  queue = queue.then(async () => {
    if (cancelled.delete(message.id)) {
      send({ type: "decision", id: message.id, cancelled: true });
      return;
    }

    const controller = new AbortController();
    activeControllers.set(message.id, controller);
    try {
      const result = await decide(message, controller.signal);
      if (cancelled.delete(message.id) || controller.signal.aborted) {
        send({ type: "decision", id: message.id, cancelled: true });
      } else {
        send({ type: "decision", id: message.id, result });
      }
    } catch (error) {
      if (cancelled.delete(message.id) || controller.signal.aborted || error?.name === "AbortError") {
        send({ type: "decision", id: message.id, cancelled: true });
      } else {
        send({
          type: "decision",
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      activeControllers.delete(message.id);
    }
  });
});
