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

const mapWithConcurrency = async (items, concurrency, mapper) => {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

const privateIpv4 = hostname => {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some(value => value < 0 || value > 255)) return false;
  const [first, second] = octets;
  return first === 10
    || first === 127
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254);
};

const localNetworkHost = hostname => {
  const value = String(hostname || "").toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return value === "localhost"
    || value.endsWith(".localhost")
    || value.endsWith(".local")
    || value === "::1"
    || /^(?:fc|fd)[0-9a-f:]*$/i.test(value)
    || /^fe[89ab][0-9a-f:]*$/i.test(value)
    || privateIpv4(value);
};

export const createOllamaProvider = ({
  name = "ollama",
  baseUrl = "http://localhost:11434/api",
  apiKey = null,
} = {}) => {
  if (typeof name !== "string" || !name.trim()) throw new Error("Provider name must be a non-empty string");
  const providerName = name.trim();
  const apiUrl = normalizeBaseUrl(baseUrl);
  const endpointIsCloud = (() => {
    try {
      return !localNetworkHost(new URL(apiUrl).hostname);
    } catch {
      return false;
    }
  })();

  const provider = {
    name: providerName,
    models: [],

    async generate({ model, messages, tools = [], format = null, signal = null }) {
      if (!model || typeof model !== "string") {
        throw new Error(`${providerName} model must be a non-empty string`);
      }
      if (!Array.isArray(messages)) throw new Error(`${providerName} messages must be an array`);

      const body = {
        model,
        messages: normalizeMessages(messages),
        stream: false,
      };

      if (tools.length) body.tools = normalizeTools(tools);
      if (format) body.format = format;

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
      return (result.models ?? []).map(model => model.name ?? model.model).filter(Boolean);
    },

    async listModelMetadata() {
      const result = await request(`${apiUrl}/tags`, { method: "GET" }, apiKey);
      const taggedModels = (result.models ?? []).filter(model => model?.name || model?.model);

      return mapWithConcurrency(taggedModels, 4, async tagged => {
        const modelName = tagged.name ?? tagged.model;
        let shown = null;
        try {
          shown = await request(
            `${apiUrl}/show`,
            { method: "POST", body: JSON.stringify({ model: modelName }) },
            apiKey,
          );
        } catch {
          // Some remote/cloud catalogs expose tags but not full /show metadata.
        }

        return {
          name: modelName,
          location: endpointIsCloud || /(?:^|[-:])cloud$/i.test(modelName) ? "cloud" : "local",
          details: shown?.details ?? tagged.details ?? null,
          capabilities: Array.isArray(shown?.capabilities) ? shown.capabilities : null,
          modelInfo: shown?.model_info ?? null,
          pricing: shown?.pricing ?? tagged.pricing ?? null,
          available: true,
        };
      });
    },

    async refreshModels() {
      provider.models = await provider.listModels();
      return [...provider.models];
    },
  };

  return provider;
};
