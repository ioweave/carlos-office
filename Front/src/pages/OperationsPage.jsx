import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconActivity,
  IconArrowLeft,
  IconEdit,
  IconGitBranch,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconRefresh,
  IconReload,
  IconSparkles,
  IconSquare,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { useAppContext } from "../AppContext";
import api, { endpoints } from "../api";
import ProcessGraph from "../components/ProcessGraph";
import TaskConfigurationForm from "../components/TaskConfigurationForm";
import WorkflowDataEditor from "../components/WorkflowDataEditor";

const ACTIVE_WORKFLOW_STATUSES = new Set(["running", "paused", "blocked", "failed", "pending"]);
const STATUS_ORDER = ["running", "paused", "blocked", "failed", "pending", "completed", "cancelled"];
const isTerminal = status => ["completed", "cancelled"].includes(status);
const canResumeTask = status => ["failed", "blocked", "cancelled"].includes(status);
const canCancelTask = status => ["running", "ready", "pending", "blocked"].includes(status);
const canSkipTask = status => ["pending", "ready", "blocked", "failed"].includes(status);
const formatTime = value => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};
const workflowTitle = workflow => workflow.process || workflow.purpose || workflow.id;
const taskStatusMap = workflow => Object.fromEntries(
  Object.entries(workflow?.tasks || {}).map(([id, task]) => [id, task.status]),
);

