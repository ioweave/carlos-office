import { useCallback, useEffect, useMemo, useState } from "react";
import { IconArrowLeft, IconBolt, IconCircleCheck, IconRefresh, IconReload, IconRoute, IconPlayerSkipForward, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import api, { endpoints } from "../api";
import ProcessGraph from "../components/ProcessGraph";
import StateView from "../components/StateView";
import StatusBadge from "../components/StatusBadge";

const STATUS_FILTERS = ["all", "running", "blocked", "failed", "completed", "cancelled"];

const statusTone = {
  running: "info",
  blocked: "warning",
  failed: "danger",
  completed: "success",
  cancelled: "neutral",
};

const formatTime = value => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};

const AttemptDetail = ({ attempt }) => {
  const fields = {
    id: attempt.id,
    workflowId: attempt.workflowId,
    taskId: attempt.taskId,
    attempt: attempt.attempt,
    agent: attempt.agent,
    provider: attempt.provider,
    model: attempt.model,
    status: attempt.status,
    approvalId: attempt.approvalId,
    startedAt: attempt.startedAt,
    endedAt: attempt.endedAt,
    blockedReason: attempt.blockedReason,
    error: attempt.error,
    input: attempt.input,
    tools: attempt.tools,
    skills: attempt.skills,
    output: attempt.output,
  };
  return (
    <div className="operations-attempts__item">
      <header className="operations-attempts__head">
        <StatusBadge tone={statusTone[attempt.status] || "neutral"}>#{attempt.attempt} {attempt.status}</StatusBadge>
        <small className="operations-attempts__head-meta">{attempt.agent || "—"}</small>
        <small className="operations-attempts__head-meta">{attempt.provider && attempt.model ? `${attempt.provider} · ${attempt.model}` : "—"}</small>
        <small className="operations-attempts__time">{formatTime(attempt.startedAt)} → {formatTime(attempt.endedAt)}</small>
      </header>
      <pre className="operations-result">{JSON.stringify(fields, null, 2)}</pre>
    </div>
  );
};

