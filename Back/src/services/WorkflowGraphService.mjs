const NODE_TYPES = new Set(["start", "task", "end"]);
const GROUP_TYPES = new Set(["map", "loop"]);
const MAX_TASK_NAME_LENGTH = 50;
const MAX_GROUP_NAME_LENGTH = 60;

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

const groupNameFromId = groupId => String(groupId)
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\b\w/g, character => character.toUpperCase())
  .slice(0, MAX_GROUP_NAME_LENGTH);

const normalizeGeneratedGroup = group => {
  if (!isObject(group)) return group;
  const normalized = structuredClone(group);
  if (!normalized.name && typeof normalized.title === "string" && normalized.title.trim()) {
    normalized.name = normalized.title.trim();
  }
  delete normalized.title;
  if (!normalized.name && normalized.id) normalized.name = groupNameFromId(normalized.id);

  if (normalized.type === "map") {
    normalized.itemAs ??= "item";
    normalized.indexAs ??= "index";
    normalized.concurrency ??= 1;
  }
  if (normalized.type === "loop") {
    normalized.maxIterations ??= 3;
    normalized.minimumScore ??= 0.8;
    normalized.criteria ??= "Review the Task result against its objective and completion criteria.";
  }
  return normalized;
};

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

  normalized.groups = Array.isArray(normalized.groups)
    ? normalized.groups.map(normalizeGeneratedGroup)
    : [];
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

const validateGroupLayout = group => {
  for (const key of ["x", "y", "width", "height"]) {
    if (group[key] == null) continue;
    if (!Number.isFinite(Number(group[key])) || Number(group[key]) < 0) {
      throw new Error(`Execution Group ${group.id} ${key} must be a non-negative number`);
    }
  }
  if (group.width != null && Number(group.width) < 160) {
    throw new Error(`Execution Group ${group.id} width must be at least 160`);
  }
  if (group.height != null && Number(group.height) < 100) {
    throw new Error(`Execution Group ${group.id} height must be at least 100`);
  }
};

const validateThrottle = (group, throttle) => {
  if (throttle == null) return;
  if (!isObject(throttle)) throw new Error(`Map Group ${group.id} throttle must be an object or null`);
  if (!Number.isSafeInteger(throttle.requests) || throttle.requests < 1 || throttle.requests > 100_000) {
    throw new Error(`Map Group ${group.id} throttle.requests must be an integer from 1 to 100000`);
  }
  if (!Number.isSafeInteger(throttle.windowMs) || throttle.windowMs < 100 || throttle.windowMs > 86_400_000) {
    throw new Error(`Map Group ${group.id} throttle.windowMs must be an integer from 100 to 86400000`);
  }
};

const groupIndex = graph => new Map((graph.groups ?? []).map(group => [group.id, group]));

