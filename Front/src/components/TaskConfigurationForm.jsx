import { useEffect, useMemo, useState } from "react";
import { IconDeviceFloppy, IconSparkles } from "@tabler/icons-react";
import { toast } from "sonner";

import api, { endpoints } from "../api";

const DEFAULT_TASK_TIMEOUT_MS = 300_000;
const TASK_TIMEOUT_OPTIONS = [
  { value: "60000", label: "1 minute" },
  { value: "120000", label: "2 minutes" },
  { value: "300000", label: "5 minutes (default)" },
  { value: "600000", label: "10 minutes" },
  { value: "900000", label: "15 minutes" },
  { value: "1800000", label: "30 minutes" },
  { value: "3600000", label: "60 minutes" },
  { value: "0", label: "No timeout" },
];

const uniqueNames = value => (
  Array.isArray(value)
    ? [...new Set(value.map(item => String(item).trim()).filter(Boolean))]
    : []
);

const commaList = value => [...new Set(
  String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean),
)];

const humanizeId = id => String(id || "")
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\b\w/g, character => character.toUpperCase())
  .slice(0, 50);

const taskDraftFrom = (task, taskId) => {
  const legacyTools = task?.tool ? [task.tool] : [];
  const hasFixedTools = Array.isArray(task?.tools) || legacyTools.length > 0;
  const hasFixedSkills = Array.isArray(task?.skills);

  return {
    name: task?.name || humanizeId(taskId),
    objective: task?.objective || "",
    provider: task?.provider || "",
    model: task?.model || "",
    timeoutMs: String(task?.timeoutMs === null ? 0 : (task?.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS)),
    inputs: uniqueNames(task?.inputs).join(", "),
    output: task?.output || "",
    toolsAutomatic: !hasFixedTools,
    tools: uniqueNames(Array.isArray(task?.tools) ? task.tools : legacyTools),
    skillsAutomatic: !hasFixedSkills,
    skills: uniqueNames(task?.skills),
    completion: task?.completion || "",
  };
};

const sameDraft = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const addCurrentOption = (options, current) => (
  current && !options.includes(current) ? [current, ...options] : options
);

