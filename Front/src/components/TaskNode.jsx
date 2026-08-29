import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconActivity,
  IconChevronDown,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";

export const TASK_NODE_WIDTH = 304;
export const TASK_NODE_HEIGHT = 430;
export const COMPACT_NODE_WIDTH = 132;
export const COMPACT_NODE_HEIGHT = 54;

const TIMEOUT_OPTIONS = [
  { value: "60000", label: "1 minute" },
  { value: "120000", label: "2 minutes" },
  { value: "300000", label: "5 minutes" },
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

const humanizeId = id => String(id || "")
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\b\w/g, character => character.toUpperCase())
  .slice(0, 50);

const commaList = value => [...new Set(
  String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean),
)];

const draftFrom = (task, taskId) => ({
  name: task?.name || humanizeId(taskId),
  objective: task?.objective || "",
  provider: task?.provider || "",
  model: task?.model || "",
  timeoutMs: String(task?.timeoutMs === null ? 0 : (task?.timeoutMs ?? 300000)),
  inputs: uniqueNames(task?.inputs).join(", "),
  output: task?.output || "",
  tools: Array.isArray(task?.tools) ? uniqueNames(task.tools) : null,
  skills: Array.isArray(task?.skills) ? uniqueNames(task.skills) : null,
  completion: task?.completion || "",
});

const payloadFrom = draft => ({
  name: draft.name.trim(),
  objective: draft.objective.trim(),
  provider: draft.provider || null,
  model: draft.provider ? draft.model || null : null,
  timeoutMs: draft.timeoutMs === "0" ? null : Number(draft.timeoutMs),
  inputs: commaList(draft.inputs),
  output: draft.output.trim(),
  tools: draft.tools === null ? null : uniqueNames(draft.tools),
  skills: draft.skills === null ? null : uniqueNames(draft.skills),
  completion: draft.completion.trim(),
});

