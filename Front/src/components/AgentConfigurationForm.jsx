import { IconRefresh } from "@tabler/icons-react";

// Minimal agent configuration: only the model binding is editable.
// The backend persists this via PATCH /agents/:id/model { provider, model }.
export const editableAgentConfig = agent => ({
  provider: agent?.provider || "",
  model: agent?.model || "",
});

const sameConfig = (left, right) => left.provider === right.provider && left.model === right.model;

export const isAgentDraftDirty = (draft, agent) => !sameConfig(draft, editableAgentConfig(agent));

export default function AgentConfigurationForm({ agent, draft, models = [], saving, loadingModels, onChange, onRefreshModels, onSave }) {
  const providers = models.map(entry => entry.provider);
  const modelOptions = models.find(entry => entry.provider === draft.provider)?.models || [];
  const valid = !!draft.provider && !!draft.model;
  const dirty = isAgentDraftDirty(draft, agent);

  return (
    <form className="agent-config" onSubmit={event => { event.preventDefault(); if (dirty && valid && !saving) onSave(); }}>
      <section className="agent-config__section">
        <div className="agent-config__section-heading">
          <div><strong className="agent-config__section-title">Model binding</strong><span className="agent-config__section-hint">Only the provider and model are editable. Other agent definition lives in the vault.</span></div>
          <button type="button" className="agent-config__section-action" onClick={onRefreshModels} disabled={loadingModels} aria-label="Refresh models">
            <IconRefresh size={15} className={loadingModels ? "agent-config__icon--spinning" : ""} />
            {loadingModels ? "Refreshing" : "Refresh"}
          </button>
        </div>
        <div className="agent-config__grid">
          <label className="agent-config__field">
            <span className="agent-config__field-label">Provider</span>
            <select className="agent-config__field-select" value={draft.provider} onChange={event => onChange({ provider: event.target.value, model: "" })}>
              {!providers.includes(draft.provider) && draft.provider && <option value={draft.provider}>{draft.provider} · current</option>}
              {providers.map(provider => <option key={provider} value={provider}>{provider}</option>)}
            </select>
          </label>
          <label className="agent-config__field">
            <span className="agent-config__field-label">Model</span>
            <select className="agent-config__field-select" value={draft.model} onChange={event => onChange({ provider: draft.provider, model: event.target.value })}>
              <option value="">Select model</option>
              {modelOptions.map(model => <option key={model} value={model}>{model}</option>)}
              {!modelOptions.includes(draft.model) && draft.model && <option value={draft.model}>{draft.model} · current</option>}
            </select>
          </label>
        </div>
      </section>
      <p className="agent-config__notice">Applies to {agent.name}'s next execution. Running workflows keep their current binding.</p>
      <footer className="agent-config__footer">
        <span className="agent-config__runtime">{dirty ? "Unsaved changes" : "Up to date"}</span>
        <button type="submit" className="primary-button" disabled={!dirty || !valid || saving}>{saving ? "Saving…" : "Save model"}</button>
      </footer>
    </form>
  );
}