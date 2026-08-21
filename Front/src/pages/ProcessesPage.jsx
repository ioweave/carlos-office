import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconArrowLeft,
  IconBolt,
  IconClock,
  IconGitBranch,
  IconPlus,
  IconRefresh,
  IconRoute,
  IconSparkles,
} from "@tabler/icons-react";
import { toast } from "sonner";
import api, { endpoints } from "../api";
import ProcessGraph from "../components/ProcessGraph";
import StateView from "../components/StateView";

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

const scheduleTimingLabel = schedule => {
  if (schedule.timing?.type === "at") return `once · ${formatTime(schedule.timing.value)}`;
  return `cron UTC · ${schedule.timing?.value || "—"}`;
};

const scheduleValue = draft => {
  const value = draft.timingValue.trim();
  if (draft.timingType === "cron") return value;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Choose a valid local date and time.");
  return date.toISOString();
};

export default function ProcessesPage({ onAskNora }) {
  const [processes, setProcesses] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedName, setSelectedName] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [tab, setTab] = useState("library");
  const [scheduleDraft, setScheduleDraft] = useState(EMPTY_SCHEDULE);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const [processResponse, scheduleResponse] = await Promise.all([
        api.get(endpoints.processes()),
        api.get(endpoints.schedules()),
      ]);
      setProcesses(processResponse.data || []);
      setSchedules(scheduleResponse.data || []);
      setError("");
    } catch (fetchError) {
      setError(fetchError.response?.data?.error || "Could not load processes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(
    () => processes.find(item => item.name === selectedName) || null,
    [processes, selectedName],
  );
  const selectedTask = useMemo(
    () => selected?.tasks?.[selectedTaskId] || null,
    [selected, selectedTaskId],
  );

  const createSchedule = async event => {
    event.preventDefault();
    if (!scheduleDraft.process) return toast.error("Select a process.");
    if (!scheduleDraft.timingValue.trim()) return toast.error("Provide a schedule value.");

    let timingValue;
    try {
      timingValue = scheduleValue(scheduleDraft);
    } catch (validationError) {
      return toast.error(validationError.message);
    }

    setBusy("schedule");
    try {
      await api.post(endpoints.schedules(), {
        process: scheduleDraft.process,
        enabled: scheduleDraft.enabled,
        timing: { type: scheduleDraft.timingType, value: timingValue },
        inputs: {},
        config: {},
      });
      toast.success("Schedule created.");
      setScheduleDraft(EMPTY_SCHEDULE);
      await load();
    } catch (fetchError) {
      toast.error(fetchError.response?.data?.error || "Could not create schedule.");
    } finally {
      setBusy("");
    }
  };

  const toggleSchedule = async schedule => {
    try {
      await api.patch(endpoints.schedule(schedule.id), { enabled: !schedule.enabled });
      await load();
    } catch (fetchError) {
      toast.error(fetchError.response?.data?.error || "Could not update schedule.");
    }
  };

  const triggerSchedule = async schedule => {
    try {
      await api.post(endpoints.scheduleTrigger(schedule.id));
      toast.success("Schedule triggered.");
      await load();
    } catch (fetchError) {
      toast.error(fetchError.response?.data?.error || "Could not trigger schedule.");
    }
  };

  if (loading) {
    return <div className="processes-page redesign-page"><StateView variant="loading" /></div>;
  }
  if (error && !processes.length) {
    return (
      <div className="processes-page redesign-page">
        <StateView
          variant="error"
          message={error}
          actions={(
            <button type="button" className="secondary-button" onClick={load}>
              <IconRefresh size={15} /> Retry
            </button>
          )}
        />
      </div>
    );
  }

  if (selected) {
    const taskList = Object.entries(selected.tasks || {}).map(([id, task]) => ({ id, ...task }));

    return (
      <div className="process-studio redesign-page">
        <header className="redesign-header">
          <div className="redesign-header__leading">
            <button
              type="button"
              className="icon-button redesign-header__back"
              onClick={() => setSelectedName(null)}
              aria-label="Back to library"
            >
              <IconArrowLeft size={18} />
            </button>
            <span className="eyebrow">Process definition · read-only</span>
            <h1 className="redesign-header__title">{selected.name}</h1>
            <p className="redesign-header__subtitle">{selected.purpose || "No purpose recorded."}</p>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={() => onAskNora?.(
              `Create or update the Process ${selected.name} as a reusable Carlos Office process.`,
            )}
          >
            <IconSparkles size={15} /> Ask Nora to update
          </button>
        </header>

        <div className="process-studio__body">
          <div className="process-studio__graph">
            <ProcessGraph
              tasks={selected.tasks}
              edges={selected.edges}
              start={selected.start}
              end={selected.end}
              selectedId={selectedTaskId}
              onSelect={node => setSelectedTaskId(node.id)}
            />
          </div>
          <aside className="process-studio__inspector">
            <section className="process-studio__inspector-section">
              <span className="eyebrow">Process</span>
              <dl className="meta-list">
                <div className="meta-list__row">
                  <dt className="meta-list__term">Inputs</dt>
                  <dd className="meta-list__value">{(selected.inputs || []).join(", ") || "—"}</dd>
                </div>
                <div className="meta-list__row">
                  <dt className="meta-list__term">Start</dt>
                  <dd className="meta-list__value">{selected.start}</dd>
                </div>
                <div className="meta-list__row">
                  <dt className="meta-list__term">End</dt>
                  <dd className="meta-list__value">{selected.end}</dd>
                </div>
                <div className="meta-list__row">
                  <dt className="meta-list__term">Tasks</dt>
                  <dd className="meta-list__value">{taskList.length}</dd>
                </div>
              </dl>
            </section>
            {selectedTask && (
              <section className="process-studio__inspector-section">
                <span className="eyebrow">Task · {selectedTask.type}</span>
                <h2 className="process-studio__inspector-title">
                  {selectedTask.objective || selectedTaskId}
                </h2>
                <dl className="meta-list">
                  <div className="meta-list__row">
                    <dt className="meta-list__term">Objective</dt>
                    <dd className="meta-list__value">{selectedTask.objective || "—"}</dd>
                  </div>
                  <div className="meta-list__row">
                    <dt className="meta-list__term">Inputs</dt>
                    <dd className="meta-list__value">{(selectedTask.inputs || []).join(", ") || "—"}</dd>
                  </div>
                  <div className="meta-list__row">
                    <dt className="meta-list__term">Output</dt>
                    <dd className="meta-list__value">{selectedTask.output || "—"}</dd>
                  </div>
                  <div className="meta-list__row">
                    <dt className="meta-list__term">Completion</dt>
                    <dd className="meta-list__value">{selectedTask.completion || "—"}</dd>
                  </div>
                  <div className="meta-list__row">
                    <dt className="meta-list__term">Tools</dt>
                    <dd className="meta-list__value">{(selectedTask.tools || []).join(", ") || "—"}</dd>
                  </div>
                  <div className="meta-list__row">
                    <dt className="meta-list__term">Skills</dt>
                    <dd className="meta-list__value">{(selectedTask.skills || []).join(", ") || "—"}</dd>
                  </div>
                  <div className="meta-list__row">
                    <dt className="meta-list__term">Agent</dt>
                    <dd className="meta-list__value">{selectedTask.agent || "—"}</dd>
                  </div>
                  <div className="meta-list__row">
                    <dt className="meta-list__term">Provider</dt>
                    <dd className="meta-list__value">{selectedTask.provider || "—"}</dd>
                  </div>
                  <div className="meta-list__row">
                    <dt className="meta-list__term">Model</dt>
                    <dd className="meta-list__value">{selectedTask.model || "—"}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onAskNora?.(
                    `Create or update the Process ${selected.name}; revise task ${selectedTask.objective || selectedTaskId}.`,
                  )}
                >
                  <IconSparkles size={15} /> Ask Nora to revise
                </button>
              </section>
            )}
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="processes-page redesign-page">
      <header className="redesign-header">
        <div className="redesign-header__leading">
          <span className="eyebrow">Reusable office procedures</span>
          <h1 className="redesign-header__title">Processes</h1>
          <p className="redesign-header__subtitle">
            Read-only Process definitions and their Schedules. Ask Nora to create or revise reusable procedures.
          </p>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => onAskNora?.("Create a new reusable Carlos Office Process for: ")}
        >
          <IconSparkles size={15} /> Ask Nora to create
        </button>
      </header>

      <nav className="redesign-tabs" aria-label="Process view">
        <button
          type="button"
          className={tab === "library" ? "redesign-tabs__tab redesign-tabs__tab--active" : "redesign-tabs__tab"}
          onClick={() => setTab("library")}
        >
          Library
        </button>
        <button
          type="button"
          className={tab === "schedules" ? "redesign-tabs__tab redesign-tabs__tab--active" : "redesign-tabs__tab"}
          onClick={() => setTab("schedules")}
        >
          Schedules
        </button>
      </nav>

      {tab === "library" && (
        <section className="process-library">
          {!processes.length ? (
            <StateView
              variant="empty"
              icon={IconRoute}
              title="No Process definitions"
              message="Ask Nora to create a Process, or promote an ad-hoc Workflow from Operations."
            />
          ) : (
            <ul className="process-library__list">
              {processes.map(item => {
                const taskCount = Object.keys(item.tasks || {}).length;

                return (
                  <li key={item.name}>
                    <button
                      type="button"
                      className="process-library__item"
                      onClick={() => {
                        setSelectedName(item.name);
                        setSelectedTaskId("");
                      }}
                    >
                      <span className="process-library__item-icon"><IconGitBranch size={18} /></span>
                      <span className="process-library__item-body">
                        <strong className="process-library__item-name">{item.name}</strong>
                        <small className="process-library__item-meta">
                          {item.purpose || "No purpose"} · {taskCount} tasks
                        </small>
                      </span>
                      <span className="process-library__item-inputs">{(item.inputs || []).join(", ")}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "schedules" && (
        <section className="process-schedules">
          <form className="process-schedules__form" onSubmit={createSchedule}>
            <h2 className="process-schedules__form-title">New schedule</h2>
            <label className="process-schedules__form-field">
              <span>Process</span>
              <select
                value={scheduleDraft.process}
                onChange={event => setScheduleDraft({ ...scheduleDraft, process: event.target.value })}
                required
              >
                <option value="">Select a process…</option>
                {processes.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
              </select>
            </label>
            <label className="process-schedules__form-field">
              <span>Timing</span>
              <select
                value={scheduleDraft.timingType}
                onChange={event => setScheduleDraft({
                  ...scheduleDraft,
                  timingType: event.target.value,
                  timingValue: "",
                })}
              >
                <option value="cron">cron (UTC)</option>
                <option value="at">one time (your local time)</option>
              </select>
            </label>
            <label className="process-schedules__form-field">
              <span>{scheduleDraft.timingType === "at" ? "Local date and time" : "UTC cron expression"}</span>
              <input
                type={scheduleDraft.timingType === "at" ? "datetime-local" : "text"}
                value={scheduleDraft.timingValue}
                onChange={event => setScheduleDraft({ ...scheduleDraft, timingValue: event.target.value })}
                placeholder={scheduleDraft.timingType === "cron" ? "0 14 * * *" : undefined}
                required
              />
            </label>
            <label className="redesign-switch">
              <input
                className="redesign-switch__input"
                type="checkbox"
                checked={scheduleDraft.enabled}
                onChange={event => setScheduleDraft({ ...scheduleDraft, enabled: event.target.checked })}
              />
              <span>Enabled</span>
            </label>
            <button
              type="submit"
              className="primary-button process-schedules__form-submit"
              disabled={!!busy}
            >
              <IconPlus size={15} /> Create schedule
            </button>
          </form>

          <div className="process-schedules__list">
            <h2 className="process-schedules__list-title">Schedules</h2>
            {!schedules.length ? (
              <StateView
                variant="empty"
                icon={IconClock}
                title="No schedules"
                message="Create a schedule above to run a Process on a timer."
              />
            ) : (
              <ul className="schedule-list">
                {schedules.map(schedule => (
                  <li key={schedule.id} className="schedule-list__item">
                    <div className="schedule-list__body">
                      <strong className="schedule-list__title">{schedule.process}</strong>
                      <small className="schedule-list__meta">{scheduleTimingLabel(schedule)}</small>
                      <small className="schedule-list__meta">
                        Last: {formatTime(schedule.lastRunAt)} · Next: {formatTime(schedule.nextRunAt)}
                      </small>
                    </div>
                    <div className="schedule-list__actions">
                      <button
                        type="button"
                        className={`secondary-button ${schedule.enabled ? "secondary-button--active" : ""}`}
                        onClick={() => toggleSchedule(schedule)}
                      >
                        {schedule.enabled ? "Enabled" : "Disabled"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => triggerSchedule(schedule)}
                      >
                        <IconBolt size={15} /> Trigger
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
