import { parseProviderJSON } from "../lib.mjs";

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

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

const normalizeArtifacts = value => {
  if (!Array.isArray(value)) return [];
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
  } catch {
    return { output: String(content || "").trim(), data: null, artifacts: [] };
  }

  if (!isObject(value) || typeof value.output !== "string" || !value.output.trim()) {
    throw failure("Agent completion must include output", "completion", "invalid_completion");
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
  retryable: typeof error?.retryable === "boolean" ? error.retryable : true,
  ...(typeof error?.hint === "string" && error.hint.trim() ? { hint: error.hint.trim() } : {}),
});

const failureFingerprint = (toolName, details) => [
  toolName,
  details.code,
  details.message.replace(/\d+/g, "#").slice(0, 240),
].join("|");

export class Agent {
  constructor({ provider, model, tools = [], skills = [], invokeTool, maxNoProgressTurns = 3 }) {
    if (typeof provider?.generate !== "function") throw new Error("Agent requires a model provider");
    if (!model || typeof model !== "string") throw new Error("Agent requires a model");
    if (typeof invokeTool !== "function") throw new Error("Agent requires a Tool invoker");
    if (!Number.isSafeInteger(maxNoProgressTurns) || maxNoProgressTurns < 1) {
      throw new Error("Agent maxNoProgressTurns must be a positive integer");
    }

    this.provider = provider;
    this.model = model;
    this.tools = structuredClone(tools);
    this.skills = structuredClone(skills);
    this.invokeTool = invokeTool;
    this.maxNoProgressTurns = maxNoProgressTurns;
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
        "Relative filesystem paths and the default PowerShell working directory resolve inside this private invocation workspace.",
        "Use relative paths for generated files, scratch files, downloaded working copies, and intermediate outputs.",
        "Do not use the Carlos Office Back directory as scratch storage. Use an absolute path only when the Task explicitly requires reading or modifying an existing external file/project at that exact location.",
        `Objective:\n${task.objective ?? ""}`,
        `Completion criteria:\n${task.completion ?? ""}`,
        `Resolved input:\n${JSON.stringify(task.input ?? {}, null, 2)}`,
        "When the Task is complete, return one JSON object with this exact shape:",
        '{"output":"human-readable Task result","data":{"optional":"machine-readable JSON value"},"artifacts":[{"path":"absolute-or-workspace-relative-file-path","name":"optional-display-name","type":"optional-MIME-type"}]}',
        "data may be any JSON value, including an array, object, scalar, or null. Use it when downstream Tasks would benefit from structured values.",
        "The artifacts array is ONLY for files intended as deliverables to Carlos.",
        "For deliverables generated in your workspace, use the path returned by the filesystem Tool or a workspace-relative path.",
        "Do not declare ordinary source files, configuration files, or project files merely because you edited them.",
        "If there are no deliverable files, return an empty artifacts array.",
        "When a Tool fails, inspect its structured error and change strategy when appropriate. Do not blindly repeat the same failing Tool call.",
      ].join("\n\n"),
    });
    messages.push({
      role: "user",
      content: "Perform this Task. Use available Tools when needed. Return the completed Task output using the required JSON completion object.",
    });

    return messages;
  }

  async run(task) {
    if (!isObject(task) || !task.id || !task.workflowId) {
      throw failure("Agent received an invalid Task", "setup", "invalid_task");
    }

    const messages = this.buildMessages(task);
    const modelTools = describeTools(this.tools);
    let noProgressTurns = 0;
    let previousFailureSignature = "";

    while (true) {
      let response;
      try {
        response = await this.provider.generate({
          model: this.model,
          messages,
          tools: modelTools,
        });
      } catch (error) {
        throw classifyFailure(error, "model", "provider_error");
      }

      if (!isObject(response)) {
        throw failure("Model provider returned an invalid response", "model", "invalid_provider_response");
      }

      const content = typeof response.content === "string" ? response.content : "";
      const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];

      if (!toolCalls.length) {
        if (!content.trim()) {
          throw failure("Agent model returned no usable Task output", "model", "empty_model_output");
        }
        try {
          return normalizeCompletion(content);
        } catch (error) {
          throw classifyFailure(error, "completion", "invalid_completion");
        }
      }

      messages.push({ role: "assistant", content, toolCalls: structuredClone(toolCalls) });

      let successfulTools = 0;
      let failedTools = 0;
      const failureFingerprints = [];

      for (const call of toolCalls) {
        if (!call || typeof call.name !== "string") {
          throw failure("Model returned an invalid Tool call", "tool", "invalid_tool_call");
        }
        if (call.input != null && !isObject(call.input)) {
          throw failure(`Model returned invalid input for Tool: ${call.name}`, "tool", "invalid_tool_input");
        }
        if (!this.tools.some(tool => tool.name === call.name)) {
          throw failure(`Agent requested unavailable Tool: ${call.name}`, "tool", "unavailable_tool");
        }

        try {
          const result = await this.invokeTool({
            id: call.id ?? null,
            name: call.name,
            input: structuredClone(call.input ?? {}),
          });
          successfulTools += 1;
          messages.push({
            role: "tool",
            toolCallId: call.id ?? null,
            name: call.name,
            content: resultToText(result),
          });
        } catch (error) {
          if (error?.blocked) throw error;

          failedTools += 1;
          const details = toolFailureDetails(error);
          failureFingerprints.push(failureFingerprint(call.name, details));
          messages.push({
            role: "tool",
            toolCallId: call.id ?? null,
            name: call.name,
            content: `Tool failed:\n${JSON.stringify(details, null, 2)}`,
          });
        }
      }

      if (successfulTools > 0) {
        noProgressTurns = 0;
        previousFailureSignature = "";
        continue;
      }

      if (failedTools > 0) {
        noProgressTurns += 1;
        const failureSignature = [...new Set(failureFingerprints)].sort().join("\n");
        const repeatedStrategy = Boolean(failureSignature && failureSignature === previousFailureSignature);
        previousFailureSignature = failureSignature;

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
            repeatedStrategy
              ? "This failure pattern repeated. Change strategy now; do not repeat the same calls or parameters."
              : "Inspect the Tool error codes and hints, then adjust parameters, choose another endpoint/resource, or use another available Tool.",
          ].join(" "),
        });
      }
    }
  }
}
