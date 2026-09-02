import { parseProviderJSON } from "../lib.mjs";
import { normalizeNoraDecision } from "../NoraActions.mjs";
import { createConfiguredProviders } from "../providers/ProviderFactory.mjs";

const { providers } = await createConfiguredProviders();
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

const generateJson = async ({ provider, model, messages, format, signal }) => provider.generate({
  model,
  messages,
  tools: [],
  format,
  signal,
});

const repairJson = async ({ provider, model, messages, format, content, parseError, signal }) => {
  const repairMessages = [
    ...messages,
    ...(typeof content === "string" && content.trim() ? [{ role: "assistant", content }] : []),
    {
      role: "system",
      content: [
        "The previous response was invalid JSON or violated the required decision shape.",
        `Validation error: ${errorMessage(parseError)}`,
        "Repair it now. Return exactly one complete JSON object and nothing else.",
        "Do not add Markdown, commentary, code fences, or a second object.",
      ].join("\n"),
    },
  ];
  const response = await generateJson({ provider, model, messages: repairMessages, format, signal });
  return parseJson(response?.content ?? "");
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

  const format = message.format ?? JSON_OBJECT_SCHEMA;
  const response = await generateJson({ provider, model: selection.model, messages, format, signal });
  const content = response?.content ?? "";

  try {
    return parseJson(content);
  } catch (error) {
    console.warn("[nora] Invalid JSON response; attempting one bounded repair.", {
      requestId: message.id ?? null,
      provider: selection.provider,
      model: selection.model,
      error: errorMessage(error),
    });
    try {
      return await repairJson({
        provider,
        model: selection.model,
        messages,
        format,
        content,
        parseError: error,
        signal,
      });
    } catch (repairError) {
      console.error("[nora] JSON repair failed.", {
        requestId: message.id ?? null,
        provider: selection.provider,
        model: selection.model,
        error: errorMessage(repairError),
      });
      throw repairError;
    }
  }
};

for (const [providerName, provider] of providers) {
  try {
    await provider.refreshModels();
  } catch (error) {
    console.warn(`[nora] ${providerName} model discovery failed: ${error.message}`);
  }
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
