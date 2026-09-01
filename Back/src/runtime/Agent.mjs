import { parseProviderJSON } from "../lib.mjs";

const MAX_REASONING_TURNS = 16;
const MAX_TOOL_CALLS = 24;
const MAX_PROVIDER_ATTEMPTS = 3;
const MAX_SAFE_TOOL_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [300, 900];
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

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const resultToText = result => {
  if (typeof result === "string") return result;
  if (Buffer.isBuffer(result)) return result.toString("utf8");
  if (result === undefined) return "";
  return JSON.stringify(result, null, 2);
};

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

const normalizeCompletion = content => {
  let value;
  try {
    value = parseProviderJSON(content);
  } catch (error) {
    throw classifyFailure(error, "completion", "invalid_completion_json");
  }
  if (!isObject(value) || typeof value.output !== "string" || !value.output.trim()) {
    throw failure("Agent completion must include output", "completion", "invalid_completion");
  }
  if (!Object.prototype.hasOwnProperty.call(value, "data")) {
    throw failure("Agent completion must include data", "completion", "invalid_completion");
  }
  if (!Object.prototype.hasOwnProperty.call(value, "artifacts")) {
    throw failure("Agent completion must include artifacts", "completion", "invalid_completion");
  }
  return {
    output: value.output.trim(),
    data: value.data === undefined ? null : structuredClone(value.data),
    artifacts: normalizeArtifacts(value.artifacts),
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

    messages.push({
      role: "system",
      content: [
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
        `Resolved input:\n${JSON.stringify(task.input ?? {}, null, 2)}`,
        "Tool schemas are authoritative. Send only declared properties and satisfy required fields and declared types exactly.",
        "When the Task is complete, return one JSON object with this exact shape:",
        '{"output":"human-readable Task result","data":null,"artifacts":[]}',
        "data may be any JSON value, including an array, object, scalar, or null. Use it when downstream Tasks would benefit from structured values.",
        "The artifacts array is ONLY for files intended as deliverables to Carlos.",
        "For deliverables generated in your workspace, use the path returned by the filesystem Tool or a workspace-relative path.",
        "Do not declare ordinary source files, configuration files, or project files merely because you edited them.",
        "If there are no deliverable files, return an empty artifacts array.",
        "When a Tool fails, inspect its structured error and change strategy. An unchanged deterministic failure is rejected without execution, so use that feedback to choose another Tool, path, endpoint, or argument set.",
      ].join("\n\n"),
    });
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
        return await this.provider.generate({ model: this.model, messages, tools, format });
      } catch (error) {
        lastError = error;
        if (error?.retryable !== true || attempt >= MAX_PROVIDER_ATTEMPTS) break;
        await sleep(RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]);
      }
    }
    throw classifyFailure(lastError, "model", "provider_error");
  }

  async repairCompletion(messages, content) {
    const repairMessages = [
      ...messages,
      { role: "assistant", content },
      {
        role: "system",
        content: [
          "Your final Task completion was invalid.",
          "Return only one valid completion object with output, data, and artifacts.",
          "Do not call Tools. Do not add prose or Markdown outside the JSON object.",
        ].join(" "),
      },
    ];
    const response = await this.generate(repairMessages, [], COMPLETION_SCHEMA);
    if (!isObject(response) || typeof response.content !== "string" || !response.content.trim()) {
      throw failure("Agent completion repair returned no usable output", "completion", "invalid_completion_repair");
    }
    return normalizeCompletion(response.content);
  }

  async run(task) {
    if (!isObject(task) || !task.id || !task.workflowId) {
      throw failure("Agent received an invalid Task", "setup", "invalid_task");
    }
    validateRequiredInputs(task);

    const messages = this.buildMessages(task);
    const modelTools = describeTools(this.tools);
    const failedCalls = new Map();
    let noProgressTurns = 0;
    let reasoningTurns = 0;
    let toolExecutions = 0;

    while (true) {
      reasoningTurns += 1;
      if (reasoningTurns > this.maxReasoningTurns) {
        throw failure(`Task exceeded ${this.maxReasoningTurns} reasoning turns`, "model", "reasoning_turn_limit");
      }

      const response = await this.generate(messages, modelTools);
      if (!isObject(response)) throw failure("Model provider returned an invalid response", "model", "invalid_provider_response");

      const content = typeof response.content === "string" ? response.content : "";
      const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];

      if (!toolCalls.length) {
        if (!content.trim()) throw failure("Agent model returned no usable Task output", "model", "empty_model_output");
        try {
          return normalizeCompletion(content);
        } catch {
          return this.repairCompletion(messages, content);
        }
      }

      messages.push({ role: "assistant", content, toolCalls: structuredClone(toolCalls) });
      let successfulTools = 0;
      let failedTools = 0;
      const failureFingerprints = [];

      for (const call of toolCalls) {
        if (!call || typeof call.name !== "string" || !call.name) {
          throw failure("Model returned an invalid Tool call", "tool", "invalid_tool_call");
        }

        const key = callKey(call);
        const priorFailure = failedCalls.get(key);
        let error = priorFailure && !priorFailure.retryable
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
        if (!error) {
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
          successfulTools += 1;
          failedCalls.delete(key);
          messages.push({
            role: "tool",
            toolCallId: call.id ?? null,
            name: call.name,
            content: resultToText(result),
          });
          continue;
        }

        failedTools += 1;
        const details = toolFailureDetails(error);
        failedCalls.set(key, details);
        failureFingerprints.push(failureFingerprint(call, details));
        messages.push({
          role: "tool",
          toolCallId: call.id ?? null,
          name: call.name,
          content: `Tool failed:\n${JSON.stringify(details, null, 2)}`,
        });
      }

      if (successfulTools > 0) {
        failedCalls.clear();
        noProgressTurns = 0;
        continue;
      }

      if (failedTools > 0) {
        noProgressTurns += 1;
        const uniqueFailures = [...new Set(failureFingerprints)];
        if (noProgressTurns >= this.maxNoProgressTurns) {
          throw failure(
            `Task made no Tool progress for ${this.maxNoProgressTurns} consecutive reasoning turns`,
            "tool",
            "tool_progress_stalled",
          );
        }

        messages.push({
          role: "system",
          content: [
            `The previous Tool turn made no progress: all ${failedTools} Tool call${failedTools === 1 ? "" : "s"} failed.`,
            `No-progress turn ${noProgressTurns} of ${this.maxNoProgressTurns}.`,
            `Distinct failures: ${uniqueFailures.length}.`,
            "Use the error codes and hints to change the Tool, arguments, endpoint, file path, or strategy.",
            "An unchanged deterministic failure will be rejected without executing it again; treat that rejection as feedback rather than a reason to stop.",
          ].join(" "),
        });
      }
    }
  }
}
