export const TASK_EXECUTION_LIMITS = Object.freeze({
  maxReasoningTurns: { min: 1, max: 64 },
  maxToolCalls: { min: 1, max: 128 },
  maxNoProgressTurns: { min: 1, max: 8 },
  maxAttempts: { min: 1, max: 4 },
});

const executionProperties = Object.fromEntries(
  Object.entries(TASK_EXECUTION_LIMITS).map(([name, range]) => [name, {
    type: "integer",
    minimum: range.min,
    maximum: range.max,
  }]),
);

export const TASK_EXECUTION_SCHEMA = Object.freeze({
  type: "object",
  description: "Optional bounded execution budget for one executable Task.",
  properties: executionProperties,
  additionalProperties: false,
});

export const WORKFLOW_NODE_SCHEMA = Object.freeze({
  type: "object",
  description: "One graph node. start/end are topology-only; task is executable work.",
  properties: {
    type: {
      type: "string",
      enum: ["start", "task", "end"],
      description: "Node kind. Map and Loop are never node types; they belong in groups.",
    },
    name: {
      type: "string",
      minLength: 1,
      maxLength: 50,
      description: "Human-readable 2-5 word label for an executable Task.",
    },
    objective: {
      type: "string",
      minLength: 1,
      description: "Exact work the temporary Agent must perform. Required by Carlos Office when type=task.",
    },
    completion: {
      type: "string",
      description: "Acceptance criteria that tell the temporary Agent when the Task is complete.",
    },
    inputs: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
      description: "Optional resolved input paths. Use workflow.<name> or upstream.<producerTaskId>[.<property>].",
    },
    output: {
      type: "string",
      minLength: 1,
      description: "Optional unique output ALIAS for downstream addressing only. It is not the Task result. Omit when unnecessary.",
    },
    provider: {
      type: "string",
      minLength: 1,
      description: "Optional fixed provider. provider and model must be present together.",
    },
    model: {
      type: "string",
      minLength: 1,
      description: "Optional fixed model. provider and model must be present together.",
    },
    tools: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
      description: "Optional authoritative Tool list. Omit for Nora selection; [] intentionally means no Tools.",
    },
    skills: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
      description: "Optional authoritative Skill list. Omit for Nora selection; [] intentionally means no Skills.",
    },
    timeoutMs: {
      type: ["integer", "null"],
      minimum: 1000,
      maximum: 3600000,
      description: "Optional absolute Task timeout. null disables the Task timeout.",
    },
    execution: TASK_EXECUTION_SCHEMA,
  },
  required: ["type"],
  additionalProperties: false,
});

export const WORKFLOW_GROUP_SCHEMA = Object.freeze({
  type: "object",
  description: "Execution scope. type=map iterates an array; type=loop repeats one Task under Nora quality review.",
  properties: {
    id: { type: "string", minLength: 1 },
    type: {
      type: "string",
      enum: ["map", "loop"],
      description: "Execution Group type. A Group is never a graph node and never appears in edges.",
    },
    name: { type: "string", minLength: 1, maxLength: 60 },
    members: {
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1,
      uniqueItems: true,
      description: "Task IDs or nested Group IDs directly owned by this Group. start/end are forbidden.",
    },
    source: {
      type: "string",
      minLength: 1,
      description: "Map only: array path, normally workflow.<input> or upstream.<producerTaskId>[.<arrayProperty>].",
    },
    itemAs: { type: "string", minLength: 1, description: "Map only: item variable name. Defaults to item." },
    indexAs: { type: "string", minLength: 1, description: "Map only: index variable name. Defaults to index." },
    concurrency: { type: "integer", minimum: 1, maximum: 64, description: "Map only: maximum concurrent item executions." },
    maxItemAttempts: { type: "integer", minimum: 1, maximum: 4, description: "Map only: replay budget for one item." },
    failurePolicy: { type: "string", enum: ["fail-fast", "continue"], description: "Map only." },
    throttle: {
      type: ["object", "null"],
      properties: {
        requests: { type: "integer", minimum: 1, maximum: 100000 },
        windowMs: { type: "integer", minimum: 100, maximum: 86400000 },
      },
      required: ["requests", "windowMs"],
      additionalProperties: false,
      description: "Map only: optional start-rate limiter.",
    },
    maxIterations: { type: "integer", minimum: 2, maximum: 10, description: "Loop only. Defaults to 3." },
    minimumScore: { type: "number", minimum: 0, maximum: 1, description: "Loop only. Defaults to 0.8." },
    criteria: { type: "string", description: "Loop only: independent Nora review criteria." },
    x: { type: "number", minimum: 0 },
    y: { type: "number", minimum: 0 },
    width: { type: "number", minimum: 160 },
    height: { type: "number", minimum: 100 },
  },
  required: ["id", "type", "members"],
  additionalProperties: false,
});

