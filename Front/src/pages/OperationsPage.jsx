import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowLeft,
  IconDeviceFloppy,
  IconEdit,
  IconGitBranch,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconPlus,
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
import "../styles/workflow-editor.scss";

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
const humanizeId = id => String(id || "")
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\b\w/g, character => character.toUpperCase());
const taskTitle = (taskId, task) => task?.name?.trim() || humanizeId(taskId) || taskId;
const taskStatusMap = workflow => Object.fromEntries(
  Object.entries(workflow?.tasks || {}).map(([id, task]) => [id, task.status]),
);
const slugTaskId = value => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 36) || "task";
const cloneLayout = layout => Object.fromEntries(Object.entries(layout || {}).map(([id, position]) => [
  id,
  { x: Number(position.x), y: Number(position.y) },
]));
const cloneGroups = groups => (Array.isArray(groups) ? groups : []).map(group => ({ ...group }));
const stableKey = value => JSON.stringify(value || {});
const errorText = value => {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};
const errorHeadline = value => errorText(value).split(/\r?\n/).find(line => line.trim())?.trim() || "Task failed";
const latestFailedAttempt = task => [...(task?.attempts || [])]
  .reverse()
  .find(attempt => attempt.status === "failed") || null;

export default function OperationsPage({ onAskNora, openRequest }) {
  const { officeState, refresh } = useAppContext();
  const workflows = officeState.workflows || [];
  const activeAgents = officeState.agents || [];
  const [selectedId, setSelectedId] = useState("");
  const [events, setEvents] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [editingTask, setEditingTask] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [placementMode, setPlacementMode] = useState("");
  const [filter, setFilter] = useState("active");
  const [detailTab, setDetailTab] = useState("tasks");
  const [busy, setBusy] = useState("");
  const [edgeDraft, setEdgeDraft] = useState({ from: "", to: "" });
  const [layoutBaseline, setLayoutBaseline] = useState({});
  const [layoutDraft, setLayoutDraft] = useState({});
  const [groupsBaseline, setGroupsBaseline] = useState([]);
  const [groupsDraft, setGroupsDraft] = useState([]);

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
  const persistedLayout = useMemo(() => (
    workflow?.layout && Object.keys(workflow.layout).length
      ? workflow.layout
      : workflow?.config?._ui?.layout || {}
  ), [workflow]);
  const persistedGroups = useMemo(() => workflow?.config?._ui?.groups || [], [workflow]);
  const layoutDirty = stableKey(layoutDraft) !== stableKey(layoutBaseline)
    || stableKey(groupsDraft) !== stableKey(groupsBaseline);
  const workflowEditable = Boolean(workflow && editMode && workflow.status !== "running");

  useEffect(() => {
    if (!selectedId || detailTab !== "activity") return;
    void loadEvents(selectedId);
  }, [selectedId, detailTab, loadEvents]);

  useEffect(() => {
    if (!openRequest?.workflowId) return;
    setSelectedId(openRequest.workflowId);
    setSelectedTaskId("");
    setSelectedEdge(null);
    setEditingTask(false);
    setEditMode(false);
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
    const nextLayout = cloneLayout(persistedLayout);
    const nextGroups = cloneGroups(persistedGroups);
    setLayoutBaseline(nextLayout);
    setLayoutDraft(nextLayout);
    setGroupsBaseline(nextGroups);
    setGroupsDraft(nextGroups);
  }, [workflow?.id, persistedLayout, persistedGroups]);

  useEffect(() => {
    if (!workflow) return;
    setEdgeDraft(current => ({
      from: workflow.tasks?.[current.from] ? current.from : workflow.start,
      to: workflow.tasks?.[current.to] ? current.to : workflow.end,
    }));
  }, [workflow?.id, workflow?.start, workflow?.end, workflow?.tasks]);

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
    await refresh();
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

  const closeWorkflow = () => {
    if (layoutDirty && !window.confirm("Discard unsaved layout/group changes?")) return;
    setSelectedId("");
    setSelectedTaskId("");
    setSelectedEdge(null);
    setEditingTask(false);
    setEditMode(false);
    setPlacementMode("");
    setEvents([]);
  };

  const deleteWorkflow = async target => {
    if (!target || target.status === "running") return;
    if (!window.confirm(`Delete Workflow ${target.id}? Its execution record will be removed permanently.`)) return;

    setBusy(`Delete:${target.id}`);
    try {
      await api.delete(endpoints.workflow(target.id));
      if (selectedId === target.id) closeWorkflow();
      await refresh();
      toast.success("Workflow deleted.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not delete Workflow.");
    } finally {
      setBusy("");
    }
  };

  const persistAsProcess = async () => {
    if (!workflow || workflow.status === "running") return;
    const suggested = workflow.process || `process-${workflow.id.replace(/^workflow-/, "")}`;
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

  const beginEditWorkflow = async () => {
    if (!workflow || editMode) return;
    setBusy("Edit Workflow");
    try {
      if (workflow.status === "running") {
        await api.post(endpoints.workflowStop(workflow.id));
        await refreshCurrentDetail(workflow.id);
      }
      setDetailTab("tasks");
      setEditMode(true);
      setSelectedEdge(null);
      setPlacementMode("");
      toast.message("Manual Workflow editor enabled. Structural edits save immediately; layout and groups save with Save layout.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not enter Workflow edit mode.");
    } finally {
      setBusy("");
    }
  };

  const finishEditWorkflow = () => {
    if (layoutDirty && !window.confirm("Layout or group changes are not saved. Exit edit mode anyway?")) return;
    setEditMode(false);
    setPlacementMode("");
    setSelectedEdge(null);
    setEditingTask(false);
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

  const saveLayout = async () => {
    if (!workflow || !layoutDirty) return;
    setBusy("Save Layout");
    try {
      const config = {
        ...(workflow.config || {}),
        _ui: {
          ...(workflow.config?._ui || {}),
          layout: cloneLayout(layoutDraft),
          groups: cloneGroups(groupsDraft),
        },
      };
      const updated = (await api.patch(endpoints.workflowConfig(workflow.id), config)).data;
      const savedLayout = cloneLayout(updated.layout || layoutDraft);
      const savedGroups = cloneGroups(updated.config?._ui?.groups || groupsDraft);
      setLayoutBaseline(savedLayout);
      setLayoutDraft(savedLayout);
      setGroupsBaseline(savedGroups);
      setGroupsDraft(savedGroups);
      await refresh();
      toast.success("Workflow layout and groups saved.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not save Workflow layout.");
    } finally {
      setBusy("");
    }
  };

  const resetLayout = () => {
    setLayoutDraft(cloneLayout(layoutBaseline));
    setGroupsDraft(cloneGroups(groupsBaseline));
  };

  const addTaskAt = async point => {
    if (!workflowEditable) return;
    const name = window.prompt("Task name (2-5 words)", "New Task")?.trim();
    if (!name) return;
    const objective = window.prompt("Task objective", `Complete ${name.toLowerCase()}.`)?.trim();
    if (!objective) return;

    const base = slugTaskId(name);
    let taskId = base;
    let suffix = 2;
    while (workflow.tasks?.[taskId]) {
      taskId = `${base}-${suffix}`;
      suffix += 1;
    }

    setBusy("Add Task");
    try {
      await api.post(endpoints.workflowTask(workflow.id, taskId), {
        task: {
          type: "task",
          name: name.slice(0, 50),
          objective,
          inputs: [],
          output: "",
          completion: "",
        },
        edges: [[workflow.start, taskId], [taskId, workflow.end]],
      });
      setLayoutDraft(current => ({ ...current, [taskId]: { x: point.x, y: point.y } }));
      setSelectedTaskId(taskId);
      setSelectedEdge(null);
      setEditingTask(true);
      setPlacementMode("");
      await refresh();
      toast.success(`Task ${name} added. Drag its connectors to rewire it.`);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not add Task.");
      await refresh();
    } finally {
      setBusy("");
    }
  };

  const addGroupAt = point => {
    if (!workflowEditable) return;
    const title = window.prompt("Group / wrapper name", "New Group")?.trim();
    if (!title) return;
    const id = `group-${Date.now().toString(36)}`;
    setGroupsDraft(current => [...current, {
      id,
      title: title.slice(0, 60),
      x: Math.max(12, point.x - 24),
      y: Math.max(12, point.y - 24),
      width: 320,
      height: 180,
    }]);
    setPlacementMode("");
    toast.message("Group added. Move/resize it, then Save layout to persist it.");
  };

  const removeSelectedTask = async () => {
    if (!workflowEditable || !selectedTask || selectedTask.type !== "task") return;
    if (!window.confirm(`Remove Task "${taskTitle(selectedTaskId, selectedTask)}"? Connections will be bridged automatically.`)) return;

    setBusy("Remove Task");
    try {
      await api.delete(endpoints.workflowTask(workflow.id, selectedTaskId));
      setLayoutDraft(current => {
        const next = { ...current };
        delete next[selectedTaskId];
        return next;
      });
      setSelectedTaskId("");
      setEditingTask(false);
      await refresh();
      toast.success("Task removed. Existing Attempts were archived when present.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not remove Task.");
    } finally {
      setBusy("");
    }
  };

  const connectTasks = async (from, to) => {
    if (!workflowEditable || from === to) return;
    if ((workflow.edges || []).some(edge => edge[0] === from && edge[1] === to)) {
      toast.message("Those Tasks are already connected.");
      return;
    }
    setBusy("Connect Tasks");
    try {
      const edges = [...(workflow.edges || []), [from, to]];
      await api.put(endpoints.workflowEdges(workflow.id), { edges });
      setSelectedEdge([from, to]);
      await refresh();
      toast.success(`Connected ${from} → ${to}.`);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not connect Tasks. The graph must remain valid and acyclic.");
    } finally {
      setBusy("");
    }
  };

  const addEdge = async () => {
    if (!workflowEditable || !edgeDraft.from || !edgeDraft.to) return;
    await connectTasks(edgeDraft.from, edgeDraft.to);
  };

  const removeEdge = async edge => {
    if (!workflowEditable || !edge) return;
    setBusy("Remove Connection");
    try {
      const edges = (workflow.edges || []).filter(([from, to]) => from !== edge[0] || to !== edge[1]);
      await api.put(endpoints.workflowEdges(workflow.id), { edges });
      setSelectedEdge(null);
      await refresh();
      toast.success("Connection removed.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not remove connection. The Workflow must retain a valid path from Start to End.");
    } finally {
      setBusy("");
    }
  };

  const renameGroup = group => {
    const title = window.prompt("Group / wrapper name", group.title || "Group")?.trim();
    if (!title) return;
    setGroupsDraft(current => current.map(item => item.id === group.id
      ? { ...item, title: title.slice(0, 60) }
      : item));
  };

  const removeGroup = groupId => {
    setGroupsDraft(current => current.filter(group => group.id !== groupId));
  };

  const handleCanvasClick = point => {
    if (placementMode === "task") {
      void addTaskAt(point);
      return;
    }
    if (placementMode === "group") {
      addGroupAt(point);
      return;
    }
    setSelectedTaskId("");
    setSelectedEdge(null);
    setEditingTask(false);
  };

  if (workflow) {
    const statuses = taskStatusMap(workflow);
    const attempts = selectedTask?.attempts || [];
    const approvals = (officeState.approvals || []).filter(
      approval => approval.context?.workflowId === workflow.id,
    );
    const displayTitle = workflowTitle(workflow);
    const connectedEdges = selectedTaskId
      ? (workflow.edges || []).filter(([from, to]) => from === selectedTaskId || to === selectedTaskId)
      : [];
    const taskIds = Object.keys(workflow.tasks || {});
    const canResumeWorkflow = ["paused", "blocked", "failed"].includes(workflow.status);
    const canRestartWorkflow = !["running", "pending"].includes(workflow.status);
    const failedTasks = Object.entries(workflow.tasks || {})
      .filter(([, task]) => task?.type === "task" && task.status === "failed");
    const primaryFailure = failedTasks[0] || null;
    const primaryFailureAttempt = primaryFailure ? latestFailedAttempt(primaryFailure[1]) : null;
    const selectedFailureAttempt = selectedTask?.status === "failed" ? latestFailedAttempt(selectedTask) : null;

    return (
      <div className={`workspace-page operations-studio ${editMode ? "operations-studio--editing" : ""}`}>
        <header className="page-header">
          <div className="page-header__leading">
            <button type="button" className="icon-button" onClick={closeWorkflow} aria-label="Back to Operations"><IconArrowLeft size={18} /></button>
            <div className="page-header__copy">
              <span className="eyebrow">{editMode ? "Manual Workflow editor" : "Workflow execution"}</span>
              <h1>{displayTitle}</h1>
              {displayTitle !== workflow.id && <p>{workflow.id}</p>}
            </div>
          </div>
          <div className="page-header__actions">
            <span className={`status-pill status-pill--${workflow.status}`}>{workflow.status}</span>
            {!editMode && <button type="button" className="button button--quiet" disabled={!!busy} onClick={beginEditWorkflow}><IconEdit size={14} /> Edit Workflow</button>}
            {editMode && <button type="button" className="button button--quiet" disabled={!!busy} onClick={finishEditWorkflow}>Done editing</button>}
            {workflow.status !== "running" && <button type="button" className="button button--quiet" disabled={!!busy} onClick={persistAsProcess}><IconGitBranch size={14} /> Save as Process</button>}
            {workflow.status === "pending" && !editMode && <button type="button" className="button button--primary" disabled={!!busy} onClick={() => runAction("Run", () => api.post(endpoints.workflowRun(workflow.id)))}><IconPlayerPlay size={14} /> Run now</button>}
            {canResumeWorkflow && !editMode && <button type="button" className="button button--primary" disabled={!!busy} onClick={() => runAction("Resume", () => api.post(endpoints.workflowResume(workflow.id), {}))}><IconPlayerPlay size={14} /> Resume</button>}
            {canRestartWorkflow && !editMode && <button type="button" className="button button--quiet" disabled={!!busy} onClick={() => runAction("Restart", () => api.post(endpoints.workflowRestart(workflow.id)))}><IconReload size={14} /> Restart</button>}
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

        {workflow.status === "failed" && primaryFailure && (
          <button
            type="button"
            className="workflow-failure-banner"
            onClick={() => {
              setSelectedTaskId(primaryFailure[0]);
              setEditingTask(false);
              setDetailTab("tasks");
            }}
          >
            <IconAlertTriangle size={17} />
            <span className="workflow-failure-banner__copy">
              <strong>Failed at {taskTitle(primaryFailure[0], primaryFailure[1])}</strong>
              <small>{errorHeadline(primaryFailureAttempt?.error || primaryFailure[1]?.error)}</small>
            </span>
            <span className="workflow-failure-banner__action">Inspect Task</span>
          </button>
        )}

        <div className="segmented-control page-tabs" role="tablist" aria-label="Workflow detail">
          {["tasks", "activity", "data"].map(tab => <button key={tab} type="button" className={detailTab === tab ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"} onClick={() => setDetailTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}
        </div>

        {detailTab === "tasks" && (
          <div className="studio-layout operations-studio__tasks">
            <section className="studio-layout__canvas">
              <div className={`workflow-layout-toolbar ${editMode ? "workflow-layout-toolbar--editor" : ""}`}>
                {editMode ? (
                  <>
                    <button type="button" className={placementMode === "task" ? "button button--primary" : "button button--quiet"} onClick={() => setPlacementMode(current => current === "task" ? "" : "task")}><IconPlus size={13} /> Task</button>
                    <button type="button" className={placementMode === "group" ? "button button--primary" : "button button--quiet"} onClick={() => setPlacementMode(current => current === "group" ? "" : "group")}><IconPlus size={13} /> Group</button>
                    {selectedEdge && <button type="button" className="button button--danger" disabled={!!busy} onClick={() => removeEdge(selectedEdge)}><IconTrash size={13} /> Delete connection</button>}
                    <span className="workflow-layout-toolbar__hint">
                      {placementMode === "task" ? "Click empty canvas to place a Task" : placementMode === "group" ? "Click empty canvas to place a visual wrapper" : "Drag connector dots to link Tasks · drag empty space to pan"}
                    </span>
                  </>
                ) : (
                  <span>Drag nodes to arrange · drag empty space to pan</span>
                )}
                <span className={layoutDirty ? "workflow-layout-toolbar__dirty" : ""}>{layoutDirty ? "Layout/group changes" : ""}</span>
                <button type="button" className="button button--quiet" disabled={!layoutDirty || busy === "Save Layout"} onClick={resetLayout}><IconReload size={13} /> Reset</button>
                <button type="button" className="button button--primary" disabled={!layoutDirty || busy === "Save Layout"} onClick={saveLayout}><IconDeviceFloppy size={13} /> Save layout</button>
              </div>
              <ProcessGraph
                tasks={workflow.tasks}
                edges={workflow.edges}
                start={workflow.start}
                savedPositions={layoutDraft}
                statuses={statuses}
                selectedId={selectedTaskId}
                selectedEdge={selectedEdge}
                groups={groupsDraft}
                editable={workflowEditable}
                onSelect={node => {
                  if (!node) {
                    setSelectedTaskId("");
                    return;
                  }
                  setSelectedTaskId(node.id);
                  setSelectedEdge(null);
                  setEditingTask(Boolean(node.edit && workflowEditable && node.type === "task"));
                }}
                onEdgeSelect={setSelectedEdge}
                onMove={setLayoutDraft}
                onConnect={connectTasks}
                onGroupsChange={next => setGroupsDraft(cloneGroups(next))}
                onCanvasClick={handleCanvasClick}
              />
            </section>
            <aside className="inspector-panel">
              {selectedEdge && !selectedTask ? (
                <div className="workflow-edge-inspector">
                  <header className="inspector-panel__header inspector-panel__header--rows">
                    <div className="inspector-panel__meta"><span>Connection</span><code>{selectedEdge[0]} → {selectedEdge[1]}</code></div>
                    <h2>Task connection</h2>
                  </header>
                  <p>Connections define execution order. The Workflow must remain acyclic and every Task must remain reachable from Start and able to reach End.</p>
                  {workflowEditable && <button type="button" className="button button--danger" onClick={() => removeEdge(selectedEdge)}><IconTrash size={14} /> Remove connection</button>}
                </div>
              ) : !selectedTask ? (
                <div className="inspector-panel__empty">
                  <IconActivity size={24} stroke={1.4} />
                  <strong>{editMode ? "Manual editor active" : "Select a Task"}</strong>
                  <span>{editMode ? "Use + Task or + Group above. Drag connector dots between Tasks to create links. Double-click a Task to edit it manually." : "Inspect execution configuration, attempts, model, Tools, Skills, and result."}</span>
                  {!editMode && <button type="button" className="button button--primary" onClick={beginEditWorkflow}><IconEdit size={14} /> Edit Workflow manually</button>}
                </div>
              ) : editingTask && selectedTask.type === "task" ? (
                <>
                  <header className="inspector-panel__header inspector-panel__header--rows">
                    <div className="inspector-panel__meta">
                      <span className={`status-pill status-pill--${selectedTask.status}`}>{selectedTask.status}</span>
                      <code>{selectedTaskId}</code>
                    </div>
                    <h2>{taskTitle(selectedTaskId, selectedTask)}</h2>
                  </header>
                  <TaskConfigurationForm
                    key={`${workflow.id}:${selectedTaskId}`}
                    workflowId={workflow.id}
                    taskId={selectedTaskId}
                    task={selectedTask}
                    disabled={!workflowEditable}
                    onSaved={() => {
                      setEditingTask(false);
                      refresh();
                    }}
                    onRevise={() => onAskNora?.(`Review Workflow ${workflow.id}, Task ${selectedTaskId}, and suggest an improved Task configuration with a concise 2-5 word name.`)}
                  />
                </>
              ) : (
                <>
                  <header className="inspector-panel__header inspector-panel__header--rows">
                    <div className="inspector-panel__meta">
                      <span className={`status-pill status-pill--${selectedTask.status}`}>{selectedTask.status}</span>
                      <code>{selectedTaskId}</code>
                    </div>
                    <h2>{taskTitle(selectedTaskId, selectedTask)}</h2>
                  </header>

                  {selectedFailureAttempt && (
                    <section className="task-failure-insight">
                      <div className="task-failure-insight__heading">
                        <IconAlertTriangle size={15} />
                        <div><span>Latest failure</span><strong>{errorHeadline(selectedFailureAttempt.error)}</strong></div>
                      </div>
                      <pre>{errorText(selectedFailureAttempt.error)}</pre>
                    </section>
                  )}

                  <div className="definition-list">
                    {selectedTask.type === "task" && <div><span>Objective</span><strong>{selectedTask.objective || "—"}</strong></div>}
                    <div><span>Model constraint</span><strong>{selectedTask.provider && selectedTask.model ? `${selectedTask.provider} · ${selectedTask.model}` : selectedTask.type === "task" ? "Nora selects" : "—"}</strong></div>
                    {selectedTask.type === "task" && <div><span>Tools</span><strong>{Array.isArray(selectedTask.tools) ? selectedTask.tools.join(", ") || "None" : "Nora selects"}</strong></div>}
                    {selectedTask.type === "task" && <div><span>Skills</span><strong>{Array.isArray(selectedTask.skills) ? selectedTask.skills.join(", ") || "None" : "Nora selects"}</strong></div>}
                    {selectedTask.type === "task" && <div><span>Attempts</span><strong>{attempts.length}</strong></div>}
                    {selectedTask.blockedReason && <div><span>Blocked</span><strong>{selectedTask.blockedReason}</strong></div>}
                    {selectedTask.error && <div><span>Error</span><strong>{errorHeadline(selectedTask.error)}</strong></div>}
                  </div>

                  {workflowEditable && (
                    <div className="workflow-connections">
                      <h3>Connections</h3>
                      {!connectedEdges.length ? <span className="workflow-connections__empty">No direct connections.</span> : connectedEdges.map(([from, to]) => (
                        <div key={`${from}-${to}`} className="workflow-connection-row">
                          <code>{from}</code><span>→</span><code>{to}</code>
                          <button type="button" className="icon-button" disabled={!!busy} onClick={() => removeEdge([from, to])} aria-label={`Remove connection ${from} to ${to}`}><IconTrash size={13} /></button>
                        </div>
                      ))}
                      <div className="workflow-connection-add">
                        <select value={edgeDraft.from} onChange={event => setEdgeDraft(current => ({ ...current, from: event.target.value }))}>
                          {taskIds.filter(id => id !== workflow.end).map(id => <option key={id} value={id}>{id}</option>)}
                        </select>
                        <span>→</span>
                        <select value={edgeDraft.to} onChange={event => setEdgeDraft(current => ({ ...current, to: event.target.value }))}>
                          {taskIds.filter(id => id !== workflow.start).map(id => <option key={id} value={id}>{id}</option>)}
                        </select>
                        <button type="button" className="button button--quiet" disabled={!!busy || edgeDraft.from === edgeDraft.to} onClick={addEdge}><IconPlus size={13} /> Add</button>
                      </div>
                    </div>
                  )}

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
                        <details key={attempt.id} className="attempt-card" open={attempt.status === "failed"}>
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
                            {attempt.error && <pre className="attempt-card__error">{errorText(attempt.error)}</pre>}
                          </div>
                        </details>
                      ))}
                    </div>
                  )}

                  <div className="inspector-panel__actions">
                    {selectedTask.type === "task" && workflowEditable && <button type="button" className="button button--primary" onClick={() => setEditingTask(true)} disabled={!!busy}><IconEdit size={14} /> Edit Task manually</button>}
                    {selectedTask.type === "task" && workflowEditable && <button type="button" className="button button--danger" onClick={removeSelectedTask} disabled={!!busy}><IconTrash size={14} /> Remove Task</button>}
                    {selectedTask.type === "task" && canResumeTask(selectedTask.status) && !editMode && workflow.status !== "running" && workflow.status !== "pending" && <button type="button" className="button button--primary" onClick={resumeSelectedTask} disabled={!!busy}><IconPlayerPlay size={14} /> Resume from Task</button>}
                    {selectedTask.status === "failed" && <button type="button" className="button button--quiet" onClick={reviewTask} disabled={!!busy}><IconSparkles size={14} /> Nora review</button>}
                    {selectedTask.type === "task" && canCancelTask(selectedTask.status) && !editMode && workflow.status !== "pending" && <button type="button" className="button button--danger" disabled={!!busy} onClick={cancelSelectedTask}><IconSquare size={14} /> Cancel Task</button>}
                    {selectedTask.type === "task" && canSkipTask(selectedTask.status) && !editMode && workflow.status !== "pending" && <button type="button" className="button button--quiet" disabled={!!busy} onClick={() => runAction("Skip", () => api.post(endpoints.workflowTaskSkip(workflow.id, selectedTaskId)))}><IconPlayerSkipForward size={14} /> Skip Task</button>}
                  </div>
                </>
              )}

              {workflowEditable && groupsDraft.length > 0 && (
                <section className="workflow-groups-list">
                  <h3>Visual groups / wrappers</h3>
                  {groupsDraft.map(group => (
                    <div key={group.id} className="workflow-group-row">
                      <span>{group.title}</span>
                      <button type="button" className="icon-button" onClick={() => renameGroup(group)} aria-label={`Rename group ${group.title}`}><IconEdit size={13} /></button>
                      <button type="button" className="icon-button" onClick={() => removeGroup(group.id)} aria-label={`Remove group ${group.title}`}><IconTrash size={13} /></button>
                    </div>
                  ))}
                </section>
              )}
            </aside>
          </div>
        )}

        {detailTab === "activity" && (
          <section className="operations-activity panel">
            <div className="panel__header"><div><span className="eyebrow">Runtime timeline</span><h2>Activity</h2></div><button type="button" className="icon-button" onClick={() => loadEvents(workflow.id)} aria-label="Refresh activity"><IconRefresh size={17} /></button></div>
            {!events.length ? (
              <div className="empty-state empty-state--compact"><IconActivity size={24} /><strong>No recorded events</strong></div>
            ) : (
              <div className="event-list">
                {events.map((event, index) => (
                  <div key={`${event.id || event.at || "event"}-${index}`} className={`event-row ${event.error ? "event-row--error" : ""}`}>
                    <span className="event-row__dot" />
                    <div><strong>{event.type}</strong><span>{event.taskId || event.tool || event.agentId || event.action || event.reason || "Workflow event"}</span>{event.error && <code>{errorHeadline(event.error)}</code>}</div>
                    <small>{formatTime(event.at || event.createdAt)}</small>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {detailTab === "data" && (
          <div className="operations-data">
            <section className="panel operations-data__editor">
              <div className="panel__header"><div><span className="eyebrow">Workflow contract</span><h2>Inputs & runtime config</h2></div></div>
              <WorkflowDataEditor workflow={workflow} disabled={!workflowEditable} onSaved={refresh} />
              {!editMode && <div className="workflow-data-editor__locked"><button type="button" className="button button--quiet" onClick={beginEditWorkflow}><IconEdit size={14} /> Edit Workflow manually</button></div>}
            </section>
            <section className="panel">
              <div className="panel__header"><div><span className="eyebrow">Captured output</span><h2>Result</h2></div></div>
              <pre className="data-block">{workflow.result == null ? "No result captured yet." : typeof workflow.result === "string" ? workflow.result : JSON.stringify(workflow.result, null, 2)}</pre>
            </section>
            {!!workflow.archivedTasks?.length && (
              <section className="panel">
                <div className="panel__header"><div><span className="eyebrow">Preserved history</span><h2>Archived Tasks</h2></div></div>
                <pre className="data-block">{JSON.stringify(workflow.archivedTasks, null, 2)}</pre>
              </section>
            )}
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
        <div className="page-header__copy"><span className="eyebrow">Inspect and control execution</span><h1>Operations</h1><p>Workflows start automatically. Open any Workflow and choose Edit Workflow for direct manual graph editing.</p></div>
        <div className="page-header__actions"><span className="status-pill status-pill--running">{activeCount} open</span><button type="button" className="icon-button" onClick={refresh} aria-label="Refresh Operations"><IconRefresh size={18} /></button></div>
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
              <div key={item.id} className="workflow-row" onClick={() => { setSelectedId(item.id); setEditingTask(false); setEditMode(false); setSelectedEdge(null); }}>
                <span className={`workflow-row__status workflow-row__status--${item.status}`} />
                <span className="workflow-row__copy"><strong>{workflowTitle(item)}</strong>{workflowTitle(item) !== item.id && <small>{item.id}</small>}</span>
                <span className="workflow-row__progress">{completeTasks}/{tasks.length} tasks</span>
                <span className="workflow-row__agents">{runningTasks ? `${runningTasks} running` : item.status === "pending" ? "draft" : "—"}</span>
                <span className={`status-pill status-pill--${item.status}`}>{item.status}</span>
                {filter === "history" && (
                  <button type="button" className="icon-button" disabled={!!busy} aria-label={`Delete Workflow ${item.id}`} title="Delete Workflow" onClick={event => { event.stopPropagation(); void deleteWorkflow(item); }}><IconTrash size={15} /></button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
