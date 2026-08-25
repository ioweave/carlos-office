import { IconRoute } from "@tabler/icons-react";

import { useAppContext } from "../AppContext";

const humanizeId = id => String(id || "")
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\b\w/g, character => character.toUpperCase());

const taskTitle = (taskId, task) => task?.name?.trim() || humanizeId(taskId) || taskId;

const workflowLabel = workflow => {
  if (!workflow) return "Workflow";

  const executable = Object.entries(workflow.tasks || {})
    .filter(([, task]) => task?.type === "task");
  const completed = executable.filter(([, task]) => ["completed", "skipped"].includes(task.status)).length;
  const total = executable.length;
  const progress = total ? `${completed}/${total} Tasks` : "No executable Tasks";
  const affected = executable.find(([, task]) => task.status === workflow.status)
    || executable.find(([, task]) => ["failed", "blocked"].includes(task.status));

  if (workflow.status === "running") return `Running · ${progress}`;
  if (workflow.status === "completed") return `Completed · ${progress}`;
  if (workflow.status === "failed") {
    return affected ? `Failed · ${taskTitle(affected[0], affected[1])}` : "Failed";
  }
  if (workflow.status === "blocked") {
    return affected ? `Blocked · ${taskTitle(affected[0], affected[1])}` : "Blocked";
  }
  if (workflow.status === "paused") return `Paused · ${progress}`;
  if (workflow.status === "pending") return `Pending · ${progress}`;
  if (workflow.status === "cancelled") return "Cancelled";
  return `${humanizeId(workflow.status)} · ${progress}`;
};

export default function WorkflowLink({ workflowId, onOpen }) {
  const { officeState } = useAppContext();
  const workflow = (officeState.workflows || []).find(item => item.id === workflowId) || null;
  const status = workflow?.status || "unknown";
  const label = workflowLabel(workflow);

  return (
    <button
      type="button"
      className={`workflow-link workflow-link--inline workflow-link--${status}`}
      onClick={() => onOpen?.(workflowId)}
      aria-label={`${label}. Open Workflow ${workflowId} in Operations`}
    >
      <IconRoute size={16} />
      <span className="workflow-link__status-dot" aria-hidden="true" />
      <span className="workflow-link__copy">
        <strong>{label}</strong>
        <small>{workflowId}</small>
      </span>
      <span className="workflow-link__action">Open Operations</span>
    </button>
  );
}
