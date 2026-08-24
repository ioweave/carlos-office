import { useEffect, useMemo, useState } from "react";
import { IconDeviceFloppy } from "@tabler/icons-react";
import { toast } from "sonner";

import api, { endpoints } from "../api";

const pretty = value => JSON.stringify(value ?? {}, null, 2);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

export default function WorkflowDataEditor({ workflow, disabled = false, onSaved }) {
  const initial = useMemo(() => ({
    inputs: pretty(workflow?.inputs),
    config: pretty(workflow?.config),
  }), [workflow?.id, workflow?.inputs, workflow?.config]);
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBaseline(initial);
    setDraft(initial);
  }, [initial]);

  const dirty = draft.inputs !== baseline.inputs || draft.config !== baseline.config;

  const parseObject = (text, label) => {
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new Error(`${label} must contain valid JSON: ${error.message}`);
    }
    if (!isObject(value)) throw new Error(`${label} must be a JSON object`);
    return value;
  };

  const save = async event => {
    event.preventDefault();
    if (!workflow?.id || !dirty || saving || disabled) return;

    setSaving(true);
    try {
      const inputs = parseObject(draft.inputs, "Inputs");
      const config = parseObject(draft.config, "Config");
      let updated = workflow;

      if (draft.inputs !== baseline.inputs) {
        updated = (await api.patch(endpoints.workflowInputs(workflow.id), inputs)).data;
      }
      if (draft.config !== baseline.config) {
        updated = (await api.patch(endpoints.workflowConfig(workflow.id), config)).data;
      }

      const saved = { inputs: pretty(updated.inputs), config: pretty(updated.config) };
      setBaseline(saved);
      setDraft(saved);
      onSaved?.(updated);
      toast.success("Workflow data saved.");
    } catch (error) {
      toast.error(error.response?.data?.error || error.message || "Could not save Workflow data.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="workflow-data-editor" onSubmit={save}>
      <label className="field">
        <span>Inputs · JSON</span>
        <textarea
          rows={12}
          value={draft.inputs}
          onChange={event => setDraft(current => ({ ...current, inputs: event.target.value }))}
          disabled={disabled}
        />
      </label>
      <label className="field">
        <span>Config · JSON</span>
        <textarea
          rows={12}
          value={draft.config}
          onChange={event => setDraft(current => ({ ...current, config: event.target.value }))}
          disabled={disabled}
        />
      </label>
      <footer className="form-actions">
        <span className="form-actions__status">{disabled ? "Stop the Workflow before editing" : dirty ? "Unsaved changes" : "Up to date"}</span>
        <button type="submit" className="button button--primary" disabled={disabled || !dirty || saving}>
          <IconDeviceFloppy size={14} /> {saving ? "Saving…" : "Save Workflow data"}
        </button>
      </footer>
    </form>
  );
}
