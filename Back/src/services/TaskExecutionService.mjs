import { randomUUID } from "node:crypto";

import { getTaskExecutionGroups } from "./WorkflowGraphService.mjs";

const limiterStates = new Map();

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = value => value === undefined ? undefined : structuredClone(value);

const errorResult = (message, phase, code, extra = {}) => ({
  status: "failed",
  error: message,
  diagnostics: { phase, code, message, ...extra },
});

const getPath = (value, path) => {
  const parts = String(path || "").split(".").map(part => part.trim()).filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (current == null || (typeof current !== "object" && !Array.isArray(current))) return undefined;
    current = current[part];
  }
  return current;
};

const mapDataFor = (groupId, items) => ({
  __carlosOfficeMap: groupId,
  items: items.map((item, index) => ({
    index,
    output: item?.output ?? null,
    data: item?.data ?? null,
  })),
});

const valueFromMapItem = item => item?.data != null ? clone(item.data) : clone(item?.output);

export const materializeMapData = (value, retainedGroupIds = new Set()) => {
  if (Array.isArray(value)) return value.map(item => materializeMapData(item, retainedGroupIds));
  if (!isObject(value)) return clone(value);

  if (typeof value.__carlosOfficeMap === "string" && Array.isArray(value.items)) {
    if (retainedGroupIds.has(value.__carlosOfficeMap)) return clone(value);
    return value.items.map(item => materializeMapData(valueFromMapItem(item), retainedGroupIds));
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    materializeMapData(item, retainedGroupIds),
  ]));
};

const latestCompletedValue = task => {
  const attempt = [...(task?.attempts ?? [])].reverse().find(item => item.status === "completed") ?? null;
  if (!attempt) return undefined;
  return attempt.data != null ? clone(attempt.data) : clone(attempt.output);
};

const ancestorTaskIds = (workflow, taskId) => {
  const reverse = new Map(Object.keys(workflow.tasks ?? {}).map(id => [id, []]));
  for (const [from, to] of workflow.edges ?? []) {
    if (!reverse.has(to)) reverse.set(to, []);
    reverse.get(to).push(from);
  }
  const ancestors = new Set();
  const pending = [...(reverse.get(taskId) ?? [])];
  while (pending.length) {
    const id = pending.pop();
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    for (const parent of reverse.get(id) ?? []) pending.push(parent);
  }
  return ancestors;
};

const valueType = value => {
  if (value === undefined) return "unresolved";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const resolveMapSource = ({ workflow, taskId, input, sourcePath }) => {
  const attempts = [];
  const consider = (value, resolvedPath) => {
    if (value === undefined) return null;
    const candidate = { value, resolvedPath };
    attempts.push(candidate);
    return Array.isArray(value) ? candidate : null;
  };

  let found = consider(getPath(input, sourcePath), sourcePath);
  if (found) return { ...found, attempts };

  const parts = String(sourcePath || "").split(".").map(part => part.trim()).filter(Boolean);
  if (parts[0] === "workflow" && parts.length > 1) {
    const relativePath = parts.slice(1).join(".");
    found = consider(getPath(workflow.inputs ?? {}, relativePath), `workflow.${relativePath}`);
    if (found) return { ...found, attempts };
  } else {
    found = consider(getPath(workflow.inputs ?? {}, sourcePath), `workflow.${sourcePath}`);
    if (found) return { ...found, attempts };
  }

  if (parts[0] === "upstream" && parts.length >= 2) {
    const key = parts[1];
    const rest = parts.slice(2);
    const ancestors = ancestorTaskIds(workflow, taskId);
    const ancestorEntries = [...ancestors]
      .map(id => [id, workflow.tasks?.[id]])
      .filter(([, task]) => task?.type === "task");
    const exact = ancestorEntries.filter(([id]) => id === key);
    const aliases = ancestorEntries.filter(([, task]) => task.output === key);
    const producers = exact.length ? exact : aliases.length === 1 ? aliases : [];

    for (const [producerId, producer] of producers) {
      const raw = materializeMapData(latestCompletedValue(producer));
      if (raw === undefined) continue;

      if (rest.length) {
        found = consider(getPath(raw, rest.join(".")), `upstream.${producerId}.${rest.join(".")}`);
        if (found) return { ...found, attempts };

        // Nora historically emitted upstream.<taskId>.<outputName> even when
        // the Task value itself is the declared output. Treat that legacy
        // spelling as the canonical upstream.<taskId> value.
        if (rest.length === 1 && producer.output === rest[0]) {
          found = consider(raw, `upstream.${producerId}`);
          if (found) return { ...found, attempts };
        }
      } else {
        found = consider(raw, `upstream.${producerId}`);
        if (found) return { ...found, attempts };
      }
    }
  }

  const best = attempts.find(item => item.value !== undefined) ?? null;
  return {
    value: best?.value,
    resolvedPath: best?.resolvedPath ?? null,
    attempts,
  };
};

const projectMapData = (value, groupId, index) => {
  if (Array.isArray(value)) return value.map(item => projectMapData(item, groupId, index));
  if (!isObject(value)) return clone(value);

  if (value.__carlosOfficeMap === groupId && Array.isArray(value.items)) {
    return valueFromMapItem(value.items[index]);
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    projectMapData(item, groupId, index),
  ]));
};

