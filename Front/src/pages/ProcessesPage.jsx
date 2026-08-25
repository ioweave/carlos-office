import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconArrowLeft,
  IconBolt,
  IconCalendarClock,
  IconGitBranch,
  IconPlus,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import api, { endpoints } from "../api";
import ExecutionGroupForm from "../components/ExecutionGroupForm";
import ProcessGraph from "../components/ProcessGraph";
import TaskConfigurationForm from "../components/TaskConfigurationForm";

const EMPTY_SCHEDULE = {
  process: "",
  timingType: "cron",
  timingValue: "",
  enabled: true,
};

const formatTime = value => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};

const timingLabel = schedule => {
  if (schedule.timing?.type === "at") return `Once · ${formatTime(schedule.timing.value)}`;
  return `Cron UTC · ${schedule.timing?.value || "—"}`;
};

export default function ProcessesPage({ onAskNora }) {
  const [processes, setProcesses] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [view, setView] = useState("library");
  const [selectedName, setSelectedName] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [scheduleDraft, setScheduleDraft] = useState(EMPTY_SCHEDULE);

  const load = useCallback(async () => {
    try {
      const [processResponse, scheduleResponse] = await Promise.all([
        api.get(endpoints.processes()),
        api.get(endpoints.schedules()),
      ]);
      setProcesses(processResponse.data || []);
      setSchedules(scheduleResponse.data || []);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not load Processes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(
    () => processes.find(item => item.name === selectedName) || null,
    [processes, selectedName],
  );
  const selectedTask = selected?.tasks?.[selectedTaskId] || null;
  const selectedGroup = (selected?.groups || []).find(group => group.id === selectedGroupId) || null;

  const clearSelection = () => {
    setSelectedTaskId("");
    setSelectedGroupId("");
  };

  const deleteSelectedProcess = async () => {
    if (!selected) return;
    const scheduleCount = schedules.filter(schedule => schedule.process === selected.name).length;
    const suffix = scheduleCount
      ? ` This will also delete ${scheduleCount} schedule${scheduleCount === 1 ? "" : "s"} that reference it.`
      : "";
    if (!window.confirm(`Delete Process "${selected.name}"?${suffix} Existing Workflow history will be preserved.`)) return;

    setBusy("delete-process");
    try {
      await api.delete(endpoints.process(selected.name));
      setSelectedName("");
      clearSelection();
      toast.success("Process deleted.");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not delete Process.");
    } finally {
      setBusy("");
    }
  };

  const createSchedule = async event => {
    event.preventDefault();
    if (!scheduleDraft.process || !scheduleDraft.timingValue.trim()) return;

    let value = scheduleDraft.timingValue.trim();
    if (scheduleDraft.timingType === "at") {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return toast.error("Choose a valid local date and time.");
      value = date.toISOString();
    }

    setBusy("create-schedule");
    try {
      await api.post(endpoints.schedules(), {
        process: scheduleDraft.process,
        enabled: scheduleDraft.enabled,
        timing: { type: scheduleDraft.timingType, value },
        inputs: {},
        config: {},
      });
      setScheduleDraft(EMPTY_SCHEDULE);
      toast.success("Schedule created.");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not create schedule.");
    } finally {
      setBusy("");
    }
  };

  const toggleSchedule = async schedule => {
    setBusy(schedule.id);
    try {
      await api.patch(endpoints.schedule(schedule.id), { enabled: !schedule.enabled });
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not update schedule.");
    } finally {
      setBusy("");
    }
  };

  const triggerSchedule = async schedule => {
    setBusy(schedule.id);
    try {
      await api.post(endpoints.scheduleTrigger(schedule.id));
      toast.success("Workflow started.");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not trigger schedule.");
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return <div className="workspace-page"><div className="page-state"><span className="spinner" /> Loading Processes</div></div>;
  }

  if (selected) {
    const taskEntries = Object.entries(selected.tasks || {});
    const reviseTask = task => onAskNora?.(
      `Update Process ${selected.name}, specifically Task ${task.id} (${task.objective || task.id}): `,
    );
    const replaceSelectedProcess = updated => setProcesses(current => current.map(process => (
      process.name === updated.name ? updated : process
    )));
    const saveLayout = async layout => {
      setProcesses(current => current.map(process => (
        process.name === selected.name ? { ...process, layout } : process
      )));

      try {
        const updated = (await api.patch(endpoints.process(selected.name), { layout })).data;
        replaceSelectedProcess(updated);
      } catch (error) {
        toast.error(error.response?.data?.error || "Could not save Process layout.");
        await load();
      }
    };

    return (
      <div className="workspace-page process-studio">
        <header className="process-editor-header">
          <div className="process-editor-header__leading">
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                setSelectedName("");
                clearSelection();
              }}
              aria-label="Back to Process library"
            >
              <IconArrowLeft size={18} />
            </button>
            <div className="process-editor-header__title">
              <strong>{selected.name}</strong>
              <span>{selected.purpose || "Reusable procedure coordinated by Nora."}</span>
            </div>
          </div>

          <div className="process-editor-header__stats" aria-label="Process summary">
            <span>{taskEntries.length} nodes</span>
            <span>{(selected.edges || []).length} connections</span>
            <span>{(selected.groups || []).length} groups</span>
            <span>{(selected.inputs || []).length} inputs</span>
          </div>

          <div className="process-editor-header__actions">
            <button
              type="button"
              className="button button--danger"
              disabled={busy === "delete-process"}
              onClick={deleteSelectedProcess}
            >
              <IconTrash size={15} /> Delete
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => onAskNora?.(`Update the reusable Process ${selected.name}: `)}
            >
              <IconSparkles size={15} /> Edit
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => onAskNora?.(`Run the Process ${selected.name}. Ask me for any required inputs first.`)}
            >
              <IconBolt size={15} /> Run with Nora
            </button>
          </div>
        </header>

        <div className="studio-layout">
          <section className="studio-layout__canvas">
            <ProcessGraph
              tasks={selected.tasks}
              edges={selected.edges}
              start={selected.start}
              groups={selected.groups || []}
              savedPositions={selected.layout}
              selectedId={selectedTaskId}
              selectedGroupId={selectedGroupId}
              onSelect={node => {
                setSelectedTaskId(node?.id || "");
                setSelectedGroupId("");
              }}
              onGroupSelect={group => {
                setSelectedGroupId(group?.id || "");
                setSelectedTaskId("");
              }}
              onRevise={reviseTask}
              onMove={saveLayout}
              onCanvasClick={clearSelection}
            />

            {(selectedTask || selectedGroup) && (
              <aside className="inspector-panel inspector-panel--floating">
                <header className="inspector-panel__header">
                  <div>
                    <span className="eyebrow">{selectedGroup ? `${selectedGroup.type} group` : selectedTask.type || "Task"}</span>
                    <h2>{selectedGroup ? selectedGroup.name || selectedGroup.id : selectedTask.objective || selectedTaskId}</h2>
                    <code>{selectedGroup?.id || selectedTaskId}</code>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={clearSelection}
                    aria-label="Close inspector"
                  >
                    <IconX size={17} />
                  </button>
                </header>
                {selectedGroup ? (
                  <ExecutionGroupForm group={selectedGroup} disabled />
                ) : selectedTask.type === "task" ? (
                  <TaskConfigurationForm
                    key={`${selected.name}:${selectedTaskId}`}
                    processName={selected.name}
                    taskId={selectedTaskId}
                    task={selectedTask}
                    onSaved={replaceSelectedProcess}
                    onRevise={() => reviseTask({ id: selectedTaskId, ...selectedTask })}
                  />
                ) : (
                  <div className="definition-list"><div><span>Node</span><strong>{selectedTask.type}</strong></div></div>
                )}
              </aside>
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-page processes-page">
      <header className="page-header">
        <div className="page-header__copy">
          <span className="eyebrow">Design how work happens</span>
          <h1>Processes</h1>
          <p>Reusable graph definitions: Start → Tasks → Edges → End. Maps and Loops define execution scopes without changing graph topology.</p>
        </div>
        <button
          type="button"
          className="button button--primary"
          onClick={() => onAskNora?.("Create a new reusable Carlos Office Process for: ")}
        >
          <IconSparkles size={15} /> Ask Nora to create
        </button>
      </header>

      <div className="segmented-control page-tabs" role="tablist" aria-label="Processes view">
        <button
          type="button"
          className={view === "library" ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"}
          onClick={() => setView("library")}
        >
          Library
        </button>
        <button
          type="button"
          className={view === "schedules" ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"}
          onClick={() => setView("schedules")}
        >
          Schedules
        </button>
      </div>

      {view === "library" ? (
        <section className="process-library">
          {!processes.length ? (
            <div className="empty-state">
              <IconGitBranch size={28} stroke={1.4} />
              <strong>No reusable Processes</strong>
              <span>Ask Nora to create one when a procedure becomes worth repeating.</span>
            </div>
          ) : (
            <div className="process-grid">
              {processes.map(process => (
                <button
                  key={process.name}
                  type="button"
                  className="process-card"
                  onClick={() => setSelectedName(process.name)}
                >
                  <span className="process-card__icon"><IconGitBranch size={18} /></span>
                  <span className="process-card__copy">
                    <strong>{process.name}</strong>
                    <span>{process.purpose || "Reusable Process"}</span>
                  </span>
                  <span className="process-card__meta">
                    {Object.keys(process.tasks || {}).length} nodes · {(process.edges || []).length} edges · {(process.groups || []).length} groups
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="schedule-workspace">
          <form className="schedule-form panel" onSubmit={createSchedule}>
            <div className="panel__header">
              <div>
                <span className="eyebrow">Timed execution</span>
                <h2>New schedule</h2>
              </div>
              <IconCalendarClock size={20} />
            </div>
            <label className="field">
              <span>Process</span>
              <select
                value={scheduleDraft.process}
                onChange={event => setScheduleDraft(current => ({ ...current, process: event.target.value }))}
                required
              >
                <option value="">Select Process</option>
                {processes.map(process => <option key={process.name} value={process.name}>{process.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Timing type</span>
              <select
                value={scheduleDraft.timingType}
                onChange={event => setScheduleDraft(current => ({
                  ...current,
                  timingType: event.target.value,
                  timingValue: "",
                }))}
              >
                <option value="cron">Recurring · cron UTC</option>
                <option value="at">One time · local time</option>
              </select>
            </label>
            <label className="field">
              <span>{scheduleDraft.timingType === "at" ? "Local date and time" : "Cron expression (UTC)"}</span>
              <input
                type={scheduleDraft.timingType === "at" ? "datetime-local" : "text"}
                value={scheduleDraft.timingValue}
                onChange={event => setScheduleDraft(current => ({ ...current, timingValue: event.target.value }))}
                placeholder={scheduleDraft.timingType === "cron" ? "0 13 * * *" : undefined}
                required
              />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={scheduleDraft.enabled}
                onChange={event => setScheduleDraft(current => ({ ...current, enabled: event.target.checked }))}
              />
              <span>Enabled immediately</span>
            </label>
            <footer className="form-actions schedule-form__actions">
              <button type="submit" className="button button--primary" disabled={busy === "create-schedule"}>
                <IconPlus size={15} /> Create schedule
              </button>
            </footer>
          </form>

          <div className="schedule-list panel">
            <div className="panel__header">
              <div>
                <span className="eyebrow">Existing timers</span>
                <h2>Schedules</h2>
              </div>
              <button type="button" className="icon-button" onClick={load} aria-label="Refresh schedules">
                <IconRefresh size={17} />
              </button>
            </div>
            {!schedules.length ? (
              <div className="empty-state empty-state--compact">
                <IconCalendarClock size={24} stroke={1.4} />
                <strong>No schedules</strong>
                <span>Processes only run on demand until you create one.</span>
              </div>
            ) : schedules.map(schedule => (
              <div key={schedule.id} className="schedule-row">
                <div className="schedule-row__copy">
                  <strong>{schedule.process}</strong>
                  <span>{timingLabel(schedule)}</span>
                  <small>Last {formatTime(schedule.lastRunAt)} · Next {formatTime(schedule.nextRunAt)}</small>
                </div>
                <div className="schedule-row__actions">
                  <button
                    type="button"
                    className={`status-pill ${schedule.enabled ? "status-pill--completed" : ""}`}
                    onClick={() => toggleSchedule(schedule)}
                    disabled={busy === schedule.id}
                  >
                    {schedule.enabled ? "enabled" : "disabled"}
                  </button>
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => triggerSchedule(schedule)}
                    disabled={busy === schedule.id}
                  >
                    <IconBolt size={14} /> Run now
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
