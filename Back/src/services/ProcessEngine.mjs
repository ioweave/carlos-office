import { randomUUID } from "node:crypto";

import { importArtifact } from "../controllers/ArtifactController.mjs";
import { recordEvent } from "../controllers/EventController.mjs";
import {
  addTaskAttempt,
  getReadyTasks,
  getWorkflow,
  listTaskAttempts,
  setTaskStatus,
  updateTaskAttempt,
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

const activeRuns = new Map();
const workflowTransitions = new Map();
const ORPHANED_ATTEMPT_REASON = "Previous Agent process is no longer active";

const errorMessage = error => error instanceof Error ? error.message : String(error);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const withWorkflowTransition = async (workflowId, operation) => {
  const previous = workflowTransitions.get(workflowId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  workflowTransitions.set(workflowId, next);

  try {
    return await next;
  } finally {
    if (workflowTransitions.get(workflowId) === next) workflowTransitions.delete(workflowId);
  }
};

const selectionFrom = (value, validateModelSelection, models = []) => {
  if (!value?.provider && !value?.model) return null;
  if (!value?.provider || !value?.model) throw new Error("Provider and model must be configured together");

  try {
    return validateModelSelection(value);
  } catch (error) {
    const matches = models.filter(entry => entry.models?.includes(value.model));
    if (matches.length === 1) {
      return validateModelSelection({ provider: matches[0].provider, model: value.model });
    }
    throw error;
  }
};

const upstreamTaskIds = (workflow, taskId) => workflow.edges
  .filter(([, to]) => to === taskId)
  .map(([from]) => from)
  .filter(id => workflow.tasks[id]?.type === "task");

const latestCompletedAttempt = task => [...(task.attempts ?? [])]
  .reverse()
  .find(attempt => attempt.status === "completed") ?? null;

const resolveTaskInput = (workflow, taskId, task) => {
  const available = structuredClone(workflow.inputs ?? {});

  for (const upstreamId of upstreamTaskIds(workflow, taskId)) {
    const upstream = workflow.tasks[upstreamId];
    const attempt = latestCompletedAttempt(upstream);
    if (!attempt) continue;
    if (upstream.output) available[upstream.output] = structuredClone(attempt.output);
    available[upstreamId] = structuredClone(attempt.output);
  }

  if (!Array.isArray(task.inputs) || !task.inputs.length) return available;
  return Object.fromEntries(
    task.inputs
      .filter(name => Object.prototype.hasOwnProperty.call(available, name))
      .map(name => [name, available[name]]),
  );
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

const finishAttempt = (workflowId, taskId, attemptId, changes) => updateTaskAttempt(
  workflowId,
  taskId,
  attemptId,
  { ...changes, endedAt: new Date().toISOString() },
);

const liveAgentForTask = (workflowId, taskId) => listActiveAgents().find(
  agent => agent.context?.workflowId === workflowId && agent.taskId === taskId,
) ?? null;

const closeOrphanedRunningAttempts = async (workflowId, taskId, task) => {
  const runningAttempts = (task.attempts ?? []).filter(attempt => attempt.status === "running");
  if (!runningAttempts.length) return 0;

  const liveAgent = liveAgentForTask(workflowId, taskId);
  if (liveAgent) {
    throw new Error(
      `Task ${taskId} in Workflow ${workflowId} already has an active Agent process (${liveAgent.id})`,
    );
  }

  for (const attempt of runningAttempts) {
    await finishAttempt(workflowId, taskId, attempt.id, {
      status: "failed",
      error: ORPHANED_ATTEMPT_REASON,
      blockedReason: null,
    });
    await recordEvent("attempt.orphaned", {
      workflowId,
      taskId,
      attemptId: attempt.id,
      agentId: attempt.agentId ?? null,
      pid: attempt.pid ?? null,
      error: ORPHANED_ATTEMPT_REASON,
    });
  }

  return runningAttempts.length;
};

const failSetup = async (workflowId, taskId, error) => {
  const message = errorMessage(error);

  await withWorkflowTransition(workflowId, async () => {
    const workflow = getWorkflow(workflowId);
    const task = workflow?.tasks?.[taskId];
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
      artifacts: [],
      error: message,
      blockedReason: null,
    });
    await setTaskStatus(workflowId, taskId, "failed");
  });

  await recordEvent("task.execution_failed", { workflowId, taskId, error: message });
};

export const selectTaskExecution = async ({
  workflowId,
  taskId,
  decide,
  noraSelection,
  models = [],
  validateModelSelection,
}) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown Workflow: ${workflowId}`);
  const task = workflow.tasks?.[taskId];
  if (!task || task.type !== "task") throw new Error(`Unknown executable Task: ${taskId}`);

  const availableModels = models.map(entry => ({
    provider: entry.provider,
    models: Array.isArray(entry.models) ? [...entry.models] : [],
  }));
  const availableTools = listTools().map(tool => ({
    name: tool.name,
    description: tool.description ?? "",
    requiresApproval: Boolean(tool.requiresApproval),
  }));
  const availableSkills = listSkills().map(({ name, content }) => ({ name, content }));
  const toolNames = new Set(availableTools.map(tool => tool.name));
  const skillNames = new Set(availableSkills.map(skill => skill.name));

  const fixedModel = selectionFrom(task, validateModelSelection, availableModels);
  const fixedTools = Array.isArray(task.tools) ? [...task.tools] : null;
  const fixedSkills = Array.isArray(task.skills) ? [...task.skills] : null;

  if (fixedTools?.some(name => !toolNames.has(name))) throw new Error("Task requires an unknown Tool");
  if (fixedSkills?.some(name => !skillNames.has(name))) throw new Error("Task requires an unknown Skill");

  let decision = {};
  if (!fixedModel || fixedTools === null || fixedSkills === null) {
    decision = await decide(
      [
        "Choose the unspecified execution resources for this ready Task.",
        "Explicit Task provider/model, tools, and skills are authoritative constraints and must not be replaced.",
        "There are no persistent specialist Agent identities or Agent defaults.",
        "Return only:",
        '{"provider":"provider-name","model":"model-name","tools":[],"skills":[]}',
      ].join("\n\n"),
      {
        workflow: {
          id: workflow.id,
          process: workflow.process,
          inputs: workflow.inputs,
          config: workflow.config,
        },
        task: { id: taskId, ...task },
        fixed: { model: fixedModel, tools: fixedTools, skills: fixedSkills },
        availableModels,
        availableTools,
        availableSkills,
      },
      noraSelection,
    );
  }

  const selectedModel = fixedModel ?? validateModelSelection({
    provider: decision.provider,
    model: decision.model,
  });
  const selectedTools = fixedTools ?? decision.tools;
  const selectedSkills = fixedSkills ?? decision.skills;

  if (!Array.isArray(selectedTools)) throw new Error("Nora must select a Tool list for the Task");
  if (!Array.isArray(selectedSkills)) throw new Error("Nora must select a Skill list for the Task");
  if (selectedTools.some(name => !toolNames.has(name))) throw new Error("Nora selected an invalid Tool set");
  if (selectedSkills.some(name => !skillNames.has(name))) throw new Error("Nora selected an invalid Skill set");

  return {
    ...selectedModel,
    tools: [...new Set(selectedTools)],
    skills: [...new Set(selectedSkills)],
  };
};

const importDeclaredArtifacts = async (workflow, result, createdBy) => {
  const completion = isObject(result.output) && typeof result.output.output === "string"
    ? result.output
    : { output: result.output, artifacts: [] };
  const declarations = Array.isArray(completion.artifacts) ? completion.artifacts : [];
  if (!declarations.length) return { output: completion.output, artifacts: [] };

  const conversationId = workflow?.config?.conversationId;
  if (!conversationId) return { output: completion.output, artifacts: [] };

  const artifactIds = [];
  for (const declaration of declarations) {
    if (!isObject(declaration) || typeof declaration.path !== "string" || !declaration.path.trim()) {
      throw new Error("Agent declared an invalid Artifact path");
    }
    const artifact = await importArtifact({
      conversationId,
      sourcePath: declaration.path,
      name: declaration.name ?? null,
      type: declaration.type ?? null,
      createdBy: createdBy || "Temporary Agent",
    });
    artifactIds.push(artifact.id);
  }

  return { output: completion.output, artifacts: artifactIds };
};

const runTask = async ({ workflowId, taskId, execution, runState }) => {
  if (runState?.cancelled) return null;

  const tools = loadTools(execution.tools);
  const skills = loadSkills(execution.skills);

  const prepared = await withWorkflowTransition(workflowId, async () => {
    const workflow = getWorkflow(workflowId);
    const task = workflow?.tasks?.[taskId];
    if (!task || task.type !== "task") throw new Error(`Unknown executable Task: ${taskId}`);

    if (task.status !== "ready") {
      if (runState?.cancelled || task.status === "cancelled" || ["paused", "cancelled"].includes(workflow.status)) {
        return null;
      }
      throw new Error(`Task ${taskId} is ${task.status}, not ready`);
    }

    await closeOrphanedRunningAttempts(workflowId, taskId, task);

    const latestWorkflow = getWorkflow(workflowId);
    const latestTask = latestWorkflow?.tasks?.[taskId];
    if (!latestTask || latestTask.status !== "ready") return null;
    if (liveAgentForTask(workflowId, taskId)) {
      throw new Error(`Task ${taskId} in Workflow ${workflowId} already has an active Agent process`);
    }

    const input = resolveTaskInput(latestWorkflow, taskId, latestTask);
    const previousAttempts = listTaskAttempts(workflowId, taskId);
    const attempt = {
      id: `attempt-${randomUUID()}`,
      workflowId,
      taskId,
      attempt: previousAttempts.length + 1,
      agentId: null,
      pid: null,
      provider: execution.provider,
      model: execution.model,
      status: "running",
      input: structuredClone(input),
      tools: [...execution.tools],
      skills: [...execution.skills],
      startedAt: new Date().toISOString(),
      endedAt: null,
      output: null,
      artifacts: [],
      error: null,
      blockedReason: null,
    };

    await addTaskAttempt(workflowId, taskId, attempt);
    try {
      await setTaskStatus(workflowId, taskId, "running");
    } catch (error) {
      await finishAttempt(workflowId, taskId, attempt.id, {
        status: "failed",
        error: `Could not reserve Task execution: ${errorMessage(error)}`,
      });
      throw error;
    }

    return { attempt, input, task: structuredClone(latestTask) };
  });

  if (!prepared) return null;
  const { attempt, input, task } = prepared;

  await recordEvent("attempt.started", {
    workflowId,
    taskId,
    attemptId: attempt.id,
    provider: execution.provider,
    model: execution.model,
  });

  if (runState?.cancelled) {
    return withWorkflowTransition(workflowId, () => finishAttempt(workflowId, taskId, attempt.id, {
      status: "cancelled",
      error: "Workflow stopped before Agent launch",
    }));
  }

  let result;
  try {
    result = await runAgentProcess({
      workflowId,
      taskId,
      task: { ...task, input },
      provider: execution.provider,
      model: execution.model,
      tools,
      skills,
    });
  } catch (error) {
    result = { status: "failed", error: errorMessage(error), agentId: null, pid: null };
  }

  const runtime = { agentId: result.agentId ?? null, pid: result.pid ?? null };
  let completion = { output: result.output, artifacts: [] };
  if (result.status === "completed") {
    try {
      completion = await importDeclaredArtifacts(getWorkflow(workflowId), result, runtime.agentId);
    } catch (error) {
      result = {
        ...result,
        status: "failed",
        error: `Could not register Task Artifact: ${errorMessage(error)}`,
      };
    }
  }

  const outcome = await withWorkflowTransition(workflowId, async () => {
    const current = getWorkflow(workflowId);
    const currentTask = current?.tasks?.[taskId];
    if (!currentTask) throw new Error(`Unknown executable Task: ${taskId}`);

    const taskWasCancelled = currentTask.status === "cancelled";
    const executionWasCancelled = (
      runState?.cancelled
      || taskWasCancelled
      || result.status === "cancelled"
      || current?.status === "cancelled"
    );

    if (executionWasCancelled) {
      return {
        event: "attempt.cancelled",
        attempt: await finishAttempt(workflowId, taskId, attempt.id, {
          ...runtime,
          status: "cancelled",
          error: result.error ?? (taskWasCancelled ? "Task cancelled by Carlos" : "Workflow stopped"),
        }),
      };
    }

    if (result.status === "completed") {
      const completed = await finishAttempt(workflowId, taskId, attempt.id, {
        ...runtime,
        status: "completed",
        output: completion.output,
        artifacts: completion.artifacts,
        error: null,
        blockedReason: null,
      });
      if (currentTask.status === "running" && current.status === "running") {
        await setTaskStatus(workflowId, taskId, "completed");
      }
      return { event: "attempt.completed", attempt: completed };
    }

    if (result.status === "blocked") {
      const reason = result.error || "Carlos approval required";
      const blocked = await finishAttempt(workflowId, taskId, attempt.id, {
        ...runtime,
        status: "blocked",
        error: null,
        blockedReason: reason,
        approvalId: result.approvalId ?? null,
      });
      if (currentTask.status === "running" && current.status === "running") {
        await setTaskStatus(workflowId, taskId, "blocked");
      }
      return { event: "attempt.blocked", attempt: blocked, approvalId: result.approvalId ?? null };
    }

    const message = result.error || "Agent process failed";
    const failed = await finishAttempt(workflowId, taskId, attempt.id, {
      ...runtime,
      status: "failed",
      error: message,
    });
    if (currentTask.status === "running" && current.status === "running") {
      await setTaskStatus(workflowId, taskId, "failed");
    }
    return { event: "attempt.failed", attempt: failed, error: message };
  });

  await recordEvent(outcome.event, {
    workflowId,
    taskId,
    attemptId: attempt.id,
    agentId: runtime.agentId,
    artifacts: outcome.attempt?.artifacts ?? [],
    ...(outcome.approvalId ? { approvalId: outcome.approvalId } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
  });
  return outcome.attempt;
};

const runWorkflowInternal = async ({
  workflowId,
  decide,
  getNoraSelection,
  models,
  validateModelSelection,
  runState,
}) => {
  const attempts = [];

  while (!runState.cancelled) {
    const workflow = getWorkflow(workflowId);
    if (!workflow) throw new Error(`Unknown Workflow: ${workflowId}`);
    if (["completed", "cancelled", "paused", "blocked", "failed"].includes(workflow.status)) break;

    const readyTasks = getReadyTasks(workflowId);
    if (!readyTasks.length) {
      await recordEvent("workflow.stalled", { workflowId, status: workflow.status });
      break;
    }

    const assignments = [];
    for (const task of readyTasks) {
      if (runState.cancelled) break;
      try {
        const currentWorkflow = getWorkflow(workflowId);
        const execution = await selectTaskExecution({
          workflowId,
          taskId: task.id,
          decide,
          noraSelection: getNoraSelection(currentWorkflow),
          models,
          validateModelSelection,
        });
        const latest = getWorkflow(workflowId);
        if (
          runState.cancelled
          || latest?.status !== "running"
          || latest.tasks?.[task.id]?.status !== "ready"
        ) continue;
        assignments.push({ taskId: task.id, execution });
      } catch (error) {
        if (runState.cancelled || getWorkflow(workflowId)?.status === "paused") continue;
        await failSetup(workflowId, task.id, error);
      }
    }

    const batch = (await Promise.all(assignments.map(({ taskId, execution }) => (
      runTask({ workflowId, taskId, execution, runState })
    )))).filter(Boolean);
    attempts.push(...batch);
  }

  return { workflow: getWorkflow(workflowId), attempts };
};

export const runWorkflow = options => {
  const existing = activeRuns.get(options.workflowId);
  if (existing) {
    if (!existing.cancelled) return existing.promise;
    return existing.promise.then(() => runWorkflow(options));
  }

  const runState = { cancelled: false, promise: null };
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

export const cancelWorkflowExecution = (workflowId, reason = "Workflow cancelled") => {
  const runState = activeRuns.get(workflowId);
  if (runState) runState.cancelled = true;
  return cancelWorkflowAgents(workflowId, reason);
};

export const listAgentProcesses = () => listActiveAgents();

export const shutdownProcessEngine = () => {
  stopAllAgents("Carlos Office platform shutting down");
};
