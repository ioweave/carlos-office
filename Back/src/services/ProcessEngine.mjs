import { createHash, randomUUID } from "node:crypto";

import { importArtifact } from "../controllers/ArtifactController.mjs";
import { listEvents, recordEvent } from "../controllers/EventController.mjs";
import {
  addTaskAttempt,
  getTaskAttempt,
  getWorkflow,
  listTaskAttempts,
  resumeWorkflow,
  setTaskStatus,
  updateTaskAttempt,
  updateTaskAttemptRuntime,
  withWorkflowTransition,
} from "../controllers/ProcessController.mjs";
import { getSkill, listSkills } from "../registry/Skills.mjs";
import { getTool, listTools } from "../registry/Tools.mjs";
import {
  cancelTaskAgents,
  cancelWorkflowAgents,
  listActiveAgents,
  runAgentProcess,
  stopAllAgents,
} from "../runtime/AgentProcesses.mjs";
import { appendInvocationJournal, clearInvocationJournal } from "./InvocationJournalService.mjs";
import { runLangGraphWorkflow } from "./LangGraphWorkflowRuntime.mjs";
import { toolCanReplay } from "./ToolExecutionService.mjs";
import { taskAllowsTools, validateAtomicTaskDefinition } from "./TaskAtomicity.mjs";
import { executeTaskWithGroups, materializeMapData } from "./TaskExecutionService.mjs";
import { getTaskExecutionGroups } from "./WorkflowGraphService.mjs";

const activeRuns = new Map();
const ORPHANED_ATTEMPT_REASON = "Previous Agent process is no longer active";
const DEFAULT_MAX_ATTEMPTS = 3;
const RECOVERABLE_FAILURE_CODES = new Set([
  "provider_error",
  "provider_transient_error",
  "provider_inference_timeout",
  "invalid_completion_repair",
  "agent_process_error",
  "agent_process_exit",
  "task_inactivity_timeout",
]);
const HALTED_WORKFLOW_STATUSES = new Set(["blocked", "cancelled", "failed", "paused", "stalled"]);

class WorkflowHaltError extends Error {
  constructor(workflowId, taskId, status) {
    super(`Workflow ${workflowId} halted at Task ${taskId} with status ${status}`);
    this.name = "WorkflowHaltError";
    this.code = "workflow_halted";
    this.workflowId = workflowId;
    this.taskId = taskId;
    this.status = status;
  }
}

const errorMessage = error => error instanceof Error ? error.message : String(error);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const failureDiagnostics = (error, phase = "process", code = "execution_failure") => {
  if (isObject(error?.diagnostics)) return structuredClone(error.diagnostics);
  if (isObject(error)) {
    return {
      phase: typeof error.phase === "string" && error.phase ? error.phase : phase,
      code: typeof error.code === "string" && error.code ? error.code : code,
      message: typeof error.message === "string" && error.message ? error.message : errorMessage(error),
      ...(typeof error.retryable === "boolean" ? { retryable: error.retryable } : {}),
      ...(Array.isArray(error.toolFailures) ? { toolFailures: structuredClone(error.toolFailures) } : {}),
    };
  }
  return { phase, code, message: errorMessage(error) };
};

const selectionFrom = (value, validateModelSelection, models = []) => {
  if (!value?.provider && !value?.model) return null;
  if (!value?.provider || !value?.model) throw new Error("Provider and model must be configured together");
  try { return validateModelSelection(value); } catch (error) {
    const matches = models.filter(entry => entry.models?.includes(value.model));
    if (matches.length === 1) return validateModelSelection({ provider: matches[0].provider, model: value.model });
    throw error;
  }
};

const incomingTaskIds = (workflow, taskId) => workflow.edges
  .filter(([, to]) => to === taskId)
  .map(([from]) => from)
  .filter(id => workflow.tasks?.[id]?.type === "task");

