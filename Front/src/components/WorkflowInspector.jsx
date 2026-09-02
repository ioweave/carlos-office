import {
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconSparkles,
  IconSquare,
  IconTrash,
  IconX,
} from "@tabler/icons-react";

import ExecutionGroupForm from "./ExecutionGroupForm";
import TaskConfigurationForm from "./TaskConfigurationForm";

const canResumeTask = status => ["failed", "blocked", "cancelled"].includes(status);
const canCancelTask = status => ["running", "ready", "pending", "blocked"].includes(status);
const canSkipTask = status => ["pending", "ready", "blocked", "failed"].includes(status);
const formatTime = value => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};
const humanizeId = id => String(id || "")
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\b\w/g, character => character.toUpperCase());
const taskTitle = (taskId, task) => task?.name?.trim() || humanizeId(taskId) || taskId;
const errorText = value => {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
};

export default function WorkflowInspector({
  workflow,
  selectedTaskId,
  selectedTask,
  selectedEdge,
  selectedGroup,
  editable,
  mode,
  setMode,
  busy,
  workflowAgents,
  onClose,
  onTaskSaved,
  onTaskRevise,
  onRemoveTask,
  onRemoveEdge,
  onGroupChange,
  onRemoveGroup,
  onResumeTask,
  onReviewTask,
  onCancelTask,
  onSkipTask,
  onFailureDetails,
}) {
  if ((!selectedTask && !selectedEdge && !selectedGroup) || selectedTask?.status === "failed") return null;
  const attempts = selectedTask?.attempts || [];
  const taskAgents = workflowAgents.filter(agent => agent.taskId === selectedTaskId);

  return (
    <aside className="inspector-panel inspector-panel--floating">
      <header className="inspector-panel__header inspector-panel__header--rows">
        <div className="inspector-panel__meta">
          {selectedTask && <span className={`status-pill status-pill--${selectedTask.status}`}>{selectedTask.status}</span>}
          {selectedGroup && <span className="status-pill">{selectedGroup.type}</span>}
          <code>{selectedTaskId || selectedGroup?.id || (selectedEdge ? `${selectedEdge[0]} → ${selectedEdge[1]}` : "")}</code>
        </div>
        <div className="inspector-panel__title-row">
          <h2>{selectedTask ? taskTitle(selectedTaskId, selectedTask) : selectedGroup ? selectedGroup.name || humanizeId(selectedGroup.id) : "Connection"}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close inspector"><IconX size={16} /></button>
        </div>
      </header>

      {selectedEdge && !selectedTask && !selectedGroup && (
        <div className="workflow-edge-inspector">
          <p>Connections define Task dependency order. Execution groups change how contained Tasks run without adding graph cycles.</p>
          {editable && <button type="button" className="button button--danger" onClick={() => onRemoveEdge(selectedEdge)}><IconTrash size={14} /> Remove connection</button>}
        </div>
      )}

      {selectedGroup && (
        <ExecutionGroupForm
          group={selectedGroup}
          disabled={!editable}
          onChange={onGroupChange}
          onRemove={editable ? onRemoveGroup : null}
        />
      )}

      {selectedTask && (
        <>
          <div className="workflow-inspector-tabs">
            <button type="button" aria-selected={mode === "config"} onClick={() => setMode("config")}>Configuration</button>
            <button type="button" aria-selected={mode === "runs"} onClick={() => setMode("runs")}>Execution · {attempts.length}</button>
          </div>

          {mode === "config" && selectedTask.type === "task" && (
            <TaskConfigurationForm
              key={`${workflow.id}:${selectedTaskId}`}
              workflowId={workflow.id}
              taskId={selectedTaskId}
              task={selectedTask}
              disabled={!editable}
              onSaved={onTaskSaved}
              onRevise={onTaskRevise}
            />
          )}

          {mode === "config" && selectedTask.type !== "task" && (
            <div className="definition-list"><div><span>Node</span><strong>{selectedTask.type}</strong></div></div>
          )}

          {mode === "runs" && (
            <div className="workflow-run-inspector">
              <div className="definition-list">
                {selectedTask.type === "task" && <div><span>Objective</span><strong>{selectedTask.objective || "—"}</strong></div>}
                {selectedTask.type === "task" && <div><span>Model</span><strong>{selectedTask.provider && selectedTask.model ? `${selectedTask.provider} · ${selectedTask.model}` : "Nora selects"}</strong></div>}
                {taskAgents.map(agent => <div key={agent.id}><span>Running Agent</span><strong>{agent.id} · PID {agent.pid}{agent.invocationId ? ` · ${agent.invocationId}` : ""}</strong></div>)}
              </div>

              {!!attempts.length && (
                <div className="attempt-list">
                  {[...attempts].reverse().map(attempt => (
                    <details key={attempt.id} className="attempt-card" open={attempt.status === "failed"}>
                      <summary><span>#{attempt.attempt}</span><strong>{attempt.agentId || (attempt.invocations?.length ? `${attempt.invocations.length} invocations` : "Temporary Agent")}</strong><span className={`status-pill status-pill--${attempt.status}`}>{attempt.status}</span></summary>
                      <div className="attempt-card__body">
                        <span>{attempt.provider && attempt.model ? `${attempt.provider} · ${attempt.model}` : "Model not recorded"}</span>
                        <span>{formatTime(attempt.startedAt)} → {formatTime(attempt.endedAt)}</span>
                        {attempt.executionGroups?.length > 0 && <span>Scopes: {attempt.executionGroups.map(group => group.type === "map" ? `Map ${group.name || group.id}` : `Loop ${group.name || group.id}`).join(" → ")}</span>}
                        {attempt.output != null && <pre>{typeof attempt.output === "string" ? attempt.output : JSON.stringify(attempt.output, null, 2)}</pre>}
                        {attempt.data != null && <details><summary>Structured data</summary><pre>{JSON.stringify(attempt.data, null, 2)}</pre></details>}
                        {attempt.invocations?.length > 0 && (
                          <details>
                            <summary>Invocation history · {attempt.invocations.length}</summary>
                            <div className="invocation-list">
                              {attempt.invocations.map(invocation => (
                                <div key={invocation.id} className={`invocation-row invocation-row--${invocation.status}`}>
                                  <strong>{invocation.kind}</strong>
                                  <span>{invocation.scope?.map(scope => scope.type === "map" ? `${scope.groupId}[${scope.index}]` : `${scope.groupId}#${scope.iteration}`).join(" · ") || "base"}</span>
                                  {invocation.score != null && <span>score {Math.round(invocation.score * 100)}%</span>}
                                  {invocation.feedback && <small>{invocation.feedback}</small>}
                                  {invocation.error && <small>{invocation.error}</small>}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        {attempt.status === "failed" && <button type="button" className="button button--quiet" onClick={() => onFailureDetails(attempt)}>Failure details</button>}
                        {attempt.error && <pre className="attempt-card__error">{errorText(attempt.error)}</pre>}
                      </div>
                    </details>
                  ))}
                </div>
              )}

              <div className="inspector-panel__actions">
                {editable && selectedTask.type === "task" && <button type="button" className="button button--danger" onClick={onRemoveTask} disabled={!!busy}><IconTrash size={14} /> Remove Task</button>}
                {selectedTask.status === "failed" && <button type="button" className="button button--quiet" onClick={onReviewTask} disabled={!!busy}><IconSparkles size={14} /> Nora review</button>}
                {canResumeTask(selectedTask.status) && workflow.status !== "running" && workflow.status !== "pending" && <button type="button" className="button button--primary" onClick={onResumeTask} disabled={!!busy}><IconPlayerPlay size={14} /> Resume from Task</button>}
                {canCancelTask(selectedTask.status) && workflow.status !== "running" && workflow.status !== "pending" && <button type="button" className="button button--danger" onClick={onCancelTask} disabled={!!busy}><IconSquare size={14} /> Cancel Task</button>}
                {canSkipTask(selectedTask.status) && workflow.status !== "running" && <button type="button" className="button button--quiet" onClick={onSkipTask} disabled={!!busy}><IconPlayerSkipForward size={14} /> Skip Task</button>}
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  );
}