const scopeKey = scope => scope
  .filter(item => item.type === "map")
  .map(item => `${item.groupId}:${item.index}`)
  .join("/");

const checkpointKey = (scope, groupId, index) => `${scopeKey(scope)}|${groupId}:${index}`;

const normalizeAgentCompletion = result => {
  if (result.status !== "completed") return result;
  const completion = isObject(result.output) && typeof result.output.output === "string"
    ? result.output
    : { output: String(result.output ?? ""), data: null, artifacts: [] };
  return {
    ...result,
    output: completion.output,
    data: completion.data === undefined ? null : clone(completion.data),
    artifactDeclarations: Array.isArray(completion.artifacts)
      ? completion.artifacts.map(item => ({ ...clone(item), createdBy: result.agentId ?? "Temporary Agent" }))
      : [],
  };
};

const limiterKey = (workflowId, groupId) => `${workflowId}\u0000${groupId}`;

const pruneStarts = limiter => {
  if (!limiter.throttle) return;
  const threshold = Date.now() - limiter.throttle.windowMs;
  limiter.starts = limiter.starts.filter(startedAt => startedAt > threshold);
};

const scheduleLimiterCleanup = limiter => {
  if (limiter.active || limiter.queue.length) return;
  pruneStarts(limiter);
  if (!limiter.throttle || !limiter.starts.length) {
    if (limiterStates.get(limiter.key) === limiter) limiterStates.delete(limiter.key);
    if (limiter.cleanupTimer) clearTimeout(limiter.cleanupTimer);
    limiter.cleanupTimer = null;
    return;
  }

  if (limiter.cleanupTimer) clearTimeout(limiter.cleanupTimer);
  const delay = Math.max(25, limiter.starts[0] + limiter.throttle.windowMs - Date.now() + 5);
  limiter.cleanupTimer = setTimeout(() => {
    limiter.cleanupTimer = null;
    scheduleLimiterCleanup(limiter);
  }, delay);
};

const getLimiter = (workflowId, group) => {
  const key = limiterKey(workflowId, group.id);
  const signature = JSON.stringify({
    concurrency: group.concurrency,
    throttle: group.throttle ?? null,
  });
  let limiter = limiterStates.get(key);
  if (!limiter || limiter.signature !== signature) {
    if (limiter?.cleanupTimer) clearTimeout(limiter.cleanupTimer);
    limiter = {
      key,
      signature,
      concurrency: group.concurrency,
      throttle: group.throttle ?? null,
      active: 0,
      starts: [],
      queue: [],
      cleanupTimer: null,
    };
    limiterStates.set(key, limiter);
  }
  return limiter;
};

const wakeLimiter = limiter => {
  for (const wake of limiter.queue.splice(0)) wake();
};

const waitForLimiter = async (limiter, isCancelled) => {
  while (true) {
    if (isCancelled()) throw Object.assign(new Error("Workflow stopped"), { cancelled: true });
    const now = Date.now();
    pruneStarts(limiter);

    const throttle = limiter.throttle;
    const capacityReady = limiter.active < limiter.concurrency;
    const rateReady = !throttle || limiter.starts.length < throttle.requests;
    if (capacityReady && rateReady) {
      limiter.active += 1;
      if (throttle) limiter.starts.push(now);
      if (limiter.cleanupTimer) {
        clearTimeout(limiter.cleanupTimer);
        limiter.cleanupTimer = null;
      }
      return;
    }

    let delay = 0;
    if (throttle && !rateReady) {
      delay = Math.max(10, limiter.starts[0] + throttle.windowMs - now + 1);
    }

    await new Promise(resolve => {
      const wake = () => resolve();
      limiter.queue.push(wake);
      if (delay > 0) {
        setTimeout(() => {
          const index = limiter.queue.indexOf(wake);
          if (index >= 0) limiter.queue.splice(index, 1);
          resolve();
        }, delay);
      }
    });
  }
};

