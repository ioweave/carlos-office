import { useCallback, useEffect, useMemo, useState } from "react";
import { IconCpu, IconPlus, IconRefresh, IconServer, IconTrash, IconX } from "@tabler/icons-react";
import { toast } from "sonner";

import api, { endpoints } from "../api";
import FilterableSortableTable from "../components/FilterableSortableTable";
import "../styles/providers.scss";

const CAPABILITIES = ["thinking", "vision", "audio", "embeddings"];
const emptyProvider = { name: "", type: "ollama", baseUrl: "http://localhost:11434/api", apiKeyEnv: "OLLAMA_API_KEY" };
const emptyModel = { provider: "", name: "", location: "local", parameters: "", supportedCapabilities: [] };

const formatParameters = value => {
  if (!Number.isFinite(value)) return "—";
  const units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [size, suffix] of units) {
    if (value >= size) {
      const scaled = value / size;
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      return `${Number(scaled.toFixed(digits))}${suffix}`;
    }
  }
  return String(value);
};

const formatCost = model => {
  const input = model.costPerMillionTokens?.inputUsd;
  const output = model.costPerMillionTokens?.outputUsd;
  if (input == null && output == null) return "—";
  const money = value => value == null ? "?" : `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  return `${money(input)} in / ${money(output)} out`;
};

const statusFor = model => !model.available ? "unavailable" : model.enabled ? "active" : "disabled";
const capabilityFilterOptions = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Supported · off" },
  { value: "unsupported", label: "Unsupported" },
  { value: "unknown", label: "Unknown" },
];

export default function ProvidersPage() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(new Set());
  const [providerFormOpen, setProviderFormOpen] = useState(false);
  const [modelFormOpen, setModelFormOpen] = useState(false);
  const [providerDraft, setProviderDraft] = useState(emptyProvider);
  const [modelDraft, setModelDraft] = useState(emptyModel);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setProviders((await api.get(endpoints.providers(refresh))).data || []);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not load provider models.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  const rows = useMemo(() => providers.flatMap(provider => (
    (provider.models || []).map(model => ({ ...model, provider: model.provider || provider.provider }))
  )), [providers]);

  const providerOptions = useMemo(() => [
    { value: "all", label: "All providers" },
    ...providers.map(item => ({ value: item.provider, label: item.provider })),
  ], [providers]);

  const replaceModel = useCallback(updated => {
    if (!updated) return;
    setProviders(current => current.map(provider => provider.provider !== updated.provider ? provider : ({
      ...provider,
      models: (provider.models || []).map(model => model.name === updated.name ? updated : model),
    })));
  }, []);

  const patchModel = useCallback(async (model, changes, key) => {
    const savingKey = `${model.provider}:${model.name}:${key}`;
    setSaving(current => new Set(current).add(savingKey));
    try {
      replaceModel((await api.patch(endpoints.providerModel(model.provider, model.name), changes)).data);
    } catch (error) {
      toast.error(error.response?.data?.error || `Could not update ${model.name}.`);
    } finally {
      setSaving(current => {
        const next = new Set(current);
        next.delete(savingKey);
        return next;
      });
    }
  }, [replaceModel]);

  const registerProvider = async event => {
    event.preventDefault();
    try {
      const response = await api.post(endpoints.providers(), providerDraft);
      setProviders(response.data || []);
      setProviderDraft(emptyProvider);
      setProviderFormOpen(false);
      toast.success("Provider registered. Restart the backend before assigning it to Nora.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not register provider.");
    }
  };

  const registerModel = async event => {
    event.preventDefault();
    try {
      const response = await api.post(endpoints.providerModels(modelDraft.provider), modelDraft);
      setProviders(response.data || []);
      setModelDraft(current => ({ ...emptyModel, provider: current.provider }));
      setModelFormOpen(false);
      toast.success("Model registered. Restart the backend before assigning it to Nora.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not register model.");
    }
  };

  const removeProvider = async provider => {
    if (provider.builtIn || !window.confirm(`Remove provider ${provider.provider}?`)) return;
    try {
      setProviders((await api.delete(endpoints.provider(provider.provider))).data || []);
    } catch (error) {
      toast.error(error.response?.data?.error || `Could not remove ${provider.provider}.`);
    }
  };

  const removeModel = async model => {
    if (!model.registered || !window.confirm(`Remove registered model ${model.name}?`)) return;
    try {
      setProviders((await api.delete(endpoints.providerModel(model.provider, model.name))).data || []);
    } catch (error) {
      toast.error(error.response?.data?.error || `Could not remove ${model.name}.`);
    }
  };

  const renderCapability = useCallback((model, capability) => {
    const definition = model.capabilities?.[capability] || { supported: null, enabled: false };
    const key = `${model.provider}:${model.name}:${capability}`;
    if (definition.supported === false) return <span className="model-capability model-capability--unsupported" title="Unsupported">—</span>;
    if (definition.supported !== true) return <span className="model-capability model-capability--unknown" title="Capability not reported">?</span>;
    return (
      <button
        type="button"
        className={`model-capability model-capability--toggle ${definition.enabled ? "model-capability--enabled" : ""}`}
        disabled={saving.has(key) || !model.available}
        aria-pressed={definition.enabled}
        onClick={() => void patchModel(model, { capabilities: { [capability]: !definition.enabled } }, capability)}
      >
        {definition.enabled ? "On" : "Off"}
      </button>
    );
  }, [patchModel, saving]);

  const columns = useMemo(() => [
    { key: "provider", label: "Provider", sortType: "text" },
    { key: "name", label: "Model", sortType: "mixed", className: "providers-table__model" },
    { key: "location", label: "Runtime", sortType: "text", render: row => <span className={`model-runtime model-runtime--${row.location}`}>{row.location}</span> },
    { key: "parameters", label: "Parameters", sortType: "number", render: row => formatParameters(row.parameters) },
    ...CAPABILITIES.map(capability => ({
      key: capability,
      label: capability[0].toUpperCase() + capability.slice(1),
      sortType: "boolean",
      value: row => row.capabilities?.[capability]?.enabled ?? false,
      render: row => renderCapability(row, capability),
      className: "providers-table__capability",
    })),
    { key: "cost", label: "Cost / 1M tokens", sortType: "number", value: row => row.costPerMillionTokens?.inputUsd, render: row => <span className="model-cost">{formatCost(row)}</span> },
    {
      key: "status",
      label: "Usage",
      sortType: "text",
      value: statusFor,
      render: model => {
        const status = statusFor(model);
        const key = `${model.provider}:${model.name}:enabled`;
        if (!model.available) return <span className="model-status model-status--unavailable">Unavailable</span>;
        return (
          <button type="button" className={`model-status model-status--${status}`} disabled={saving.has(key)} aria-pressed={model.enabled} onClick={() => void patchModel(model, { enabled: !model.enabled }, "enabled")}>
            {model.enabled ? "Enabled" : "Disabled"}
          </button>
        );
      },
    },
    {
      key: "registry",
      label: "Registry",
      sortType: "text",
      value: row => row.registered ? "registered" : "discovered",
      render: row => row.registered ? (
        <button type="button" className="icon-button" onClick={() => void removeModel(row)} title="Remove manual registration" aria-label={`Remove ${row.name}`}><IconTrash size={14} /></button>
      ) : <span className="model-source">discovered</span>,
    },
  ], [patchModel, renderCapability, saving]);

  const filters = useMemo(() => [
    { key: "search", label: "Search", type: "search", placeholder: "Provider or model…", value: row => `${row.provider} ${row.name}` },
    { key: "provider", label: "Provider", type: "select", defaultValue: "all", options: providerOptions },
    { key: "location", label: "Runtime", type: "select", defaultValue: "all", options: [{ value: "all", label: "All runtimes" }, { value: "local", label: "Local" }, { value: "cloud", label: "Cloud" }] },
    ...CAPABILITIES.map(capability => ({
      key: capability,
      label: capability[0].toUpperCase() + capability.slice(1),
      type: "select",
      defaultValue: "all",
      options: capabilityFilterOptions,
      predicate: (row, selected) => {
        const value = row.capabilities?.[capability];
        if (selected === "enabled") return value?.supported === true && value.enabled === true;
        if (selected === "disabled") return value?.supported === true && value.enabled === false;
        if (selected === "unsupported") return value?.supported === false;
        if (selected === "unknown") return value?.supported == null;
        return true;
      },
    })),
    { key: "status", label: "Usage", type: "select", defaultValue: "all", options: [{ value: "all", label: "All statuses" }, { value: "active", label: "Enabled" }, { value: "disabled", label: "Disabled" }, { value: "unavailable", label: "Unavailable" }], predicate: (row, selected) => statusFor(row) === selected },
  ], [providerOptions]);

  const toggleCapability = capability => setModelDraft(current => ({
    ...current,
    supportedCapabilities: current.supportedCapabilities.includes(capability)
      ? current.supportedCapabilities.filter(item => item !== capability)
      : [...current.supportedCapabilities, capability],
  }));

  return (
    <div className="workspace-page providers-page">
      <header className="page-header">
        <div className="page-header__copy">
          <span className="eyebrow">Model routing policy</span>
          <h1>Providers</h1>
          <p>Register model endpoints, add models, and control which capabilities Nora may route to them.</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="button button--quiet" onClick={() => setProviderFormOpen(true)}><IconPlus size={15} /> Provider</button>
          <button type="button" className="button button--primary" onClick={() => { setModelDraft(current => ({ ...current, provider: current.provider || providers[0]?.provider || "" })); setModelFormOpen(true); }} disabled={!providers.length}><IconPlus size={15} /> Model</button>
          <button type="button" className="icon-button" onClick={() => void load(true)} disabled={loading} aria-label="Refresh provider models"><IconRefresh size={18} /></button>
        </div>
      </header>

      <section className="provider-registry" aria-label="Registered providers">
        {providers.map(provider => (
          <article key={provider.provider} className={`provider-card ${provider.available ? "provider-card--available" : "provider-card--offline"}`}>
            <div className="provider-card__icon"><IconServer size={18} /></div>
            <div className="provider-card__copy">
              <strong>{provider.provider}</strong>
              <span>{provider.type} · {provider.baseUrl}</span>
              {provider.apiKeyEnv && <small>API key env: {provider.apiKeyEnv}</small>}
              {provider.error && <small className="provider-card__error">{provider.error}</small>}
            </div>
            <span className={`status-pill ${provider.available ? "status-pill--completed" : "status-pill--failed"}`}>{provider.available ? "Available" : provider.enabled ? "Offline" : "Disabled"}</span>
            {!provider.builtIn && <button type="button" className="icon-button" onClick={() => void removeProvider(provider)} aria-label={`Remove ${provider.provider}`}><IconTrash size={15} /></button>}
          </article>
        ))}
      </section>

      {providerFormOpen && (
        <form className="provider-editor panel" onSubmit={registerProvider}>
          <div className="panel__header"><div><span className="eyebrow">Registry</span><h2>Register provider</h2></div><button type="button" className="icon-button" onClick={() => setProviderFormOpen(false)}><IconX size={17} /></button></div>
          <div className="provider-editor__grid">
            <label className="field"><span>Name</span><input value={providerDraft.name} onChange={event => setProviderDraft(current => ({ ...current, name: event.target.value }))} placeholder="ollama-cloud" required /></label>
            <label className="field"><span>Adapter</span><select value={providerDraft.type} onChange={event => setProviderDraft(current => ({ ...current, type: event.target.value }))}><option value="ollama">Ollama / Ollama-compatible</option></select></label>
            <label className="field provider-editor__wide"><span>Base URL</span><input value={providerDraft.baseUrl} onChange={event => setProviderDraft(current => ({ ...current, baseUrl: event.target.value }))} placeholder="http://localhost:11434/api" required /></label>
            <label className="field provider-editor__wide"><span>API key environment variable · optional</span><input value={providerDraft.apiKeyEnv} onChange={event => setProviderDraft(current => ({ ...current, apiKeyEnv: event.target.value }))} placeholder="OLLAMA_API_KEY" /></label>
          </div>
          <footer className="form-actions"><button type="button" className="button button--quiet" onClick={() => setProviderFormOpen(false)}>Cancel</button><button type="submit" className="button button--primary">Register provider</button></footer>
        </form>
      )}

      {modelFormOpen && (
        <form className="provider-editor panel" onSubmit={registerModel}>
          <div className="panel__header"><div><span className="eyebrow">Registry</span><h2>Add model</h2></div><button type="button" className="icon-button" onClick={() => setModelFormOpen(false)}><IconX size={17} /></button></div>
          <div className="provider-editor__grid">
            <label className="field"><span>Provider</span><select value={modelDraft.provider} onChange={event => setModelDraft(current => ({ ...current, provider: event.target.value }))} required><option value="">Select provider</option>{providers.map(provider => <option key={provider.provider} value={provider.provider}>{provider.provider}</option>)}</select></label>
            <label className="field"><span>Model name</span><input value={modelDraft.name} onChange={event => setModelDraft(current => ({ ...current, name: event.target.value }))} placeholder="qwen3:8b" required /></label>
            <label className="field"><span>Runtime</span><select value={modelDraft.location} onChange={event => setModelDraft(current => ({ ...current, location: event.target.value }))}><option value="local">Local</option><option value="cloud">Cloud</option></select></label>
            <label className="field"><span>Parameters · optional</span><input value={modelDraft.parameters} onChange={event => setModelDraft(current => ({ ...current, parameters: event.target.value }))} placeholder="8B" /></label>
          </div>
          <div className="provider-capabilities"><span>Supported capabilities</span>{CAPABILITIES.map(capability => <label key={capability}><input type="checkbox" checked={modelDraft.supportedCapabilities.includes(capability)} onChange={() => toggleCapability(capability)} /> {capability}</label>)}</div>
          <footer className="form-actions"><button type="button" className="button button--quiet" onClick={() => setModelFormOpen(false)}>Cancel</button><button type="submit" className="button button--primary">Add model</button></footer>
        </form>
      )}

      {loading && !providers.length ? (
        <div className="page-state"><span className="spinner" /> Loading provider registry</div>
      ) : !rows.length ? (
        <div className="empty-state"><IconCpu size={28} stroke={1.4} /><strong>No models registered or discovered</strong><span>The provider remains visible above even when its endpoint is offline. Add a model manually or fix the endpoint and refresh.</span></div>
      ) : (
        <FilterableSortableTable rows={rows} columns={columns} filters={filters} filtering sorting defaultSort={{ key: "provider", direction: "asc" }} rowKey={row => `${row.provider}:${row.name}`} emptyMessage="No models match the current filters." />
      )}
    </div>
  );
}