const ancestorTaskIds = (workflow, taskId) => {
  const reverse = new Map(Object.keys(workflow.tasks ?? {}).map(id => [id, []]));
  for (const [from, to] of workflow.edges ?? []) reverse.get(to)?.push(from);
  const result = new Set();
  const pending = [...(reverse.get(taskId) ?? [])];
  while (pending.length) {
    const id = pending.pop();
    if (result.has(id)) continue;
    result.add(id);
    for (const parent of reverse.get(id) ?? []) pending.push(parent);
  }
  return [...result].filter(id => workflow.tasks[id]?.type === "task");
};

const latestCompletedAttempt = task => task.status !== "completed" ? null : [...(task.attempts ?? [])]
  .reverse()
  .find(attempt => attempt.status === "completed") ?? null;
const attemptValue = attempt => attempt?.data != null ? attempt.data : attempt?.output;

const getPath = (value, path) => {
  const parts = String(path || "").split(".").map(part => part.trim()).filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
};

const mapInputPath = (value, path) => {
  if (!path) return value;
  if (value?.__carlosOfficeMap && Array.isArray(value.items)) {
    return { ...value, items: value.items.map(item => item.status !== "completed" ? item : {
      ...item, data: mapInputPath(item.data ?? item.output, path), output: null,
    }) };
  }
  const [part, ...rest] = path.split(".");
  const next = value != null && typeof value === "object" && Object.hasOwn(value, part) ? value[part] : undefined;
  return rest.length ? mapInputPath(next, rest.join(".")) : next;
};

const setPath = (target, path, value) => {
  const parts = String(path || "").split(".").map(part => part.trim()).filter(Boolean);
  if (!parts.length) return;
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (["__proto__", "constructor", "prototype"].includes(part)) throw new Error("Unsafe Task input path");
    if (!Object.hasOwn(current, part) || !isObject(current[part])) current[part] = {};
    current = current[part];
  }
  Object.defineProperty(current, parts.at(-1), { value: structuredClone(value), enumerable: true, writable: true, configurable: true });
};

const upstreamValue = (workflow, taskId, reference, retainedMapIds) => {
  const ancestors = ancestorTaskIds(workflow, taskId);
  const producerId = ancestors.includes(reference) ? reference : ancestors.find(id => workflow.tasks[id]?.output === reference);
  if (!producerId) return undefined;
  return materializeMapData(attemptValue(latestCompletedAttempt(workflow.tasks[producerId])), retainedMapIds);
};

const resolveInputPath = (workflow, taskId, path, retainedMapIds) => {
  if (path === "workflow") return materializeMapData(structuredClone(workflow.inputs ?? {}), retainedMapIds);
  if (path.startsWith("workflow.")) return getPath(workflow.inputs ?? {}, path.slice("workflow.".length));
  if (path === "upstream") {
    return Object.fromEntries(ancestorTaskIds(workflow, taskId).flatMap(id => {
      const value = upstreamValue(workflow, taskId, id, retainedMapIds);
      return value === undefined ? [] : [[id, value]];
    }));
  }
  if (path.startsWith("upstream.")) {
    const parts = path.slice("upstream.".length).split(".");
    const value = upstreamValue(workflow, taskId, parts.shift(), retainedMapIds);
    return parts.length ? mapInputPath(value, parts.join(".")) : value;
  }

  const workflowValue = getPath(workflow.inputs ?? {}, path);
  if (workflowValue !== undefined) return workflowValue;
  const [reference, ...rest] = path.split(".");
  const value = upstreamValue(workflow, taskId, reference, retainedMapIds);
  return rest.length ? mapInputPath(value, rest.join(".")) : value;
};

