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

export class Agent {
  constructor({ provider, model, tools = [], skills = [], invokeTool, maxToolFailures = 12 }) {
    if (typeof provider?.generate !== "function") throw new Error("Agent requires a model provider");
    if (!model || typeof model !== "string") throw new Error("Agent requires a model");
    if (typeof invokeTool !== "function") throw new Error("Agent requires a Tool invoker");

    this.provider = provider;
    this.model = model;
    this.tools = structuredClone(tools);
    this.skills = structuredClone(skills);
    this.invokeTool = invokeTool;
    this.maxToolFailures = maxToolFailures;
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
        `Objective:\n${task.objective ?? ""}`,
        `Completion criteria:\n${task.completion ?? ""}`,
        `Resolved input:\n${JSON.stringify(task.input ?? {}, null, 2)}`,
      ].join("\n\n"),
    });
    messages.push({
      role: "user",
      content: "Perform this Task. Use available Tools when needed. Return the completed Task output when finished.",
    });

    return messages;
  }

  async run(task) {
    if (!isObject(task) || !task.id || !task.workflowId) throw new Error("Agent received an invalid Task");

    const messages = this.buildMessages(task);
    const modelTools = describeTools(this.tools);
    let toolFailures = 0;

    while (true) {
      const response = await this.provider.generate({
        model: this.model,
        messages,
        tools: modelTools,
      });
      if (!isObject(response)) throw new Error("Model provider returned an invalid response");

      const content = typeof response.content === "string" ? response.content : "";
      const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];

      if (!toolCalls.length) {
        if (!content.trim()) throw new Error("Agent model returned no usable Task output");
        return content;
      }

      messages.push({ role: "assistant", content, toolCalls: structuredClone(toolCalls) });

      for (const call of toolCalls) {
        if (!call || typeof call.name !== "string") throw new Error("Model returned an invalid Tool call");
        if (call.input != null && !isObject(call.input)) {
          throw new Error(`Model returned invalid input for Tool: ${call.name}`);
        }
        if (!this.tools.some(tool => tool.name === call.name)) {
          throw new Error(`Agent requested unavailable Tool: ${call.name}`);
        }

        try {
          const result = await this.invokeTool({
            id: call.id ?? null,
            name: call.name,
            input: structuredClone(call.input ?? {}),
          });
          messages.push({
            role: "tool",
            toolCallId: call.id ?? null,
            name: call.name,
            content: resultToText(result),
          });
        } catch (error) {
          if (error?.blocked) throw error;

          toolFailures += 1;
          if (toolFailures >= this.maxToolFailures) {
            throw new Error(`Task exceeded the ${this.maxToolFailures} Tool failure limit`);
          }

          messages.push({
            role: "tool",
            toolCallId: call.id ?? null,
            name: call.name,
            content: `Tool failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }
  }
}