export default function OperationsPage({ onAskNora, openRequest }) {
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [inspect, setInspect] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [busy, setBusy] = useState("");
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteDraft, setPromoteDraft] = useState({ name: "", purpose: "" });

  const loadList = useCallback(async () => {
    try {
      const list = (await api.get(endpoints.workflows())).data || [];
      setWorkflows(list);
      setError("");
    } catch (fetchError) {
      setError(fetchError.response?.data?.error || "Could not load workflows.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadInspect = useCallback(async id => {
    if (!id) return setInspect(null);
    try {
      const res = await api.get(endpoints.workflowInspect(id));
      setInspect(res.data);
    } catch (fetchError) {
      setInspect(null);
      toast.error(fetchError.response?.data?.error || "Could not inspect workflow.");
    }
  }, []);

  useEffect(() => { loadList(); const timer = setInterval(loadList, 5000); return () => clearInterval(timer); }, [loadList]);

  useEffect(() => {
    if (!selectedId) return undefined;
    loadInspect(selectedId);
    const timer = setInterval(() => loadInspect(selectedId), 4000);
    return () => clearInterval(timer);
  }, [selectedId, loadInspect]);

  // Auto-select workflow when navigated here from Chat (request-token pattern).
  useEffect(() => {
    if (!openRequest?.workflowId) return;
    setSelectedId(openRequest.workflowId);
    setSelectedTaskId("");
    setLoading(false);
  }, [openRequest?.token, openRequest?.workflowId]);  

  const filtered = useMemo(() => workflows.filter(item => filter === "all" || item.status === filter), [workflows, filter]);
  const workflow = useMemo(() => inspect?.workflow || workflows.find(item => item.id === selectedId) || null, [inspect, workflows, selectedId]);
  const task = useMemo(() => workflow?.tasks?.[selectedTaskId] || null, [workflow, selectedTaskId]);

  const act = async (label, action) => {
    if (!workflow) return;
    setBusy(label);
    try {
      await action();
      await loadInspect(workflow.id);
      await loadList();
      toast.success(`${label} complete.`);
    } catch (fetchError) {
      toast.error(fetchError.response?.data?.error || `${label} failed.`);
    } finally {
      setBusy("");
    }
  };

  const reviewTask = async () => {
    if (!workflow || !selectedTaskId) return;

    setBusy("Review");

    try {
      const review = (
        await api.post(
          endpoints.workflowTaskReview(
            workflow.id,
            selectedTaskId,
          ),
        )
      ).data;

      if (review?.action === "retry") {
        await api.post(endpoints.workflowRun(workflow.id));
        toast.success("Task reviewed and retry started.");
      } else {
        toast.message(
          review?.reason
            ? `Task escalated: ${review.reason}`
            : "Task requires Carlos's attention.",
        );
      }

      await loadInspect(workflow.id);
      await loadList();
    } catch (error) {
      toast.error(
        error.response?.data?.error
        || "Task review failed.",
      );
    } finally {
      setBusy("");
    }
  };

  const promote = async event => {
    event.preventDefault();
    if (!promoteDraft.name.trim()) return toast.error("Name the new Process.");
    setBusy("promote");
    try {
      await api.post(endpoints.workflowPromote(workflow.id), { name: promoteDraft.name.trim(), purpose: promoteDraft.purpose.trim() || null });
      toast.success("Workflow promoted to Process.");
      setPromoteOpen(false);
      setPromoteDraft({ name: "", purpose: "" });
      await loadList();
    } catch (fetchError) {
      toast.error(fetchError.response?.data?.error || "Promotion failed.");
    } finally {
      setBusy("");
    }
  };

  if (loading) return <div className="operations-page redesign-page"><StateView variant="loading" /></div>;
  if (error && !workflows.length) return <div className="operations-page redesign-page"><StateView variant="error" message={error} actions={<button className="secondary-button" onClick={loadList}><IconRefresh size={15} /> Retry</button>} /></div>;

  if (workflow) {
    const statuses = Object.fromEntries(Object.entries(workflow.tasks || {}).map(([id, t]) => [id, t.status]));
    const approvals = inspect?.approvals || [];
    const resumable = workflow.status === "blocked";
    const attempts = task?.attempts || [];

    return (
      <div className="operations-studio redesign-page">
        <header className="redesign-header">
          <div className="redesign-header__leading">
            <button type="button" className="icon-button redesign-header__back" onClick={() => { setSelectedId(null); setInspect(null); }} aria-label="Back to workflow list"><IconArrowLeft size={18} /></button>
            <span className="eyebrow">Workflow runtime</span>
            <h1 className="redesign-header__title">{workflow.process || "Ad-hoc workflow"}</h1>
            <p className="redesign-header__subtitle">{workflow.id} · <StatusBadge tone={statusTone[workflow.status] || "neutral"}>{workflow.status}</StatusBadge></p>
          </div>
          <div className="operations-studio__header-actions">
            {resumable && <button type="button" className="secondary-button" onClick={() => act("Resume", () => api.post(endpoints.workflowResume(workflow.id), {}))} disabled={!!busy}><IconReload size={15} /> Resume</button>}
            <button type="button" className="secondary-button" onClick={() => act("Restart", () => api.post(endpoints.workflowRestart(workflow.id)))} disabled={!!busy || workflow.status === "running"}><IconRefresh size={15} /> Restart</button>
            <button type="button" className="danger-button" onClick={() => act("Cancel", () => api.post(endpoints.workflowCancel(workflow.id)))} disabled={!!busy || workflow.status === "cancelled"}><IconX size={15} /> Cancel</button>
            <button type="button" className="primary-button" onClick={() => setPromoteOpen(true)} disabled={!!busy || workflow.status !== "completed"}><IconRoute size={15} /> Promote</button>
          </div>
        </header>

        <div className="operations-studio__body">
          <div className="operations-studio__graph">
            <ProcessGraph
              tasks={workflow.tasks}
              edges={workflow.edges}
              start={workflow.start}
              end={workflow.end}
              statuses={statuses}
              selectedId={selectedTaskId}
              onSelect={node => setSelectedTaskId(node.id)}
            />
          </div>
          <aside className="operations-studio__inspector">
            {!!approvals.length && (
              <section className="operations-studio__inspector-section">
                <span className="eyebrow">Pending authorizations</span>
                <ul className="operations-approvals">
                  {approvals.map(approval => (
                    <li key={approval.id} className="operations-approvals__item">
                      <strong className="operations-approvals__title">{approval.tool || "Action"}</strong>
                      <small className="operations-approvals__meta">{approval.reason || "Authorization required"}</small>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {task && (
              <section className="operations-studio__inspector-section">
                <span className="eyebrow">Task · {task.type}</span>
                <h2 className="operations-studio__inspector-title">{task.objective || selectedTaskId}</h2>
                <StatusBadge tone={statusTone[task.status] || "neutral"}>{task.status}</StatusBadge>
                <dl className="meta-list">
                  <div className="meta-list__row"><dt className="meta-list__term">Objective</dt><dd className="meta-list__value">{task.objective || "—"}</dd></div>
                  <div className="meta-list__row"><dt className="meta-list__term">Inputs</dt><dd className="meta-list__value">{(task.inputs || []).join(", ") || "—"}</dd></div>
                  <div className="meta-list__row"><dt className="meta-list__term">Output</dt><dd className="meta-list__value">{task.output || "—"}</dd></div>
                  <div className="meta-list__row"><dt className="meta-list__term">Completion</dt><dd className="meta-list__value">{task.completion || "—"}</dd></div>
                  <div className="meta-list__row"><dt className="meta-list__term">Tools</dt><dd className="meta-list__value">{(task.tools || []).join(", ") || "—"}</dd></div>
                  <div className="meta-list__row"><dt className="meta-list__term">Skills</dt><dd className="meta-list__value">{(task.skills || []).join(", ") || "—"}</dd></div>
                  <div className="meta-list__row"><dt className="meta-list__term">Agent</dt><dd className="meta-list__value">{task.agent || "—"}</dd></div>
                  <div className="meta-list__row"><dt className="meta-list__term">Provider</dt><dd className="meta-list__value">{task.provider || "—"}</dd></div>
                  <div className="meta-list__row"><dt className="meta-list__term">Model</dt><dd className="meta-list__value">{task.model || "—"}</dd></div>
                </dl>
                {!!attempts.length && (
                  <div className="operations-attempts">
                    <span className="eyebrow">Attempts · {attempts.length}</span>
                    {attempts.map(attempt => <AttemptDetail key={attempt.id} attempt={attempt} />)}
                  </div>
                )}
                <div className="operations-task-actions">
                  {task.status === "blocked" && <button type="button" className="secondary-button" onClick={() => act("Skip", () => api.post(endpoints.workflowTaskSkip(workflow.id, selectedTaskId)))} disabled={!!busy}><IconPlayerSkipForward size={15} /> Skip</button>}
                  {task.status === "failed" && <button type="button" className="secondary-button" onClick={reviewTask} disabled={!!busy}><IconRefresh size={15} /> Review</button>}
                  <button type="button" className="secondary-button" onClick={() => onAskNora?.(`Workflow ${workflow.id} task ${task.objective || selectedTaskId} needs revision. Update it.`)}><IconBolt size={15} /> Ask Nora</button>
                </div>
              </section>
            )}
            {workflow.result != null && (
              <section className="operations-studio__inspector-section">
                <span className="eyebrow">Result</span>
                <pre className="operations-result">{JSON.stringify(workflow.result, null, 2)}</pre>
              </section>
            )}
          </aside>
        </div>

        {promoteOpen && (
          <div className="dialog" onClick={() => setPromoteOpen(false)} role="dialog" aria-modal="true">
            <form className="dialog__panel" onClick={event => event.stopPropagation()} onSubmit={promote}>
              <h2 className="dialog__title">Promote to Process</h2>
              <p className="dialog__body">Save this workflow as a reusable Process definition. Nora will clean runtime state.</p>
              <label className="operations-promote__field"><span>Name</span><input value={promoteDraft.name} onChange={event => setPromoteDraft({ ...promoteDraft, name: event.target.value })} required /></label>
              <label className="operations-promote__field"><span>Purpose (optional)</span><textarea rows={3} value={promoteDraft.purpose} onChange={event => setPromoteDraft({ ...promoteDraft, purpose: event.target.value })} /></label>
              <div className="dialog__actions">
                <button type="button" className="secondary-button" onClick={() => setPromoteOpen(false)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={!!busy}><IconCircleCheck size={15} /> Promote</button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="operations-page redesign-page">
      <header className="redesign-header">
        <div className="redesign-header__leading">
          <span className="eyebrow">Live workflow runtime</span>
          <h1 className="redesign-header__title">Operations</h1>
          <p className="redesign-header__subtitle">Monitor and control running Workflows. Promote completed Workflows into Processes.</p>
        </div>
      </header>

      <nav className="redesign-tabs">
        {STATUS_FILTERS.map(value => (
          <button key={value} type="button" className={filter === value ? "redesign-tabs__tab redesign-tabs__tab--active" : "redesign-tabs__tab"} onClick={() => setFilter(value)}>{value}</button>
        ))}
      </nav>

      <section className="operations-list">
        {!filtered.length ? (
          <StateView variant="empty" icon={IconBolt} title="No workflows" message="Start a workflow from Chat or trigger a Schedule. Workflows appear here in real time." />
        ) : (
          <ul className="workflow-list">
            {filtered.map(item => (
              <li key={item.id}>
                <button type="button" className="workflow-list__item" onClick={() => { setSelectedId(item.id); setSelectedTaskId(""); }}>
                  <span className="workflow-list__body">
                    <strong className="workflow-list__title">{item.process || "Ad-hoc workflow"}</strong>
                    <small className="workflow-list__meta">{item.id} · {Object.keys(item.tasks || {}).length} tasks · {formatTime(item.updatedAt)}</small>
                  </span>
                  <StatusBadge tone={statusTone[item.status] || "neutral"}>{item.status}</StatusBadge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}