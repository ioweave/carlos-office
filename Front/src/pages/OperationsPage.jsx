import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowLeft,
  IconDeviceFloppy,
  IconGitBranch,
  IconLock,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconPlus,
  IconReload,
  IconSparkles,
  IconSquare,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { useAppContext } from "../AppContext";
import api, { endpoints } from "../api";
import ExecutionGroupForm from "../components/ExecutionGroupForm";
import ProcessGraph from "../components/ProcessGraph";
import TaskConfigurationForm from "../components/TaskConfigurationForm";
import WorkflowDataEditor from "../components/WorkflowDataEditor";
import "../styles/workflow-editor.scss";

const ACTIVE_WORKFLOW_STATUSES = new Set(["running", "paused", "blocked", "failed", "pending"]);
const STATUS_ORDER = ["running", "paused", "blocked", "failed", "pending", "completed", "cancelled"];
const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);
const canResumeTask = status => ["failed", "blocked", "cancelled"].includes(status);
const canCancelTask = status => ["running", "ready", "pending", "blocked"].includes(status);
const canSkipTask = status => ["pending", "ready", "blocked", "failed"].includes(status);
const NODE_WIDTH = 108;
const NODE_HEIGHT = 68;

const formatTime = value => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};
const workflowTitle = workflow => workflow.process || workflow.purpose || workflow.id;
const humanizeId = id => String(id || "")
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\b\w/g, character => character.toUpperCase());
const taskTitle = (taskId, task) => task?.name?.trim() || humanizeId(taskId) || taskId;
const slugTaskId = value => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 36) || "task";
const cloneLayout = layout => Object.fromEntries(Object.entries(layout || {}).map(([id, position]) => [
  id,
  { x: Number(position.x), y: Number(position.y) },
]));
const cloneGroups = groups => (Array.isArray(groups) ? groups : []).map(group => ({
  ...group,
  members: Array.isArray(group.members) ? [...group.members] : [],
  ...(group.throttle ? { throttle: { ...group.throttle } } : {}),
}));
const stableKey = value => JSON.stringify(value ?? null);
const errorText = value => {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
};
const errorHeadline = value => errorText(value).split(/\r?\n/).find(line => line.trim())?.trim() || "Task failed";
const latestFailedAttempt = task => [...(task?.attempts || [])].reverse().find(attempt => attempt.status === "failed") || null;
const taskStatusMap = workflow => Object.fromEntries(Object.entries(workflow?.tasks || {}).map(([id, task]) => [id, task.status]));
const validRect = group => ["x", "y", "width", "height"].every(key => Number.isFinite(Number(group?.[key])));
const containsPoint = (group, point) => (
  point.x >= group.x
  && point.x <= group.x + group.width
  && point.y >= group.y
  && point.y <= group.y + group.height
);
const containsRect = (outer, inner) => (
  inner.x >= outer.x
  && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width
  && inner.y + inner.height <= outer.y + outer.height
);
const area = group => Number(group.width) * Number(group.height);

const deriveSpatialMembership = (groups, layout, tasks, start, end) => {
  const next = cloneGroups(groups);
  const positioned = next.filter(validRect);
  const byId = new Map(next.map(group => [group.id, group]));
  const parentByGroup = new Map();

  for (const child of positioned) {
    const candidates = positioned
      .filter(parent => parent.id !== child.id && area(parent) > area(child) && containsRect(parent, child))
      .sort((left, right) => area(left) - area(right));
    if (candidates[0]) parentByGroup.set(child.id, candidates[0].id);
  }

  const taskOwner = new Map();
  for (const [taskId, point] of Object.entries(layout || {})) {
    if (taskId === start || taskId === end || tasks?.[taskId]?.type !== "task") continue;
    const taskCenter = { x: Number(point.x) + NODE_WIDTH / 2, y: Number(point.y) + NODE_HEIGHT / 2 };
    const candidates = positioned
      .filter(group => containsPoint(group, taskCenter))
      .sort((left, right) => area(left) - area(right));
    if (candidates[0]) taskOwner.set(taskId, candidates[0].id);
  }

  for (const group of next) {
    if (!validRect(group)) continue;
    group.members = [
      ...[...parentByGroup.entries()].filter(([, parentId]) => parentId === group.id).map(([childId]) => childId),
      ...[...taskOwner.entries()].filter(([, ownerId]) => ownerId === group.id).map(([taskId]) => taskId),
    ];
  }

  // Preserve generated semantic groups without geometry until Carlos moves/resizes them.
  for (const group of next) {
    if (validRect(group) || !byId.has(group.id)) continue;
    group.members = Array.isArray(group.members) ? group.members : [];
  }
  return next;
};

