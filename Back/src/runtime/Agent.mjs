import { parseProviderJSON } from "../lib.mjs";

const MAX_REASONING_TURNS = 16;
const MAX_TOOL_CALLS = 24;
const MAX_PROVIDER_ATTEMPTS = 3;
const MAX_SAFE_TOOL_ATTEMPTS = 3;
const MAX_TOOL_RESULT_CHARS = 60_000;
const MAX_ACTIVE_TOOL_CONTEXT_CHARS = 180_000;
const MAX_COMPLETION_EVIDENCE_CHARS = 80_000;
const MAX_COMPLETION_TOOL_CHARS = 20_000;
const MAX_HTTP_BODY_CONTEXT_CHARS = 12_000;
const MAX_RELAY_OUTPUT_CHARS = 600;
const RESEARCH_CONVERGENCE_TOOL_CALLS = 24;
const FAILED_CALL_MEMORY_TURNS = 4;
const RETRY_BACKOFF_MS = [300, 900];
const CACHEABLE_TOOLS = new Set(["http-content", "read-file", "workspace-variables"]);
const COMPLETION_SCHEMA = {
  type: "object",
  properties: {
    output: { type: "string" },
    data: {},
    artifacts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  required: ["output", "data", "artifacts"],
  additionalProperties: false,
};
const RELAY_COMPLETION_SCHEMA = {
  ...COMPLETION_SCHEMA,
  properties: {
    ...COMPLETION_SCHEMA.properties,
    output: { type: "string", maxLength: MAX_RELAY_OUTPUT_CHARS },
  },
};

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const cappedText = (text, limit = MAX_TOOL_RESULT_CHARS) => {
  if (text.length <= limit) return text;
  const tailChars = Math.min(8_000, Math.floor(limit / 4));
  const headChars = limit - tailChars;
  return [
    text.slice(0, headChars),
    `\n\n[Tool result truncated for model context: ${text.length} characters total.`,
    "Use a narrower Tool request, range read, search operation, or stored-content handle for omitted data.]\n\n",
    text.slice(-tailChars),
  ].join("");
};

const compactHttpResult = result => {
  if (!isObject(result)) return result;
  const compact = structuredClone(result);
  if (isObject(compact.headers)) {
    const usefulHeaders = new Set([
      "content-type", "content-length", "content-disposition", "location", "last-modified", "etag",
      "cache-control", "expires", "retry-after", "allow", "www-authenticate",
    ]);
    compact.headers = Object.fromEntries(Object.entries(compact.headers).filter(([name]) => (
      usefulHeaders.has(name.toLowerCase()) || name.toLowerCase().startsWith("access-control-")
    )));
  }
  if (typeof compact.body === "string" && compact.body.length > MAX_HTTP_BODY_CONTEXT_CHARS) {
    compact.body = `${compact.body.slice(0, MAX_HTTP_BODY_CONTEXT_CHARS)}\n[HTTP body omitted; use the returned content handle or a narrower request.]`;
  }
  return compact;
};

const resultToText = (result, toolName = null) => {
  const value = toolName === "http" ? compactHttpResult(result) : result;
  let text;
  if (typeof value === "string") text = value;
  else if (Buffer.isBuffer(value)) text = value.toString("utf8");
  else if (value === undefined) text = "";
  else text = JSON.stringify(value);
  return cappedText(text);
};

const compactMessages = messages => {
  const compacted = structuredClone(messages);
  const toolMessages = compacted
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message?.role === "tool" && typeof message.content === "string");
  let retainedToolChars = toolMessages.reduce((total, { message }) => total + message.content.length, 0);
  if (retainedToolChars <= MAX_ACTIVE_TOOL_CONTEXT_CHARS) return compacted;

  const omission = "[Tool result omitted from active model context. Re-run a narrow read/search if it is still needed.]";
  toolMessages.sort((left, right) => right.message.content.length - left.message.content.length || left.index - right.index);
  for (const { message } of toolMessages) {
    if (retainedToolChars <= MAX_ACTIVE_TOOL_CONTEXT_CHARS) break;
    const previousLength = message.content.length;
    message.content = omission;
    retainedToolChars -= Math.max(0, previousLength - omission.length);
  }
  return compacted;
};