const resolveTaskInput = (workflow, taskId, task) => {
  const retainedMapIds = new Set(
    getTaskExecutionGroups(workflow, taskId)
      .filter(group => group.type === "map")
      .map(group => group.id),
  );

  if (Array.isArray(task.inputs)) {
    const selected = {};
    const maps = getTaskExecutionGroups(workflow, taskId).filter(group => group.type === "map");
    const localNames = new Set(maps.flatMap(group => [group.itemAs || "item", group.indexAs || "index"]));
    const paths = new Set([...task.inputs, ...maps.map(group => group.source)]);
    for (const name of paths) {
      if (localNames.has(name.split(".")[0])) continue;
      const value = resolveInputPath(workflow, taskId, name, retainedMapIds);
      if (value === undefined) throw new Error(`Task input "${name}" could not be resolved before execution`);
      setPath(selected, name, value);
    }
    return selected;
  }

  const upstream = {};
  for (const upstreamId of incomingTaskIds(workflow, taskId)) {
    const value = upstreamValue(workflow, taskId, upstreamId, retainedMapIds);
    if (value !== undefined) upstream[upstreamId] = structuredClone(value);
  }
  return {
    ...(task.operation === "legacy"
      ? { workflow: materializeMapData(structuredClone(workflow.inputs ?? {}), retainedMapIds) }
      : {}),
    upstream,
    runtime: {},
  };
};

const loadTools = names => names.map(name => {
  const tool = getTool(name);
  if (!tool) throw new Error(`Unknown Tool: ${name}`);
  return tool;
});
const loadSkills = names => names.map(name => {
  const skill = getSkill(name);
  if (!skill) throw new Error(`Unknown Skill: ${name}`);
  return skill;
});

const finishAttempt = async (workflowId, taskId, attemptId, changes) => {
  const result = await updateTaskAttempt(workflowId, taskId, attemptId, {
    ...changes,
    endedAt: new Date().toISOString(),
  });
  await clearInvocationJournal(workflowId, taskId, attemptId);
  return result;
};

const settleAttemptAndTask = async (workflowId, taskId, attemptId, changes, taskStatus) => {
  const updated = updateTaskAttemptRuntime(workflowId, taskId, attemptId, {
    ...changes,
    endedAt: new Date().toISOString(),
  });
  await setTaskStatus(workflowId, taskId, taskStatus);
  await clearInvocationJournal(workflowId, taskId, attemptId);
  return updated;
};

const liveAgentForTask = (workflowId, taskId) => listActiveAgents().find(
  agent => agent.context?.workflowId === workflowId && agent.taskId === taskId,
) ?? null;

const closeOrphanedRunningAttempts = async (workflowId, taskId, task) => {
  const runningAttempts = (task.attempts ?? []).filter(attempt => attempt.status === "running");
  if (!runningAttempts.length) return;
  const liveAgent = liveAgentForTask(workflowId, taskId);
  if (liveAgent) throw new Error(`Task ${taskId} already has active Agent ${liveAgent.id}`);

  for (const attempt of runningAttempts) {
    const diagnostics = {
      phase: "process",
      code: "orphaned_agent_process",
      message: ORPHANED_ATTEMPT_REASON,
      retryable: true,
    };
    await finishAttempt(workflowId, taskId, attempt.id, {
      status: "failed",
      error: ORPHANED_ATTEMPT_REASON,
      diagnostics,
      blockedReason: null,
    });
    await recordEvent("attempt.orphaned", { workflowId, taskId, attemptId: attempt.id, diagnostics });
  }
};

