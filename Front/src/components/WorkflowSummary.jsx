import { useEffect } from "react";
import {
  IconActivity,
  IconArrowRight,
  IconCircleCheck,
  IconCircleDot,
  IconCircleX,
  IconClock,
  IconLock,
} from "@tabler/icons-react";
import useWorkflowPolling from "../hooks/useWorkflowPolling";
import StatusBadge from "./StatusBadge";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const statusTone = {
  running: "info",
  ready: "info",
  pending: "neutral",
  blocked: "warning",
  completed: "success",
  failed: "danger",
  skipped: "neutral",
  cancelled: "neutral",
};

const TaskRow = ({ task }) => {
  const tone = statusTone[task.status] || "neutral";
  const Icon = task.status === "completed"
    ? IconCircleCheck
    : task.status === "failed"
      ? IconCircleX
      : task.status === "blocked"
        ? IconLock
        : IconCircleDot;
  const taskLabel = task.objective || task.id;

  return (
    <li className="workflow-summary__task">
      <span className="workflow-summary__task-icon"><Icon size={15} stroke={1.6} /></span>
      <span className="workflow-summary__task-name">{taskLabel}</span>
      {task.attempts?.length > 1 && <span className="workflow-summary__task-attempts">×{task.attempts.length}</span>}
      <StatusBadge tone={tone}>{task.status}</StatusBadge>
    </li>
  );
};

export default function WorkflowSummary({ workflowId, onOpenOperations, onSettled }) {
  const { snapshot, activity, error } = useWorkflowPolling(workflowId);
  const workflowStatus = snapshot?.workflow?.status ?? "";

  useEffect(() => {
    if (!snapshot?.workflow || !TERMINAL_STATUSES.has(workflowStatus)) return;
    void onSettled?.(snapshot.workflow);
  }, [workflowStatus, onSettled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!workflowId) return null;
  if (error && !snapshot) {
    return (
      <aside className="workflow-summary workflow-summary--error">
        <header className="workflow-summary__header">
          <IconActivity size={16} />
          <strong className="workflow-summary__title">Workflow</strong>
        </header>
        <p className="workflow-summary__error">{error}</p>
      </aside>
    );
  }
  if (!snapshot) {
    return (
      <aside className="workflow-summary">
        <header className="workflow-summary__header">
          <span className="loader" />
          <strong className="workflow-summary__title">Loading workflow…</strong>
        </header>
      </aside>
    );
  }

  const { workflow, approvals } = snapshot;
  const tasks = Object.entries(workflow.tasks || {})
    .filter(([, task]) => task.type === "task")
    .map(([id, task]) => ({ id, ...task }));

  return (
    <aside className="workflow-summary" aria-label="Workflow runtime summary">
      <header className="workflow-summary__header">
        <IconActivity size={16} />
        <strong className="workflow-summary__title">{workflow.process || "Ad-hoc workflow"}</strong>
        <StatusBadge tone={statusTone[workflow.status] || "neutral"}>{workflow.status}</StatusBadge>
        {onOpenOperations && (
          <button type="button" className="workflow-summary__open" onClick={onOpenOperations}>
            Open <IconArrowRight size={14} />
          </button>
        )}
      </header>

      {!!approvals.length && (
        <div className="workflow-summary__approvals">
          <IconLock size={14} />
          <span>{approvals.length} authorization{approvals.length === 1 ? "" : "s"} pending</span>
        </div>
      )}

      <ul className="workflow-summary__tasks">
        {tasks.map(task => <TaskRow key={task.id} task={task} />)}
      </ul>

      {!!activity.length && (
        <div className="workflow-summary__activity" aria-label="Runtime activity">
          {activity.map(item => (
            <div
              key={item.id}
              className={`workflow-summary__activity-item workflow-summary__activity-item--${item.tone}`}
            >
              <IconClock size={12} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}

      {workflow.status === "completed" && workflow.result != null && (
        <pre className="workflow-summary__result">{JSON.stringify(workflow.result, null, 2)}</pre>
      )}
    </aside>
  );
}