const messageCharacters = messages => messages.reduce((total, message) => total + String(message?.content ?? "").length, 0);
const describeTools = tools => tools.map(tool => ({
  name: tool.name,
  description: tool.description ?? "",
  input: tool.input ?? {},
  output: tool.output ?? null,
}));

const failure = (message, phase, code) => {
  const error = new Error(message);
  error.phase = phase;
  error.code = code;
  return error;
};

const classifyFailure = (error, phase, code) => {
  if (!(error instanceof Error)) return failure(String(error), phase, code);
  if (!error.phase) error.phase = phase;
  if (!error.code) error.code = code;
  return error;
};

const getPath = (value, path) => {
  const parts = String(path || "").split(".").map(part => part.trim()).filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (current == null || (typeof current !== "object" && !Array.isArray(current))) return undefined;
    current = current[part];
  }
  return current;
};

const validateRequiredInputs = task => {
  const requiredInputs = Array.isArray(task.requiredInputs) ? task.requiredInputs : [];
  for (const path of requiredInputs) {
    if (typeof path !== "string" || !path.trim()) {
      throw failure("Task contains an invalid declared input", "setup", "task_input_invalid");
    }
    if (getPath(task.input ?? {}, path) === undefined) {
      throw failure(`Task input "${path}" is unresolved`, "setup", "task_input_unresolved");
    }
  }
};

const normalizeArtifacts = value => {
  if (!Array.isArray(value)) throw failure("Agent completion artifacts must be an array", "completion", "invalid_completion");
  return value.map((artifact, index) => {
    if (!isObject(artifact) || typeof artifact.path !== "string" || !artifact.path.trim()) {
      throw failure(`Agent completion artifact ${index + 1} must include a path`, "completion", "invalid_artifact_declaration");
    }
    if (artifact.name != null && (typeof artifact.name !== "string" || !artifact.name.trim())) {
      throw failure(`Agent completion artifact ${index + 1} has an invalid name`, "completion", "invalid_artifact_declaration");
    }
    if (artifact.type != null && (typeof artifact.type !== "string" || !artifact.type.trim())) {
      throw failure(`Agent completion artifact ${index + 1} has an invalid type`, "completion", "invalid_artifact_declaration");
    }
    return {
      path: artifact.path.trim(),
      ...(artifact.name?.trim() ? { name: artifact.name.trim() } : {}),
      ...(artifact.type?.trim() ? { type: artifact.type.trim() } : {}),
    };
  });
};

const preserveVerboseRelayOutput = (data, output) => {
  if (data == null) return { relayText: output };
  if (isObject(data) && !Object.prototype.hasOwnProperty.call(data, "relayText")) return { ...data, relayText: output };
  return { value: data, relayText: output };
};

const normalizeCompletion = (content, relayMode = false) => {
  let value;
  try {
    value = parseProviderJSON(content);
  } catch (error) {
    throw classifyFailure(error, "completion", "invalid_completion_json");
  }
  if (!isObject(value)) throw failure("Agent completion must be one JSON object", "completion", "invalid_completion");

  const hasData = Object.prototype.hasOwnProperty.call(value, "data");
  let data = hasData && value.data !== undefined ? structuredClone(value.data) : null;
  let output = typeof value.output === "string" ? value.output.trim() : "";
  if (!output && !(relayMode && hasData && data != null)) {
    throw failure("Agent completion must include output", "completion", "invalid_completion");
  }
  if (!output) output = "Completed.";

  if (relayMode && output.length > MAX_RELAY_OUTPUT_CHARS) {
    data = preserveVerboseRelayOutput(data, output);
    output = `${output.slice(0, MAX_RELAY_OUTPUT_CHARS - 1)}…`;
  }

  return {
    output,
    data,
    artifacts: value.artifacts == null ? [] : normalizeArtifacts(value.artifacts),
  };
};

const toolFailureDetails = error => ({
  message: error instanceof Error ? error.message : String(error),
  code: typeof error?.code === "string" && error.code ? error.code : "tool_execution_failed",
  retryable: error?.retryable === true,
  ...(typeof error?.hint === "string" && error.hint.trim() ? { hint: error.hint.trim() } : {}),
});