export default function OperationsPage({ onAskNora, openRequest }) {
  const { officeState, refresh } = useAppContext();
  const workflows = officeState.workflows || [];
  const activeAgents = officeState.agents || [];
  const [selectedId, setSelectedId] = useState("");
  const [events, setEvents] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [editingTask, setEditingTask] = useState(false);
  const [filter, setFilter] = useState("active");
  const [detailTab, setDetailTab] = useState("tasks");
  const [busy, setBusy] = useState("");

  const loadEvents = useCallback(async id => {
    if (!id) return;
    try {
      const response = await api.get(endpoints.events(), { params: { workflowId: id, limit: 100 } });
      setEvents(response.data || []);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not load Workflow activity.");
    }
  }, []);

  const workflow = workflows.find(item => item.id === selectedId) || null;

  useEffect(() => {
    if (!selectedId || detailTab !== "activity") return;
    void loadEvents(selectedId);
  }, [selectedId, detailTab, loadEvents]);

  useEffect(() => {
    if (!openRequest?.workflowId) return;
    setSelectedId(openRequest.workflowId);
    setSelectedTaskId("");
    setEditingTask(false);
  }, [openRequest]);

  const sortedWorkflows = useMemo(() => [...workflows].sort((left, right) => {
    const statusDelta = STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status);
    if (statusDelta !== 0) return statusDelta;
    return String(right.createdAt || right.updatedAt || "").localeCompare(String(left.createdAt || left.updatedAt || ""));
  }), [workflows]);

  const filtered = useMemo(() => sortedWorkflows.filter(item => {
    if (filter === "active") return ACTIVE_WORKFLOW_STATUSES.has(item.status);
    if (filter === "history") return isTerminal(item.status);
    return true;
  }), [sortedWorkflows, filter]);

  const selectedTask = workflow?.tasks?.[selectedTaskId] || null;
  const workflowAgents = activeAgents.filter(agent => agent.context?.workflowId === workflow?.id);

  const refreshCurrentDetail = async id => {
    refresh();
    if (detailTab === "activity") await loadEvents(id);
  };

  const runAction = async (label, request) => {
    if (!workflow) return;
    setBusy(label);
    try {
      await request();
      await refreshCurrentDetail(workflow.id);
      toast.success(`${label} complete.`);
    } catch (error) {
      toast.error(error.response?.data?.error || `${label} failed.`);
    } finally {
      setBusy("");
    }
  };

  const deleteWorkflow = async target => {
    if (!target || target.status === "running") return;
    if (!window.confirm(`Delete Workflow ${target.id}? Its execution record will be removed permanently.`)) return;

    setBusy(`Delete:${target.id}`);
    try {
      await api.delete(endpoints.workflow(target.id));
      if (selectedId === target.id) {
        setSelectedId("");
        setSelectedTaskId("");
        setEditingTask(false);
        setEvents([]);
      }
      refresh();
      toast.success("Workflow deleted.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not delete Workflow.");
    } finally {
      setBusy("");
    }
  };

  const persistAsProcess = async () => {
    if (!workflow || workflow.status === "running") return;
    const suggested = workflow.process || `process-${workflow.id.replace(/^workflow-/, "").slice(0, 8)}`;
    const name = window.prompt("Process name", suggested)?.trim();
    if (!name) return;
    const purpose = window.prompt(
      "Process purpose",
      workflow.purpose || `Reusable Process promoted from ${workflow.id}`,
    );
    if (purpose === null) return;

    setBusy("Promote");
    try {
      const process = (await api.post(endpoints.workflowPromote(workflow.id), {
        name,
        purpose: purpose.trim(),
      })).data;
      toast.success(`Process ${process.name} saved.`);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not save Workflow as a Process.");
    } finally {
      setBusy("");
    }
  };

  const reviewTask = async () => {
    if (!workflow || !selectedTaskId) return;
    setBusy("Review");
    try {
      const result = (await api.post(endpoints.workflowTaskReview(workflow.id, selectedTaskId))).data;
      if (result?.action === "retry") {
        await api.post(endpoints.workflowRun(workflow.id));
        toast.success("Nora reviewed the failure and started a retry.");
      } else {
        toast.message(result?.reason || "Nora escalated this Task to Carlos.");
      }
      await refreshCurrentDetail(workflow.id);
    } catch (error) {
      toast.error(error.response?.data?.error || "Task review failed.");
    } finally {
      setBusy("");
    }
  };

  const resumeSelectedTask = () => {
    if (!workflow || !selectedTaskId) return;
    void runAction("Resume Task", () => api.post(endpoints.workflowResume(workflow.id), {
      taskIds: [selectedTaskId],
    }));
  };

  const cancelSelectedTask = () => {
    if (!workflow || !selectedTaskId) return;
    if (!window.confirm(`Cancel Task ${selectedTaskId}? Its active Agent will be stopped and the Workflow paused.`)) return;
    void runAction("Cancel Task", () => api.post(endpoints.workflowTaskCancel(workflow.id, selectedTaskId)));
  };

  if (workflow) {
    const statuses = taskStatusMap(workflow);
    const attempts = selectedTask?.attempts || [];
    const approvals = (officeState.approvals || []).filter(
      approval => approval.context?.workflowId === workflow.id,
    );

    return (
      <div className="workspace-page operations-studio">
        <header className="page-header">
          <div className="page-header__leading">
            <button type="button" className="icon-button" onClick={() => { setSelectedId(""); setSelectedTaskId(""); setEditingTask(false); setEvents([]); }} aria-label="Back to Operations"><IconArrowLeft size={18} /></button>
            <div className="page-header__copy">
              <span className="eyebrow">Workflow execution</span>
              <h1>{workflowTitle(workflow)}</h1>
              <p>{workflow.id}</p>
            </div>
          </div>
          <div className="page-header__actions">
            <span className={`status-pill status-pill--${workflow.status}`}>{workflow.status}</span>
            {workflow.status !== "running" && <button type="button" className="button button--quiet" disabled={!!busy} onClick={persistAsProcess}><IconGitBranch size={14} /> Save as Process</button>}
            {workflow.status === "pending" && <button type="button" className="button button--primary" disabled={!!busy} onClick={() => runAction("Run", () => api.post(endpoints.workflowRun(workflow.id)))}><IconPlayerPlay size={14} /> Run now</button>}
            {["paused", "blocked", "failed"].includes(workflow.status) && <button type="button" className="button button--primary" disabled={!!busy} onClick={() => runAction("Resume", () => api.post(endpoints.workflowResume(workflow.id), {}))}><IconPlayerPlay size={14} /> Resume</button>}
            {workflow.status !== "pending" && <button type="button" className="button button--quiet" disabled={!!busy} onClick={() => runAction("Restart", () => api.post(endpoints.workflowRestart(workflow.id)))}><IconReload size={14} /> Restart</button>}
            {workflow.status === "running" && <button type="button" className="button button--danger" disabled={!!busy} onClick={() => runAction("Stop", () => api.post(endpoints.workflowStop(workflow.id)))}><IconSquare size={14} /> Stop</button>}
            <button type="button" className="button button--danger" disabled={!!busy || workflow.status === "running"} onClick={() => deleteWorkflow(workflow)}><IconTrash size={14} /> Delete</button>
          </div>
        </header>

        <div className="operations-summary">
          <div><span>Status</span><strong>{workflow.status}</strong></div>
          <div><span>Tasks</span><strong>{Object.keys(workflow.tasks || {}).length}</strong></div>
          <div><span>Agent processes</span><strong>{workflowAgents.length}</strong></div>
          <div><span>Approvals</span><strong>{approvals.filter(item => item.status === "pending").length} pending</strong></div>
        </div>

        <div className="segmented-control page-tabs" role="tablist" aria-label="Workflow detail">
          {["tasks", "activity", "data"].map(tab => <button key={tab} type="button" className={detailTab === tab ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"} onClick={() => setDetailTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}
        </div>

        {detailTab === "tasks" && (
          <div className="studio-layout operations-studio__tasks">
            <section className="studio-layout__canvas">
              <ProcessGraph
                tasks={workflow.tasks}
                edges={workflow.edges}
                start={workflow.start}
                statuses={statuses}
                selectedId={selectedTaskId}
                onSelect={node => { setSelectedTaskId(node.id); setEditingTask(false); }}
              />
            </section>
            <aside className="inspector-panel">
              {!selectedTask ? (
                <div className="inspector-panel__empty"><IconActivity size={24} stroke={1.4} /><strong>Select a Task</strong><span>Inspect or edit its execution configuration, attempts, model, Tools, Skills, and result.</span></div>
              ) : editingTask && selectedTask.type === "task" ? (
                <>
                  <header className="inspector-panel__header">
                    <span className={`status-pill status-pill--${selectedTask.status}`}>{selectedTask.status}</span>
                    <h2>{selectedTask.objective || selectedTaskId}</h2>
                    <code>{selectedTaskId}</code>
                  </header>
                  <TaskConfigurationForm
                    key={`${workflow.id}:${selectedTaskId}`}
                    workflowId={workflow.id}
                    taskId={selectedTaskId}
                    task={selectedTask}
                    disabled={workflow.status === "running"}
                    onSaved={() => {
                      setEditingTask(false);
                      refresh();
                    }}
                    onRevise={() => onAskNora?.(`Review Workflow ${workflow.id}, Task ${selectedTaskId}, and suggest an improved Task configuration.`)}
                  />
                </>
              ) : (
                <>
                  <header className="inspector-panel__header">
                    <span className={`status-pill status-pill--${selectedTask.status}`}>{selectedTask.status}</span>
                    <h2>{selectedTask.objective || selectedTaskId}</h2>
                    <code>{selectedTaskId}</code>
                  </header>
                  <div className="definition-list">
                    <div><span>Model constraint</span><strong>{selectedTask.provider && selectedTask.model ? `${selectedTask.provider} · ${selectedTask.model}` : "Nora selects"}</strong></div>
                    <div><span>Tools</span><strong>{Array.isArray(selectedTask.tools) ? selectedTask.tools.join(", ") || "None" : "Nora selects"}</strong></div>
                    <div><span>Skills</span><strong>{Array.isArray(selectedTask.skills) ? selectedTask.skills.join(", ") || "None" : "Nora selects"}</strong></div>
                    <div><span>Attempts</span><strong>{attempts.length}</strong></div>
                    {selectedTask.blockedReason && <div><span>Blocked</span><strong>{selectedTask.blockedReason}</strong></div>}
                    {selectedTask.error && <div><span>Error</span><strong>{selectedTask.error}</strong></div>}
                  </div>

                  {!!workflowAgents.filter(agent => agent.taskId === selectedTaskId).length && (
                    <div className="definition-list">
                      {workflowAgents.filter(agent => agent.taskId === selectedTaskId).map(agent => (
                        <div key={agent.id}><span>Running Agent</span><strong>{agent.id} · PID {agent.pid} · {agent.model}</strong></div>
                      ))}
                    </div>
                  )}

                  {attempts.length > 0 && (
                    <div className="attempt-list">
                      <h3>Attempts</h3>
                      {[...attempts].reverse().map(attempt => (
                        <details key={attempt.id} className="attempt-card">
                          <summary>
                            <span>#{attempt.attempt}</span>
                            <strong>{attempt.agentId || "Temporary Agent"}</strong>
                            <span className={`status-pill status-pill--${attempt.status}`}>{attempt.status}</span>
                          </summary>
                          <div className="attempt-card__body">
                            {attempt.pid && <span>PID {attempt.pid}</span>}
                            <span>{attempt.provider && attempt.model ? `${attempt.provider} · ${attempt.model}` : "Model not recorded"}</span>
                            <span>Tools: {(attempt.tools || []).join(", ") || "none"}</span>
                            <span>Skills: {(attempt.skills || []).join(", ") || "none"}</span>
                            <span>{formatTime(attempt.startedAt)} → {formatTime(attempt.endedAt)}</span>
                            {attempt.output != null && <pre>{typeof attempt.output === "string" ? attempt.output : JSON.stringify(attempt.output, null, 2)}</pre>}
                            {attempt.error && <pre>{attempt.error}</pre>}
                          </div>
                        </details>
                      ))}
                    </div>
                  )}

                  <div className="inspector-panel__actions">
                    {selectedTask.type === "task" && workflow.status !== "running" && <button type="button" className="button button--quiet" onClick={() => setEditingTask(true)} disabled={!!busy}><IconEdit size={14} /> Edit Task</button>}
                    {selectedTask.type === "task" && canResumeTask(selectedTask.status) && workflow.status !== "running" && <button type="button" className="button button--primary" onClick={resumeSelectedTask} disabled={!!busy}><IconPlayerPlay size={14} /> Resume from Task</button>}
                    {selectedTask.status === "failed" && <button type="button" className="button button--quiet" onClick={reviewTask} disabled={!!busy}><IconSparkles size={14} /> Nora review</button>}
                    {selectedTask.type === "task" && canCancelTask(selectedTask.status) && <button type="button" className="button button--danger" disabled={!!busy} onClick={cancelSelectedTask}><IconSquare size={14} /> Cancel Task</button>}
                    {selectedTask.type === "task" && canSkipTask(selectedTask.status) && <button type="button" className="button button--quiet" disabled={!!busy} onClick={() => runAction("Skip", () => api.post(endpoints.workflowTaskSkip(workflow.id, selectedTaskId)))}><IconPlayerSkipForward size={14} /> Skip Task</button>}
                  </div>
                </>
              )}
            </aside>
          </div>
        )}

        {detailTab === "activity" && (
          <section className="operations-activity panel">
            <div className="panel__header"><div><span className="eyebrow">Runtime timeline</span><h2>Activity</h2></div><button type="button" className="icon-button" onClick={() => loadEvents(workflow.id)} aria-label="Refresh activity"><IconRefresh size={17} /></button></div>
            {!events.length ? <div className="empty-state empty-state--compact"><IconActivity size={24} /><strong>No recorded events</strong></div> : <div className="event-list">{events.map((event, index) => <div key={`${event.id || event.at || "event"}-${index}`} className="event-row"><span className="event-row__dot" /><div><strong>{event.type}</strong><span>{event.taskId || event.tool || event.agentId || event.action || event.reason || "Workflow event"}</span></div><small>{formatTime(event.at || event.createdAt)}</small></div>)}</div>}
          </section>
        )}

        {detailTab === "data" && (
          <div className="operations-data">
            <section className="panel operations-data__editor">
              <div className="panel__header"><div><span className="eyebrow">Workflow contract</span><h2>Inputs & runtime config</h2></div></div>
              <WorkflowDataEditor workflow={workflow} disabled={workflow.status === "running"} onSaved={refresh} />
            </section>
            <section className="panel">
              <div className="panel__header"><div><span className="eyebrow">Captured output</span><h2>Result</h2></div></div>
              <pre className="data-block">{workflow.result == null ? "No result captured yet." : typeof workflow.result === "string" ? workflow.result : JSON.stringify(workflow.result, null, 2)}</pre>
            </section>
            <button type="button" className="button button--quiet" onClick={() => onAskNora?.(`Review Workflow ${workflow.id} and tell me what should be improved or promoted into a reusable Process.`)}><IconSparkles size={15} /> Ask Nora about this Workflow</button>
          </div>
        )}
      </div>
    );
  }

  const activeCount = workflows.filter(item => ACTIVE_WORKFLOW_STATUSES.has(item.status)).length;
  return (
    <div className="workspace-page operations-page">
      <header className="page-header">
        <div className="page-header__copy"><span className="eyebrow">Inspect and control execution</span><h1>Operations</h1><p>Workflows are actual runs. Open one to inspect Tasks, temporary Agent processes, attempts, events, and results.</p></div>
        <div className="page-header__actions"><span className="status-pill status-pill--running">{activeCount} active</span><button type="button" className="icon-button" onClick={refresh} aria-label="Refresh Operations"><IconRefresh size={18} /></button></div>
      </header>
      <div className="segmented-control page-tabs" role="tablist" aria-label="Workflow status">
        {[["active", "Active"], ["history", "History"], ["all", "All"]].map(([id, labelText]) => <button key={id} type="button" className={filter === id ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"} onClick={() => setFilter(id)}>{labelText}</button>)}
      </div>
      {!filtered.length ? (
        <div className="empty-state"><IconActivity size={28} stroke={1.4} /><strong>{filter === "active" ? "Nothing is running" : "No Workflows here"}</strong><span>When Nora starts work, its Workflow appears here.</span></div>
      ) : (
        <div className="workflow-list">
          {filtered.map(item => {
            const tasks = Object.values(item.tasks || {});
            const completeTasks = tasks.filter(task => task.status === "completed" || task.status === "skipped").length;
            const runningTasks = tasks.filter(task => task.status === "running").length;
            return (
              <div
                key={item.id}
                className="workflow-row"
                onClick={() => { setSelectedId(item.id); setEditingTask(false); }}
              >
                <span className={`workflow-row__status workflow-row__status--${item.status}`} />
                <span className="workflow-row__copy"><strong>{workflowTitle(item)}</strong><small>{item.id}</small></span>
                <span className="workflow-row__progress">{completeTasks}/{tasks.length} tasks</span>
                <span className="workflow-row__agents">{runningTasks ? `${runningTasks} running` : "—"}</span>
                <span className={`status-pill status-pill--${item.status}`}>{item.status}</span>
                {filter === "history" && (
                  <button
                    type="button"
                    className="icon-button"
                    disabled={!!busy}
                    aria-label={`Delete Workflow ${item.id}`}
                    title="Delete Workflow"
                    onClick={event => {
                      event.stopPropagation();
                      void deleteWorkflow(item);
                    }}
                  >
                    <IconTrash size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}