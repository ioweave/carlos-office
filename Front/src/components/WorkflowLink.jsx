import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconCircle,
  IconFile,
  IconPlayerPlay,
  IconRefresh,
  IconRoute,
  IconShieldLock,
  IconSquare,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import api, { endpoints } from "../api";
import { useAppContext } from "../AppContext";
import "../styles/workflow-chat-card.scss";

const humanizeId = id => String(id || "")
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\b\w/g, character => character.toUpperCase());

const taskTitle = (taskId, task) => task?.name?.trim() || humanizeId(taskId) || taskId;
const latestAttempt = task => (task?.attempts || []).at(-1) || null;

const orderedTasks = workflow => {
  if (!workflow?.tasks) return [];
  const ids = Object.keys(workflow.tasks);
  const incoming = new Map(ids.map(id => [id, 0]));
  const outgoing = new Map(ids.map(id => [id, []]));

  for (const edge of workflow.edges || []) {
    if (!Array.isArray(edge) || edge.length !== 2) continue;
    const [from, to] = edge;
    if (!incoming.has(to) || !outgoing.has(from)) continue;
    incoming.set(to, incoming.get(to) + 1);
    outgoing.get(from).push(to);
  }

  const queue = [];
  if (workflow.start && incoming.has(workflow.start)) queue.push(workflow.start);
  for (const id of ids) if (id !== workflow.start && incoming.get(id) === 0) queue.push(id);

  const remaining = new Map(incoming);
  const visited = new Set();
  const result = [];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    if (workflow.tasks[id]?.type === "task") result.push([id, workflow.tasks[id]]);
    for (const next of outgoing.get(id) || []) {
      remaining.set(next, remaining.get(next) - 1);
      if (remaining.get(next) === 0) queue.push(next);
    }
  }

  for (const [id, task] of Object.entries(workflow.tasks)) {
    if (task?.type === "task" && !visited.has(id)) result.push([id, task]);
  }
  return result;
};

const statusLabel = status => ({
  pending: "Pending",
  ready: "Ready",
  running: "In progress",
  completed: "Completed",
  skipped: "Skipped",
  failed: "Failed",
  blocked: "Approval required",
  paused: "Paused",
  stalled: "Stalled",
  cancelled: "Cancelled",
}[status] || humanizeId(status || "unknown"));

const taskStatusClass = task => {
  const status = task?.status || "pending";
  if (["completed", "skipped"].includes(status)) return "completed";
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  if (status === "blocked") return "blocked";
  if (status === "cancelled") return "cancelled";
  return "pending";
};

const attemptIssue = task => {
  const attempt = latestAttempt(task);
  const diagnostics = attempt?.diagnostics || null;
  const message = task?.blockedReason
    || task?.error
    || attempt?.blockedReason
    || attempt?.error
    || diagnostics?.message
    || null;
  return {
    message,
    phase: diagnostics?.phase || null,
    code: diagnostics?.code || null,
  };
};

const executionDetail = task => {
  const attempt = latestAttempt(task);
  if (!attempt) return "";
  const groups = Array.isArray(attempt.executionGroups) ? attempt.executionGroups : [];
  const invocations = Array.isArray(attempt.invocations) ? attempt.invocations : [];

  const map = [...groups].reverse().find(group => group.type === "map");
  if (map) {
    const mapScopes = invocations
      .flatMap(invocation => Array.isArray(invocation.scope) ? invocation.scope : [])
      .filter(scope => scope?.type === "map" && scope.groupId === map.id);
    const total = mapScopes.find(scope => Number.isSafeInteger(scope.total))?.total ?? null;
    const completedIndexes = new Set(invocations
      .filter(invocation => invocation?.kind === "map-item" && invocation.groupId === map.id && invocation.status === "completed")
      .map(invocation => invocation.index)
      .filter(Number.isSafeInteger));
    if (total != null) return `For each · ${completedIndexes.size}/${total} items`;
    if (completedIndexes.size) return `For each · ${completedIndexes.size} items completed`;
    return `For each · concurrency ${map.concurrency ?? 1}`;
  }

  const loop = [...groups].reverse().find(group => group.type === "loop");
  if (loop) {
    const iterations = invocations
      .filter(invocation => invocation?.kind === "validation" && invocation.groupId === loop.id)
      .map(invocation => invocation.iteration)
      .filter(Number.isSafeInteger);
    const current = iterations.length ? Math.max(...iterations) : 1;
    return `Quality review · iteration ${current}/${loop.maxIterations ?? 3}`;
  }

  if (task?.tools?.length) return task.tools.join(", ");
  if (task?.skills?.length) return task.skills.join(", ");
  if (attempt.provider && attempt.model) return `${attempt.provider} · ${attempt.model}`;
  return "";
};