const stableValue = value => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
};
const callKey = call => `${call.name}|${JSON.stringify(stableValue(call.input ?? {}))}`;
const failureFingerprint = (call, details) => [
  callKey(call),
  details.code,
  details.message.replace(/\d+/g, "#").slice(0, 240),
].join("|");
const canRetryToolError = (call, error) => (
  call.name === "http"
  && ["GET", "OPTIONS"].includes(String(call.input?.method || "GET").toUpperCase())
  && error?.retryable === true
  && error?.code === "http_timeout"
);
const cacheableToolCall = call => (
  CACHEABLE_TOOLS.has(call.name)
  || (call.name === "http" && ["GET", "OPTIONS"].includes(String(call.input?.method || "GET").toUpperCase()))
);
const unsuccessfulToolResult = result => isObject(result) && result.ok === false;
const unsuccessfulToolDetails = (call, result) => ({
  message: Number.isInteger(result.status)
    ? `${call.name} returned HTTP/status ${result.status}${result.statusText ? ` ${result.statusText}` : ""}`
    : `${call.name} returned an unsuccessful result`,
  code: Number.isInteger(result.status) ? `${call.name}_status_${result.status}` : `${call.name}_unsuccessful_result`,
  retryable: false,
  hint: "Inspect the returned status/body and change the endpoint, command, arguments, or strategy before retrying.",
});

const evidencePriority = name => {
  if (name === "http-content" || name === "read-file") return 4;
  if (name === "document-parser" || name === "unlimited-ocr") return 3;
  if (name === "http") return 2;
  return 1;
};
const completionEvidence = messages => {
  const candidates = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message?.role === "tool" && typeof message.content === "string")
    .map(({ message, index }) => {
      const content = cappedText(message.content, MAX_COMPLETION_TOOL_CHARS);
      let result = content;
      try { result = JSON.parse(content); } catch { /* Keep compact text. */ }
      return {
        index,
        priority: evidencePriority(message.name),
        record: { tool: message.name || "tool", result },
      };
    });

  const selected = [];
  let chars = 0;
  for (const candidate of candidates.sort((left, right) => right.priority - left.priority || right.index - left.index)) {
    const size = JSON.stringify(candidate.record).length;
    if (chars + size > MAX_COMPLETION_EVIDENCE_CHARS) continue;
    selected.push(candidate);
    chars += size;
  }
  return selected.sort((left, right) => left.index - right.index).map(item => item.record);
};
const completionGrounding = (messages, evidence) => {
  const grounding = [];
  for (const message of messages) {
    if (message?.role === "assistant" || message?.role === "tool") break;
    if (["system", "user"].includes(message?.role)) grounding.push(structuredClone(message));
  }
  if (evidence.length) {
    grounding.push({
      role: "system",
      content: [
        "Compacted Tool evidence collected during this Task follows. Use it as authoritative working evidence.",
        "Do not re-run research merely because the original Tool transcript was compacted.",
        JSON.stringify(evidence),
      ].join("\n\n"),
    });
  }
  return grounding;
};
const fallbackRelayCompletion = evidence => ({
  output: "Research evidence collected; model finalization was unavailable. Preserve this evidence for downstream synthesis.",
  data: {
    _carlosOfficeRecovery: "completion-evidence-fallback",
    incompleteSynthesis: true,
    evidence: structuredClone(evidence),
  },
  artifacts: [],
});

export class Agent {
  constructor({
    provider,
    model,
    tools = [],
    skills = [],
    invokeTool,
    maxNoProgressTurns = 3,
    maxReasoningTurns = MAX_REASONING_TURNS,
    maxToolCalls = MAX_TOOL_CALLS,
  }) {
    if (typeof provider?.generate !== "function") throw new Error("Agent requires a model provider");
    if (!model || typeof model !== "string") throw new Error("Agent requires a model");
    if (typeof invokeTool !== "function") throw new Error("Agent requires a Tool invoker");
    if (!Number.isSafeInteger(maxNoProgressTurns) || maxNoProgressTurns < 1) {
      throw new Error("Agent maxNoProgressTurns must be a positive integer");
    }
    if (!Number.isSafeInteger(maxReasoningTurns) || maxReasoningTurns < 1) {
      throw new Error("Agent maxReasoningTurns must be a positive integer");
    }
    if (!Number.isSafeInteger(maxToolCalls) || maxToolCalls < 1) {
      throw new Error("Agent maxToolCalls must be a positive integer");
    }

    this.provider = provider;
    this.model = model;
    this.tools = structuredClone(tools);
    this.skills = structuredClone(skills);
    this.invokeTool = invokeTool;
    this.maxNoProgressTurns = maxNoProgressTurns;
    this.maxReasoningTurns = maxReasoningTurns;
    this.maxToolCalls = maxToolCalls;
    this.usage = {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputCharacters: 0,
      outputCharacters: 0,
      totalDuration: 0,
    };
  }

