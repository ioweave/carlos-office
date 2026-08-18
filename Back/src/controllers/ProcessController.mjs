import {
  mkdir,
  readdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { recordEvent } from "./EventController.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const processesDir = resolve(
  here,
  "../../ObsidianVault/90-System/Processes"
);
const workflowsDir = resolve(
  here,
  "../../ObsidianVault/90-System/Workflows"
);
const processes = new Map();
const workflows = new Map();
const workflowWrites = new Map();
const TASK_STATUSES = new Set([
  "pending",
  "ready",
  "running",
  "blocked",
  "completed",
  "failed",
  "skipped",
  "cancelled"
]);

const isObject = (value) => {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

const validateFileName = (value, label) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim() !== value ||
    value === "." ||
    value === ".." ||
    /[<>:"/\\|?*\u0000-\u001F]/.test(value)
  ) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

const hasTask = (graph, taskId) => {
  return Object.prototype.hasOwnProperty.call(
    graph.tasks,
    taskId
  );
}

export const validateGraph = (graph) => {
  if (!isObject(graph)) {
    throw new Error("Graph must be an object");
  }

  if (!graph.start || typeof graph.start !== "string") {
    throw new Error("Graph must define a start node");
  }

  if (!graph.end || typeof graph.end !== "string") {
    throw new Error("Graph must define an end node");
  }

  if (graph.start === graph.end) {
    throw new Error("Start and end must be different nodes");
  }

  if (!isObject(graph.tasks)) {
    throw new Error("Graph tasks must be an object");
  }

  if (!Array.isArray(graph.edges)) {
    throw new Error("Graph edges must be an array");
  }

  if (!hasTask(graph, graph.start)) {
    throw new Error(`Start node does not exist: ${graph.start}`);
  }

  if (!hasTask(graph, graph.end)) {
    throw new Error(`End node does not exist: ${graph.end}`);
  }

  if (graph.tasks[graph.start]?.type !== "start") {
    throw new Error(`Start node ${graph.start} must have type "start"`);
  }

  if (graph.tasks[graph.end]?.type !== "end") {
    throw new Error(`End node ${graph.end} must have type "end"`);
  }

  let startNodes = 0;
  let endNodes = 0;

  for (const [taskId, task] of Object.entries(graph.tasks)) {
    if (!isObject(task)) {
      throw new Error(`Invalid task: ${taskId}`);
    }

    if (!["start", "task", "end"].includes(task.type)) {
      throw new Error(`Invalid node type for ${taskId}: ${task.type}`);
    }

    if (task.type === "start") {
      startNodes += 1;
    }

    if (task.type === "end") {
      endNodes += 1;
    }
  }

  if (startNodes !== 1) {
    throw new Error("Graph must contain exactly one start node");
  }

  if (endNodes !== 1) {
    throw new Error("Graph must contain exactly one end node");
  }

  for (const edge of graph.edges) {
    if (
      !Array.isArray(edge) ||
      edge.length !== 2 ||
      typeof edge[0] !== "string" ||
      typeof edge[1] !== "string"
    ) {
      throw new Error("Every edge must be [fromTaskId, toTaskId]");
    }

    const [from, to] = edge;

    if (!hasTask(graph, from)) {
      throw new Error(`Edge references unknown task: ${from}`);
    }

    if (!hasTask(graph, to)) {
      throw new Error(`Edge references unknown task: ${to}`);
    }

    if (from === to) {
      throw new Error(`Task cannot connect to itself: ${from}`);
    }

    if (to === graph.start) {
      throw new Error("The start node cannot have incoming edges");
    }

    if (from === graph.end) {
      throw new Error("The end node cannot have outgoing edges");
    }
  }

  return true;
}

const validateProcess = (process) => {
  if (!isObject(process)) {
    throw new Error("Process must be an object");
  }

  validateFileName(process.name, "process name");
  validateGraph(process);
}

const validateWorkflow = (workflow) => {
  if (!isObject(workflow)) {
    throw new Error("Workflow must be an object");
  }

  validateFileName(workflow.id, "workflow ID");
  validateGraph(workflow);

  if (!workflow.status || typeof workflow.status !== "string") {
    throw new Error(`Workflow ${workflow.id} must have a status`);
  }
}

const validateAttempt = (attempt) => {
  if (!isObject(attempt)) {
    throw new Error("Task Attempt must be an object");
  }

  if (!attempt.id || typeof attempt.id !== "string") {
    throw new Error("Task Attempt must have an ID");
  }

  if (!Number.isInteger(attempt.attempt) || attempt.attempt < 1) {
    throw new Error("Task Attempt must have a positive attempt number");
  }

  if (!attempt.status || typeof attempt.status !== "string") {
    throw new Error("Task Attempt must have a status");
  }
}

const processPath = (name) => {
  validateFileName(name, "process name");
  return resolve(processesDir, `${name}.md`);
}

const workflowPath = (id) => {
  validateFileName(id, "workflow ID");
  return resolve(workflowsDir, `${id}.json`);
}

const renderProcess = (process) => {
  return [
    `# ${process.name}`,
    "",
    "```json",
    JSON.stringify(process, null, 2),
    "```",
    ""
  ].join("\n");
}

const parseProcess = (content, filename) => {
  const match = content.match(/```json\s*\n([\s\S]*?)\n```/);

  if (!match) {
    throw new Error(`Process file ${filename} does not contain a Carlos Office JSON definition`);
  }

  return JSON.parse(match[1]);
}

const persistWorkflow = async (workflow) => {
  const id = workflow.id;
  const previous = workflowWrites.get(id) ?? Promise.resolve();

  const next = previous.then(async () => {
    await mkdir(workflowsDir, {
      recursive: true
    });

    await writeFile(
      workflowPath(id),
      JSON.stringify(workflow, null, 2),
      "utf8"
    );
  });

  workflowWrites.set(id, next);

  try {
    await next;
  } finally {
    if (workflowWrites.get(id) === next) {
      workflowWrites.delete(id);
    }
  }
}

const requireWorkflow = (id) => {
  const workflow = workflows.get(id);

  if (!workflow) {
    throw new Error(`Unknown workflow: ${id}`);
  }

  return workflow;
}

const requireTask = (workflow, taskId) => {
  const task = workflow.tasks[taskId];

  if (!task) {
    throw new Error(`Unknown task ${taskId} in workflow ${workflow.id}`);
  }

  return task;
}

const requireExecutableTask = (workflow, taskId) => {
  const task = requireTask(workflow, taskId);

  if (task.type !== "task") {
    throw new Error(`${taskId} is not an executable Task`);
  }

  return task;
}

const incoming = (workflow, taskId) => {
  return workflow.edges
    .filter(([, to]) => to === taskId)
    .map(([from]) => from);
}

const dependenciesComplete = (workflow, taskId) => {
  const dependencies = incoming(workflow, taskId);

  if (!dependencies.length) {
    return false;
  }

  return dependencies.every((dependencyId) => {
    const status = workflow.tasks[dependencyId]?.status;

    return ["completed", "skipped"].includes (status);
  });
}

const refreshWorkflow = (workflow) => {
  if (workflow.status === "cancelled") {
    return;
  }

  for (const [taskId, task] of Object.entries(workflow.tasks)) {
    if (task.type !== "task") {
      continue;
    }

    if (
      task.status !== "pending" &&
      task.status !== "ready"
    ) {
      continue;
    }

    task.status = dependenciesComplete(workflow, taskId)
      ? "ready"
      : "pending";
  }

  const endTask = workflow.tasks[workflow.end];

  if (
    endTask.status !== "completed" &&
    dependenciesComplete(workflow, workflow.end)
  ) {
    endTask.status = "completed";
  }

  if (endTask.status === "completed") {
    workflow.status = "completed";
    return;
  }

  const tasks = Object.values(workflow.tasks)
    .filter((task) => task.type === "task");

  if (tasks.some((task) =>
    task.status === "running" || task.status === "ready"
  )) {
    workflow.status = "running";
    return;
  }

  if (tasks.some(
    (task) => task.status === "blocked"
  )) {
    workflow.status = "blocked";
    return;
  }

  if (tasks.some(
    (task) => task.status === "failed"
  )) {
    workflow.status = "failed";
    return;
  }

  workflow.status = "running";
}

const createRuntimeTasks = (
  tasks,
  start,
  end
) => {
  const runtimeTasks = {};

  for (const [taskId, task] of Object.entries(tasks)) {
    if (taskId === start) {
      runtimeTasks[taskId] = {
        ...structuredClone(task),
        status: "completed"
      };

      continue;
    }

    if (taskId === end) {
      runtimeTasks[taskId] = {
        ...structuredClone(task),
        status: "pending"
      };

      continue;
    }

    runtimeTasks[taskId] = {
      ...structuredClone(task),
      status: "pending",
      attempts: []
    };
  }

  return runtimeTasks;
}

const storeNewWorkflow = async (workflow) => {
  validateWorkflow(workflow);
  refreshWorkflow(workflow);

  workflows.set(workflow.id, workflow);

  await persistWorkflow(workflow);
  await recordEvent("workflow.created", {
    workflowId: workflow.id,
    process: workflow.process
  });

  if (workflow.status === "completed") {
    await recordEvent("workflow.completed", {
      workflowId: workflow.id
    });
  }

  return structuredClone(workflow);
}

/* ------------------------------------------------------------------
   Processes
------------------------------------------------------------------ */

export const loadProcesses = async () => {
  await mkdir(processesDir, {
    recursive: true
  });

  processes.clear();

  const files = await readdir(processesDir);

  for (const filename of files.filter(
    (file) => file.endsWith(".md")
  )) {
    const content = await readFile(
      resolve(processesDir, filename),
      "utf8"
    );
    const process = parseProcess(content, filename);

    validateProcess(process);

    if (processes.has(process.name)) {
      throw new Error(`Duplicate process name: ${process.name}`);
    }

    processes.set(process.name, structuredClone(process));
  }

  return listProcesses();
}

export const getProcess = (name) => {
  const process = processes.get(name);

  return process
    ? structuredClone(process)
    : null;
}

export const listProcesses = () => {
  return [...processes.values()].map(
    (process) => structuredClone(process)
  );
}

export const saveProcess = async (process) => {
  validateProcess(process);

  const stored = structuredClone(process);

  await mkdir(processesDir, {
    recursive: true
  });

  await writeFile(
    processPath(stored.name),
    renderProcess(stored),
    "utf8"
  );

  processes.set(stored.name, stored);

  await recordEvent("process.saved", {
    process: stored.name
  });

  return structuredClone(stored);
}

/* ------------------------------------------------------------------
   Workflows
------------------------------------------------------------------ */

export const loadWorkflows = async () => {
  await mkdir(workflowsDir, {
    recursive: true
  });

  workflows.clear();

  const files = await readdir(workflowsDir);

  for (const filename of files.filter(
    (file) => file.endsWith(".json")
  )) {
    const content = await readFile(
      resolve(workflowsDir, filename),
      "utf8"
    );

    const workflow = JSON.parse(content);

    validateWorkflow(workflow);

    workflows.set(workflow.id, workflow);
  }

  return listWorkflows();
}

export const getWorkflow = (id) => {
  const workflow = workflows.get(id);

  return workflow
    ? structuredClone(workflow)
    : null;
}

export const listWorkflows = () => {
  return [...workflows.values()].map(
    (workflow) => structuredClone(workflow)
  );
}

export const createWorkflow = async (
  processName,
  inputs = {},
  config = {}
) => {
  const process = processes.get(processName);

  if (!process) {
    throw new Error(`Unknown process: ${processName}`);
  }

  if (!isObject(inputs)) {
    throw new Error("Workflow inputs must be an object");
  }

  if (!isObject(config)) {
    throw new Error("Workflow config must be an object");
  }

  const workflow = {
    id: `workflow-${randomUUID()}`,
    process: process.name,
    status: "running",
    inputs: structuredClone(inputs),
    config: structuredClone(config),
    start: process.start,
    end: process.end,
    tasks: createRuntimeTasks(
      process.tasks,
      process.start,
      process.end
    ),
    edges: structuredClone(process.edges),
    result: null
  };

  return storeNewWorkflow(workflow);
}

export const createAdHocWorkflow = async ({
  start,
  end,
  tasks,
  edges,
  inputs = {},
  config = {}
}) => {
  if (!isObject(inputs)) {
    throw new Error("Workflow inputs must be an object");
  }

  if (!isObject(config)) {
    throw new Error("Workflow config must be an object");
  }

  const definition = {
    start,
    end,
    tasks,
    edges
  };

  validateGraph(definition);

  const workflow = {
    id: `workflow-${randomUUID()}`,
    process: null,
    status: "running",
    inputs: structuredClone(inputs),
    config: structuredClone(config),
    start,
    end,
    tasks: createRuntimeTasks(tasks, start, end),
    edges: structuredClone(edges),
    result: null
  };

  return storeNewWorkflow(workflow);
}

export const getReadyTasks = (workflowId) => {
  const workflow = requireWorkflow(workflowId);

  return Object.entries(workflow.tasks)
    .filter(([, task]) =>
      task.type === "task" &&
      task.status === "ready"
    )
    .map(([id, task]) => ({
      id,
      ...structuredClone(task)
    }));
}

export const setTaskStatus = async (
  workflowId,
  taskId,
  status
) => {
  if (!TASK_STATUSES.has(status)) {
    throw new Error(`Invalid task status: ${status}`);
  }

  const workflow = requireWorkflow(workflowId);
  const task = requireExecutableTask(workflow, taskId);

  if (workflow.status === "cancelled") {
    throw new Error(`Workflow ${workflowId} is cancelled`);
  }

  const previousWorkflowStatus = workflow.status;

  task.status = status;

  refreshWorkflow(workflow);

  await persistWorkflow(workflow);
  await recordEvent(`task.${status}`, {
    workflowId,
    taskId
  });

  if (
    previousWorkflowStatus !== "completed" &&
    workflow.status === "completed"
  ) {
    await recordEvent("workflow.completed", {
      workflowId
    });
  }

  return structuredClone(task);
}

/* ------------------------------------------------------------------
   Task Attempts

   TaskController creates and executes Attempts.
   ProcessController only stores them as part of its Workflow.
------------------------------------------------------------------ */

export const addTaskAttempt = async (
  workflowId,
  taskId,
  attempt
) => {
  validateAttempt(attempt);

  const workflow = requireWorkflow(workflowId);
  const task = requireExecutableTask(workflow, taskId);
  task.attempts ??= [];

  if (task.attempts.some((existing) =>
    existing.id === attempt.id
  )) {
    throw new Error(`Task Attempt already exists: ${attempt.id}`);
  }

  if (task.attempts.some((existing) =>
    existing.attempt === attempt.attempt
  )) {
    throw new Error(`Task ${taskId} already has attempt number ${attempt.attempt}`);
  }

  task.attempts.push(structuredClone(attempt));

  await persistWorkflow(workflow);

  return structuredClone(attempt);
}

export const getTaskAttempt = (
  workflowId,
  taskId,
  attemptId
) => {
  const workflow = requireWorkflow(workflowId);

  const task = requireExecutableTask(workflow, taskId);

  const attempt = (task.attempts ?? [])
    .find((item) => item.id === attemptId);

  return attempt
    ? structuredClone(attempt)
    : null;
}

export const listTaskAttempts = (
  workflowId,
  taskId
) => {
  const workflow = requireWorkflow(workflowId);
  const task = requireExecutableTask(workflow, taskId);

  return structuredClone(task.attempts ?? []);
}

export const updateTaskAttempt = async (
  workflowId,
  taskId,
  attemptId,
  changes
) => {
  if (!isObject(changes)) {
    throw new Error("Task Attempt changes must be an object");
  }

  const workflow = requireWorkflow(workflowId);
  const task = requireExecutableTask(workflow, taskId);
  const index = (task.attempts ?? [])
    .findIndex((attempt) => attempt.id === attemptId);

  if (index === -1) {
    throw new Error(`Unknown Task Attempt: ${attemptId}`);
  }

  const current = task.attempts[index];
  const updated = {
    ...current,
    ...structuredClone(changes),
    // Execution identity cannot change.
    id: current.id,
    attempt: current.attempt
  };

  validateAttempt(updated);

  task.attempts[index] = updated;

  await persistWorkflow(workflow);

  return structuredClone(updated);
}

/* ------------------------------------------------------------------
   Workflow mutation
------------------------------------------------------------------ */

export const addTask = async (
  workflowId,
  taskId,
  task,
  edges = []
) => {
  const workflow = requireWorkflow(workflowId);

  if (!taskId || typeof taskId !== "string") {
    throw new Error("Task ID must be a non-empty string");
  }

  if (hasTask(workflow, taskId)) {
    throw new Error(`Task already exists: ${taskId}`);
  }

  if (!isObject(task) || task.type !== "task") {
    throw new Error('Added node must have type "task"');
  }

  if (!Array.isArray(edges)) {
    throw new Error("Task edges must be an array");
  }

  const draft = structuredClone(workflow);
  const {status, attempts, ...definition} = task;

  draft.tasks[taskId] = {
    ...definition,
    status: "pending",
    attempts: []
  };

  draft.edges.push(...structuredClone(edges));

  validateGraph(draft);

  workflow.tasks = draft.tasks;
  workflow.edges = draft.edges;

  refreshWorkflow(workflow);

  await persistWorkflow(workflow);
  await recordEvent("workflow.task_added", {
    workflowId,
    taskId
  });

  return structuredClone(workflow);
}

export const removeTask = async (
  workflowId,
  taskId
) => {
  const workflow = requireWorkflow(workflowId);

  if (taskId === workflow.start || taskId === workflow.end) {
    throw new Error("Start and end nodes cannot be removed");
  }

  requireTask(workflow, taskId);

  const draft = structuredClone(workflow);

  delete draft.tasks[taskId];

  draft.edges = draft.edges
    .filter(([from, to]) =>
      from !== taskId && to !== taskId
    );

  validateGraph(draft);

  workflow.tasks = draft.tasks;
  workflow.edges = draft.edges;

  refreshWorkflow(workflow);

  await persistWorkflow(workflow);
  await recordEvent("workflow.task_removed", {
    workflowId,
    taskId
  });

  return structuredClone(workflow);
}

export const editTask = async (
  workflowId,
  taskId,
  changes
) => {
  if (!isObject(changes)) {
    throw new Error("Task changes must be an object");
  }

  const workflow = requireWorkflow(workflowId);
  const task = requireExecutableTask(workflow, taskId);
  const {
    status,
    attempts,
    type,
    ...editable
  } = changes;

  const draft = structuredClone(workflow);

  draft.tasks[taskId] = {
    ...draft.tasks[taskId],
    ...structuredClone(editable)
  };

  validateGraph(draft);

  workflow.tasks = draft.tasks;

  refreshWorkflow(workflow);

  await persistWorkflow(workflow);
  await recordEvent("workflow.task_edited", {
    workflowId,
    taskId
  });

  return structuredClone(workflow.tasks[taskId]);
}

export const skipTask = async (
  workflowId,
  taskId
) => {
  return setTaskStatus(workflowId, taskId, "skipped");
}

export const setWorkflowEdges = async (
  workflowId,
  edges
) => {
  if (!Array.isArray(edges)) {
    throw new Error("Workflow edges must be an array");
  }

  const workflow = requireWorkflow(workflowId);
  const draft = structuredClone(workflow);
  draft.edges = structuredClone(edges);

  validateGraph(draft);

  workflow.edges = draft.edges;

  refreshWorkflow(workflow);

  await persistWorkflow(workflow);
  await recordEvent("workflow.edges_changed", {
    workflowId
  });

  return structuredClone(workflow);
}

export const setWorkflowInputs = async (
  workflowId,
  inputs
) => {
  if (!isObject(inputs)) {
    throw new Error("Workflow inputs must be an object");
  }

  const workflow = requireWorkflow(workflowId);
  workflow.inputs = structuredClone(inputs);

  await persistWorkflow(workflow);
  await recordEvent("workflow.inputs_changed", {
    workflowId
  });

  return structuredClone(workflow);
}

export const setWorkflowConfig = async (
  workflowId,
  config
) => {
  if (!isObject(config)) {
    throw new Error("Workflow config must be an object");
  }

  const workflow = requireWorkflow(workflowId);
  workflow.config = structuredClone(config);

  await persistWorkflow(workflow);
  await recordEvent("workflow.config_changed", {
    workflowId
  });

  return structuredClone(workflow);
}

export const resumeWorkflow = async (
  workflowId,
  taskIds = null
) => {
  const workflow = requireWorkflow(workflowId);

  if (workflow.status === "cancelled") {
    throw new Error("Cancelled workflows must be restarted");
  }

  const selected = taskIds === null
      ? Object.keys(workflow.tasks)
      : taskIds;

  if (!Array.isArray(selected)) {
    throw new Error("Task IDs must be an array or null");
  }

  const resumed = [];

  for (const taskId of selected) {
    const task =   requireTask(workflow, taskId);

    if (task.type === "task" && task.status === "blocked") {
      task.status = "pending";
      resumed.push(taskId);
    }
  }

  workflow.status = "running";

  refreshWorkflow(workflow);

  await persistWorkflow(workflow);
  await recordEvent("workflow.resumed",
    {
      workflowId,
      taskIds: resumed
    }
  );

  return structuredClone(workflow);
}

export const restartWorkflow = async (
  workflowId
) => {
  const workflow = requireWorkflow(workflowId);

  for (const [taskId, task] of Object.entries(workflow.tasks)) {
    if (taskId === workflow.start) {
      task.status = "completed";
      continue;
    }

    if (taskId === workflow.end) {
      task.status = "pending";
      continue;
    }

    if (task.type === "task") {
      task.status = "pending";
      // Attempt history is intentionally preserved.
      task.attempts ??= [];
    }
  }

  workflow.status = "running";
  workflow.result = null;

  refreshWorkflow(workflow);

  await persistWorkflow(workflow);
  await recordEvent("workflow.restarted", {
    workflowId
  });

  return structuredClone(workflow);
}

export const cancelWorkflow = async (
  workflowId
) => {
  const workflow = requireWorkflow(workflowId);

  for (const task of Object.values(workflow.tasks)) {
    if (
      task.type === "task" &&
      !["completed","skipped"].includes(task.status)
    ) {
      task.status = "cancelled";
    }
  }

  if (workflow.tasks[workflow.end]) {
    workflow.tasks[workflow.end].status = "cancelled";
  }

  workflow.status = "cancelled";

  await persistWorkflow(workflow);
  await recordEvent("workflow.cancelled", {
    workflowId
  });

  return structuredClone(workflow);
}

export const setWorkflowResult = async (
  workflowId,
  result
) => {
  const workflow = requireWorkflow(workflowId);
  workflow.result = structuredClone(result);

  await persistWorkflow(workflow);
  await recordEvent("workflow.result_set", {
    workflowId
  });

  return structuredClone(workflow);
}