const REQUEST_TIMEOUT_MS = 300_000;

const normalizeBaseUrl = value => {
  const url = (value || "http://localhost:11434/api").replace(/\/+$/, "");
  return url.endsWith("/api") ? url : `${url}/api`;
};

const headers = apiKey => {
  const result = { "Content-Type": "application/json" };
  if (apiKey) result.Authorization = `Bearer ${apiKey}`;
  return result;
};

const toJsonSchema = input => {
  if (input && typeof input === "object" && input.type === "object") return input;

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { type: "object", properties: {} };
  }

  const properties = {};
  for (const [name, definition] of Object.entries(input)) {
    if (definition && typeof definition === "object") {
      properties[name] = definition;
      continue;
    }

    properties[name] = {
      type: typeof definition === "string" ? definition : "string",
    };
  }

  return { type: "object", properties };
};

const normalizeTools = (tools = []) => tools.map(tool => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description ?? "",
    parameters: toJsonSchema(tool.input),
  },
}));

const normalizeMessages = (messages = []) => messages.map(message => {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_name: message.name,
      content: message.content ?? "",
    };
  }

  if (message.role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length) {
    return {
      role: "assistant",
      content: message.content ?? "",
      tool_calls: message.toolCalls.map((call, index) => ({
        type: "function",
        function: {
          index,
          name: call.name,
          arguments: call.input ?? {},
        },
      })),
    };
  }

  return {
    role: message.role,
    content: message.content ?? "",
  };
});

const normalizeToolCalls = (toolCalls = []) => toolCalls.map((call, index) => ({
  id: `ollama-tool-${index}`,
  name: call.function?.name,
  input: call.function?.arguments ?? {},
}));

const request = async (url, options, apiKey) => {
  const { signal: providedSignal = null, ...requestOptions } = options;
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = providedSignal ? AbortSignal.any([providedSignal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(url, {
    ...requestOptions,
    signal,
    headers: {
      ...headers(apiKey),
      ...(requestOptions.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${body || response.statusText}`);
  }

  return response.json();
};

export const createOllamaProvider = ({
  baseUrl = "http://localhost:11434/api",
  apiKey = null,
} = {}) => {
  const apiUrl = normalizeBaseUrl(baseUrl);

  const provider = {
    name: "ollama",
    models: [],

    async generate({ model, messages, tools = [], signal = null }) {
      if (!model || typeof model !== "string") {
        throw new Error("Ollama model must be a non-empty string");
      }
      if (!Array.isArray(messages)) throw new Error("Ollama messages must be an array");

      const body = {
        model,
        messages: normalizeMessages(messages),
        stream: false,
      };

      if (tools.length) body.tools = normalizeTools(tools);

      const result = await request(
        `${apiUrl}/chat`,
        {
          method: "POST",
          body: JSON.stringify(body),
          signal,
        },
        apiKey,
      );

      return {
        content: result.message?.content ?? "",
        toolCalls: normalizeToolCalls(result.message?.tool_calls),
        usage: {
          inputTokens: result.prompt_eval_count ?? 0,
          outputTokens: result.eval_count ?? 0,
          totalDuration: result.total_duration ?? 0,
          loadDuration: result.load_duration ?? 0,
        },
      };
    },

    async listModels() {
      const result = await request(`${apiUrl}/tags`, { method: "GET" }, apiKey);
      return (result.models ?? []).map(model => model.name ?? model.model);
    },

    async refreshModels() {
      provider.models = await provider.listModels();
      return [...provider.models];
    },
  };

  return provider;
};
