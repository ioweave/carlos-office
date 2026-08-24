import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import api, { endpoints } from "../api";

const THEMED_SELECT_STYLE = {
  backgroundColor: "var(--color-surface)",
  color: "var(--color-text)",
};

export default function NoraConfig({ nora, onChanged }) {
  const [models, setModels] = useState([]);
  const [draft, setDraft] = useState({ provider: "", model: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft({ provider: nora?.provider || "", model: nora?.model || "" });
  }, [nora?.provider, nora?.model]);

  useEffect(() => {
    api.get(endpoints.models())
      .then(response => setModels(response.data || []))
      .catch(error => toast.error(error.response?.data?.error || "Could not load Nora models."));
  }, []);

  const providers = useMemo(() => models.map(item => item.provider), [models]);
  const providerModels = models.find(item => item.provider === draft.provider)?.models || [];
  const changed = draft.provider && draft.model
    && (draft.provider !== nora?.provider || draft.model !== nora?.model);

  const save = async () => {
    if (!changed) return;
    setSaving(true);
    try {
      await api.patch(endpoints.nora(), draft);
      onChanged?.();
      toast.success("Nora default model updated.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not update Nora.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="agent-config">
      <div className="agent-config__section">
        <div className="agent-config__section-heading">
          <div>
            <strong className="agent-config__section-title">New conversation model</strong>
            <span className="agent-config__section-hint">Default model Nora uses when a new conversation is created.</span>
          </div>
          {changed && (
            <button type="button" className="button button--primary" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>

        <div className="agent-config__grid">
          <label className="agent-config__field">
            <span className="agent-config__field-label">Provider</span>
            <select
              className="agent-config__field-select"
              style={THEMED_SELECT_STYLE}
              aria-label="Nora default provider"
              value={draft.provider}
              onChange={event => {
                const provider = event.target.value;
                const model = models.find(item => item.provider === provider)?.models?.[0] || "";
                setDraft({ provider, model });
              }}
            >
              {!providers.includes(draft.provider) && draft.provider && <option value={draft.provider}>{draft.provider}</option>}
              {providers.map(provider => <option key={provider} value={provider}>{provider}</option>)}
            </select>
          </label>

          <label className="agent-config__field">
            <span className="agent-config__field-label">Model</span>
            <select
              className="agent-config__field-select"
              style={THEMED_SELECT_STYLE}
              aria-label="Nora default model"
              value={draft.model}
              onChange={event => setDraft(current => ({ ...current, model: event.target.value }))}
            >
              <option value="">Select model</option>
              {providerModels.map(model => <option key={model} value={model}>{model}</option>)}
              {!providerModels.includes(draft.model) && draft.model && <option value={draft.model}>{draft.model}</option>}
            </select>
          </label>
        </div>

        <p className="agent-config__notice">Existing conversations keep their own model.</p>
      </div>
    </section>
  );
}
