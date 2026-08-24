const NODE_TYPES = new Set(["start", "task", "end"]);
const MAX_TASK_NAME_LENGTH = 50;

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const hasTask = (graph, taskId) => Object.prototype.hasOwnProperty.call(graph.tasks, taskId);

const validateStringList = (value, label) => {
  if (value == null) return;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.some(item => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} must contain non-empty strings`);
  }
};

const taskNameFromId = taskId => String(taskId)
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\b\w/g, character => character.toUpperCase())
  .slice(0, MAX_TASK_NAME_LENGTH);

export const normalizeGeneratedGraph = graph => {
  if (!isObject(graph)) return graph;

  const normalized = structuredClone(graph);
  if (!isObject(normalized.tasks)) return normalized;

  if (typeof normalized.start === "string" && normalized.start) {
    const start = isObject(normalized.tasks[normalized.start]) ? normalized.tasks[normalized.start] : {};
    normalized.tasks[normalized.start] = { ...start, type: "start" };
  }

  if (typeof normalized.end === "string" && normalized.end) {
    const end = isObject(normalized.tasks[normalized.end]) ? normalized.tasks[normalized.end] : {};
    normalized.tasks[normalized.end] = { ...end, type: "end" };
  }

  for (const [taskId, task] of Object.entries(normalized.tasks)) {
    if (taskId === normalized.start || taskId === normalized.end || !isObject(task)) continue;
    if (!task.type) task.type = "task";
    if (task.type === "task" && (!task.objective || !String(task.objective).trim())) {
      if (typeof task.description === "string" && task.description.trim()) {
        task.objective = task.description.trim();
      }
    }
    if (task.type === "task" && (!task.name || !String(task.name).trim())) {
      task.name = taskNameFromId(taskId);
    }
  }

  return normalized;
};

const validateTaskDefinition = (taskId, task) => {
  if (!isObject(task)) throw new Error(`Invalid task: ${taskId}`);
  if (!NODE_TYPES.has(task.type)) throw new Error(`Invalid node type for ${taskId}: ${task.type}`);
  if (task.type !== "task") return;

  if (task.name != null) {
    if (typeof task.name !== "string" || !task.name.trim()) {
      throw new Error(`Task ${taskId} name must be a non-empty string`);
    }
    if (task.name.trim().length > MAX_TASK_NAME_LENGTH) {
      throw new Error(`Task ${taskId} name cannot exceed ${MAX_TASK_NAME_LENGTH} characters`);
    }
  }
  if (typeof task.objective !== "string" || !task.objective.trim()) {
    throw new Error(`Task ${taskId} objective must be a non-empty string`);
  }
  if (task.output != null && typeof task.output !== "string") {
    throw new Error(`Task ${taskId} output must be a string`);
  }
  if (task.completion != null && typeof task.completion !== "string") {
    throw new Error(`Task ${taskId} completion must be a string`);
  }
  if (
    task.timeoutMs !== undefined
    && task.timeoutMs !== null
    && (!Number.isSafeInteger(task.timeoutMs) || task.timeoutMs < 1_000 || task.timeoutMs > 3_600_000)
  ) {
    throw new Error(`Task ${taskId} timeoutMs must be null or an integer from 1000 to 3600000`);
  }

  validateStringList(task.inputs, `Task ${taskId} inputs`);
  validateStringList(task.tools, `Task ${taskId} tools`);
  validateStringList(task.skills, `Task ${taskId} skills`);

  const hasProvider = task.provider != null;
  const hasModel = task.model != null;
  if (hasProvider !== hasModel) throw new Error(`Task ${taskId} provider and model must be configured together`);
  if (hasProvider && (typeof task.provider !== "string" || !task.provider.trim())) {
    throw new Error(`Task ${taskId} provider must be a non-empty string`);
  }
  if (hasModel && (typeof task.model !== "string" || !task.model.trim())) {
    throw new Error(`Task ${taskId} model must be a non-empty string`);
  }
};

const reachableFrom = (start, adjacency) => {
  const visited = new Set();
  const pending = [start];

  while (pending.length) {
    const node = pending.pop();
    if (visited.has(node)) continue;

    visited.add(node);
    for (const next of adjacency.get(node) ?? []) pending.push(next);
  }

  return visited;
};

const validateAcyclic = (graph, adjacency) => {
  const visiting = new Set();
  const visited = new Set();

  const visit = node => {
    if (visiting.has(node)) throw new Error(`Graph contains a cycle involving node: ${node}`);
    if (visited.has(node)) return;

    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) visit(next);
    visiting.delete(node);
    visited.add(node);
  };

  for (const node of Object.keys(graph.tasks)) visit(node);
};

export const validateGraph = graph => {
  if (!isObject(graph)) throw new Error("Graph must be an object");
  if (!graph.start || typeof graph.start !== "string") throw new Error("Graph must define a start node");
  if (!graph.end || typeof graph.end !== "string") throw new Error("Graph must define an end node");
  if (graph.start === graph.end) throw new Error("Start and end must be different nodes");
  if (!isObject(graph.tasks)) throw new Error("Graph tasks must be an object");
  if (!Array.isArray(graph.edges)) throw new Error("Graph edges must be an array");
  if (!hasTask(graph, graph.start)) throw new Error(`Start node does not exist: ${graph.start}`);
  if (!hasTask(graph, graph.end)) throw new Error(`End node does not exist: ${graph.end}`);
  if (graph.tasks[graph.start]?.type !== "start") {
    throw new Error(`Start node ${graph.start} must have type "start"`);
  }
  if (graph.tasks[graph.end]?.type !== "end") throw new Error(`End node ${graph.end} must have type "end"`);

  let startNodes = 0;
  let endNodes = 0;

  for (const [taskId, task] of Object.entries(graph.tasks)) {
    validateTaskDefinition(taskId, task);
    if (task.type === "start") startNodes += 1;
    if (task.type === "end") endNodes += 1;
  }

  if (startNodes !== 1) throw new Error("Graph must contain exactly one start node");
  if (endNodes !== 1) throw new Error("Graph must contain exactly one end node");

  const adjacency = new Map(Object.keys(graph.tasks).map(taskId => [taskId, []]));
  const reverseAdjacency = new Map(Object.keys(graph.tasks).map(taskId => [taskId, []]));
  const seenEdges = new Set();

  for (const edge of graph.edges) {
    if (
      !Array.isArray(edge)
      || edge.length !== 2
      || typeof edge[0] !== "string"
      || typeof edge[1] !== "string"
    ) {
      throw new Error("Every edge must be [fromTaskId, toTaskId]");
    }

    const [from, to] = edge;
    if (!hasTask(graph, from)) throw new Error(`Edge references unknown task: ${from}`);
    if (!hasTask(graph, to)) throw new Error(`Edge references unknown task: ${to}`);
    if (from === to) throw new Error(`Task cannot connect to itself: ${from}`);
    if (to === graph.start) throw new Error("The start node cannot have incoming edges");
    if (from === graph.end) throw new Error("The end node cannot have outgoing edges");

    const key = `${from}\u0000${to}`;
    if (seenEdges.has(key)) throw new Error(`Duplicate graph edge: ${from} -> ${to}`);
    seenEdges.add(key);
    adjacency.get(from).push(to);
    reverseAdjacency.get(to).push(from);
  }

  validateAcyclic(graph, adjacency);

  const reachable = reachableFrom(graph.start, adjacency);
  if (!reachable.has(graph.end)) {
    throw new Error(`End node ${graph.end} is not reachable from start node ${graph.start}`);
  }
  for (const taskId of Object.keys(graph.tasks)) {
    if (!reachable.has(taskId)) throw new Error(`Graph node is not reachable from start: ${taskId}`);
  }

  const canReachEnd = reachableFrom(graph.end, reverseAdjacency);
  for (const taskId of Object.keys(graph.tasks)) {
    if (!canReachEnd.has(taskId)) throw new Error(`Graph node cannot reach end: ${taskId}`);
  }

  return true;
};

export const validateProcessDefinition = process => {
  if (!isObject(process)) throw new Error("Process must be an object");
  if (!process.name || typeof process.name !== "string" || !process.name.trim()) {
    throw new Error("Process name must be a non-empty string");
  }
  if (process.purpose != null && typeof process.purpose !== "string") {
    throw new Error("Process purpose must be a string");
  }
  validateStringList(process.inputs, "Process inputs");
  validateGraph(process);
  return true;
};