const CLOUD_INFERENCE_TIMEOUT_MS = 300_000;
const LOCAL_INFERENCE_TIMEOUT_MS = 1_800_000;
const DISCOVERY_TIMEOUT_MS = 15_000;

const normalizeBaseUrl = value => {
  const url = (value || "http://localhost:11434/api").replace(/\/+$/, "");
  return url.endsWith("/api") ? url : `${url}/api`;
};

const headers = apiKey => {
  const result = { "Content-Type": "application/json" };
  if (apiKey) result.Authorization = `Bearer ${apiKey}`;
  return result;
};

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const normalizeTools = (tools = []) => tools.map(tool => {
  if (!isObject(tool?.input) || tool.input.type !== "object" || !isObject(tool.input.properties)) {
    throw new Error(`Tool ${tool?.name || "unknown"} does not expose a canonical object input schema`);
  }
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: structuredClone(tool.input),
    },
  };
});

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

  return { role: message.role, content: message.content ?? "" };
});

const normalizeToolArguments = value => {
  if (isObject(value)) return value;
  if (typeof value !== "string" || !value.trim()) return value ?? {};
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : value;
  } catch {
    return value;
  }
};

const normalizeToolCalls = (toolCalls = []) => toolCalls.map((call, index) => ({
  id: call?.id || `ollama-tool-${index}`,
  name: call?.function?.name,
  input: normalizeToolArguments(call?.function?.arguments),
}));

const normalizeContent = value => {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const formatInstruction = format => {
  if (!format) return null;
  if (format === "json") {
    return [
      "Return only valid JSON for this response.",
      "Do not use Markdown, code fences, comments, or prose outside the JSON value.",
    ].join(" ");
  }

  return [
    "Return only JSON matching this schema exactly.",
    "Do not use Markdown, code fences, comments, or prose outside the JSON value.",
    "JSON schema:",
    JSON.stringify(format),
  ].join("\n");
};

const requestMessages = (messages, format) => {
  const instruction = formatInstruction(format);
  return instruction ? [{ role: "system", content: instruction }, ...messages] : messages;
};

const request = async (
  url,
  options,
  apiKey,
  timeoutMs = CLOUD_INFERENCE_TIMEOUT_MS,
  timeoutCode = "provider_request_timeout",
) => {
  const { signal: providedSignal = null, ...requestOptions } = options;
  const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null;
  const signal = providedSignal && timeoutSignal
    ? AbortSignal.any([providedSignal, timeoutSignal])
    : providedSignal || timeoutSignal || undefined;

  let response;
  try {
    response = await fetch(url, {
      ...requestOptions,
      signal,
      headers: {
        ...headers(apiKey),
        ...(requestOptions.headers ?? {}),
      },
    });
  } catch (error) {
    if (timeoutSignal?.aborted && !providedSignal?.aborted) {
      const seconds = Math.round(timeoutMs / 1000);
      const timeoutError = new Error(`Ollama request exceeded its ${seconds} second inference timeout`);
      timeoutError.code = timeoutCode;
      timeoutError.retryable = false;
      timeoutError.timeoutMs = timeoutMs;
      throw timeoutError;
    }
    throw error;
  }

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Ollama request failed (${response.status}): ${body || response.statusText}`);
    error.code = response.status === 429 || response.status >= 500 ? "provider_transient_error" : "provider_request_error";
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
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
  modelSettings = {},
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
  const settingsForModel = model => isObject(modelSettings?.[model]) ? modelSettings[model] : {};
  const isCloudModel = model => {
    const setting = settingsForModel(model);
    if (setting.location === "local") return false;
    return setting.location === "cloud" || endpointIsCloud || /(?:^|[-:])cloud$/i.test(model);
  };
  const timeoutForModel = model => {
    const setting = settingsForModel(model);
    if (Number.isSafeInteger(setting.inferenceTimeoutMs) && setting.inferenceTimeoutMs >= 0) {
      return setting.inferenceTimeoutMs;
    }
    return isCloudModel(model) ? CLOUD_INFERENCE_TIMEOUT_MS : LOCAL_INFERENCE_TIMEOUT_MS;
  };

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
        messages: normalizeMessages(requestMessages(messages, format)),
        stream: false,
      };

      if (tools.length) body.tools = normalizeTools(tools);
      // Cloud-backed Ollama models do not reliably support native structured-output format, even through a local daemon.
      if (format && !isCloudModel(model)) body.format = format;

      const result = await request(
        `${apiUrl}/chat`,
        { method: "POST", body: JSON.stringify(body), signal },
        apiKey,
        timeoutForModel(model),
        "provider_inference_timeout",
      );

      return {
        content: normalizeContent(result.message?.content),
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
      const result = await request(
        `${apiUrl}/tags`,
        { method: "GET" },
        apiKey,
        DISCOVERY_TIMEOUT_MS,
        "provider_discovery_timeout",
      );
      return (result.models ?? []).map(model => model.name ?? model.model).filter(Boolean);
    },

    async listModelMetadata() {
      const result = await request(
        `${apiUrl}/tags`,
        { method: "GET" },
        apiKey,
        DISCOVERY_TIMEOUT_MS,
        "provider_discovery_timeout",
      );
      const taggedModels = (result.models ?? []).filter(model => model?.name || model?.model);

      return mapWithConcurrency(taggedModels, 4, async tagged => {
        const modelName = tagged.name ?? tagged.model;
        let shown = null;
        try {
          shown = await request(
            `${apiUrl}/show`,
            { method: "POST", body: JSON.stringify({ model: modelName }) },
            apiKey,
            DISCOVERY_TIMEOUT_MS,
            "provider_discovery_timeout",
          );
        } catch {
          // Some remote/cloud catalogs expose tags but not full /show metadata.
        }

        return {
          name: modelName,
          location: isCloudModel(modelName) ? "cloud" : "local",
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