const failSetup = async (workflowId, taskId, error) => {
  const message = errorMessage(error);
  const diagnostics = failureDiagnostics(error, "setup", "task_setup_failure");
  await withWorkflowTransition(workflowId, async () => {
    const workflow = getWorkflow(workflowId);
    const task = workflow?.tasks?.[taskId];
    if (["paused", "cancelled"].includes(workflow?.status)) return;
    if (!task || task.type !== "task" || ["completed", "cancelled", "failed"].includes(task.status)) return;
    const now = new Date().toISOString();
    const previousAttempts = listTaskAttempts(workflowId, taskId);
    await addTaskAttempt(workflowId, taskId, {
      id: `attempt-${randomUUID()}`,
      workflowId,
      taskId,
      attempt: previousAttempts.length + 1,
      agentId: null,
      pid: null,
      provider: task.provider ?? null,
      model: task.model ?? null,
      status: "failed",
      phase: "setup",
      input: null,
      tools: Array.isArray(task.tools) ? [...task.tools] : [],
      skills: Array.isArray(task.skills) ? [...task.skills] : [],
      startedAt: now,
      endedAt: now,
      output: null,
      data: null,
      artifacts: [],
      invocations: [],
      error: message,
      diagnostics,
      blockedReason: null,
    });
    await setTaskStatus(workflowId, taskId, "failed");
  });
  await recordEvent("task.execution_failed", { workflowId, taskId, error: message, diagnostics });
};

