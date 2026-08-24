export const NORA_ACTIONS = Object.freeze([
  "respond",
  "clarify",
  "process",
  "adhoc",
  "create_process",
  "create_schedule",
  "tool",
  "skill",
  "plan",
]);

export const NORA_DECISION_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    action: { type: "string", enum: [...NORA_ACTIONS] },
    response: { type: "string" },
    name: { type: "string" },
    source: { type: "string" },
    content: { type: "string" },
    process: { type: "object" },
    workflow: { type: "object" },
    schedule: { type: "object" },
    steps: { type: "array" },
  },
  required: ["action"],
});

const actionSet = new Set(NORA_ACTIONS);
const executionFields = ["process", "workflow", "steps", "schedule", "source", "content"];
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

export const normalizeNoraDecision = value => {
  if (!isObject(value)) return value;

  const hasResponse = Object.hasOwn(value, "response");
  const rawAction = value.action;
  const normalizedAction = typeof rawAction === "string" ? rawAction.trim().toLowerCase() : "";
  const decisionLike = hasResponse || actionSet.has(normalizedAction);

  if (!decisionLike) return value;
  if (hasResponse && value.response != null && typeof value.response !== "string") {
    throw new Error("Nora decision response must be a string when present");
  }
  if (rawAction != null && typeof rawAction !== "string") {
    throw new Error("Nora decision action must be a string when present");
  }

  let action = normalizedAction;
  if (!action && typeof value.response === "string" && value.response.trim()) {
    const hasExecutionPayload = executionFields.some(field => value[field] != null);
    if (!hasExecutionPayload) action = "respond";
  }

  if (!action) throw new Error("Nora decision must include an action");
  if (!actionSet.has(action)) {
    throw new Error(`Unknown Nora action: ${action}. Allowed actions: ${NORA_ACTIONS.join(", ")}`);
  }

  return { ...value, action };
};