const validateGroups = graph => {
  if (graph.groups == null) return;
  if (!Array.isArray(graph.groups)) throw new Error("Graph groups must be an array");

  const groups = new Map();
  for (const group of graph.groups) {
    if (!isObject(group)) throw new Error("Every Execution Group must be an object");
    if (typeof group.id !== "string" || !group.id.trim()) throw new Error("Execution Group must have a non-empty ID");
    if (groups.has(group.id)) throw new Error(`Duplicate Execution Group ID: ${group.id}`);
    if (!GROUP_TYPES.has(group.type)) throw new Error(`Invalid Execution Group type for ${group.id}: ${group.type}`);
    if (group.name != null && (typeof group.name !== "string" || !group.name.trim() || group.name.trim().length > MAX_GROUP_NAME_LENGTH)) {
      throw new Error(`Execution Group ${group.id} name must be 1-${MAX_GROUP_NAME_LENGTH} characters`);
    }
    if (!Array.isArray(group.members) || !group.members.length) {
      throw new Error(`Execution Group ${group.id} must contain at least one member`);
    }
    if (new Set(group.members).size !== group.members.length) {
      throw new Error(`Execution Group ${group.id} contains duplicate members`);
    }
    if (group.members.some(member => typeof member !== "string" || !member.trim())) {
      throw new Error(`Execution Group ${group.id} members must be non-empty IDs`);
    }
    validateGroupLayout(group);

    if (group.type === "map") {
      if (typeof group.source !== "string" || !group.source.trim()) {
        throw new Error(`Map Group ${group.id} source must be a non-empty input path`);
      }
      if (typeof group.itemAs !== "string" || !group.itemAs.trim()) {
        throw new Error(`Map Group ${group.id} itemAs must be a non-empty string`);
      }
      if (group.indexAs != null && (typeof group.indexAs !== "string" || !group.indexAs.trim())) {
        throw new Error(`Map Group ${group.id} indexAs must be a non-empty string`);
      }
      if (!Number.isSafeInteger(group.concurrency) || group.concurrency < 1 || group.concurrency > 64) {
        throw new Error(`Map Group ${group.id} concurrency must be an integer from 1 to 64`);
      }
      validateThrottle(group, group.throttle);
    }

    if (group.type === "loop") {
      if (group.members.length !== 1) throw new Error(`Loop Group ${group.id} must contain exactly one Task in v1.1`);
      if (!Number.isSafeInteger(group.maxIterations) || group.maxIterations < 2 || group.maxIterations > 10) {
        throw new Error(`Loop Group ${group.id} maxIterations must be an integer from 2 to 10`);
      }
      if (typeof group.minimumScore !== "number" || group.minimumScore < 0 || group.minimumScore > 1) {
        throw new Error(`Loop Group ${group.id} minimumScore must be a number from 0 to 1`);
      }
      if (group.criteria != null && typeof group.criteria !== "string") {
        throw new Error(`Loop Group ${group.id} criteria must be a string`);
      }
    }

    groups.set(group.id, group);
  }

  const owner = new Map();
  for (const group of groups.values()) {
    for (const member of group.members) {
      if (member === group.id) throw new Error(`Execution Group ${group.id} cannot contain itself`);
      const task = graph.tasks[member];
      const childGroup = groups.get(member);
      if (!task && !childGroup) throw new Error(`Execution Group ${group.id} references unknown member: ${member}`);
      if (task && ["start", "end"].includes(task.type)) {
        throw new Error(`Execution Group ${group.id} cannot contain ${task.type} node ${member}`);
      }
      if (owner.has(member)) {
        throw new Error(`Execution member ${member} belongs directly to more than one Group`);
      }
      owner.set(member, group.id);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visitGroup = groupId => {
    if (visiting.has(groupId)) throw new Error(`Execution Group nesting contains a cycle involving ${groupId}`);
    if (visited.has(groupId)) return;
    visiting.add(groupId);
    const group = groups.get(groupId);
    for (const member of group.members) if (groups.has(member)) visitGroup(member);
    visiting.delete(groupId);
    visited.add(groupId);
  };
  for (const groupId of groups.keys()) visitGroup(groupId);

  for (const group of groups.values()) {
    if (group.type !== "loop") continue;
    const task = graph.tasks[group.members[0]];
    if (!task || task.type !== "task") {
      throw new Error(`Loop Group ${group.id} must directly contain exactly one executable Task in v1.1`);
    }
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

  validateGroups(graph);
  return true;
};

export const getTaskExecutionGroups = (graph, taskId) => {
  if (!graph?.tasks?.[taskId] || graph.tasks[taskId].type !== "task") return [];
  const groups = groupIndex(graph);
  const owner = new Map();
  for (const group of groups.values()) {
    for (const member of group.members ?? []) owner.set(member, group.id);
  }

  const path = [];
  let current = taskId;
  while (owner.has(current)) {
    const group = groups.get(owner.get(current));
    if (!group) break;
    path.push(structuredClone(group));
    current = group.id;
  }
  return path.reverse();
};

export const getGroupDescendantTaskIds = (graph, groupId) => {
  const groups = groupIndex(graph);
  const result = [];
  const visit = member => {
    if (graph?.tasks?.[member]?.type === "task") {
      result.push(member);
      return;
    }
    const group = groups.get(member);
    if (!group) return;
    for (const child of group.members ?? []) visit(child);
  };
  visit(groupId);
  return [...new Set(result)];
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