export const selectTaskExecution = async ({
  workflowId,
  taskId,
  noraSelection,
  models = [],
  validateModelSelection,
}) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown Workflow: ${workflowId}`);
  const task = workflow.tasks?.[taskId];
  if (!task || task.type !== "task") throw new Error(`Unknown executable Task: ${taskId}`);
  validateAtomicTaskDefinition(taskId, task);

  const toolsAllowed = taskAllowsTools(task.operation);
  const availableModels = models.map(entry => ({ provider: entry.provider, models: [...(entry.models ?? [])] }));
  const toolNames = new Set(listTools().map(tool => tool.name));
  const skillNames = new Set(listSkills().map(skill => skill.name));
  const selectedModel = selectionFrom(task, validateModelSelection, availableModels)
    ?? selectionFrom(noraSelection, validateModelSelection, availableModels);
  if (!selectedModel) throw new Error(`Task ${taskId} has no deterministic model selection`);

  const selectedTools = toolsAllowed && Array.isArray(task.tools) ? [...task.tools] : [];
  const selectedSkills = Array.isArray(task.skills) ? [...task.skills] : [];
  if (selectedTools.some(name => !toolNames.has(name))) throw new Error("Task requires an unknown Tool");
  if (selectedSkills.some(name => !skillNames.has(name))) throw new Error("Task requires an unknown Skill");
  if (selectedTools.length > 1) throw new Error("Atomic Task execution may select at most one Tool");
  if (!toolsAllowed && selectedTools.length) throw new Error(`Task operation ${task.operation} cannot use Tools`);
  return { ...selectedModel, tools: [...new Set(selectedTools)], skills: [...new Set(selectedSkills)] };
};

const importDeclaredArtifacts = async (workflow, completion) => {
  const declarations = Array.isArray(completion.artifactDeclarations) ? completion.artifactDeclarations : [];
  if (!declarations.length) return { output: completion.output, data: completion.data ?? null, artifacts: [] };
  const conversationId = workflow?.config?.conversationId;
  if (!conversationId) return { output: completion.output, data: completion.data ?? null, artifacts: [] };

  const artifacts = [];
  for (const declaration of declarations) {
    if (!isObject(declaration) || typeof declaration.path !== "string" || !declaration.path.trim()) {
      throw new Error("Agent declared an invalid Artifact path");
    }
    const artifact = await importArtifact({
      conversationId,
      sourcePath: declaration.path,
      preserveSource: true,
      name: declaration.name ?? null,
      type: declaration.type ?? null,
      createdBy: declaration.createdBy || "Temporary Agent",
    });
    artifacts.push(artifact.id);
  }
  return { output: completion.output, data: completion.data ?? null, artifacts };
};

const appendInvocation = (workflowId, taskId, attemptId, invocation) => withWorkflowTransition(
  workflowId,
  async () => {
    const current = getTaskAttempt(workflowId, taskId, attemptId);
    if (!current) return null;
    await appendInvocationJournal({ workflowId, taskId, attemptId, invocation });
    return updateTaskAttemptRuntime(workflowId, taskId, attemptId, {
      invocations: [...(current.invocations ?? []).filter(item => item.id !== invocation.id), structuredClone(invocation)],
    });
  },
);

const toolCallIsSafeToReplay = call => call?.sideEffect === "none" || call?.replaySafe === true
  || (call?.replaySafe === undefined && typeof call?.tool === "string" && toolCanReplay(getTool(call.tool), call.input));

const resultCanRetrySafely = result => {
  if (result?.status !== "failed") return false;
  const diagnostics = result.diagnostics ?? {};
  if (diagnostics.retryable !== true && !RECOVERABLE_FAILURE_CODES.has(diagnostics.code)) return false;
  return (result.toolCalls ?? []).every(toolCallIsSafeToReplay);
};

const runTaskAttempt = async ({ workflowId, taskId, execution, runState, decide, noraSelection }) => {
  const tools = loadTools(execution.tools);
  const skills = loadSkills(execution.skills);
  const prepared = await withWorkflowTransition(workflowId, async () => {
    let workflow = getWorkflow(workflowId);
    let task = workflow?.tasks?.[taskId];
    if (!task || task.type !== "task") throw new Error(`Unknown executable Task: ${taskId}`);
    if (runState.cancelled || ["paused", "cancelled"].includes(workflow.status)) return null;

    if (task.status === "running") {
      await closeOrphanedRunningAttempts(workflowId, taskId, task);
      await setTaskStatus(workflowId, taskId, "pending");
      workflow = getWorkflow(workflowId);
      task = workflow.tasks[taskId];
    } else if (task.status === "pending") {
      await setTaskStatus(workflowId, taskId, "pending");
      workflow = getWorkflow(workflowId);
      task = workflow.tasks[taskId];
    }
    if (task.status !== "ready") throw new WorkflowHaltError(workflowId, taskId, task.status);
    if (liveAgentForTask(workflowId, taskId)) throw new Error(`Task ${taskId} already has an active Agent process`);

    const input = resolveTaskInput(workflow, taskId, task);
    const previousAttempts = listTaskAttempts(workflowId, taskId);
    const checkpointAttempt = task.resumeCheckpointAttemptId
      ? previousAttempts.find(item => item.id === task.resumeCheckpointAttemptId) ?? null
      : null;
    const runAttempt = (runState.attemptsByTask.get(taskId) ?? 0) + 1;
    runState.attemptsByTask.set(taskId, runAttempt);
    const attempt = {
      id: `attempt-${randomUUID()}`,
      workflowId,
      taskId,
      attempt: previousAttempts.length + 1,
      runAttempt,
      authorizationRunId: checkpointAttempt?.authorizationRunId ?? `authorization-${randomUUID()}`,
      agentId: null,
      pid: null,
      provider: execution.provider,
      model: execution.model,
      status: "running",
      input: structuredClone(input),
      tools: [...execution.tools],
      skills: [...execution.skills],
      execution: structuredClone(task.execution ?? {}),
      executionGroups: getTaskExecutionGroups(workflow, taskId),
      startedAt: new Date().toISOString(),
      endedAt: null,
      output: null,
      data: null,
      artifacts: [],
      invocations: structuredClone(checkpointAttempt?.invocations ?? []),
      error: null,
      diagnostics: null,
      blockedReason: null,
      checkpointFromAttemptId: checkpointAttempt?.id ?? null,
    };
    await addTaskAttempt(workflowId, taskId, attempt);
    await setTaskStatus(workflowId, taskId, "running");
    return { attempt, input, task: structuredClone(task), workflow, checkpointAttempt };
  });

  if (!prepared) return null;
  const { attempt, input, task, workflow, checkpointAttempt } = prepared;
  await recordEvent("attempt.started", {
    workflowId,
    taskId,
    attemptId: attempt.id,
    provider: execution.provider,
    model: execution.model,
    runAttempt: attempt.runAttempt,
    runtime: "langgraph",
  });

  let result;
  try {
    result = await executeTaskWithGroups({
      workflow,
      taskId,
      task,
      input,
      checkpointInvocations: checkpointAttempt?.invocations ?? [],
      isCancelled: () => Boolean(runState.cancelled || getWorkflow(workflowId)?.status === "paused"),
      canRetryInvocation: resultCanRetrySafely,
      canReplayInterrupted: tools.every(tool => tool.replay === "safe"),
      recordInvocation: invocation => appendInvocation(workflowId, taskId, attempt.id, invocation),
      runAgent: ({ invocationId, authorizationScope, input: invocationInput }) => runAgentProcess({
        workflowId,
        taskId,
        attemptId: attempt.id,
        invocationId,
        authorizationScope: `${attempt.authorizationRunId}:${authorizationScope}`,
        task: { ...task, input: invocationInput },
        provider: execution.provider,
        model: execution.model,
        tools,
        skills,
      }),
      review: ({ group, iteration, candidate }) => decide(
        [
          "Review one Loop candidate against the Task completion criteria and Loop criteria.",
          "Reject incomplete, unsupported, or materially incorrect work.",
          "Return only the configured Loop review JSON schema.",
        ].join("\n"),
        {
          workflow: { id: workflow.id, process: workflow.process },
          task: { id: taskId, name: task.name ?? taskId, objective: task.objective, completion: task.completion ?? "" },
          loop: { ...group, iteration },
          candidate,
        },
        noraSelection,
        runState.controller.signal,
      ),
    });
  } catch (error) {
    result = {
      status: "failed",
      error: errorMessage(error),
      diagnostics: failureDiagnostics(error, "process", "task_execution_failure"),
      agentId: null,
      pid: null,
    };
  }

  let completion = { output: result.output, data: result.data ?? null, artifacts: [] };
  if (result.status === "completed") {
    try { completion = await importDeclaredArtifacts(getWorkflow(workflowId), result); } catch (error) {
      const message = `Could not register Task Artifact: ${errorMessage(error)}`;
      result = {
        ...result,
        status: "failed",
        error: message,
        diagnostics: { phase: "artifact", code: "artifact_registration_failure", message },
      };
    }
  }

  const runtime = { agentId: result.agentId ?? null, pid: result.pid ?? null };
  const outcome = await withWorkflowTransition(workflowId, async () => {
    const current = getWorkflow(workflowId);
    const currentTask = current?.tasks?.[taskId];
    if (!currentTask) throw new Error(`Unknown executable Task: ${taskId}`);
    const executionWasCancelled = runState.cancelled
      || currentTask.status === "cancelled"
      || result.status === "cancelled"
      || ["cancelled", "paused"].includes(current.status);

    if (executionWasCancelled) {
      return {
        event: "attempt.cancelled",
        attempt: await finishAttempt(workflowId, taskId, attempt.id, {
          ...runtime,
          status: "cancelled",
          error: result.error ?? "Workflow stopped",
          diagnostics: null,
        }),
      };
    }
    if (result.status === "completed") {
      const completed = await settleAttemptAndTask(workflowId, taskId, attempt.id, {
        ...runtime,
        status: "completed",
        output: completion.output,
        data: completion.data,
        artifacts: completion.artifacts,
        error: null,
        diagnostics: null,
        blockedReason: null,
      }, "completed");
      return { event: "attempt.completed", attempt: completed };
    }
    if (result.status === "blocked") {
      const reason = result.error || "Carlos approval required";
      const blocked = await settleAttemptAndTask(workflowId, taskId, attempt.id, {
        ...runtime,
        status: "blocked",
        error: null,
        diagnostics: null,
        blockedReason: reason,
        approvalId: result.approvalId ?? null,
      }, "blocked");
      return { event: "attempt.blocked", attempt: blocked, approvalId: result.approvalId ?? null };
    }

    const message = result.error || "Agent process failed";
    const diagnostics = failureDiagnostics({ ...result, message, diagnostics: result.diagnostics }, "process", "agent_process_failure");
    const maxAttempts = task.execution?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const canRetry = attempt.runAttempt < maxAttempts && resultCanRetrySafely({ ...result, diagnostics });
    if (canRetry) {
      const failed = await settleAttemptAndTask(workflowId, taskId, attempt.id, {
        ...runtime,
        status: "failed",
        error: message,
        diagnostics: { ...diagnostics, recovery: "automatic_retry", runAttempt: attempt.runAttempt, maxAttempts },
      }, "failed");
      await resumeWorkflow(workflowId, [taskId]);
      return { event: "attempt.retry_scheduled", attempt: failed, retry: true, error: message, diagnostics };
    }

    const failed = await settleAttemptAndTask(workflowId, taskId, attempt.id, {
      ...runtime,
      status: "failed",
      error: message,
      diagnostics,
    }, "failed");
    return { event: "attempt.failed", attempt: failed, error: message, diagnostics };
  });

  await recordEvent(outcome.event, {
    workflowId,
    taskId,
    attemptId: attempt.id,
    agentId: runtime.agentId,
    artifacts: outcome.attempt?.artifacts ?? [],
    ...(outcome.retry ? { retry: true } : {}),
    ...(outcome.approvalId ? { approvalId: outcome.approvalId } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
    ...(outcome.diagnostics ? { diagnostics: outcome.diagnostics } : {}),
  });
  return outcome.attempt;
};

const workflowDefinitionFingerprint = workflow => createHash("sha256")
  .update(JSON.stringify({
    executionRevision: workflow.executionRevision ?? 0,
    inputs: workflow.inputs ?? {},
    start: workflow.start,
    end: workflow.end,
    edges: workflow.edges,
    groups: workflow.groups ?? [],
    tasks: Object.fromEntries(Object.entries(workflow.tasks ?? {}).map(([taskId, task]) => {
      const {
        status: _status,
        attempts: _attempts,
        blockedReason: _blockedReason,
        error: _error,
        resumeCheckpointAttemptId: _resumeCheckpointAttemptId,
        resultAttemptId: _resultAttemptId,
        ...definition
      } = task;
      return [taskId, definition];
    })),
  }))
  .digest("hex")
  .slice(0, 16);

const workflowRunMarker = workflowId => {
  const events = [
    ...listEvents({ type: "workflow.started", workflowId }),
    ...listEvents({ type: "workflow.restarted", workflowId }),
  ].filter(event => event.at).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return events.at(-1)?.at ?? "initial";
};

const executeTaskNode = async ({ workflowId, taskId, runState, decide, getNoraSelection, models, validateModelSelection }) => {
  let workflow = getWorkflow(workflowId);
  const currentTask = workflow?.tasks?.[taskId];
  if (!currentTask) throw new Error(`Unknown executable Task: ${taskId}`);
  if (["completed", "skipped"].includes(currentTask.status)) return attemptValue(latestCompletedAttempt(currentTask));
  if (HALTED_WORKFLOW_STATUSES.has(workflow.status)) throw new WorkflowHaltError(workflowId, taskId, workflow.status);

  let execution = runState.executionByTask.get(taskId) ?? null;
  const noraSelection = getNoraSelection(workflow);
  if (!execution) {
    try {
      execution = await selectTaskExecution({
        workflowId,
        taskId,
        noraSelection,
        models,
        validateModelSelection,
      });
      runState.executionByTask.set(taskId, structuredClone(execution));
    } catch (error) {
      await failSetup(workflowId, taskId, error);
      throw new WorkflowHaltError(workflowId, taskId, "failed");
    }
  }

  while (!runState.cancelled) {
    let attempt;
    try {
      attempt = await runTaskAttempt({ workflowId, taskId, execution, runState, decide, noraSelection });
    } catch (error) {
      if (error instanceof WorkflowHaltError) throw error;
      await failSetup(workflowId, taskId, error);
      throw new WorkflowHaltError(workflowId, taskId, "failed");
    }
    if (!attempt) throw new WorkflowHaltError(workflowId, taskId, getWorkflow(workflowId)?.status ?? "cancelled");
    runState.attempts.push(attempt);
    if (attempt.status === "completed") return attemptValue(attempt);
    if (attempt.status === "failed" && attempt.diagnostics?.recovery === "automatic_retry") continue;
    workflow = getWorkflow(workflowId);
    throw new WorkflowHaltError(workflowId, taskId, workflow?.tasks?.[taskId]?.status ?? attempt.status);
  }
  throw new WorkflowHaltError(workflowId, taskId, "cancelled");
};

const runWorkflowInternal = async ({
  workflowId,
  decide,
  getNoraSelection,
  models,
  validateModelSelection,
  runState,
}) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown Workflow: ${workflowId}`);
  const threadId = `${workflowId}:${workflowRunMarker(workflowId)}:${workflowDefinitionFingerprint(workflow)}`;

  try {
    await runLangGraphWorkflow({
      workflow,
      threadId,
      signal: runState.controller.signal,
      runTask: taskId => {
        const execution = executeTaskNode({
          workflowId,
          taskId,
          runState,
          decide,
          getNoraSelection,
          models,
          validateModelSelection,
        });
        runState.pendingTasks.add(execution);
        void execution.then(() => runState.pendingTasks.delete(execution), () => runState.pendingTasks.delete(execution));
        return execution;
      },
    });
  } catch (error) {
    const current = getWorkflow(workflowId);
    if (!(error instanceof WorkflowHaltError) && !runState.cancelled && !HALTED_WORKFLOW_STATUSES.has(current?.status)) {
      await recordEvent("workflow.runtime_failed", {
        workflowId,
        runtime: "langgraph",
        threadId,
        error: errorMessage(error),
      });
      await Promise.allSettled([...runState.pendingTasks]);
      throw error;
    }
  }
  await Promise.allSettled([...runState.pendingTasks]);
  return { workflow: getWorkflow(workflowId), attempts: [...runState.attempts], threadId };
};

