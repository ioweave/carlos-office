export const TASK_OPERATIONS = Object.freeze([
  "search",
  "fetch",
  "extract",
  "inspect",
  "verify",
  "analyze",
  "compare",
  "synthesize",
  "transform",
  "write",
  "execute",
  "decide",
]);
export const TOOL_FREE_TASK_OPERATIONS = Object.freeze([
  "verify",
  "analyze",
  "compare",
  "synthesize",
  "transform",
  "decide",
]);
export const TASK_TOOL_REQUIRED_OPERATIONS = Object.freeze([
  "search",
  "fetch",
  "extract",
  "inspect",
  "execute",
]);
export const TASK_OBJECTIVE_MAX_CHARS = 700;
export const TASK_COMPLETION_MAX_CHARS = 600;

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
  description: "One graph node. start/end are topology-only; task is exactly one executable operation.",
  properties: {
    type: {
      type: "string",
      enum: ["start", "task", "end"],
      description: "Node kind. Map and Loop are never node types; they belong in groups.",
    },
    operation: {
      type: "string",
      enum: TASK_OPERATIONS,
      description: "Task only: exactly one operation. Broad research is forbidden; decompose search/fetch/extract/analyze/synthesize into separate nodes.",
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
      maxLength: TASK_OBJECTIVE_MAX_CHARS,
      description: "One atomic action only. Context belongs in inputs; sequential or numbered action lists are invalid.",
    },
    completion: {
      type: "string",
      maxLength: TASK_COMPLETION_MAX_CHARS,
      description: "Acceptance criteria for that one operation; do not add another action here.",
    },
    inputs: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
      description: "Explicit minimal input paths. [] means no external context. Use workflow.<name> or upstream.<producerTaskId>[.<property>].",
    },
    output: {
      type: "string",
      minLength: 1,
      description: "Optional unique output ALIAS for downstream addressing only. It is not the Task result. Omit when unnecessary.",
    },
    provider: {
      type: "string",
      minLength: 1,
      description: "Optional fixed provider. provider and model must be present together. Otherwise the Workflow Nora model is inherited deterministically.",
    },
    model: {
      type: "string",
      minLength: 1,
      description: "Optional fixed model. provider and model must be present together. Otherwise the Workflow Nora model is inherited deterministically.",
    },
    tools: {
      type: "array",
      items: { type: "string", minLength: 1 },
      maxItems: 1,
      uniqueItems: true,
      description: "Authoritative Tool assignment. Atomic Tool operations use exactly one Tool; evidence-only operations use []. Runtime Tool selection is not used.",
    },
    skills: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
      description: "Authoritative Skill list. Use [] when none are required; runtime Skill selection is not used.",
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
      description: "Node dictionary keyed by stable node ID. Contains exactly one start and one end plus atomic executable Tasks.",
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
  description: "Resolved runtime resources for one atomic ready Task.",
  properties: {
    provider: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    tools: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 1, uniqueItems: true },
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
  "Task: exactly ONE atomic operation. A Task is one verb applied to one target; never a mini-workflow hidden inside one objective.",
  `Every Task must declare operation as exactly one of: ${TASK_OPERATIONS.join(", ")}. There is intentionally no research operation because research must be decomposed.`,
  "Canonical decomposition is search -> fetch -> extract -> verify/analyze/compare -> synthesize -> write. Create only the nodes actually needed and connect them with edges.",
  "Never ask one Task to fetch information and analyze it, or analyze and compare it, or compare and generate an output. Those are separate Task nodes.",
  "Task objectives must be concise and atomic. Put case context in Workflow inputs and pass evidence through upstream data; do not paste the whole job into one objective.",
  `Task objective length is bounded to ${TASK_OBJECTIVE_MAX_CHARS} characters and completion to ${TASK_COMPLETION_MAX_CHARS} characters. Numbered multi-action objectives and sequential 'then/luego' instructions are invalid.`,
  "Every Task must declare inputs explicitly. Use [] when it needs no Workflow/upstream context. Carlos Office does not inject the whole Workflow input into Tasks that declare [].",
  "Declare only the minimum input paths the operation requires. A search whose objective already names the target usually uses inputs:[].",
  "Tool assignment is decided when the Workflow is designed, not while the Task is running.",
  `Operations ${TASK_TOOL_REQUIRED_OPERATIONS.join(", ")} require exactly one Tool. Operations ${TOOL_FREE_TASK_OPERATIONS.join(", ")} require tools:[]. write may use zero or one Tool depending on whether it creates an external artifact.`,
  "A Task may use AT MOST ONE Tool. If two Tools are required, that is evidence that two Task nodes are required.",
  "Skills are also fixed at design time; use skills:[] when none are required.",
  "Provider/model are inherited deterministically from the Workflow's Nora model unless explicitly pinned together on the Task. Runtime model selection is not used.",
  "search discovers candidate sources only; fetch retrieves one identified resource; extract reads one provided resource; inspect observes one provided target; verify checks one claim against provided evidence.",
  "analyze reasons over provided evidence; compare compares provided inputs; synthesize combines upstream results; transform changes provided content; write produces one output/artifact; execute performs one side effect; decide makes one choice.",
  "Task output is an OPTIONAL ALIAS used only to address that Task downstream. It is not the Agent result. Omit output instead of emitting an empty string.",
  "Task results are produced at runtime as Agent completion {output,data,artifacts}. Downstream machine-readable handoff belongs in data and is addressed through upstream.<taskId>.",
  "Edge: [from,to] expresses dependency. The graph must be acyclic; every node must be reachable from start and able to reach end.",
  "Map: an execution Group for genuine collection iteration. source must resolve to an array. Its members execute once per item. Map is never a node, label, visual box, or generic sequence container.",
  "Loop: an execution Group for quality-controlled repetition. In v1.1 it directly owns exactly one executable Task. Nora reviews each result and may repeat it up to maxIterations. Never create a graph back-edge for a Loop.",
  "Groups never appear in edges. start/end cannot be Group members. A Task or nested Group may directly belong to at most one Group.",
  "Use workflow.<input> for Workflow inputs. Use upstream.<producerTaskId> or a unique output alias for completed ancestor data. Never invent sibling/descendant dependencies.",
  "Omit optional output, timeoutMs, execution, and Groups that are not needed. Do not use empty strings or null placeholders.",
  `Workflow graph JSON schema: ${JSON.stringify(WORKFLOW_GRAPH_SCHEMA)}`,
  `Reusable Process JSON schema: ${JSON.stringify(PROCESS_DEFINITION_SCHEMA)}`,
].join("\n\n");