export const WORKFLOW_GRAPH_SCHEMA = Object.freeze({
  type: "object",
  description: "Carlos Office directed acyclic Workflow graph.",
  properties: {
    start: { type: "string", minLength: 1, description: "ID of the single topology-only start node." },
    end: { type: "string", minLength: 1, description: "ID of the single topology-only end node." },
    tasks: {
      type: "object",
      minProperties: 2,
      additionalProperties: WORKFLOW_NODE_SCHEMA,
      description: "Node dictionary keyed by stable node ID. Contains exactly one start and one end plus executable Tasks.",
    },
    edges: {
      type: "array",
      items: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 2,
        maxItems: 2,
      },
      description: "Dependency edges as [fromNodeId,toNodeId]. DAG only; Groups never appear here.",
    },
    groups: {
      type: "array",
      items: WORKFLOW_GROUP_SCHEMA,
      description: "Optional Map/Loop execution scopes. Use [] when none are required.",
    },
  },
  required: ["start", "end", "tasks", "edges", "groups"],
  additionalProperties: false,
});

export const PROCESS_DEFINITION_SCHEMA = Object.freeze({
  type: "object",
  description: "Reusable Process definition: metadata plus one Carlos Office Workflow graph.",
  properties: {
    name: { type: "string", minLength: 1 },
    purpose: { type: "string" },
    inputs: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
      description: "Named Workflow inputs required when instantiating the Process.",
    },
    ...WORKFLOW_GRAPH_SCHEMA.properties,
  },
  required: ["name", "purpose", "inputs", ...WORKFLOW_GRAPH_SCHEMA.required],
  additionalProperties: false,
});

export const TASK_EXECUTION_SELECTION_SCHEMA = Object.freeze({
  type: "object",
  description: "Resolved runtime resources for one ready Task.",
  properties: {
    provider: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    tools: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
    skills: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
  },
  required: ["provider", "model", "tools", "skills"],
  additionalProperties: false,
});

export const LOOP_REVIEW_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    passed: { type: "boolean" },
    score: { type: "number", minimum: 0, maximum: 1 },
    feedback: { type: "string" },
  },
  required: ["passed", "score", "feedback"],
  additionalProperties: false,
});

export const TASK_RECOVERY_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    action: { type: "string", enum: ["retry", "escalate"] },
    reason: { type: "string" },
    taskChanges: { type: "object" },
  },
  required: ["action", "reason"],
  additionalProperties: false,
});

export const getWorkflowDesignInstruction = () => [
  "CARLOS OFFICE WORKFLOW LANGUAGE — AUTHORITATIVE CONTRACT. Read this before deciding how to execute the request.",
  "Start: exactly one topology-only entry node. It performs no work and owns no Tools, model, or output.",
  "End: exactly one topology-only terminal node. It performs no work and owns no Tools, model, or output.",
  "Task: the only executable graph node. Give it one atomic objective, explicit completion criteria when useful, and only the inputs/resources it actually needs.",
  "Task output is an OPTIONAL ALIAS used only to address that Task downstream. It is not the Agent result. Omit output instead of emitting an empty string.",
  "Task results are produced at runtime as Agent completion {output,data,artifacts}. Downstream machine-readable handoff belongs in data and is addressed through upstream.<taskId>.",
  "Edge: [from,to] expresses dependency. The graph must be acyclic; every node must be reachable from start and able to reach end.",
  "Map: an execution Group for genuine collection iteration. source must resolve to an array. Its members execute once per item. Map is never a node, label, visual box, or generic sequence container.",
  "Loop: an execution Group for quality-controlled repetition. In v1.1 it directly owns exactly one executable Task. Nora reviews each result and may repeat it up to maxIterations. Never create a graph back-edge for a Loop.",
  "Groups never appear in edges. start/end cannot be Group members. A Task or nested Group may directly belong to at most one Group.",
  "Use workflow.<input> for Workflow inputs. Use upstream.<producerTaskId> or a unique output alias for completed ancestor data. Never invent sibling/descendant dependencies.",
  "Omit optional provider/model, tools, skills, output, timeoutMs, execution, and Groups that are not needed. Do not fill optional fields with empty strings or null placeholders just to satisfy shape.",
  `Workflow graph JSON schema: ${JSON.stringify(WORKFLOW_GRAPH_SCHEMA)}`,
  `Reusable Process JSON schema: ${JSON.stringify(PROCESS_DEFINITION_SCHEMA)}`,
].join("\n\n");