function ChoiceList({ label, options, selected, automatic, onAutomaticChange, onToggle, disabled }) {
  return (
    <fieldset className="task-config__choice-field" disabled={disabled}>
      <legend>{label}</legend>
      <label className="check-field task-config__automatic">
        <input
          type="checkbox"
          checked={automatic}
          onChange={event => onAutomaticChange(event.target.checked)}
        />
        <span>Nora selects {label.toLowerCase()} at runtime</span>
      </label>
      {!automatic && (
        <div className="task-config__choices">
          {!options.length ? (
            <span className="task-config__empty-choice">No {label.toLowerCase()} available.</span>
          ) : options.map(name => (
            <label key={name} className="task-config__choice">
              <input
                type="checkbox"
                checked={selected.includes(name)}
                onChange={() => onToggle(name)}
              />
              <span>{name}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export default function TaskConfigurationForm({
  processName = null,
  workflowId = null,
  taskId,
  task,
  onSaved,
  onRevise,
  disabled = false,
}) {
  const initial = useMemo(() => taskDraftFrom(task, taskId), [task, taskId]);
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [catalog, setCatalog] = useState({ models: [], tools: [], skills: [] });
  const [catalogLoading, setCatalogLoading] = useState(task.type === "task");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBaseline(initial);
    setDraft(initial);
  }, [initial]);

  useEffect(() => {
    if (task.type !== "task") return undefined;

    let active = true;
    const loadCatalog = async () => {
      try {
        const [modelsResponse, toolsResponse, skillsResponse] = await Promise.all([
          api.get(endpoints.models()),
          api.get(endpoints.tools()),
          api.get(endpoints.skills()),
        ]);
        if (!active) return;
        setCatalog({
          models: modelsResponse.data || [],
          tools: toolsResponse.data || [],
          skills: skillsResponse.data || [],
        });
      } catch (error) {
        if (active) toast.error(error.response?.data?.error || "Could not load Task configuration options.");
      } finally {
        if (active) setCatalogLoading(false);
      }
    };

    void loadCatalog();
    return () => { active = false; };
  }, [task.type]);

  if (task.type !== "task") {
    return (
      <div className="task-config task-config--readonly">
        <div className="task-config__body">
          <p>Start and end nodes define topology and do not have execution configuration.</p>
        </div>
      </div>
    );
  }

  const providerOptions = addCurrentOption(catalog.models.map(entry => entry.provider), draft.provider);
  const modelOptions = addCurrentOption(
    catalog.models.find(entry => entry.provider === draft.provider)?.models || [],
    draft.model,
  );
  const toolOptions = [...new Set([...catalog.tools.map(tool => tool.name), ...draft.tools])];
  const skillOptions = [...new Set([...catalog.skills.map(skill => skill.name), ...draft.skills])];
  const timeoutOptions = TASK_TIMEOUT_OPTIONS.some(option => option.value === draft.timeoutMs)
    ? TASK_TIMEOUT_OPTIONS
    : [{ value: draft.timeoutMs, label: `${Number(draft.timeoutMs) / 1000} seconds` }, ...TASK_TIMEOUT_OPTIONS];
  const validName = !workflowId || (Boolean(draft.name.trim()) && draft.name.trim().length <= 50);
  const valid = validName && Boolean(draft.objective.trim()) && (!draft.provider || Boolean(draft.model));

  const update = changes => setDraft(current => ({ ...current, ...changes }));
  const toggle = (field, name) => setDraft(current => ({
    ...current,
    [field]: current[field].includes(name)
      ? current[field].filter(item => item !== name)
      : [...current[field], name],
  }));

  const taskPayload = () => ({
    name: draft.name.trim(),
    objective: draft.objective.trim(),
    provider: draft.provider || null,
    model: draft.provider ? draft.model || null : null,
    timeoutMs: draft.timeoutMs === "0" ? null : Number(draft.timeoutMs),
    inputs: commaList(draft.inputs),
    output: draft.output.trim(),
    tools: draft.toolsAutomatic ? null : uniqueNames(draft.tools),
    skills: draft.skillsAutomatic ? null : uniqueNames(draft.skills),
    completion: draft.completion.trim(),
  });

  const save = async event => {
    event.preventDefault();
    if (!dirty || !valid || saving || disabled) return;

    setSaving(true);
    try {
      let savedTask;
      let savedRecord;

      if (workflowId) {
        savedTask = (await api.patch(endpoints.workflowTask(workflowId, taskId), taskPayload())).data;
        savedRecord = savedTask;
      } else {
        const updated = (await api.patch(endpoints.process(processName), {
          taskId,
          task: taskPayload(),
        })).data;
        savedTask = updated.tasks?.[taskId] || task;
        savedRecord = updated;
      }

      const savedDraft = taskDraftFrom(savedTask, taskId);
      setBaseline(savedDraft);
      setDraft(savedDraft);
      onSaved?.(savedRecord);
      toast.success(workflowId ? "Workflow Task configuration saved." : "Task configuration saved.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not save Task configuration.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="task-config" onSubmit={save}>
      <div className="task-config__body">
        {catalogLoading && <span className="task-config__loading">Loading configuration options…</span>}
        <div className="task-config__fields">
          {workflowId && (
            <label className="field">
              <span>Name</span>
              <input
                type="text"
                maxLength={50}
                value={draft.name}
                onChange={event => update({ name: event.target.value })}
                placeholder="Atomic 2-5 word label"
                disabled={disabled}
              />
            </label>
          )}

          <label className="field">
            <span>Objective</span>
            <textarea
              rows={3}
              value={draft.objective}
              onChange={event => update({ objective: event.target.value })}
              placeholder="What this Task must accomplish"
              disabled={disabled}
            />
          </label>

          <label className="field">
            <span>Provider</span>
            <select
              value={draft.provider}
              onChange={event => update({ provider: event.target.value, model: "" })}
              disabled={disabled}
            >
              <option value="">Nora selects at runtime</option>
              {providerOptions.map(provider => <option key={provider} value={provider}>{provider}</option>)}
            </select>
          </label>

          <label className="field">
            <span>Model</span>
            <select
              value={draft.model}
              onChange={event => update({ model: event.target.value })}
              disabled={disabled || !draft.provider}
            >
              <option value="">{draft.provider ? "Select model" : "Nora selects at runtime"}</option>
              {modelOptions.map(model => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>

          <label className="field">
            <span>Task timeout</span>
            <select
              value={draft.timeoutMs}
              onChange={event => update({ timeoutMs: event.target.value })}
              disabled={disabled}
            >
              {timeoutOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Inputs</span>
            <input
              type="text"
              value={draft.inputs}
              onChange={event => update({ inputs: event.target.value })}
              placeholder="input-name, previous-output"
              disabled={disabled}
            />
          </label>

          <label className="field">
            <span>Output</span>
            <input
              type="text"
              value={draft.output}
              onChange={event => update({ output: event.target.value })}
              placeholder="result-name"
              disabled={disabled}
            />
          </label>

          <ChoiceList
            label="Tools"
            options={toolOptions}
            selected={draft.tools}
            automatic={draft.toolsAutomatic}
            onAutomaticChange={value => update({ toolsAutomatic: value })}
            onToggle={name => toggle("tools", name)}
            disabled={disabled}
          />

          <ChoiceList
            label="Skills"
            options={skillOptions}
            selected={draft.skills}
            automatic={draft.skillsAutomatic}
            onAutomaticChange={value => update({ skillsAutomatic: value })}
            onToggle={name => toggle("skills", name)}
            disabled={disabled}
          />

          <label className="field">
            <span>Completion</span>
            <textarea
              rows={3}
              value={draft.completion}
              onChange={event => update({ completion: event.target.value })}
              placeholder="How the temporary Agent knows this Task is complete"
              disabled={disabled}
            />
          </label>
        </div>
      </div>

      <footer className="form-actions task-config__actions">
        <span className="form-actions__status">{disabled ? "Workflow configuration is locked" : dirty ? "Unsaved changes" : "Up to date"}</span>
        <div className="form-actions__buttons">
          {onRevise && (
            <button type="button" className="button button--quiet" onClick={onRevise} disabled={disabled}>
              <IconSparkles size={14} /> Ask Nora
            </button>
          )}
          <button type="submit" className="button button--primary" disabled={disabled || !dirty || !valid || saving}>
            <IconDeviceFloppy size={14} /> {saving ? "Saving…" : "Save configuration"}
          </button>
        </div>
      </footer>
    </form>
  );
}