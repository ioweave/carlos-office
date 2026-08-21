import config from "../config.mjs";
import { createOllamaProvider } from "../providers/OllamaProvider.mjs";

const providers = new Map();
const ollama = createOllamaProvider(config.ollama);
providers.set(ollama.name, ollama);
let queue = Promise.resolve();

const send = message => {
  if (process.connected) process.send(message);
};

const parseJson = content => {
  if (typeof content !== "string" || !content.trim()) throw new Error("Nora returned an empty response");

  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const source = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("Nora did not return valid JSON");
    return JSON.parse(source.slice(start, end + 1));
  }
};

const decide = async message => {
  const selection = message.selection;
  const provider = providers.get(selection?.provider);
  if (!provider) throw new Error(`Unknown model provider: ${selection?.provider}`);
  if (!selection?.model) throw new Error("Nora model is required");

  const messages = [];
  if (message.definition?.instructions) {
    messages.push({ role: "system", content: message.definition.instructions });
  }
  messages.push({
    role: "system",
    content: [
      "You are Nora, the permanent Chief of Staff process of Carlos Office.",
      "Carlos is the final human authority.",
      "Return only valid JSON for this decision.",
      "Do not wrap the JSON in explanation.",
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
  });
  return parseJson(response?.content);
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
  if (message?.type !== "decide") return;

  queue = queue.then(async () => {
    try {
      const result = await decide(message);
      send({ type: "decision", id: message.id, result });
    } catch (error) {
      send({
        type: "decision", id: message.id, error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});