function MultiPicker({ label, values, options, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const automatic = values === null;
  const selected = values || [];
  const allOptions = useMemo(
    () => [...new Set([...options, ...selected])].sort((left, right) => left.localeCompare(right)),
    [options, selected],
  );
  const summary = automatic ? "Nora selects" : selected.length ? `${selected.length} selected` : "None";

  const toggle = name => {
    const next = selected.includes(name)
      ? selected.filter(item => item !== name)
      : [...selected, name];
    onChange(next);
  };

  return (
    <div className="workflow-node-picker">
      <span>{label}</span>
      <button
        type="button"
        className="workflow-node-picker__trigger"
        disabled={disabled}
        onClick={event => {
          event.stopPropagation();
          setOpen(value => !value);
        }}
      >
        <span>{summary}</span>
        <IconChevronDown size={12} />
      </button>
      {open && !disabled && (
        <div
          className="workflow-node-picker__menu"
          onPointerDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
        >
          <label className="workflow-node-picker__automatic">
            <input
              type="checkbox"
              checked={automatic}
              onChange={event => onChange(event.target.checked ? null : [])}
            />
            <span>Nora selects at runtime</span>
          </label>
          {!automatic && (
            <div className="workflow-node-picker__options">
              {allOptions.length ? allOptions.map(name => (
                <label key={name}>
                  <input type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)} />
                  <span>{name}</span>
                </label>
              )) : <small>No options available.</small>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TaskNode({
  taskId,
  task,
  status = "",
  selected = false,
  editable = false,
  catalog = { models: [], tools: [], skills: [] },
  onSave,
  onDelete,
  onRevise,
  onInspect,
  dragHandlers = {},
}) {
  const initial = useMemo(() => draftFrom(task, taskId), [task, taskId]);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const saveQueueRef = useRef(Promise.resolve());
  const pendingRef = useRef(0);

  useEffect(() => { setDraft(initial); }, [initial]);

  const providerOptions = [...new Set([
    ...catalog.models.map(entry => entry.provider),
    ...(draft.provider ? [draft.provider] : []),
  ])];
  const modelOptions = [...new Set([
    ...(catalog.models.find(entry => entry.provider === draft.provider)?.models || []),
    ...(draft.model ? [draft.model] : []),
  ])];
  const toolOptions = catalog.tools.map(tool => tool.name).filter(Boolean);
  const skillOptions = catalog.skills.map(skill => skill.name).filter(Boolean);

  const queueSave = next => {
    setDraft(next);
    if (!editable || !onSave) return;
    pendingRef.current += 1;
    setSaving(true);
    saveQueueRef.current = saveQueueRef.current
      .catch(() => {})
      .then(() => onSave(taskId, payloadFrom(next)))
      .finally(() => {
        pendingRef.current -= 1;
        if (pendingRef.current === 0) setSaving(false);
      });
  };

  const updateLocal = changes => setDraft(current => ({ ...current, ...changes }));
  const commitLocal = changes => queueSave({ ...draft, ...changes });

  const changeProvider = provider => {
    const models = catalog.models.find(entry => entry.provider === provider)?.models || [];
    queueSave({
      ...draft,
      provider,
      model: provider ? (models.includes(draft.model) ? draft.model : models[0] || "") : "",
    });
  };

  return (
    <div className={`workflow-task-node ${selected ? "workflow-task-node--selected" : ""} ${status ? `workflow-task-node--${status}` : ""}`}>
      <div
        className="workflow-task-node__titlebar"
        onPointerDown={dragHandlers.onPointerDown}
        onPointerMove={dragHandlers.onPointerMove}
        onPointerUp={dragHandlers.onPointerUp}
        onPointerCancel={dragHandlers.onPointerCancel}
      >
        <span className="workflow-task-node__status" title={status || "Task"} />
        <strong>{draft.name || humanizeId(taskId)}</strong>
        <span className="workflow-task-node__saving">{saving ? "saving" : ""}</span>
        <div className="workflow-task-node__actions" onPointerDown={event => event.stopPropagation()}>
          {onInspect && (
            <button type="button" onClick={event => { event.stopPropagation(); onInspect(); }} title="Details" aria-label="Details">
              <IconActivity size={13} />
            </button>
          )}
          {onRevise && (
            <button type="button" onClick={event => { event.stopPropagation(); onRevise(); }} title="Ask Nora to revise" aria-label="Ask Nora to revise">
              <IconSparkles size={13} />
            </button>
          )}
          {editable && onDelete && (
            <button type="button" onClick={event => { event.stopPropagation(); onDelete(); }} title="Delete Task" aria-label="Delete Task">
              <IconTrash size={13} />
            </button>
          )}
        </div>
      </div>

      <div
        className="workflow-task-node__body"
        onPointerDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
      >
        <label className="workflow-node-field workflow-node-field--stacked">
          <span>Objective</span>
          <textarea
            rows={2}
            value={draft.objective}
            disabled={!editable}
            onChange={event => updateLocal({ objective: event.target.value })}
            onBlur={() => queueSave(draft)}
          />
        </label>

        <label className="workflow-node-field">
          <span>Provider</span>
          <select value={draft.provider} disabled={!editable} onChange={event => changeProvider(event.target.value)}>
            <option value="">Nora selects</option>
            {providerOptions.map(provider => <option key={provider} value={provider}>{provider}</option>)}
          </select>
        </label>

        <label className="workflow-node-field">
          <span>Model</span>
          <select
            value={draft.model}
            disabled={!editable || !draft.provider}
            onChange={event => commitLocal({ model: event.target.value })}
          >
            <option value="">{draft.provider ? "Select model" : "Nora selects"}</option>
            {modelOptions.map(model => <option key={model} value={model}>{model}</option>)}
          </select>
        </label>

        <label className="workflow-node-field">
          <span>Timeout</span>
          <select value={draft.timeoutMs} disabled={!editable} onChange={event => commitLocal({ timeoutMs: event.target.value })}>
            {TIMEOUT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="workflow-node-field">
          <span>Inputs</span>
          <input
            type="text"
            value={draft.inputs}
            disabled={!editable}
            onChange={event => updateLocal({ inputs: event.target.value })}
            onBlur={() => queueSave(draft)}
            placeholder="input, previous-output"
          />
        </label>

        <label className="workflow-node-field">
          <span>Output</span>
          <input
            type="text"
            value={draft.output}
            disabled={!editable}
            onChange={event => updateLocal({ output: event.target.value })}
            onBlur={() => queueSave(draft)}
            placeholder="result"
          />
        </label>

        <MultiPicker
          label="Tools"
          values={draft.tools}
          options={toolOptions}
          disabled={!editable}
          onChange={tools => queueSave({ ...draft, tools })}
        />

        <MultiPicker
          label="Skills"
          values={draft.skills}
          options={skillOptions}
          disabled={!editable}
          onChange={skills => queueSave({ ...draft, skills })}
        />

        <label className="workflow-node-field workflow-node-field--stacked">
          <span>Completion</span>
          <textarea
            rows={2}
            value={draft.completion}
            disabled={!editable}
            onChange={event => updateLocal({ completion: event.target.value })}
            onBlur={() => queueSave(draft)}
          />
        </label>
      </div>
    </div>
  );
}