const withOneLimiter = async (workflowId, group, operation, isCancelled) => {
  const limiter = getLimiter(workflowId, group);
  await waitForLimiter(limiter, isCancelled);
  try {
    return await operation();
  } finally {
    limiter.active = Math.max(0, limiter.active - 1);
    wakeLimiter(limiter);
    scheduleLimiterCleanup(limiter);
  }
};

const withMapLimiters = (workflowId, groups, operation, isCancelled, index = 0) => {
  if (index >= groups.length) return operation();
  return withOneLimiter(
    workflowId,
    groups[index],
    () => withMapLimiters(workflowId, groups, operation, isCancelled, index + 1),
    isCancelled,
  );
};

const normalizedReview = (review, minimumScore) => {
  if (!isObject(review)) throw new Error("Nora Loop review must be an object");
  if (typeof review.passed !== "boolean") throw new Error("Nora Loop review must include passed");
  if (typeof review.score !== "number" || !Number.isFinite(review.score) || review.score < 0 || review.score > 1) {
    throw new Error("Nora Loop review score must be a number from 0 to 1");
  }
  const feedback = typeof review.feedback === "string" ? review.feedback.trim() : "";
  return {
    passed: review.passed && review.score >= minimumScore,
    score: review.score,
    feedback,
  };
};

const checkpointMap = invocations => new Map((invocations ?? [])
  .filter(item => item?.kind === "map-item" && item.status === "completed" && item.checkpointKey)
  .map(item => [item.checkpointKey, clone(item)]));

const runPool = async (count, workers, operation) => {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, workers), Math.max(1, count)) }, async () => {
    while (cursor < count) {
      const index = cursor++;
      await operation(index);
    }
  });
  await Promise.all(runners);
};