const workflowArtifactIds = workflow => [...new Set(
  Object.values(workflow?.tasks || {})
    .filter(task => task?.type === "task")
    .flatMap(task => task.attempts || [])
    .filter(attempt => attempt.status === "completed")
    .flatMap(attempt => attempt.artifacts || []),
)];

const compactResult = result => {
  if (typeof result === "string") return result.trim();
  if (result == null) return "";
  try {
    const text = JSON.stringify(result, null, 2);
    return text.length > 520 ? `${text.slice(0, 520).trimEnd()}…` : text;
  } catch {
    return String(result);
  }
};

const reconcileWorkflowMessages = (thread, workflowId) => {
  if (!thread) return;
  const messages = [...thread.querySelectorAll(".message[data-workflow-message-id]")]
    .filter(message => message.dataset.workflowMessageId === workflowId);
  messages.forEach((message, index) => {
    message.hidden = index > 0;
  });
};

const Marker = ({ status }) => {
  if (status === "completed") return <IconCheck size={13} stroke={2.5} />;
  if (status === "failed") return <IconX size={13} stroke={2.5} />;
  if (status === "blocked") return <IconShieldLock size={12} stroke={2.2} />;
  if (status === "cancelled") return <IconX size={12} stroke={2} />;
  if (status === "running") return <span className="workflow-chat-card__spinner" aria-hidden="true" />;
  return <IconCircle size={9} stroke={2} />;
};

