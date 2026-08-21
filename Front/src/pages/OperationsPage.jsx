import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconActivity,
  IconArrowLeft,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconRefresh,
  IconReload,
  IconSparkles,
  IconSquare,
} from "@tabler/icons-react";
import { toast } from "sonner";

import api, { endpoints } from "../api";
import ProcessGraph from "../components/ProcessGraph";

const STATUS_ORDER = ["running", "blocked", "failed", "completed", "cancelled", "pending"];

const formatTime = value => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};

const workflowTitle = workflow => workflow.process || workflow.purpose || workflow.id;

const taskStatusMap = workflow => Object.fromEntries(
  Object.entries(workflow?.tasks || {}).map(([id, task]) => [id, task.status]),
);

const isTerminal = status => ["completed", "failed", "cancelled"].includes(status);

export default function OperationsPage({ onAskNora, openRequest }) {
  const [workflows, setWorkflows] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [inspect, setInspect] = useState(null);
  const [events, setEvents] = useState([]);
  const [activeAgents, setActiveAgents] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [filter, setFilter] = useState("active");
  const [detailTab, setDetailTab] = useState("tasks");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const loadOverview = useCallback(async ({ quiet = false } = {}) => {
    try {
      const [workflowResponse, activeResponse] = await Promise.all([
        api.get(endpoints.workflows()),
        api.get(endpoints.agentsActive()),
      ]);
      setWorkflows(workflowResponse.data || []);
      setActiveAgents(activeResponse.data || []);
    } catch (error) {
      if (!quiet) toast.error(error.response?.data?.error || "Could not load Operations.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async id => {
    if (!id) return;
    try {
      const [inspectResponse, eventResponse, activeResponse] = await Promise.all([
        api.get(endpoints.workflowInspect(id)),
        api.get(endpoints.events(), { params: { workflowId: id, limit: 100 } }),
        api.get(endpoints.agentsActive()),
      ]);
      setInspect(inspectResponse.data || null);
      setEvents(eventResponse.data || []);
      setActiveAgents(activeResponse.data || []);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not inspect Workflow.");
    }
  }, []);

  useEffect(() => {
    loadOverview();
    const timer = setInterval(() => loadOverview({ quiet: true }), 5000);
    return () => clearInterval(timer);
  }, [loadOverview]);

  useEffect(() => {
    if (!selectedId) return undefined;
    loadDetail(selectedId);
    const timer = setInterval(() => loadDetail(selectedId), 4000);
    return () => clearInterval(timer);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!openRequest?.workflowId) return;
    setSelectedId(openRequest.workflowId);
    setSelectedTaskId("");
  }, [openRequest]);

  const sortedWorkflows = useMemo(() => [...workflows].sort((left, right) => {
    const statusDelta = STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status);
    if (statusDelta !== 0) return statusDelta;
    return String(right.createdAt || right.updatedAt || "").localeCompare(String(left.createdAt || left.updatedAt || ""));
  }), [workflows]);

  const filtered = useMemo(() => sortedWorkflows.filter(workflow => {
    if (filter === "active") return ["running", "blocked", "pending"].includes(workflow.status);
    if (filter === "history") return isTerminal(workflow.status);
    return true;
  }), [sortedWorkflows, filter]);

  const workflow = inspect?.workflow || workflows.find(item => item.id === selectedId) || null;
  const selectedTask = workflow?.tasks?.[selectedTaskId] || null;
  const workflowAgents = activeAgents.filter(agent => agent.workflowId === workflow?.id);

  const runAction = async (label, request) => {
    if (!workflow) return;
    setBusy(label);
    try {
      await request();
      await Promise.all([loadDetail(workflow.id), loadOverview({ quiet: true })]);
      toast.success(`${label} complete.`);
    } catch (error) {
      toast.error(error.response?.data?.error || `${label} failed.`);
    } finally {
      setBusy("");
    }
  };

  const reviewTask = async () => {
    if (!workflow || !selectedTaskId) return;
    setBusy("Review");
    try {
      const result = (
        await api.post(endpoints.workflowTaskReview(workflow.id, selectedTaskId))
      ).data;
      if (result?.action === "retry") {
        await api.post(endpoints.workflowRun(workflow.id));
        toast.success("Nora reviewed the failure and started a retry.");
      } else {
        toast.message(result?.reason || "Nora escalated this Task to Carlos.");
      }
      await Promise.all([loadDetail(workflow.id), loadOverview({ quiet: true })]);
    } catch (error) {
      toast.error(error.response?.data?.error || "Task review failed.");
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return <div className="workspace-page"><div className="page-state"><span className="spinner" /> Loading Operations</div></div>;
  }

  if (workflow) {
    const statuses = taskStatusMap(workflow);
    const attempts = selectedTask?.attempts || [];
    const approvals = inspect?.approvals || [];

    return (
      <div className="workspace-page operations-studio">
        <header className="page-header">
          <div className="page-header__leading">
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                setSelectedId("");
                setInspect(null);
                setSelectedTaskId("");
              }}
              aria-label="Back to Operations"
            >
              <IconArrowLeft size={18} />
            </button>
            <div className="page-header__copy">
              <span className="eyebrow">Workflow execution</span>
              <h1>{workflowTitle(workflow)}</h1>
              <p>{workflow.id}</p>
            </div>
          </div>
          <div className="page-header__actions">
            <span className={`status-pill status-pill--${workflow.status}`}>{workflow.status}</span>
            {workflow.status === "running" && (
              <button
                type="button"
                className="button button--danger"
                disabled={!!busy}
                onClick={() => runAction("Cancel", () => api.post(endpoints.workflowCancel(workflow.id)))}
              >
                <IconSquare size={14} /> Cancel
              </button>
            )}
            {workflow.status === "blocked" && (
              <button
                type="button"
                className="button button--primary"
                disabled={!!busy}
                onClick={() => runAction("Resume", () => api.post(endpoints.workflowResume(workflow.id), {}))}
              >
                <IconPlayerPlay size={14} /> Resume
              </button>
            )}
            {isTerminal(workflow.status) && workflow.status !== "completed" && (
              <button
                type="button"
                className="button button--quiet"
                disabled={!!busy}
                onClick={() => runAction("Restart", () => api.post(endpoints.workflowRestart(workflow.id)))}
              >
                <IconReload size={14} /> Restart
              </button>
            )}
          </div>
        </header>

        <div className="operations-summary">
          <div><span>Status</span><strong>{workflow.status}</strong></div>
          <div><span>Tasks</span><strong>{Object.keys(workflow.tasks || {}).length}</strong></div>
          <div><span>Running Agents</span><strong>{workflowAgents.length}</strong></div>
          <div><span>Approvals</span><strong>{approvals.filter(item => item.status === "pending").length} pending</strong></div>
        </div>

        <div className="segmented-control page-tabs" role="tablist" aria-label="Workflow detail">
          <button
            type="button"
            className={detailTab === "tasks" ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"}
            onClick={() => setDetailTab("tasks")}
          >
            Tasks
          </button>
          <button
            type="button"
            className={detailTab === "activity" ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"}
            onClick={() => setDetailTab("activity")}
          >
            Activity
          </button>
          <button
            type="button"
            className={detailTab === "data" ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"}
            onClick={() => setDetailTab("data")}
          >
            Data
          </button>
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
                onSelect={node => setSelectedTaskId(node.id)}
              />
            </section>
            <aside className="inspector-panel">
              {!selectedTask ? (
                <div className="inspector-panel__empty">
                  <IconActivity size={24} stroke={1.4} />
                  <strong>Select a Task</strong>
                  <span>Inspect its runtime state, Agent, attempts, and result.</span>
                </div>
              ) : (
                <>
                  <header className="inspector-panel__header">
                    <span className={`status-pill status-pill--${selectedTask.status}`}>{selectedTask.status}</span>
                    <h2>{selectedTask.objective || selectedTaskId}</h2>
                    <code>{selectedTaskId}</code>
                  </header>
                  <div className="definition-list">
                    <div><span>Agent</span><strong>{selectedTask.agent || "Nora selects"}</strong></div>
                    <div><span>Tools</span><strong>{(selectedTask.tools || []).join(", ") || "—"}</strong></div>
                    <div><span>Skills</span><strong>{(selectedTask.skills || []).join(", ") || "—"}</strong></div>
                    <div><span>Attempts</span><strong>{attempts.length}</strong></div>
                    {selectedTask.blockedReason && <div><span>Blocked</span><strong>{selectedTask.blockedReason}</strong></div>}
                    {selectedTask.error && <div><span>Error</span><strong>{selectedTask.error}</strong></div>}
                  </div>

                  {attempts.length > 0 && (
                    <div className="attempt-list">
                      <h3>Attempts</h3>
                      {[...attempts].reverse().map(attempt => (
                        <details key={attempt.id} className="attempt-card">
                          <summary>
                            <span>#{attempt.attempt}</span>
                            <strong>{attempt.agent || "Agent"}</strong>
                            <span className={`status-pill status-pill--${attempt.status}`}>{attempt.status}</span>
                          </summary>
                          <div className="attempt-card__body">
                            <span>{attempt.provider && attempt.model ? `${attempt.provider} · ${attempt.model}` : "Model not recorded"}</span>
                            <span>{formatTime(attempt.startedAt)} → {formatTime(attempt.endedAt)}</span>
                            {attempt.output != null && <pre>{typeof attempt.output === "string" ? attempt.output : JSON.stringify(attempt.output, null, 2)}</pre>}
                            {attempt.error && <pre>{attempt.error}</pre>}
                          </div>
                        </details>
                      ))}
                    </div>
                  )}

                  <div className="inspector-panel__actions">
                    {["failed", "blocked"].includes(selectedTask.status) && (
                      <button type="button" className="button button--primary" onClick={reviewTask} disabled={!!busy}>
                        <IconSparkles size={14} /> Nora review
                      </button>
                    )}
                    {!isTerminal(selectedTask.status) && selectedTask.type === "task" && (
                      <button
                        type="button"
                        className="button button--quiet"
                        disabled={!!busy}
                        onClick={() => runAction(
                          "Skip",
                          () => api.post(endpoints.workflowTaskSkip(workflow.id, selectedTaskId)),
                        )}
                      >
                        <IconPlayerSkipForward size={14} /> Skip Task
                      </button>
                    )}
                  </div>
                </>
              )}
            </aside>
          </div>
        )}

        {detailTab === "activity" && (
          <section className="operations-activity panel">
            <div className="panel__header">
              <div><span className="eyebrow">Runtime timeline</span><h2>Activity</h2></div>
              <button type="button" className="icon-button" onClick={() => loadDetail(workflow.id)} aria-label="Refresh activity">
                <IconRefresh size={17} />
              </button>
            </div>
            {!events.length ? (
              <div className="empty-state empty-state--compact"><IconActivity size={24} /><strong>No recorded events</strong></div>
            ) : (
              <div className="event-list">
                {events.map((event, index) => (
                  <div key={`${event.id || event.at || "event"}-${index}`} className="event-row">
                    <span className="event-row__dot" />
                    <div>
                      <strong>{event.type}</strong>
                      <span>{event.taskId || event.tool || event.action || event.reason || "Workflow event"}</span>
                    </div>
                    <small>{formatTime(event.at || event.createdAt)}</small>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {detailTab === "data" && (
          <div className="operations-data">
            <section className="panel">
              <div className="panel__header"><div><span className="eyebrow">Workflow contract</span><h2>Inputs</h2></div></div>
              <pre className="data-block">{JSON.stringify(workflow.inputs || {}, null, 2)}</pre>
            </section>
            <section className="panel">
              <div className="panel__header"><div><span className="eyebrow">Runtime settings</span><h2>Config</h2></div></div>
              <pre className="data-block">{JSON.stringify(workflow.config || {}, null, 2)}</pre>
            </section>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => onAskNora?.(`Review Workflow ${workflow.id} and tell me what should be improved or promoted into a reusable Process.`)}
            >
              <IconSparkles size={15} /> Ask Nora about this Workflow
            </button>
          </div>
        )}
      </div>
    );
  }

  const activeCount = workflows.filter(item => ["running", "blocked", "pending"].includes(item.status)).length;

  return (
    <div className="workspace-page operations-page">
      <header className="page-header">
        <div className="page-header__copy">
          <span className="eyebrow">Inspect and control execution</span>
          <h1>Operations</h1>
          <p>Workflows are actual runs. Open one to inspect Tasks, Agent processes, attempts, events, and results.</p>
        </div>
        <div className="page-header__actions">
          <span className="status-pill status-pill--running">{activeCount} active</span>
          <button type="button" className="icon-button" onClick={() => loadOverview()} aria-label="Refresh Operations">
            <IconRefresh size={18} />
          </button>
        </div>
      </header>

      <div className="segmented-control page-tabs" role="tablist" aria-label="Workflow status">
        {[
          ["active", "Active"],
          ["history", "History"],
          ["all", "All"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={filter === id ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {!filtered.length ? (
        <div className="empty-state">
          <IconActivity size={28} stroke={1.4} />
          <strong>{filter === "active" ? "Nothing is running" : "No Workflows here"}</strong>
          <span>When Nora starts work, its Workflow appears here.</span>
        </div>
      ) : (
        <div className="workflow-list">
          {filtered.map(item => {
            const runningAgents = activeAgents.filter(agent => agent.workflowId === item.id).length;
            const tasks = Object.values(item.tasks || {});
            const completeTasks = tasks.filter(task => task.status === "completed" || task.status === "skipped").length;
            return (
              <button key={item.id} type="button" className="workflow-row" onClick={() => setSelectedId(item.id)}>
                <span className={`workflow-row__status workflow-row__status--${item.status}`} />
                <span className="workflow-row__copy">
                  <strong>{workflowTitle(item)}</strong>
                  <small>{item.id}</small>
                </span>
                <span className="workflow-row__progress">{completeTasks}/{tasks.length} tasks</span>
                <span className="workflow-row__agents">{runningAgents ? `${runningAgents} agent${runningAgents === 1 ? "" : "s"}` : "—"}</span>
                <span className={`status-pill status-pill--${item.status}`}>{item.status}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