const validateGroupDrafts = groups => {
  for (const group of groups) {
    if (!group.members?.length) return `${group.name || group.id} is empty. Place a Task or nested Group inside it.`;
    if (group.type === "map") {
      if (!String(group.source || "").trim()) return `${group.name || group.id} needs a collection source.`;
      if (!String(group.itemAs || "").trim()) return `${group.name || group.id} needs an item variable.`;
    }
    if (group.type === "loop") {
      if (group.members.length !== 1) return `${group.name || group.id} must directly contain exactly one Task in v1.1.`;
    }
  }
  return null;
};

const mapProgress = task => {
  const attempt = [...(task?.attempts || [])].reverse()[0];
  if (!attempt?.executionGroups?.some(group => group.type === "map")) return null;
  const completed = (attempt.invocations || []).filter(invocation => invocation.kind === "map-item" && invocation.status === "completed").length;
  const active = (attempt.invocations || []).filter(invocation => invocation.kind === "agent" && invocation.status === "running").length;
  return { completed, active };
};

function WorkflowInspector({
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
}) {
  if (!selectedTask && !selectedEdge && !selectedGroup) return null;
  const attempts = selectedTask?.attempts || [];
  const failedAttempt = selectedTask?.status === "failed" ? latestFailedAttempt(selectedTask) : null;
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
              {failedAttempt && (
                <section className="task-failure-insight">
                  <div className="task-failure-insight__heading"><IconAlertTriangle size={15} /><div><span>Latest failure</span><strong>{errorHeadline(failedAttempt.error)}</strong></div></div>
                  <pre>{errorText(failedAttempt.error)}</pre>
                  {failedAttempt.diagnostics && <pre>{errorText(failedAttempt.diagnostics)}</pre>}
                </section>
              )}

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

export default function OperationsPage({ onAskNora, openRequest }) {
  const { officeState, refresh } = useAppContext();
  const workflows = officeState.workflows || [];
  const activeAgents = officeState.agents || [];
  const [selectedId, setSelectedId] = useState("");
  const [events, setEvents] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [inspectorMode, setInspectorMode] = useState("config");
  const [placementMode, setPlacementMode] = useState("");
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [filter, setFilter] = useState("active");
  const [detailTab, setDetailTab] = useState("tasks");
  const [busy, setBusy] = useState("");
  const [layoutBaseline, setLayoutBaseline] = useState({});
  const [layoutDraft, setLayoutDraft] = useState({});
  const [groupsBaseline, setGroupsBaseline] = useState([]);
  const [groupsDraft, setGroupsDraft] = useState([]);

  const workflow = workflows.find(item => item.id === selectedId) || null;
  const editable = Boolean(workflow && workflow.status !== "running");
  const selectedTask = workflow?.tasks?.[selectedTaskId] || null;
  const selectedGroup = groupsDraft.find(group => group.id === selectedGroupId) || null;
  const workflowAgents = activeAgents.filter(agent => agent.context?.workflowId === workflow?.id);
  const designDirty = stableKey(layoutDraft) !== stableKey(layoutBaseline) || stableKey(groupsDraft) !== stableKey(groupsBaseline);

  const loadEvents = useCallback(async id => {
    if (!id) return;
    try {
      const response = await api.get(endpoints.events(), { params: { workflowId: id, limit: 100 } });
      setEvents(response.data || []);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not load Workflow activity.");
    }
  }, []);

  useEffect(() => {
    if (!selectedId || detailTab !== "activity") return;
    void loadEvents(selectedId);
  }, [selectedId, detailTab, loadEvents]);

  useEffect(() => {
    if (!openRequest?.workflowId) return;
    setSelectedId(openRequest.workflowId);
    setSelectedTaskId("");
    setSelectedEdge(null);
    setSelectedGroupId("");
    setPlacementMode("");
  }, [openRequest]);

  useEffect(() => {
    if (!workflow) {
      setLayoutBaseline({});
      setLayoutDraft({});
      setGroupsBaseline([]);
      setGroupsDraft([]);
      return;
    }
    const layout = cloneLayout(workflow.layout || workflow.config?._ui?.layout || {});
    const groups = cloneGroups(workflow.groups || []);
    setLayoutBaseline(layout);
    setLayoutDraft(layout);
    setGroupsBaseline(groups);
    setGroupsDraft(groups);
    if (workflow.status === "running") {
      setPlacementMode("");
      setGroupMenuOpen(false);
    }
  }, [workflow?.id, workflow?.layout, workflow?.groups, workflow?.status]);

  const sorted = useMemo(() => [...workflows].sort((left, right) => {
    const statusDelta = STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status);
    if (statusDelta) return statusDelta;
    return String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || ""));
  }), [workflows]);
  const filtered = sorted.filter(item => filter === "active" ? ACTIVE_WORKFLOW_STATUSES.has(item.status) : filter === "history" ? TERMINAL_STATUSES.has(item.status) : true);

  const runAction = async (label, request) => {
    if (!workflow) return;
    setBusy(label);
    try {
      await request();
      await refresh();
      toast.success(`${label} complete.`);
    } catch (error) {
      toast.error(error.response?.data?.error || `${label} failed.`);
    } finally {
      setBusy("");
    }
  };

  const clearSelection = () => {
    setSelectedTaskId("");
    setSelectedEdge(null);
    setSelectedGroupId("");
  };

  const closeWorkflow = () => {
    if (designDirty && !window.confirm("Discard unsaved graph changes?")) return;
    setSelectedId("");
    clearSelection();
    setPlacementMode("");
    setEvents([]);
  };

  const saveGraph = async () => {
    if (!workflow || !editable || !designDirty) return;
    const groups = deriveSpatialMembership(groupsDraft, layoutDraft, workflow.tasks, workflow.start, workflow.end);
    const issue = validateGroupDrafts(groups);
    if (issue) return toast.error(issue);

    setBusy("Save graph");
    try {
      const updated = (await api.patch(endpoints.workflowDesign(workflow.id), {
        layout: cloneLayout(layoutDraft),
        groups,
      })).data;
      const layout = cloneLayout(updated.layout || layoutDraft);
      const savedGroups = cloneGroups(updated.groups || groups);
      setLayoutBaseline(layout);
      setLayoutDraft(layout);
      setGroupsBaseline(savedGroups);
      setGroupsDraft(savedGroups);
      toast.success("Workflow graph saved.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not save Workflow graph.");
    } finally {
      setBusy("");
    }
  };

  const addTaskAt = async point => {
    if (!workflow || !editable) return;
    const name = window.prompt("Task name (2-5 words)", "New Task")?.trim();
    if (!name) return;
    const objective = window.prompt("Task objective", `Complete ${name.toLowerCase()}.`)?.trim();
    if (!objective) return;
    const base = slugTaskId(name);
    let taskId = base;
    let suffix = 2;
    while (workflow.tasks?.[taskId]) taskId = `${base}-${suffix++}`;

    setBusy("Add Task");
    try {
      await api.post(endpoints.workflowTask(workflow.id, taskId), {
        task: { type: "task", name: name.slice(0, 50), objective, inputs: [], output: "", completion: "" },
        edges: [[workflow.start, taskId], [taskId, workflow.end]],
      });
      setLayoutDraft(current => ({ ...current, [taskId]: { x: point.x, y: point.y } }));
      setSelectedTaskId(taskId);
      setSelectedGroupId("");
      setSelectedEdge(null);
      setInspectorMode("config");
      setPlacementMode("");
      toast.success("Task added. Rewire it by dragging a connector to another Task.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not add Task.");
    } finally {
      setBusy("");
    }
  };

  const addGroupAt = (type, point) => {
    if (!editable) return;
    const id = `${type}-${Date.now().toString(36)}`;
    const group = type === "map" ? {
      id,
      type: "map",
      name: "Map",
      members: [],
      source: "items",
      itemAs: "item",
      indexAs: "index",
      concurrency: 1,
      throttle: null,
      x: Math.max(12, point.x - 25),
      y: Math.max(12, point.y - 25),
      width: 360,
      height: 230,
    } : {
      id,
      type: "loop",
      name: "Loop",
      members: [],
      maxIterations: 3,
      minimumScore: 0.8,
      criteria: "Review the Task result against its objective and completion criteria.",
      x: Math.max(12, point.x - 20),
      y: Math.max(12, point.y - 20),
      width: 260,
      height: 160,
    };
    setGroupsDraft(current => [...current, group]);
    setSelectedGroupId(id);
    setSelectedTaskId("");
    setSelectedEdge(null);
    setPlacementMode("");
  };

  const handleCanvasClick = point => {
    if (placementMode === "task") return void addTaskAt(point);
    if (placementMode === "map" || placementMode === "loop") return addGroupAt(placementMode, point);
    clearSelection();
  };

  const updateGroup = updated => {
    setGroupsDraft(current => current.map(group => group.id === updated.id ? cloneGroups([updated])[0] : group));
  };

  const removeGroup = groupId => {
    setGroupsDraft(current => current
      .filter(group => group.id !== groupId)
      .map(group => ({ ...group, members: (group.members || []).filter(member => member !== groupId) })));
    setSelectedGroupId("");
  };

  const connectTasks = async (from, to) => {
    if (!workflow || !editable || from === to) return;
    if ((workflow.edges || []).some(([a, b]) => a === from && b === to)) return toast.message("Those Tasks are already connected.");
    setBusy("Connect");
    try {
      await api.put(endpoints.workflowEdges(workflow.id), { edges: [...workflow.edges, [from, to]] });
      setSelectedEdge([from, to]);
      setSelectedTaskId("");
      setSelectedGroupId("");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not connect Tasks. The graph must remain valid and acyclic.");
    } finally { setBusy(""); }
  };

  const removeEdge = async edge => {
    if (!workflow || !editable || !edge) return;
    setBusy("Remove connection");
    try {
      await api.put(endpoints.workflowEdges(workflow.id), { edges: workflow.edges.filter(([from, to]) => from !== edge[0] || to !== edge[1]) });
      setSelectedEdge(null);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not remove connection. Keep a valid Start-to-End path.");
    } finally { setBusy(""); }
  };

  const removeTask = async () => {
    if (!workflow || !editable || !selectedTask || selectedTask.type !== "task") return;
    if (!window.confirm(`Remove Task "${taskTitle(selectedTaskId, selectedTask)}"?`)) return;
    setBusy("Remove Task");
    try {
      await api.delete(endpoints.workflowTask(workflow.id, selectedTaskId));
      setLayoutDraft(current => {
        const next = { ...current };
        delete next[selectedTaskId];
        return next;
      });
      setGroupsDraft(current => current.map(group => ({ ...group, members: (group.members || []).filter(member => member !== selectedTaskId) })));
      setSelectedTaskId("");
      toast.success("Task removed. Existing execution history was archived when present.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not remove Task.");
    } finally { setBusy(""); }
  };

  const reviewTask = async () => {
    if (!workflow || !selectedTaskId) return;
    setBusy("Nora review");
    try {
      const result = (await api.post(endpoints.workflowTaskReview(workflow.id, selectedTaskId))).data;
      if (result?.action === "retry") {
        await api.post(endpoints.workflowRun(workflow.id));
        toast.success("Nora reviewed the failure and started a retry.");
      } else toast.message(result?.reason || "Nora escalated this Task to Carlos.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Task review failed.");
    } finally { setBusy(""); }
  };

  const deleteWorkflow = async target => {
    if (!target || target.status === "running") return;
    if (!window.confirm(`Delete Workflow ${target.id}? Its execution record will be removed permanently.`)) return;
    setBusy("Delete");
    try {
      await api.delete(endpoints.workflow(target.id));
      if (selectedId === target.id) setSelectedId("");
      toast.success("Workflow deleted.");
    } catch (error) { toast.error(error.response?.data?.error || "Could not delete Workflow."); }
    finally { setBusy(""); }
  };

  const persistAsProcess = async () => {
    if (!workflow || workflow.status === "running") return;
    if (designDirty) return toast.error("Save graph changes before promoting this Workflow.");
    const name = window.prompt("Process name", workflow.process || `process-${workflow.id.replace(/^workflow-/, "")}`)?.trim();
    if (!name) return;
    const purpose = window.prompt("Process purpose", workflow.purpose || `Reusable Process promoted from ${workflow.id}`);
    if (purpose === null) return;
    setBusy("Save as Process");
    try {
      const process = (await api.post(endpoints.workflowPromote(workflow.id), { name, purpose: purpose.trim() })).data;
      toast.success(`Process ${process.name} saved.`);
    } catch (error) { toast.error(error.response?.data?.error || "Could not save Workflow as a Process."); }
    finally { setBusy(""); }
  };

  if (!workflow) {
    return (
      <div className="workspace-page operations-page">
        <header className="page-header">
          <div className="page-header__copy"><span className="eyebrow">Workflow runtime</span><h1>Operations</h1><p>Inspect, revise, run, and recover Nora&apos;s Workflows.</p></div>
        </header>
        <div className="segmented-control page-tabs" role="tablist" aria-label="Workflow filter">
          {["active", "history", "all"].map(value => <button key={value} type="button" className={filter === value ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
        </div>
        <div className="workflow-list">
          {!filtered.length ? <div className="empty-state"><IconActivity size={25} /><strong>No Workflows here</strong><span>Nora-created Workflows will appear here.</span></div> : filtered.map(item => {
            const tasks = Object.values(item.tasks || {}).filter(task => task.type === "task");
            const completed = tasks.filter(task => ["completed", "skipped"].includes(task.status)).length;
            const agents = activeAgents.filter(agent => agent.context?.workflowId === item.id).length;
            return (
              <button key={item.id} type="button" className="workflow-row" onClick={() => setSelectedId(item.id)}>
                <span className={`workflow-row__status workflow-row__status--${item.status}`} />
                <span className="workflow-row__copy"><strong>{workflowTitle(item)}</strong><small>{item.id}</small></span>
                <span className="workflow-row__progress">{completed}/{tasks.length} Tasks</span>
                <span className="workflow-row__agents">{agents} Agents</span>
                <span className={`status-pill status-pill--${item.status}`}>{item.status}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const statuses = taskStatusMap(workflow);
  const approvals = (officeState.approvals || []).filter(approval => approval.context?.workflowId === workflow.id && approval.status === "pending");
  const executableTasks = Object.entries(workflow.tasks || {}).filter(([, task]) => task.type === "task");
  const failedTasks = executableTasks.filter(([, task]) => task.status === "failed");
  const primaryFailure = failedTasks[0] || null;
  const primaryFailureAttempt = primaryFailure ? latestFailedAttempt(primaryFailure[1]) : null;
  const canResumeWorkflow = ["paused", "blocked", "failed"].includes(workflow.status);
  const canRestartWorkflow = !["running", "pending"].includes(workflow.status);

  return (
    <div className={`workspace-page operations-studio ${editable ? "operations-studio--editable" : "operations-studio--locked"}`}>
      <header className="page-header">
        <div className="page-header__leading">
          <button type="button" className="icon-button" onClick={closeWorkflow} aria-label="Back to Operations"><IconArrowLeft size={18} /></button>
          <div className="page-header__copy">
            <span className="eyebrow">{editable ? "Workflow editor" : "Workflow execution"}</span>
            <h1>{workflowTitle(workflow)}</h1>
            <div className="workflow-compact-meta"><code>{workflow.id}</code><span>{executableTasks.length} Tasks</span><span>{workflowAgents.length} Agents</span><span>{approvals.length} approvals</span>{editable ? <span>Editable</span> : <span><IconLock size={10} /> Locked while running</span>}</div>
          </div>
        </div>
        <div className="page-header__actions">
          <span className={`status-pill status-pill--${workflow.status}`}>{workflow.status}</span>
          {workflow.status !== "running" && <button type="button" className="button button--quiet" disabled={!!busy || designDirty} onClick={persistAsProcess}><IconGitBranch size={14} /> Save as Process</button>}
          {workflow.status === "pending" && <button type="button" className="button button--primary" disabled={!!busy || designDirty} onClick={() => runAction("Run", () => api.post(endpoints.workflowRun(workflow.id)))}><IconPlayerPlay size={14} /> Run</button>}
          {canResumeWorkflow && <button type="button" className="button button--primary" disabled={!!busy || designDirty} onClick={() => runAction("Resume", () => api.post(endpoints.workflowResume(workflow.id), {}))}><IconPlayerPlay size={14} /> Resume</button>}
          {canRestartWorkflow && <button type="button" className="button button--quiet" disabled={!!busy || designDirty} onClick={() => runAction("Restart", () => api.post(endpoints.workflowRestart(workflow.id)))}><IconReload size={14} /> Restart</button>}
          {workflow.status === "running" && <button type="button" className="button button--danger" disabled={!!busy} onClick={() => runAction("Stop", () => api.post(endpoints.workflowStop(workflow.id)))}><IconSquare size={14} /> Stop</button>}
          <button type="button" className="button button--danger" disabled={!!busy || workflow.status === "running"} onClick={() => deleteWorkflow(workflow)}><IconTrash size={14} /> Delete</button>
        </div>
      </header>

      {workflow.status === "failed" && primaryFailure && (
        <button type="button" className="workflow-failure-banner" onClick={() => { setSelectedTaskId(primaryFailure[0]); setSelectedEdge(null); setSelectedGroupId(""); setInspectorMode("runs"); setDetailTab("tasks"); }}>
          <IconAlertTriangle size={17} /><span className="workflow-failure-banner__copy"><strong>Failed at {taskTitle(primaryFailure[0], primaryFailure[1])}</strong><small>{errorHeadline(primaryFailureAttempt?.error || primaryFailure[1]?.error)}</small></span><span className="workflow-failure-banner__action">Inspect</span>
        </button>
      )}

      <div className="segmented-control page-tabs" role="tablist" aria-label="Workflow detail">
        {["tasks", "activity", "data"].map(tab => <button key={tab} type="button" className={detailTab === tab ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"} onClick={() => setDetailTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}
      </div>

      {detailTab === "tasks" && (
        <div className="studio-layout operations-studio__tasks">
          <section className="studio-layout__canvas">
            <div className="workflow-layout-toolbar workflow-layout-toolbar--editor">
              {editable ? (
                <>
                  <button type="button" className={placementMode === "task" ? "button button--primary" : "button button--quiet"} onClick={() => { setPlacementMode(current => current === "task" ? "" : "task"); setGroupMenuOpen(false); }}><IconPlus size={13} /> Task</button>
                  <div className="workflow-group-menu">
                    <button type="button" className={placementMode === "map" || placementMode === "loop" ? "button button--primary" : "button button--quiet"} onClick={() => setGroupMenuOpen(value => !value)}><IconPlus size={13} /> Group</button>
                    {groupMenuOpen && <div className="workflow-group-menu__popover"><button type="button" onClick={() => { setPlacementMode("map"); setGroupMenuOpen(false); }}><strong>Map</strong><small>Iterate a collection with shared concurrency and throttling.</small></button><button type="button" onClick={() => { setPlacementMode("loop"); setGroupMenuOpen(false); }}><strong>Loop</strong><small>Nora quality-controls one Task and retries rejected work.</small></button></div>}
                  </div>
                  <span className="workflow-layout-toolbar__hint">{placementMode ? `Click empty canvas to place ${placementMode === "task" ? "a Task" : `a ${humanizeId(placementMode)} Group`}` : "Drag Tasks/groups freely · drag connector dots to link · Ctrl/⌘ + wheel to zoom"}</span>
                </>
              ) : <span className="workflow-layout-toolbar__locked"><IconLock size={12} /> Graph locked while Workflow is running</span>}
              <span className={designDirty ? "workflow-layout-toolbar__dirty" : ""}>{designDirty ? "Unsaved graph changes" : ""}</span>
              {editable && <button type="button" className="button button--quiet" disabled={!designDirty || !!busy} onClick={() => { setLayoutDraft(cloneLayout(layoutBaseline)); setGroupsDraft(cloneGroups(groupsBaseline)); }}><IconReload size={13} /> Reset</button>}
              {editable && <button type="button" className="button button--primary" disabled={!designDirty || !!busy} onClick={saveGraph}><IconDeviceFloppy size={13} /> Save graph</button>}
            </div>

            <ProcessGraph
              tasks={workflow.tasks}
              edges={workflow.edges}
              start={workflow.start}
              savedPositions={layoutDraft}
              statuses={statuses}
              selectedId={selectedTaskId}
              selectedEdge={selectedEdge}
              selectedGroupId={selectedGroupId}
              groups={groupsDraft}
              editable={editable}
              onSelect={node => {
                if (!node) return setSelectedTaskId("");
                setSelectedTaskId(node.id);
                setSelectedEdge(null);
                setSelectedGroupId("");
                setInspectorMode(editable ? "config" : "runs");
              }}
              onEdgeSelect={edge => { setSelectedEdge(edge); if (edge) { setSelectedTaskId(""); setSelectedGroupId(""); } }}
              onGroupSelect={group => {
                if (!group) return setSelectedGroupId("");
                setGroupsDraft(current => current.map(item => item.id === group.id ? { ...item, x: group.x, y: group.y, width: group.width, height: group.height } : item));
                setSelectedGroupId(group.id);
                setSelectedTaskId("");
                setSelectedEdge(null);
              }}
              onMove={setLayoutDraft}
              onConnect={connectTasks}
              onGroupsChange={next => setGroupsDraft(cloneGroups(next))}
              onCanvasClick={handleCanvasClick}
              onRevise={node => onAskNora?.(`Review Workflow ${workflow.id}, Task ${node.id}, and suggest a better configuration.`)}
            />

            <WorkflowInspector
              workflow={workflow}
              selectedTaskId={selectedTaskId}
              selectedTask={selectedTask}
              selectedEdge={selectedEdge}
              selectedGroup={selectedGroup}
              editable={editable}
              mode={inspectorMode}
              setMode={setInspectorMode}
              busy={busy}
              workflowAgents={workflowAgents}
              onClose={clearSelection}
              onTaskSaved={() => {}}
              onTaskRevise={() => onAskNora?.(`Review Workflow ${workflow.id}, Task ${selectedTaskId}, and suggest an improved Task configuration.`)}
              onRemoveTask={removeTask}
              onRemoveEdge={removeEdge}
              onGroupChange={updateGroup}
              onRemoveGroup={removeGroup}
              onResumeTask={() => runAction("Resume Task", () => api.post(endpoints.workflowResume(workflow.id), { taskIds: [selectedTaskId] }))}
              onReviewTask={reviewTask}
              onCancelTask={() => {
                if (window.confirm(`Cancel Task ${selectedTaskId}?`)) void runAction("Cancel Task", () => api.post(endpoints.workflowTaskCancel(workflow.id, selectedTaskId)));
              }}
              onSkipTask={() => runAction("Skip Task", () => api.post(endpoints.workflowTaskSkip(workflow.id, selectedTaskId)))}
            />
          </section>
        </div>
      )}

      {detailTab === "activity" && (
        <section className="operations-activity panel">
          {!events.length ? <div className="empty-state empty-state--compact"><IconActivity size={22} /><strong>No activity</strong></div> : events.map(event => (
            <div key={event.id || `${event.at}:${event.type}`} className={`event-row ${event.type?.includes("failed") ? "event-row--error" : ""}`}><span className="event-row__dot" /><div><strong>{event.type}</strong><span>{event.taskId || event.agentId || event.workflowId || ""}</span>{event.error && <code>{errorHeadline(event.error)}</code>}</div><small>{formatTime(event.at)}</small></div>
          ))}
        </section>
      )}

      {detailTab === "data" && (
        <section className="operations-data">
          <div className="panel"><div className="panel__header"><div><span className="eyebrow">Runtime data</span><h2>Workflow inputs and config</h2></div></div><WorkflowDataEditor workflow={workflow} disabled={!editable} onSaved={() => {}} /></div>
          <div className="panel"><div className="panel__header"><div><span className="eyebrow">Result</span><h2>Captured Workflow result</h2></div></div><pre>{workflow.result == null ? "No final result captured yet." : typeof workflow.result === "string" ? workflow.result : JSON.stringify(workflow.result, null, 2)}</pre></div>
        </section>
      )}
    </div>
  );
}
