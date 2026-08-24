import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { recordEvent } from "./EventController.mjs";
import { validateGraph, validateProcessDefinition } from "../services/WorkflowGraphService.mjs";

export { validateGraph, validateProcessDefinition } from "../services/WorkflowGraphService.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const processesDir = resolve(here, "../../ObsidianVault/System/Processes");
const workflowsDir = resolve(here, "../../ObsidianVault/System/Workflows");
const processes = new Map();
const workflows = new Map();
const workflowWrites = new Map();
const deletedWorkflowIds = new Set();
const TASK_STATUSES = new Set([
  "pending",
  "ready",
  "running",
  "blocked",
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);
const RESUMABLE_TASK_STATUSES = new Set(["blocked", "failed", "cancelled"]);

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const validateFileName = (value, label) => {
  if (
    typeof value !== "string"
    || !value.trim()
    || value.trim() !== value
    || value === "."
    || value === ".."
    || /[<>:"/\\|?*\u0000-\u001F]/.test(value)
  ) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
};

const hasTask = (graph, taskId) => Object.prototype.hasOwnProperty.call(graph.tasks, taskId);

const uniqueEdges = edges => {
  const seen = new Set();

  return edges.filter(([from, to]) => {
    const key = `${from}\u0000${to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const createWorkflowId = () => {
  let id;
  do {
    const suffix = randomUUID().split("-").at(-1);
    id = `workflow-${suffix}`;
  } while (workflows.has(id));
  return id;
};

const validateWorkflow = workflow => {
  if (!isObject(workflow)) throw new Error("Workflow must be an object");
  validateFileName(workflow.id, "workflow ID");
  validateGraph(workflow);
  if (!workflow.status || typeof workflow.status !== "string") {
    throw new Error(`Workflow ${workflow.id} must have a status`);
  }
  if (workflow.layout != null && !isObject(workflow.layout)) {
    throw new Error(`Workflow ${workflow.id} layout must be an object`);
  }
};

const validateAttempt = attempt => {
  if (!isObject(attempt)) throw new Error("Task Attempt must be an object");
  if (!attempt.id || typeof attempt.id !== "string") throw new Error("Task Attempt must have an ID");
  if (!Number.isInteger(attempt.attempt) || attempt.attempt < 1) {
    throw new Error("Task Attempt must have a positive attempt number");
  }
  if (!attempt.status || typeof attempt.status !== "string") throw new Error("Task Attempt must have a status");
};

const processPath = name => {
  validateFileName(name, "process name");
  return resolve(processesDir, `${name}.md`);
};

const workflowPath = id => {
  validateFileName(id, "workflow ID");
  return resolve(workflowsDir, `${id}.json`);
};

const renderProcess = process => [
  `# ${process.name}`,
  "",
  "```json",
  JSON.stringify(process, null, 2),
  "```",
  "",
].join("\n");

const parseProcess = (content, filename) => {
  const match = content.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!match) throw new Error(`Process file ${filename} does not contain a Carlos Office JSON definition`);
  return JSON.parse(match[1]);
};

const persistWorkflow = async workflow => {
  const id = workflow.id;
  if (deletedWorkflowIds.has(id)) throw new Error(`Workflow ${id} was deleted`);

  const previous = workflowWrites.get(id) ?? Promise.resolve();
  const next = previous.then(async () => {
    if (deletedWorkflowIds.has(id)) return;
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(workflowPath(id), JSON.stringify(workflow, null, 2), "utf8");
  });

  workflowWrites.set(id, next);

  try {
    await next;
  } finally {
    if (workflowWrites.get(id) === next) workflowWrites.delete(id);
  }
};

const commitWorkflow = async workflow => {
  await persistWorkflow(workflow);
  if (deletedWorkflowIds.has(workflow.id)) throw new Error(`Workflow ${workflow.id} was deleted`);
  workflows.set(workflow.id, workflow);
};

const recordLoadFailure = async (type, filename, error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${type}] Could not load persisted record.`, { filename, message });

  try {
    await recordEvent(`${type}.load_failed`, { filename, error: message });
  } catch (eventError) {
    console.error(`[${type}] Could not record load failure.`, {
      filename,
      message: eventError instanceof Error ? eventError.message : String(eventError),
    });
  }
};

const requireWorkflow = id => {
  const workflow = workflows.get(id);
  if (!workflow) throw new Error(`Unknown workflow: ${id}`);
  return workflow;
};

const requirePendingWorkflow = id => {
  const workflow = requireWorkflow(id);
  if (workflow.status !== "pending") {
    throw new Error(`Workflow ${id} can only be structurally edited before its first run`);
  }
  return workflow;
};

const requireTask = (workflow, taskId) => {
  const task = workflow.tasks[taskId];
  if (!task) throw new Error(`Unknown task ${taskId} in workflow ${workflow.id}`);
  return task;
};

const requireExecutableTask = (workflow, taskId) => {
  const task = requireTask(workflow, taskId);
  if (task.type !== "task") throw new Error(`${taskId} is not an executable Task`);
  return task;
};

const incoming = (workflow, taskId) => workflow.edges.filter(([, to]) => to === taskId).map(([from]) => from);
const outgoing = (workflow, taskId) => workflow.edges.filter(([from]) => from === taskId).map(([, to]) => to);

const dependenciesComplete = (workflow, taskId) => {
  const dependencies = incoming(workflow, taskId);
  if (!dependencies.length) return false;
  return dependencies.every(dependencyId => ["completed", "skipped"].includes(workflow.tasks[dependencyId]?.status));
};

const refreshWorkflow = workflow => {
  if (["pending", "cancelled", "paused"].includes(workflow.status)) return;

  for (const [taskId, task] of Object.entries(workflow.tasks)) {
    if (task.type !== "task" || !["pending", "ready"].includes(task.status)) continue;
    task.status = dependenciesComplete(workflow, taskId) ? "ready" : "pending";
  }

  const endTask = workflow.tasks[workflow.end];
  if (endTask.status !== "completed" && dependenciesComplete(workflow, workflow.end)) endTask.status = "completed";

  if (endTask.status === "completed") {
    workflow.status = "completed";
    return;
  }

  const tasks = Object.values(workflow.tasks).filter(task => task.type === "task");
  if (tasks.some(task => ["running", "ready"].includes(task.status))) {
    workflow.status = "running";
    return;
  }
  if (tasks.some(task => task.status === "blocked")) {
    workflow.status = "blocked";
    return;
  }
  if (tasks.some(task => task.status === "failed")) {
    workflow.status = "failed";
    return;
  }

  workflow.status = "running";
};

const createRuntimeTasks = (tasks, start, end) => {
  const runtimeTasks = {};

  for (const [taskId, task] of Object.entries(tasks)) {
    if (taskId === start) {
      runtimeTasks[taskId] = { ...structuredClone(task), status: "completed" };
      continue;
    }
    if (taskId === end) {
      runtimeTasks[taskId] = { ...structuredClone(task), status: "pending" };
      continue;
    }

    runtimeTasks[taskId] = { ...structuredClone(task), status: "pending", attempts: [] };
  }

  return runtimeTasks;
};

const storeNewWorkflow = async workflow => {
  validateWorkflow(workflow);
  refreshWorkflow(workflow);
  await commitWorkflow(workflow);

  await recordEvent("workflow.created", { workflowId: workflow.id, process: workflow.process });
  if (workflow.status === "completed") await recordEvent("workflow.completed", { workflowId: workflow.id });
  return structuredClone(workflow);
};

export const loadProcesses = async () => {
  await mkdir(processesDir, { recursive: true });
  processes.clear();

  const files = await readdir(processesDir);
  for (const filename of files.filter(file => file.endsWith(".md"))) {
    try {
      const content = await readFile(resolve(processesDir, filename), "utf8");
      const process = parseProcess(content, filename);
      validateFileName(process.name, "process name");
      validateProcessDefinition(process);
      if (processes.has(process.name)) throw new Error(`Duplicate process name: ${process.name}`);
      processes.set(process.name, structuredClone(process));
    } catch (error) {
      await recordLoadFailure("process", filename, error);
    }
  }

  return listProcesses();
};

export const getProcess = name => {
  const process = processes.get(name);
  return process ? structuredClone(process) : null;
};

export const listProcesses = () => [...processes.values()].map(process => structuredClone(process));

export const saveProcess = async process => {
  validateFileName(process.name, "process name");
  validateProcessDefinition(process);
  const stored = structuredClone(process);

  await mkdir(processesDir, { recursive: true });
  await writeFile(processPath(stored.name), renderProcess(stored), "utf8");
  processes.set(stored.name, stored);
  await recordEvent("process.saved", { process: stored.name });
  return structuredClone(stored);
};

export const deleteProcess = async name => {
  validateFileName(name, "process name");
  if (!processes.has(name)) return false;

  await rm(processPath(name), { force: true });
  processes.delete(name);
  await recordEvent("process.deleted", { process: name });
  return true;
};

export const loadWorkflows = async () => {
  await mkdir(workflowsDir, { recursive: true });
  workflows.clear();
  deletedWorkflowIds.clear();

  const files = await readdir(workflowsDir);
  for (const filename of files.filter(file => file.endsWith(".json"))) {
    try {
      const workflow = JSON.parse(await readFile(resolve(workflowsDir, filename), "utf8"));
      validateWorkflow(workflow);
      if (workflows.has(workflow.id)) throw new Error(`Duplicate workflow ID: ${workflow.id}`);
      workflows.set(workflow.id, workflow);
    } catch (error) {
      await recordLoadFailure("workflow", filename, error);
    }
  }

  return listWorkflows();
};

export const getWorkflow = id => {
  const workflow = workflows.get(id);
  return workflow ? structuredClone(workflow) : null;
};

export const listWorkflows = () => [...workflows.values()].map(workflow => structuredClone(workflow));

export const createWorkflow = async (processName, inputs = {}, config = {}) => {
  const process = processes.get(processName);
  if (!process) throw new Error(`Unknown process: ${processName}`);
  if (!isObject(inputs)) throw new Error("Workflow inputs must be an object");
  if (!isObject(config)) throw new Error("Workflow config must be an object");

  const workflow = {
    id: createWorkflowId(),
    process: process.name,
    status: "pending",
    inputs: structuredClone(inputs),
    config: structuredClone(config),
    start: process.start,
    end: process.end,
    tasks: createRuntimeTasks(process.tasks, process.start, process.end),
    edges: structuredClone(process.edges),
    layout: structuredClone(process.layout ?? {}),
    result: null,
  };

  return storeNewWorkflow(workflow);
};

export const createAdHocWorkflow = async ({ start, end, tasks, edges, inputs = {}, config = {} }) => {
  if (!isObject(inputs)) throw new Error("Workflow inputs must be an object");
  if (!isObject(config)) throw new Error("Workflow config must be an object");

  const definition = { start, end, tasks, edges };
  validateGraph(definition);

  const workflow = {
    id: createWorkflowId(),
    process: null,
    status: "pending",
    inputs: structuredClone(inputs),
    config: structuredClone(config),
    start,
    end,
    tasks: createRuntimeTasks(tasks, start, end),
    edges: structuredClone(edges),
    layout: {},
    result: null,
  };

  return storeNewWorkflow(workflow);
};

export const startWorkflow = async workflowId => {
  const draft = structuredClone(requireWorkflow(workflowId));
  if (draft.status !== "pending") return structuredClone(draft);

  draft.status = "running";
  refreshWorkflow(draft);
  await commitWorkflow(draft);
  await recordEvent("workflow.started", { workflowId });
  return structuredClone(draft);
};

export const getReadyTasks = workflowId => {
  const workflow = requireWorkflow(workflowId);
  return Object.entries(workflow.tasks)
    .filter(([, task]) => task.type === "task" && task.status === "ready")
    .map(([id, task]) => ({ id, ...structuredClone(task) }));
};

export const setTaskStatus = async (workflowId, taskId, status) => {
  if (!TASK_STATUSES.has(status)) throw new Error(`Invalid task status: ${status}`);

  const draft = structuredClone(requireWorkflow(workflowId));
  const task = requireExecutableTask(draft, taskId);
  if (draft.status === "cancelled") throw new Error(`Workflow ${workflowId} is cancelled`);

  const previousWorkflowStatus = draft.status;
  task.status = status;
  refreshWorkflow(draft);
  await commitWorkflow(draft);
  await recordEvent(`task.${status}`, { workflowId, taskId });

  if (previousWorkflowStatus !== "completed" && draft.status === "completed") {
    await recordEvent("workflow.completed", { workflowId });
  }

  return structuredClone(task);
};

export const addTaskAttempt = async (workflowId, taskId, attempt) => {
  validateAttempt(attempt);

  const draft = structuredClone(requireWorkflow(workflowId));
  const task = requireExecutableTask(draft, taskId);
  task.attempts ??= [];

  if (task.attempts.some(existing => existing.id === attempt.id)) {
    throw new Error(`Task Attempt already exists: ${attempt.id}`);
  }
  if (task.attempts.some(existing => existing.attempt === attempt.attempt)) {
    throw new Error(`Task ${taskId} already has attempt number ${attempt.attempt}`);
  }

  task.attempts.push(structuredClone(attempt));
  await commitWorkflow(draft);
  return structuredClone(attempt);
};

export const getTaskAttempt = (workflowId, taskId, attemptId) => {
  const workflow = requireWorkflow(workflowId);
  const task = requireExecutableTask(workflow, taskId);
  const attempt = (task.attempts ?? []).find(item => item.id === attemptId);
  return attempt ? structuredClone(attempt) : null;
};

export const listTaskAttempts = (workflowId, taskId) => {
  const workflow = requireWorkflow(workflowId);
  const task = requireExecutableTask(workflow, taskId);
  return structuredClone(task.attempts ?? []);
};

export const updateTaskAttempt = async (workflowId, taskId, attemptId, changes) => {
  if (!isObject(changes)) throw new Error("Task Attempt changes must be an object");

  const draft = structuredClone(requireWorkflow(workflowId));
  const task = requireExecutableTask(draft, taskId);
  const index = (task.attempts ?? []).findIndex(attempt => attempt.id === attemptId);
  if (index === -1) throw new Error(`Unknown Task Attempt: ${attemptId}`);

  const current = task.attempts[index];
  const updated = {
    ...current,
    ...structuredClone(changes),
    id: current.id,
    attempt: current.attempt,
  };

  validateAttempt(updated);
  task.attempts[index] = updated;
  await commitWorkflow(draft);
  return structuredClone(updated);
};

export const addTask = async (workflowId, taskId, task, edges = []) => {
  if (!taskId || typeof taskId !== "string") throw new Error("Task ID must be a non-empty string");
  if (!isObject(task) || task.type !== "task") throw new Error('Added node must have type "task"');
  if (!Array.isArray(edges)) throw new Error("Task edges must be an array");

  const draft = structuredClone(requirePendingWorkflow(workflowId));
  if (hasTask(draft, taskId)) throw new Error(`Task already exists: ${taskId}`);

  const { status: _status, attempts: _attempts, ...definition } = task;
  draft.tasks[taskId] = { ...definition, status: "pending", attempts: [] };
  draft.edges.push(...structuredClone(edges));
  validateGraph(draft);

  await commitWorkflow(draft);
  await recordEvent("workflow.task_added", { workflowId, taskId });
  return structuredClone(draft);
};

export const removeTask = async (workflowId, taskId) => {
  const draft = structuredClone(requirePendingWorkflow(workflowId));
  if (taskId === draft.start || taskId === draft.end) {
    throw new Error("Start and end nodes cannot be removed");
  }
  requireTask(draft, taskId);

  const predecessors = incoming(draft, taskId);
  const successors = outgoing(draft, taskId);
  delete draft.tasks[taskId];
  if (draft.layout) delete draft.layout[taskId];
  draft.edges = draft.edges.filter(([from, to]) => from !== taskId && to !== taskId);

  for (const predecessor of predecessors) {
    for (const successor of successors) {
      if (predecessor !== successor) draft.edges.push([predecessor, successor]);
    }
  }

  draft.edges = uniqueEdges(draft.edges);
  validateGraph(draft);
  await commitWorkflow(draft);
  await recordEvent("workflow.task_removed", { workflowId, taskId });
  return structuredClone(draft);
};

export const editTask = async (workflowId, taskId, changes) => {
  if (!isObject(changes)) throw new Error("Task changes must be an object");

  const draft = structuredClone(requirePendingWorkflow(workflowId));
  requireExecutableTask(draft, taskId);
  const { status: _status, attempts: _attempts, type: _type, ...editable } = changes;
  draft.tasks[taskId] = { ...draft.tasks[taskId], ...structuredClone(editable) };
  validateGraph(draft);

  await commitWorkflow(draft);
  await recordEvent("workflow.task_edited", { workflowId, taskId });
  return structuredClone(draft.tasks[taskId]);
};

export const skipTask = async (workflowId, taskId) => setTaskStatus(workflowId, taskId, "skipped");

export const cancelTask = async (workflowId, taskId) => {
  const draft = structuredClone(requireWorkflow(workflowId));
  const task = requireExecutableTask(draft, taskId);
  if (["completed", "skipped", "failed", "cancelled"].includes(task.status)) {
    throw new Error(`Task ${taskId} cannot be cancelled from status ${task.status}`);
  }

  task.status = "cancelled";
  draft.status = "paused";
  await commitWorkflow(draft);
  await recordEvent("task.cancelled", { workflowId, taskId, requestedBy: "Carlos" });
  await recordEvent("workflow.paused", { workflowId, taskId });
  return structuredClone(draft);
};

export const setWorkflowEdges = async (workflowId, edges) => {
  if (!Array.isArray(edges)) throw new Error("Workflow edges must be an array");

  const draft = structuredClone(requirePendingWorkflow(workflowId));
  draft.edges = structuredClone(edges);
  validateGraph(draft);

  await commitWorkflow(draft);
  await recordEvent("workflow.edges_changed", { workflowId });
  return structuredClone(draft);
};

export const setWorkflowLayout = async (workflowId, layout) => {
  if (!isObject(layout)) throw new Error("Workflow layout must be an object");

  const draft = structuredClone(requireWorkflow(workflowId));
  if (draft.status === "running") throw new Error("Stop the Workflow before changing its layout");

  const normalized = {};
  for (const [taskId, position] of Object.entries(layout)) {
    if (!hasTask(draft, taskId)) throw new Error(`Workflow layout references unknown Task: ${taskId}`);
    if (!isObject(position)) throw new Error(`Invalid Workflow position for Task: ${taskId}`);
    const x = Number(position.x);
    const y = Number(position.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      throw new Error(`Invalid Workflow position for Task: ${taskId}`);
    }
    normalized[taskId] = { x: Math.round(x), y: Math.round(y) };
  }

  draft.layout = normalized;
  await commitWorkflow(draft);
  await recordEvent("workflow.layout_changed", { workflowId });
  return structuredClone(draft);
};

export const setWorkflowInputs = async (workflowId, inputs) => {
  if (!isObject(inputs)) throw new Error("Workflow inputs must be an object");

  const draft = structuredClone(requireWorkflow(workflowId));
  draft.inputs = structuredClone(inputs);
  await commitWorkflow(draft);
  await recordEvent("workflow.inputs_changed", { workflowId });
  return structuredClone(draft);
};

export const setWorkflowConfig = async (workflowId, config) => {
  if (!isObject(config)) throw new Error("Workflow config must be an object");

  const draft = structuredClone(requireWorkflow(workflowId));
  draft.config = structuredClone(config);
  await commitWorkflow(draft);
  await recordEvent("workflow.config_changed", { workflowId });
  return structuredClone(draft);
};

export const pauseWorkflow = async workflowId => {
  const draft = structuredClone(requireWorkflow(workflowId));
  if (draft.status === "completed") throw new Error("Completed workflows cannot be stopped");
  if (draft.status === "cancelled") throw new Error("Cancelled workflows must be restarted");
  if (draft.status === "paused") return structuredClone(draft);
  if (draft.status === "pending") return structuredClone(draft);

  for (const task of Object.values(draft.tasks)) {
    if (task.type === "task" && task.status === "running") task.status = "pending";
  }

  draft.status = "paused";
  await commitWorkflow(draft);
  await recordEvent("workflow.paused", { workflowId });
  return structuredClone(draft);
};

export const resumeWorkflow = async (workflowId, taskIds = null) => {
  const draft = structuredClone(requireWorkflow(workflowId));
  if (draft.status === "pending") return startWorkflow(workflowId);
  if (draft.status === "completed") throw new Error("Completed workflows must be restarted");
  if (draft.status === "cancelled") throw new Error("Cancelled workflows must be restarted");

  const selected = taskIds === null
    ? Object.entries(draft.tasks)
      .filter(([, task]) => task.type === "task" && RESUMABLE_TASK_STATUSES.has(task.status))
      .map(([taskId]) => taskId)
    : taskIds;
  if (!Array.isArray(selected)) throw new Error("Task IDs must be an array or null");

  const resumed = [];
  for (const taskId of selected) {
    const task = requireExecutableTask(draft, taskId);
    if (!RESUMABLE_TASK_STATUSES.has(task.status)) {
      throw new Error(`Task ${taskId} cannot resume from status ${task.status}`);
    }
    task.status = "pending";
    resumed.push(taskId);
  }

  draft.status = "running";
  refreshWorkflow(draft);
  await commitWorkflow(draft);
  await recordEvent("workflow.resumed", { workflowId, taskIds: resumed });
  return structuredClone(draft);
};

export const restartWorkflow = async workflowId => {
  const draft = structuredClone(requireWorkflow(workflowId));

  for (const [taskId, task] of Object.entries(draft.tasks)) {
    if (taskId === draft.start) {
      task.status = "completed";
      continue;
    }
    if (taskId === draft.end) {
      task.status = "pending";
      continue;
    }
    if (task.type === "task") {
      task.status = "pending";
      task.attempts ??= [];
    }
  }

  draft.status = "running";
  draft.result = null;
  refreshWorkflow(draft);
  await commitWorkflow(draft);
  await recordEvent("workflow.restarted", { workflowId });
  return structuredClone(draft);
};

export const cancelWorkflow = async workflowId => {
  const draft = structuredClone(requireWorkflow(workflowId));

  for (const task of Object.values(draft.tasks)) {
    if (task.type === "task" && !["completed", "skipped"].includes(task.status)) task.status = "cancelled";
  }
  if (draft.tasks[draft.end]) draft.tasks[draft.end].status = "cancelled";
  draft.status = "cancelled";

  await commitWorkflow(draft);
  await recordEvent("workflow.cancelled", { workflowId });
  return structuredClone(draft);
};

export const deleteWorkflow = async workflowId => {
  validateFileName(workflowId, "workflow ID");
  if (!workflows.has(workflowId)) return false;

  deletedWorkflowIds.add(workflowId);
  workflows.delete(workflowId);

  const pending = workflowWrites.get(workflowId);
  if (pending) await pending.catch(() => {});
  await rm(workflowPath(workflowId), { force: true });
  workflowWrites.delete(workflowId);
  await recordEvent("workflow.deleted", { workflowId });
  return true;
};

export const setWorkflowResult = async (workflowId, result) => {
  const draft = structuredClone(requireWorkflow(workflowId));
  draft.result = structuredClone(result);
  await commitWorkflow(draft);
  await recordEvent("workflow.result_set", { workflowId });
  return structuredClone(draft);
};