export const executeTaskWithGroups = async ({
  workflow,
  taskId,
  _task,
  input,
  runAgent,
  review,
  recordInvocation = async () => {},
  checkpointInvocations = [],
  isCancelled = () => false,
}) => {
  const groups = getTaskExecutionGroups(workflow, taskId);
  const checkpoints = checkpointMap(checkpointInvocations);

  const executeLeaf = async context => {
    const invocationId = `invocation-${randomUUID()}`;
    const startedAt = new Date().toISOString();
    let result;
    try {
      result = await withMapLimiters(
        workflow.id,
        context.mapGroups,
        () => runAgent({ invocationId, input: context.input }),
        isCancelled,
      );
    } catch (error) {
      if (error?.cancelled || isCancelled()) {
        result = { status: "cancelled", error: "Workflow stopped" };
      } else {
        result = errorResult(
          error instanceof Error ? error.message : String(error),
          "process",
          "agent_invocation_failure",
        );
      }
    }

    result = normalizeAgentCompletion(result);
    const record = {
      id: invocationId,
      kind: "agent",
      status: result.status,
      scope: clone(context.scope),
      startedAt,
      endedAt: new Date().toISOString(),
      agentId: result.agentId ?? null,
      pid: result.pid ?? null,
      output: result.output ?? null,
      data: result.data ?? null,
      error: result.error ?? null,
      diagnostics: result.diagnostics ?? null,
    };
    await recordInvocation(record);
    return result;
  };

  const wrapLoop = (group, inner) => async context => {
    let feedback = null;
    for (let iteration = 1; iteration <= group.maxIterations; iteration += 1) {
      if (isCancelled()) return { status: "cancelled", error: "Workflow stopped" };
      const nextInput = feedback
        ? {
          ...clone(context.input),
          __loopReview: {
            groupId: group.id,
            iteration,
            previousOutput: feedback.output,
            previousData: feedback.data,
            score: feedback.score,
            feedback: feedback.feedback,
          },
        }
        : context.input;
      const candidate = await inner({
        ...context,
        input: nextInput,
        scope: [...context.scope, { type: "loop", groupId: group.id, iteration }],
      });
      if (candidate.status !== "completed") return candidate;

      const validationId = `validation-${randomUUID()}`;
      const validationStartedAt = new Date().toISOString();
      let assessment;
      try {
        assessment = normalizedReview(await review({
          group,
          iteration,
          candidate: {
            output: candidate.output,
            data: candidate.data ?? null,
          },
        }), group.minimumScore);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordInvocation({
          id: validationId,
          kind: "validation",
          groupId: group.id,
          status: "failed",
          scope: clone(context.scope),
          iteration,
          startedAt: validationStartedAt,
          endedAt: new Date().toISOString(),
          error: message,
        });
        return errorResult(message, "validation", "loop_review_failure");
      }

      await recordInvocation({
        id: validationId,
        kind: "validation",
        groupId: group.id,
        status: assessment.passed ? "completed" : "rejected",
        scope: clone(context.scope),
        iteration,
        startedAt: validationStartedAt,
        endedAt: new Date().toISOString(),
        score: assessment.score,
        minimumScore: group.minimumScore,
        feedback: assessment.feedback,
      });

      if (assessment.passed) return candidate;
      feedback = {
        output: candidate.output,
        data: candidate.data ?? null,
        score: assessment.score,
        feedback: assessment.feedback,
      };
    }

    const message = `Nora rejected the Task result after ${group.maxIterations} quality-control iterations`;
    return errorResult(message, "validation", "loop_quality_failed", {
      groupId: group.id,
      minimumScore: group.minimumScore,
      feedback: feedback?.feedback ?? "",
      score: feedback?.score ?? null,
    });
  };

  const wrapMap = (group, inner) => async context => {
    const resolution = resolveMapSource({
      workflow,
      taskId,
      input: context.input,
      sourcePath: group.source,
    });
    const source = resolution.value;
    if (!Array.isArray(source)) {
      const resolvedType = valueType(source);
      const message = resolution.resolvedPath
        ? `Map Group ${group.id} source ${group.source} resolved via ${resolution.resolvedPath} to ${resolvedType}, not an array`
        : `Map Group ${group.id} source ${group.source} could not be resolved to an upstream or Workflow array`;
      return errorResult(
        message,
        "map",
        source === undefined ? "map_source_unresolved" : "map_source_not_array",
        {
          groupId: group.id,
          source: group.source,
          resolvedPath: resolution.resolvedPath,
          resolvedType,
        },
      );
    }

    const results = new Array(source.length);
    let halt = null;
    await runPool(source.length, group.concurrency, async index => {
      if (halt || isCancelled()) return;
      const key = checkpointKey(context.scope, group.id, index);
      const checkpoint = checkpoints.get(key);
      if (checkpoint) {
        results[index] = {
          status: "completed",
          output: checkpoint.output ?? "",
          data: checkpoint.data ?? null,
          artifactDeclarations: clone(checkpoint.artifactDeclarations ?? []),
        };
        await recordInvocation({
          ...clone(checkpoint),
          id: `checkpoint-${randomUUID()}`,
          reusedFrom: checkpoint.id,
          reused: true,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
        });
        return;
      }

      const itemInput = projectMapData(context.input, group.id, index);
      const result = await inner({
        ...context,
        input: {
          ...itemInput,
          [group.itemAs]: clone(source[index]),
          [group.indexAs || "index"]: index,
          __mapExecution: {
            groupId: group.id,
            index,
            total: source.length,
          },
        },
        mapGroups: [...context.mapGroups, group],
        scope: [...context.scope, { type: "map", groupId: group.id, index, total: source.length }],
      });

      if (result.status !== "completed") {
        halt ??= result;
        return;
      }

      results[index] = result;
      await recordInvocation({
        id: `map-item-${randomUUID()}`,
        kind: "map-item",
        groupId: group.id,
        checkpointKey: key,
        status: "completed",
        scope: clone(context.scope),
        index,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        output: result.output ?? "",
        data: result.data ?? null,
        artifactDeclarations: clone(result.artifactDeclarations ?? []),
      });
    });

    if (isCancelled()) return { status: "cancelled", error: "Workflow stopped" };
    if (halt) return halt;

    const artifacts = results.flatMap(result => result?.artifactDeclarations ?? []);
    return {
      status: "completed",
      output: `Processed ${source.length} item${source.length === 1 ? "" : "s"} in Map ${group.name || group.id}.`,
      data: mapDataFor(group.id, results),
      artifactDeclarations: artifacts,
      map: {
        groupId: group.id,
        items: source.length,
        concurrency: group.concurrency,
      },
    };
  };

  let executor = executeLeaf;
  for (const group of [...groups].reverse()) {
    if (group.type === "loop") executor = wrapLoop(group, executor);
    if (group.type === "map") executor = wrapMap(group, executor);
  }

  return executor({
    input: clone(input),
    scope: [],
    mapGroups: [],
  });
};

export const clearWorkflowExecutionLimiters = workflowId => {
  for (const [key, limiter] of [...limiterStates.entries()]) {
    if (!key.startsWith(`${workflowId}\u0000`)) continue;
    if (limiter.cleanupTimer) clearTimeout(limiter.cleanupTimer);
    limiterStates.delete(key);
  }
};