  getUsage() {
    return structuredClone(this.usage);
  }

  recordUsage(response, inputCharacters) {
    this.usage.modelCalls += 1;
    this.usage.inputCharacters += inputCharacters;
    this.usage.outputCharacters += String(response?.content ?? "").length;
    const usage = isObject(response?.usage) ? response.usage : {};
    const inputTokens = Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
    const outputTokens = Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
    this.usage.inputTokens += inputTokens;
    this.usage.outputTokens += outputTokens;
    this.usage.totalTokens += Number.isFinite(usage.totalTokens) ? usage.totalTokens : inputTokens + outputTokens;
    if (Number.isFinite(usage.totalDuration)) this.usage.totalDuration += usage.totalDuration;
  }

  withUsage(completion, relayMode) {
    let dataCharacters = 0;
    try { dataCharacters = JSON.stringify(completion.data)?.length ?? 0; } catch { dataCharacters = 0; }
    return {
      ...completion,
      usage: {
        ...this.getUsage(),
        relayMode: Boolean(relayMode),
        completionOutputCharacters: completion.output.length,
        completionDataCharacters: dataCharacters,
      },
    };
  }

  buildMessages(task) {
    const messages = [];

    if (task.knowledge?.instructions?.trim()) {
      messages.push({
        role: "system",
        content: [
          "Standing instructions from Carlos. Apply them to this Task unless its explicit requirements supersede them:",
          task.knowledge.instructions,
        ].join("\n\n"),
      });
    }

    if (task.knowledge?.facts?.trim()) {
      messages.push({
        role: "system",
        content: [
          "Durable facts supplied by Carlos. Use them as persistent context when relevant. Do not invent missing facts:",
          task.knowledge.facts,
        ].join("\n\n"),
      });
    }

    if (this.skills.length) {
      messages.push({
        role: "system",
        content: [
          "Use these Skills as operating guidance for this Task:",
          ...this.skills.map(skill => `\n# Skill: ${skill.name}\n${skill.content}`),
        ].join("\n"),
      });
    }

    const taskInstructions = [
      "You are one temporary specialist Agent process inside Carlos Office.",
      "You exist only for this Task and have no persistent identity or defaults.",
      `Workflow: ${task.workflowId}`,
      `Task: ${task.id}`,
      `Execution workspace: ${task.workspaceDir ?? "managed by Carlos Office"}`,
      "Relative filesystem paths and the default working directory resolve inside this private invocation workspace.",
      "Use relative paths for generated files, scratch files, downloaded working copies, and intermediate outputs.",
      "Do not use the Carlos Office Back directory as scratch storage. Use an absolute path only when the Task explicitly requires reading or modifying an existing external file/project at that exact location.",
      `Objective:\n${task.objective ?? ""}`,
      `Completion criteria:\n${task.completion ?? ""}`,
      `Resolved input (compact JSON):\n${JSON.stringify(task.input ?? {})}`,
      "Tool schemas are authoritative. Send only declared properties and satisfy required fields and declared types exactly.",
      "Prefer narrow reads/searches and stored-content handles over loading large files or HTTP bodies into model context.",
      "For web research, use search pages only for discovery. Once an authoritative primary source is found, work from it instead of repeating broad searches.",
      "Do not fetch the same URL or repeat the same read-only Tool call twice. Reuse prior evidence and converge on the Task result.",
      "When HTTP returns a content handle, use http-content search/read instead of downloading the same resource again.",
    ];

    if (task.relayMode) {
      taskInstructions.push(
        "RELAY MODE: another Task consumes this result. Optimize for lossless machine handoff, not human-readable exposition.",
        "Target at least 60% fewer handoff tokens than normal explanatory prose while preserving every downstream-relevant fact.",
        "Use caveman-style telegraphic fragments: facts, values, evidence, constraints. No greeting, intro, transitions, conclusion, narration, or restatement of the Task/input.",
        "State each fact once. Put substantive handoff content in data as compact structured JSON; keep output to one short status/result sentence under 600 characters.",
        "Preserve exact numbers, dates, IDs, paths, URLs, citations, error codes, uncertainty, contrary evidence, requirements, and exact payloads needed downstream.",
        "Do not shorten away meaning. Reference large source material by stable path/content handle/range instead of reproducing it when the downstream Task can retrieve it.",
        "Prefer concise, obvious field names and arrays/objects over prose paragraphs. Do not use cryptic abbreviations that make the data ambiguous.",
      );
    }

    taskInstructions.push(
      "When the Task is complete, return one JSON object with this exact shape:",
      '{"output":"Task result","data":null,"artifacts":[]}',
      "data may be any JSON value, including an array, object, scalar, or null. Use it for all information another Task may need.",
      "The artifacts array is ONLY for files intended as deliverables to Carlos.",
      "For deliverables generated in your workspace, use the path returned by the filesystem Tool or a workspace-relative path.",
      "Do not declare ordinary source files, configuration files, or project files merely because you edited them.",
      "If there are no deliverable files, return an empty artifacts array.",
      "When a Tool fails or returns ok=false, inspect the structured result and change strategy instead of repeating it unchanged.",
    );

    messages.push({ role: "system", content: taskInstructions.join("\n\n") });
    messages.push({
      role: "user",
      content: "Perform this Task. Use available Tools when needed. Return the completed Task output using the required JSON completion object.",
    });
    return messages;
  }