export default function WorkflowLink({ workflowId, onOpen }) {
  const { officeState } = useAppContext();
  const [busy, setBusy] = useState("");
  const rootRef = useRef(null);
  const workflow = (officeState.workflows || []).find(item => item.id === workflowId) || null;
  const tasks = useMemo(() => orderedTasks(workflow), [workflow]);
  const status = workflow?.status || "unknown";
  const completed = tasks.filter(([, task]) => ["completed", "skipped"].includes(task.status)).length;
  const pendingApproval = (officeState.approvals || []).find(approval => (
    approval.status === "pending" && approval.context?.workflowId === workflowId
  )) || null;
  const conversationId = workflow?.config?.conversationId || null;
  const artifactIds = useMemo(() => workflowArtifactIds(workflow), [workflow]);
  const conversationArtifacts = conversationId ? officeState.artifacts?.[conversationId] || [] : [];
  const artifacts = artifactIds
    .map(id => conversationArtifacts.find(artifact => artifact.id === id))
    .filter(Boolean);
  const result = compactResult(workflow?.result);
  const title = workflow?.process || workflow?.name || workflow?.purpose || "Workflow execution";

  useEffect(() => {
    const article = rootRef.current?.closest?.(".message");
    const thread = article?.closest?.(".chat-thread__messages");
    if (!article || !thread) return undefined;
    article.dataset.workflowMessageId = workflowId;
    reconcileWorkflowMessages(thread, workflowId);
    return () => {
      article.hidden = false;
      delete article.dataset.workflowMessageId;
      reconcileWorkflowMessages(thread, workflowId);
    };
  }, [workflowId]);

  const perform = async (key, request, success) => {
    if (!workflowId || busy) return;
    setBusy(key);
    try {
      await request();
      if (success) toast.success(success);
    } catch (error) {
      toast.error(error.response?.data?.error || error.message || "Workflow action failed.");
    } finally {
      setBusy("");
    }
  };

  const openArtifact = artifact => {
    if (!conversationId || !artifact?.id) return;
    const url = `${api.defaults.baseURL}${endpoints.conversationArtifact(conversationId, artifact.id)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (!workflow) {
    return (
      <button ref={rootRef} type="button" className="workflow-chat-card workflow-chat-card--unknown" onClick={() => onOpen?.(workflowId)}>
        <IconRoute size={16} />
        <span>Workflow {workflowId}</span>
        <small>Open Operations</small>
      </button>
    );
  }

  return (
    <section ref={rootRef} className={`workflow-chat-card workflow-chat-card--${status}`} aria-label={`${statusLabel(status)} Workflow ${workflowId}`}>
      <header className="workflow-chat-card__header">
        <div className="workflow-chat-card__identity">
          <span className="workflow-chat-card__icon"><IconRoute size={15} stroke={2} /></span>
          <div>
            <strong>{title}</strong>
            <small>{workflowId} · {completed}/{tasks.length} Tasks</small>
          </div>
        </div>
        <span className={`workflow-chat-card__status workflow-chat-card__status--${status}`}>{statusLabel(status)}</span>
      </header>

      {!!tasks.length && (
        <div className="workflow-chat-card__timeline">
          {tasks.map(([taskId, task]) => {
            const taskStatus = taskStatusClass(task);
            const issue = attemptIssue(task);
            const detail = executionDetail(task);
            const current = ["running", "blocked", "failed"].includes(taskStatus);
            return (
              <div key={taskId} className={`workflow-chat-card__step workflow-chat-card__step--${taskStatus}`}>
                <span className="workflow-chat-card__marker"><Marker status={taskStatus} /></span>
                <div className="workflow-chat-card__step-body">
                  <div className="workflow-chat-card__step-heading">
                    <strong>{taskTitle(taskId, task)}</strong>
                    {current && <span>{taskStatus === "running" ? "Active" : statusLabel(task.status)}</span>}
                  </div>
                  {detail && <small>{detail}</small>}

                  {taskStatus === "failed" && issue.message && (
                    <div className="workflow-chat-card__issue workflow-chat-card__issue--failed">
                      <IconAlertTriangle size={15} stroke={2} />
                      <div>
                        <strong>Task failed</strong>
                        <span>{issue.message}</span>
                        {(issue.phase || issue.code) && <small>{[issue.phase, issue.code].filter(Boolean).join(" · ")}</small>}
                      </div>
                    </div>
                  )}

                  {taskStatus === "blocked" && (
                    <div className="workflow-chat-card__issue workflow-chat-card__issue--blocked">
                      <IconShieldLock size={15} stroke={2} />
                      <div>
                        <strong>Authorization required</strong>
                        <span>{pendingApproval?.action || issue.message || "This Task is waiting for Carlos approval."}</span>
                        {pendingApproval && (
                          <button
                            type="button"
                            className="button button--primary workflow-chat-card__inline-action"
                            disabled={Boolean(busy)}
                            onClick={() => perform(
                              "approve",
                              () => api.post(endpoints.approvalApprove(pendingApproval.id)),
                              "Approved.",
                            )}
                          >
                            <IconShieldLock size={13} /> Approve access
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {status === "completed" && (result || artifacts.length > 0) && (
        <div className="workflow-chat-card__result">
          {result && (
            <div>
              <strong>Result</strong>
              <p>{result}</p>
            </div>
          )}
          {!!artifacts.length && (
            <div className="workflow-chat-card__artifacts" aria-label="Workflow artifacts">
              {artifacts.map(artifact => (
                <button type="button" key={artifact.id} onClick={() => openArtifact(artifact)}>
                  <IconFile size={13} /> {artifact.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {status === "stalled" && workflow.stalled && (
        <div className="workflow-chat-card__issue workflow-chat-card__issue--failed workflow-chat-card__issue--standalone">
          <IconAlertTriangle size={15} stroke={2} />
          <div>
            <strong>Workflow stalled</strong>
            <span>{workflow.stalled.message || "No Task can currently make progress."}</span>
          </div>
        </div>
      )}

      <footer className="workflow-chat-card__footer">
        <div className="workflow-chat-card__actions">
          {status === "pending" && (
            <button
              type="button"
              className="button button--primary"
              disabled={Boolean(busy)}
              onClick={() => perform("run", () => api.post(endpoints.workflowRun(workflowId)))}
            >
              <IconPlayerPlay size={14} /> Run
            </button>
          )}
          {status === "running" && (
            <button
              type="button"
              className="button button--quiet"
              disabled={Boolean(busy)}
              onClick={() => perform("stop", () => api.post(endpoints.workflowStop(workflowId)), "Workflow stopped.")}
            >
              <IconSquare size={13} /> Stop
            </button>
          )}
          {["failed", "paused", "stalled"].includes(status) && (
            <button
              type="button"
              className="button button--primary"
              disabled={Boolean(busy)}
              onClick={() => perform("resume", () => api.post(endpoints.workflowResume(workflowId)))}
            >
              <IconPlayerPlay size={14} /> Resume
            </button>
          )}
          {status === "cancelled" && (
            <button
              type="button"
              className="button button--quiet"
              disabled={Boolean(busy)}
              onClick={() => perform("restart", () => api.post(endpoints.workflowRestart(workflowId)))}
            >
              <IconRefresh size={14} /> Restart
            </button>
          )}
        </div>
        <button type="button" className="workflow-chat-card__open" onClick={() => onOpen?.(workflowId)}>
          Open Operations
        </button>
      </footer>
    </section>
  );
}
