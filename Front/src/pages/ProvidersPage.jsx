import { useCallback, useEffect, useMemo, useState } from "react";
import { IconCpu, IconRefresh } from "@tabler/icons-react";
import { toast } from "sonner";

import api, { endpoints } from "../api";
import FilterableSortableTable from "../components/FilterableSortableTable";
import "../styles/providers.scss";

const CAPABILITIES = ["thinking", "vision", "audio", "embeddings"];

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
    ...[...new Set(rows.map(row => row.provider))]
      .sort((left, right) => left.localeCompare(right))
      .map(provider => ({ value: provider, label: provider })),
  ], [rows]);

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
      const updated = (
        await api.patch(endpoints.providerModel(model.provider, model.name), changes)
      ).data;
      replaceModel(updated);
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
        title={definition.enabled ? `Disable ${capability} routing` : `Enable ${capability} routing`}
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
    {
      key: "cost",
      label: "Cost / 1M tokens",
      sortType: "number",
      value: row => row.costPerMillionTokens?.inputUsd,
      render: row => <span className="model-cost">{formatCost(row)}</span>,
    },
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
          <button
            type="button"
            className={`model-status model-status--${status}`}
            disabled={saving.has(key)}
            aria-pressed={model.enabled}
            onClick={() => void patchModel(model, { enabled: !model.enabled }, "enabled")}
          >
            {model.enabled ? "Enabled" : "Disabled"}
          </button>
        );
      },
    },
  ], [patchModel, renderCapability, saving]);

  const filters = useMemo(() => [
    {
      key: "search",
      label: "Search",
      type: "search",
      placeholder: "Provider or model…",
      value: row => `${row.provider} ${row.name}`,
    },
    { key: "provider", label: "Provider", type: "select", defaultValue: "all", options: providerOptions },
    {
      key: "location",
      label: "Runtime",
      type: "select",
      defaultValue: "all",
      options: [
        { value: "all", label: "All runtimes" },
        { value: "local", label: "Local" },
        { value: "cloud", label: "Cloud" },
      ],
    },
    {
      key: "parameters",
      label: "Parameters",
      type: "select",
      defaultValue: "all",
      options: [
        { value: "all", label: "Any size" },
        { value: "lt1b", label: "< 1B" },
        { value: "1b10b", label: "1B – 10B" },
        { value: "10b100b", label: "10B – 100B" },
        { value: "100b1t", label: "100B – 1T" },
        { value: "gte1t", label: "≥ 1T" },
        { value: "unknown", label: "Unknown" },
      ],
      predicate: (row, selected) => {
        const value = row.parameters;
        if (selected === "unknown") return !Number.isFinite(value);
        if (!Number.isFinite(value)) return false;
        if (selected === "lt1b") return value < 1e9;
        if (selected === "1b10b") return value >= 1e9 && value < 1e10;
        if (selected === "10b100b") return value >= 1e10 && value < 1e11;
        if (selected === "100b1t") return value >= 1e11 && value < 1e12;
        return selected === "gte1t" ? value >= 1e12 : true;
      },
    },
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
    {
      key: "status",
      label: "Usage",
      type: "select",
      defaultValue: "all",
      options: [
        { value: "all", label: "All statuses" },
        { value: "active", label: "Enabled" },
        { value: "disabled", label: "Disabled" },
        { value: "unavailable", label: "Unavailable" },
      ],
      predicate: (row, selected) => statusFor(row) === selected,
    },
  ], [providerOptions]);

  return (
    <div className="workspace-page providers-page">
      <header className="page-header">
        <div className="page-header__copy">
          <span className="eyebrow">Model routing policy</span>
          <h1>Providers</h1>
          <p>Control which models Carlos Office can use and which supported capabilities Nora may route to each model.</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="icon-button" onClick={() => void load(true)} disabled={loading} aria-label="Refresh provider models" title="Refresh provider models">
            <IconRefresh size={18} />
          </button>
        </div>
      </header>

      {loading && !rows.length ? (
        <div className="page-state"><span className="spinner" /> Loading provider models</div>
      ) : !rows.length ? (
        <div className="empty-state">
          <IconCpu size={28} stroke={1.4} />
          <strong>No models discovered</strong>
          <span>Check the configured model provider and refresh this page.</span>
        </div>
      ) : (
        <FilterableSortableTable
          rows={rows}
          columns={columns}
          filters={filters}
          filtering
          sorting
          defaultSort={{ key: "provider", direction: "asc" }}
          rowKey={row => `${row.provider}:${row.name}`}
          emptyMessage="No models match the current filters."
        />
      )}
    </div>
  );
}