  async generate(messages, tools = [], format = null) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
      try {
        const compacted = compactMessages(messages);
        const response = await this.provider.generate({ model: this.model, messages: compacted, tools, format });
        this.recordUsage(response, messageCharacters(compacted));
        return response;
      } catch (error) {
        lastError = error;
        if (error?.retryable !== true || attempt >= MAX_PROVIDER_ATTEMPTS) break;
        await sleep(RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]);
      }
    }
    throw classifyFailure(lastError, "model", "provider_error");
  }

  async repairCompletion(messages, content, relayMode = false, reason = "The final Task completion was invalid or empty.") {
    const schema = relayMode ? RELAY_COMPLETION_SCHEMA : COMPLETION_SCHEMA;
    const evidence = completionEvidence(messages);
    const repairMessages = [
      ...completionGrounding(messages, evidence),
      ...(typeof content === "string" && content.trim()
        ? [{ role: "assistant", content: cappedText(content, MAX_COMPLETION_TOOL_CHARS) }]
        : []),
      {
        role: "system",
        content: [
          reason,
          "Synthesize from the compacted evidence already provided. Do not perform more research.",
          "Return only one valid completion object with output, data, and artifacts.",
          "Do not call Tools. Do not add prose or Markdown outside the JSON object.",
          ...(relayMode ? [
            `This is RELAY MODE: output should stay under ${MAX_RELAY_OUTPUT_CHARS} characters and substantive handoff content belongs in compact data.`,
            "Preserve all downstream-relevant facts while removing explanatory prose and repetition.",
          ] : []),
          `Required JSON schema: ${JSON.stringify(schema)}`,
        ].join("\n"),
      },
    ];
    let lastError = failure("Agent completion repair returned no usable output", "completion", "invalid_completion_repair");

    for (const format of [schema, "json", null]) {
      const response = await this.generate(repairMessages, [], format);
      const candidate = typeof response?.content === "string" ? response.content : "";
      if (!candidate.trim()) {
        lastError = failure("Agent completion repair returned no usable output", "completion", "invalid_completion_repair");
        continue;
      }

      try {
        return normalizeCompletion(candidate, relayMode);
      } catch (error) {
        lastError = classifyFailure(error, "completion", "invalid_completion_repair");
        repairMessages.push(
          { role: "assistant", content: cappedText(candidate, MAX_COMPLETION_TOOL_CHARS) },
          {
            role: "system",
            content: "That repair was still invalid. Correct only the JSON envelope; preserve the evidence and return one complete object.",
          },
        );
      }
    }

    if (typeof content === "string" && content.trim()) {
      const text = content.trim();
      return relayMode
        ? normalizeCompletion(JSON.stringify({ output: text, data: null, artifacts: [] }), true)
        : { output: text, data: null, artifacts: [] };
    }
    if (relayMode && evidence.length) return fallbackRelayCompletion(evidence);
    throw lastError;
  }

  async run(task) {
    if (!isObject(task) || !task.id || !task.workflowId) {
      throw failure("Agent received an invalid Task", "setup", "invalid_task");
    }
    validateRequiredInputs(task);

    const messages = this.buildMessages(task);
    const modelTools = describeTools(this.tools);
    const failedCalls = new Map();
    const successfulCalls = new Map();
    const researchMode = this.tools.some(tool => ["http", "http-content", "document-parser", "unlimited-ocr"].includes(tool.name));
    const convergenceAt = Math.min(
      RESEARCH_CONVERGENCE_TOOL_CALLS,
      Math.max(16, Math.floor(this.maxToolCalls * 0.6)),
    );
    let convergencePrompted = false;
    let noProgressTurns = 0;
    let reasoningTurns = 0;
    let toolExecutions = 0;

    while (true) {
      reasoningTurns += 1;
      if (reasoningTurns > this.maxReasoningTurns) {
        const evidence = completionEvidence(messages);
        if (evidence.length) {
          const completion = await this.repairCompletion(
            messages,
            "",
            Boolean(task.relayMode),
            `The reasoning budget of ${this.maxReasoningTurns} turns is exhausted. Finalize now from existing evidence.`,
          );
          return this.withUsage(completion, task.relayMode);
        }
        throw failure(`Task exceeded ${this.maxReasoningTurns} reasoning turns`, "model", "reasoning_turn_limit");
      }

      const response = await this.generate(messages, modelTools);
      if (!isObject(response)) throw failure("Model provider returned an invalid response", "model", "invalid_provider_response");

      const content = typeof response.content === "string" ? response.content : "";
      const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];

      if (!toolCalls.length) {
        if (content.trim()) {
          try {
            return this.withUsage(normalizeCompletion(content, Boolean(task.relayMode)), task.relayMode);
          } catch {
            // Repair below with Tools disabled and a compact evidence transcript.
          }
        }
        const completion = await this.repairCompletion(messages, content, Boolean(task.relayMode));
        return this.withUsage(completion, task.relayMode);
      }

      messages.push({ role: "assistant", content, toolCalls: structuredClone(toolCalls) });
      let successfulTools = 0;
      let reusedTools = 0;
      let failedTools = 0;
      const failureFingerprints = [];

      for (const call of toolCalls) {
        if (!call || typeof call.name !== "string" || !call.name) {
          throw failure("Model returned an invalid Tool call", "tool", "invalid_tool_call");
        }

        const key = callKey(call);
        const priorFailure = failedCalls.get(key);
        const recentFailure = priorFailure && reasoningTurns - priorFailure.turn <= FAILED_CALL_MEMORY_TURNS;
        let error = recentFailure && !priorFailure.retryable
          ? Object.assign(new Error(`This exact Tool call already failed: ${priorFailure.message}`), {
            code: "repeated_failed_tool_call",
            retryable: false,
            hint: "Do not repeat this call unchanged. Choose another Tool, path, endpoint, or argument set.",
          })
          : null;

        if (!error && call.input != null && !isObject(call.input)) {
          error = Object.assign(new Error(`Tool ${call.name} input must be one JSON object`), {
            code: "invalid_tool_input",
            retryable: false,
            hint: "Regenerate the Tool call using the Tool's declared object input schema.",
          });
        } else if (!error && !this.tools.some(tool => tool.name === call.name)) {
          error = Object.assign(new Error(`Agent requested unavailable Tool: ${call.name}`), {
            code: "unavailable_tool",
            retryable: false,
            hint: "Choose one of the Tools exposed for this Task.",
          });
        }

        let result;
        let reused = false;
        if (!error && cacheableToolCall(call) && successfulCalls.has(key)) {
          result = structuredClone(successfulCalls.get(key));
          reused = true;
        } else if (!error) {
          for (let attempt = 1; attempt <= MAX_SAFE_TOOL_ATTEMPTS; attempt += 1) {
            toolExecutions += 1;
            if (toolExecutions > this.maxToolCalls) {
              throw failure(`Task exceeded ${this.maxToolCalls} Tool executions`, "tool", "tool_call_limit");
            }
            try {
              result = await this.invokeTool({
                id: call.id ?? null,
                name: call.name,
                input: structuredClone(call.input ?? {}),
              });
              error = null;
              break;
            } catch (caught) {
              if (caught?.blocked) throw caught;
              error = caught;
              if (!canRetryToolError(call, caught) || attempt >= MAX_SAFE_TOOL_ATTEMPTS) break;
              await sleep(RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]);
            }
          }
        }

        if (!error) {
          messages.push({
            role: "tool",
            toolCallId: call.id ?? null,
            name: call.name,
            content: reused
              ? `Cached exact read-only result; no new request was executed.\n${resultToText(result, call.name)}`
              : resultToText(result, call.name),
          });

          if (!unsuccessfulToolResult(result)) {
            failedCalls.delete(key);
            if (cacheableToolCall(call) && !reused) successfulCalls.set(key, structuredClone(result));
            if (reused) reusedTools += 1;
            else successfulTools += 1;
            continue;
          }

          failedTools += 1;
          const details = unsuccessfulToolDetails(call, result);
          failedCalls.set(key, { ...details, turn: reasoningTurns });
          failureFingerprints.push(failureFingerprint(call, details));
          continue;
        }

        failedTools += 1;
        const details = toolFailureDetails(error);
        failedCalls.set(key, { ...details, turn: reasoningTurns });
        failureFingerprints.push(failureFingerprint(call, details));
        messages.push({
          role: "tool",
          toolCallId: call.id ?? null,
          name: call.name,
          content: `Tool failed:\n${JSON.stringify(details)}`,
        });
      }

      if (researchMode && !convergencePrompted && toolExecutions >= convergenceAt) {
        convergencePrompted = true;
        messages.push({
          role: "system",
          content: [
            `Research has used ${toolExecutions} Tool executions and already has substantial evidence.`,
            "Converge now unless one explicit completion criterion remains materially unverified.",
            "Do not broaden the search, switch search engines, or re-fetch authoritative sources already acquired.",
            "Prefer final synthesis from stored/searchable evidence over additional discovery.",
          ].join(" "),
        });
      }

      if (successfulTools > 0) {
        noProgressTurns = 0;
        continue;
      }

      if (reusedTools > 0 && failedTools === 0) {
        noProgressTurns += 1;
        if (noProgressTurns >= this.maxNoProgressTurns) {
          const completion = await this.repairCompletion(
            messages,
            "",
            Boolean(task.relayMode),
            "The Agent is repeating already-completed read-only calls. Stop Tool use and finalize from existing evidence.",
          );
          return this.withUsage(completion, task.relayMode);
        }
        messages.push({
          role: "system",
          content: [
            `The previous turn repeated ${reusedTools} read-only Tool call${reusedTools === 1 ? "" : "s"} and produced no new evidence.`,
            `No-progress turn ${noProgressTurns} of ${this.maxNoProgressTurns}.`,
            "Do not request the same resources again. Synthesize now or make one materially different call that closes a named evidence gap.",
          ].join(" "),
        });
        continue;
      }

      if (failedTools > 0) {
        noProgressTurns += 1;
        const uniqueFailures = [...new Set(failureFingerprints)];
        if (noProgressTurns >= this.maxNoProgressTurns) {
          const evidence = completionEvidence(messages);
          if (evidence.length) {
            const completion = await this.repairCompletion(
              messages,
              "",
              Boolean(task.relayMode),
              "Recent Tool strategies stopped making progress. Finalize from the useful evidence already collected.",
            );
            return this.withUsage(completion, task.relayMode);
          }
          throw failure(
            `Task made no Tool progress for ${this.maxNoProgressTurns} consecutive reasoning turns`,
            "tool",
            "tool_progress_stalled",
          );
        }

        messages.push({
          role: "system",
          content: [
            `The previous Tool turn made no progress: all ${failedTools} Tool call${failedTools === 1 ? "" : "s"} failed or returned an unsuccessful result.`,
            `No-progress turn ${noProgressTurns} of ${this.maxNoProgressTurns}.`,
            `Distinct failures: ${uniqueFailures.length}.`,
            "Use the error codes/statuses and returned bodies to change the Tool, arguments, endpoint, file path, or strategy.",
            "An unchanged deterministic failure is temporarily rejected without executing it again.",
          ].join(" "),
        });
      }
    }
  }
}
