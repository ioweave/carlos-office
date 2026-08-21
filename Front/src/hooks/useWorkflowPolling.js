import { useEffect, useRef, useState } from "react";
import api, { endpoints } from "../api";

const SLOW_STATUSES = new Set(["completed", "cancelled"]);

const toneFor = status => ({
  running: "info",
  completed: "success",
  failed: "danger",
  blocked: "warning",
  cancelled: "neutral",
  skipped: "neutral",
  pending: "neutral",
  ready: "info",
})[status] || "neutral";

const taskLabel = (task, taskId) => String(task?.objective || taskId);

const labelFor = (label, status) => {
  const phrase = {
    running: "started",
    completed: "completed",
    failed: "failed",
    blocked: "is blocked",
    skipped: "skipped",
    cancelled: "cancelled",
  }[status] || status;

  return `Task ${label} ${phrase}`;
};

const initialAttemptActivity = workflow => {
  const items = [];

  for (const [taskId, task] of Object.entries(workflow.tasks || {})) {
    if (task.type !== "task") continue;

    const label = taskLabel(task, taskId);

    for (const attempt of task.attempts || []) {
      if (attempt.startedAt) {
        items.push({
          id: `${attempt.id}-started`,
          at: attempt.startedAt,
          label: `Task ${label} started · Attempt ${attempt.attempt}`,
          tone: "info",
        });
      }

      if (attempt.endedAt && attempt.status !== "running") {
        items.push({
          id: `${attempt.id}-${attempt.status}`,
          at: attempt.endedAt,
          label: labelFor(label, attempt.status),
          tone: toneFor(attempt.status),
        });
      }
    }
  }

  return items
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(-40)
    .map(item => {
      const entry = { ...item };
      delete entry.at;
      return entry;
    });
};

export default function useWorkflowPolling(workflowId, { interval = 3000 } = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState("");
  const previousStatuses = useRef(new Map());
  const previousWorkflowStatus = useRef("");
  const announcedApprovals = useRef(new Set());
  const seq = useRef(0);

  useEffect(() => {
    setSnapshot(null);
    setActivity([]);
    setError("");
    previousStatuses.current = new Map();
    previousWorkflowStatus.current = "";
    announcedApprovals.current = new Set();

    if (!workflowId) return undefined;

    let cancelled = false;
    let timer = null;

    const tick = async () => {
      try {
        const [workflowRes, inspectRes] = await Promise.all([
          api.get(endpoints.workflow(workflowId)),
          api.get(endpoints.workflowInspect(workflowId)).catch(() => ({ data: null })),
        ]);

        if (cancelled) return;

        const workflow = workflowRes.data;
        const approvals = inspectRes.data?.approvals || [];
        const firstSnapshot = !previousWorkflowStatus.current;
        const next = firstSnapshot ? initialAttemptActivity(workflow) : [];
        const previous = previousStatuses.current;

        setSnapshot({ workflow, approvals });
        setError("");

        for (const [taskId, task] of Object.entries(workflow.tasks || {})) {
          if (task.type !== "task") continue;

          const label = taskLabel(task, taskId);
          const priorStatus = previous.get(taskId);
          const attemptCount = task.attempts?.length || 0;
          const priorAttempts = previous.get(`${taskId}:attempts`);

          if (!firstSnapshot && priorStatus && priorStatus !== task.status) {
            next.push({
              id: `task-${taskId}-${task.status}-${seq.current++}`,
              label: labelFor(label, task.status),
              tone: toneFor(task.status),
            });
          }

          if (
            !firstSnapshot
            && priorAttempts !== undefined
            && attemptCount > priorAttempts
          ) {
            next.push({
              id: `retry-${taskId}-${attemptCount}-${seq.current++}`,
              label: `Retry: new Attempt for ${label}`,
              tone: "warning",
            });
          }

          previous.set(taskId, task.status);
          previous.set(`${taskId}:attempts`, attemptCount);
        }

        for (const approval of approvals) {
          if (!announcedApprovals.current.has(approval.id)) {
            announcedApprovals.current.add(approval.id);
            next.push({
              id: `approval-${approval.id}-${seq.current++}`,
              label: "Authorization required",
              tone: "warning",
            });
          }
        }

        if (
          !firstSnapshot
          && previousWorkflowStatus.current !== workflow.status
        ) {
          const phrase = {
            completed: "Workflow completed",
            failed: "Workflow failed",
            blocked: "Workflow blocked",
            cancelled: "Workflow cancelled",
            running: "Workflow resumed",
          }[workflow.status];

          if (phrase) {
            next.push({
              id: `workflow-${workflow.status}-${seq.current++}`,
              label: phrase,
              tone: toneFor(workflow.status),
            });
          }
        }

        previousWorkflowStatus.current = workflow.status;

        if (next.length) {
          setActivity(current => (
            firstSnapshot
              ? next.slice(-40)
              : [...current, ...next].slice(-40)
          ));
        }

        const delay = SLOW_STATUSES.has(workflow.status) ? 10000 : interval;
        timer = window.setTimeout(tick, delay);
      } catch (fetchError) {
        if (cancelled) return;

        setError(
          fetchError.response?.data?.error
          || fetchError.message
          || "Workflow unavailable.",
        );

        timer = window.setTimeout(tick, interval);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [workflowId, interval]);

  return { snapshot, activity, error };
}