export const runWorkflow = options => {
  const existing = activeRuns.get(options.workflowId);
  if (existing) {
    if (!existing.cancelled) return existing.promise;
    return existing.promise.then(() => runWorkflow(options));
  }

  const runState = {
    cancelled: false,
    controller: new AbortController(),
    promise: null,
    executionByTask: new Map(),
    attemptsByTask: new Map(),
    pendingTasks: new Set(),
    attempts: [],
  };
  const promise = runWorkflowInternal({ ...options, runState }).finally(() => {
    if (activeRuns.get(options.workflowId) === runState) activeRuns.delete(options.workflowId);
  });
  runState.promise = promise;
  activeRuns.set(options.workflowId, runState);
  return promise;
};

export const cancelTaskExecution = (workflowId, taskId, reason = "Task cancelled") => (
  cancelTaskAgents(workflowId, taskId, reason)
);

export const cancelWorkflowExecution = async (workflowId, reason = "Workflow cancelled") => {
  const runState = activeRuns.get(workflowId);
  if (runState) {
    runState.cancelled = true;
    runState.controller.abort(reason);
  }
  const stopped = cancelWorkflowAgents(workflowId, reason);
  if (runState) await runState.promise.catch(() => {});
  return stopped;
};

export const listAgentProcesses = () => listActiveAgents();

export const shutdownProcessEngine = () => {
  for (const runState of activeRuns.values()) {
    runState.cancelled = true;
    runState.controller.abort("Carlos Office platform shutting down");
  }
  stopAllAgents("Carlos Office platform shutting down");
};