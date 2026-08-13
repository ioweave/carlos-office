import { IconCloud, IconDeviceDesktop, IconRefresh, IconWifiOff } from '@tabler/icons-react';

export const providerOptions = [
    { id: 'ollama', label: 'Ollama · local and cloud' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'openai-compatible', label: 'OpenAI-compatible' },
    { id: 'claude', label: 'Anthropic Claude' },
    { id: 'gemini', label: 'Google Gemini' },
];

export const editableAgentConfig = agent => ({
    provider: agent?.provider || 'ollama',
    model: agent?.model || '',
    baseUrl: agent?.baseUrl || '',
    temperature: agent?.temperature ?? 0.2,
    maxToolRounds: agent?.maxToolRounds ?? 5,
    enabled: agent?.enabled !== false,
    modelPolicy: {
        mode: agent?.modelPolicy?.mode || 'fixed',
        defaultModelOptionId: agent?.modelPolicy?.defaultModelOptionId || '',
        allowedModelOptionIds: agent?.modelPolicy?.allowedModelOptionIds || [],
        preferredCapabilities: agent?.modelPolicy?.preferredCapabilities || [],
    },
    fallback: {
        enabled: !!agent?.fallback?.enabled,
        provider: agent?.fallback?.provider || 'ollama',
        model: agent?.fallback?.model || '',
        baseUrl: agent?.fallback?.baseUrl || '',
    },
});

const isValidUrl = value => {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch { return false; }
};

const validate = draft => {
    const errors = {};
    const temperature = Number(draft.temperature);
    const maxToolRounds = Number(draft.maxToolRounds);
    if (!String(draft.model || '').trim()) errors.model = 'Choose or enter a primary model.';
    if (!isValidUrl(draft.baseUrl)) errors.baseUrl = 'Enter a valid HTTP or HTTPS URL.';
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) errors.temperature = 'Use a value from 0 to 2.';
    if (!Number.isInteger(maxToolRounds) || maxToolRounds < 0 || maxToolRounds > 12) errors.maxToolRounds = 'Use a whole number from 0 to 12.';
    if (draft.fallback?.enabled) {
        if (!String(draft.fallback.model || '').trim()) errors.fallbackModel = 'Choose or enter a fallback model.';
        if (!isValidUrl(draft.fallback.baseUrl)) errors.fallbackBaseUrl = 'Enter a valid HTTP or HTTPS URL.';
    }
    return errors;
};

function ModelField({ label, provider, value, models, onChange, error }) {
    return (
        <label className="agent-config__field">
            <span>{label}</span>
            {provider === 'ollama' && models.length ? (
                <select value={value} onChange={event => onChange(event.target.value)} aria-invalid={!!error}>
                    {!models.includes(value) && value && <option value={value}>{value}</option>}
                    {models.map(model => <option key={model} value={model}>{model}</option>)}
                </select>
            ) : (
                <input value={value} onChange={event => onChange(event.target.value)} placeholder="Model identifier" aria-invalid={!!error} />
            )}
            {error && <small className="agent-config__error">{error}</small>}
        </label>
    );
}

export default function AgentConfigurationForm({
    agent,
    draft,
    dirty,
    ollamaModels,
    modelOptions = [],
    loadingModels,
    saving,
    onChange,
    onDiscard,
    onRefreshModels,
    onSave,
}) {
    const errors = validate(draft);
    const valid = Object.keys(errors).length === 0;
    const update = (field, value) => onChange({ ...draft, [field]: value });
    const updateFallback = (field, value) => onChange({
        ...draft,
        fallback: { ...draft.fallback, [field]: value },
    });
    const updateModelPolicy = (field, value) => onChange({
        ...draft,
        modelPolicy: { ...draft.modelPolicy, [field]: value },
    });
    const allowedModels = draft.modelPolicy?.allowedModelOptionIds || [];
    const preferredCapabilities = draft.modelPolicy?.preferredCapabilities || [];
    const capabilityOptions = [...new Set(modelOptions.flatMap(option => option.capabilities || []))]
        .filter(capability => !['tools', 'reasoning', 'offline'].includes(capability));
    const cloudModel = draft.provider !== 'ollama' || String(draft.model || '').endsWith(':cloud');

    return (
        <form className="agent-config" onSubmit={event => { event.preventDefault(); if (dirty && valid && !saving) onSave(); }}>
            <div className="agent-config__enabled">
                <div>
                    <strong>Agent enabled</strong>
                    <span>Disabled agents remain visible but cannot receive new work.</span>
                </div>
                <label className="agent-config__switch">
                    <input type="checkbox" aria-label="Agent enabled" checked={!!draft.enabled} onChange={event => update('enabled', event.target.checked)} />
                    <span aria-hidden="true" />
                </label>
            </div>

            <section className="agent-config__section">
                <div className="agent-config__section-heading">
                    <div><strong>Primary runtime</strong><span>{ollamaModels.length} Ollama models detected</span></div>
                    <button type="button" onClick={onRefreshModels} disabled={loadingModels} aria-label="Refresh Ollama models">
                        <IconRefresh size={15} className={loadingModels ? 'is-spinning' : ''} />
                        {loadingModels ? 'Refreshing' : 'Refresh'}
                    </button>
                </div>

                <div className="agent-config__grid">
                    <label className="agent-config__field">
                        <span>Model selection</span>
                        <select value={draft.modelPolicy?.mode || 'fixed'} onChange={event => updateModelPolicy('mode', event.target.value)}>
                            <option value="adaptive">Adaptive by task</option>
                            <option value="fixed">Fixed primary</option>
                        </select>
                    </label>
                    <label className="agent-config__field">
                        <span>Provider</span>
                        <select value={draft.provider} onChange={event => update('provider', event.target.value)}>
                            {providerOptions.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                        </select>
                    </label>
                    <ModelField label="Primary model" provider={draft.provider} value={draft.model} models={ollamaModels} onChange={value => update('model', value)} error={errors.model} />
                    <label className="agent-config__field">
                        <span>Temperature</span>
                        <input type="number" min="0" max="2" step="0.05" value={draft.temperature} onChange={event => update('temperature', event.target.value)} aria-invalid={!!errors.temperature} />
                        {errors.temperature && <small className="agent-config__error">{errors.temperature}</small>}
                    </label>
                    <label className="agent-config__field">
                        <span>Maximum tool rounds</span>
                        <input type="number" min="0" max="12" step="1" value={draft.maxToolRounds} onChange={event => update('maxToolRounds', event.target.value)} aria-invalid={!!errors.maxToolRounds} />
                        {errors.maxToolRounds && <small className="agent-config__error">{errors.maxToolRounds}</small>}
                    </label>
                </div>

                {draft.modelPolicy?.mode === 'adaptive' && !!modelOptions.length && <div className="agent-config__adaptive">
                    <label className="agent-config__field">
                        <span>Default preference</span>
                        <select value={draft.modelPolicy?.defaultModelOptionId || ''} onChange={event => updateModelPolicy('defaultModelOptionId', event.target.value)}>
                            {modelOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                        </select>
                    </label>
                    <div className="agent-config__model-list"><strong>Models this agent may choose</strong>{modelOptions.map(option => {
                        const checked = !allowedModels.length || allowedModels.includes(option.id);
                        return <label key={option.id}><input type="checkbox" checked={checked} onChange={event => {
                            const baseline = allowedModels.length ? allowedModels : modelOptions.map(item => item.id);
                            updateModelPolicy('allowedModelOptionIds', event.target.checked ? [...new Set([...baseline, option.id])] : baseline.filter(id => id !== option.id));
                        }} /><span><b>{option.label}</b><small>{option.provider} · quality {option.quality} · speed {option.speed} · cost {option.cost}</small></span></label>;
                    })}</div>
                    <div className="agent-config__capabilities"><strong>Prefer capabilities</strong><div>{capabilityOptions.map(capability => <label key={capability}><input type="checkbox" checked={preferredCapabilities.includes(capability)} onChange={event => updateModelPolicy('preferredCapabilities', event.target.checked ? [...new Set([...preferredCapabilities, capability])] : preferredCapabilities.filter(item => item !== capability))} />{capability}</label>)}</div></div>
                    <p>The router scores eligible configured models for each task type. The default preference is a tie-breaker, not a forced route.</p>
                </div>}

                <details className="agent-config__advanced">
                    <summary>Advanced connection settings</summary>
                    <label className="agent-config__field">
                        <span>Base URL</span>
                        <input value={draft.baseUrl} onChange={event => update('baseUrl', event.target.value)} placeholder="Provider base URL" aria-invalid={!!errors.baseUrl} />
                        {errors.baseUrl && <small className="agent-config__error">{errors.baseUrl}</small>}
                    </label>
                </details>
            </section>

            <section className="agent-config__section agent-config__section--fallback">
                <div className="agent-config__fallback-heading">
                    <div><IconWifiOff size={16} /><span><strong>Offline fallback</strong><small>Used only for connectivity failures.</small></span></div>
                    <label className="agent-config__switch agent-config__switch--compact">
                        <input type="checkbox" aria-label="Offline fallback enabled" checked={!!draft.fallback?.enabled} onChange={event => updateFallback('enabled', event.target.checked)} />
                        <span aria-hidden="true" />
                    </label>
                </div>
                {draft.fallback?.enabled && (
                    <div className="agent-config__grid agent-config__fallback-fields">
                        <label className="agent-config__field">
                            <span>Provider</span>
                            <select value={draft.fallback.provider} onChange={event => updateFallback('provider', event.target.value)}>
                                {providerOptions.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                            </select>
                        </label>
                        <ModelField label="Fallback model" provider={draft.fallback.provider} value={draft.fallback.model} models={ollamaModels} onChange={value => updateFallback('model', value)} error={errors.fallbackModel} />
                        <label className="agent-config__field agent-config__field--wide">
                            <span>Base URL</span>
                            <input value={draft.fallback.baseUrl} onChange={event => updateFallback('baseUrl', event.target.value)} aria-invalid={!!errors.fallbackBaseUrl} />
                            {errors.fallbackBaseUrl && <small className="agent-config__error">{errors.fallbackBaseUrl}</small>}
                        </label>
                    </div>
                )}
            </section>

            <p className="agent-config__notice">Changes apply to {agent.name}'s next execution. Running jobs keep their current configuration.</p>
            <footer className="agent-config__footer">
                <div className="agent-config__runtime">
                    {cloudModel ? <IconCloud size={15} /> : <IconDeviceDesktop size={15} />}
                    <span>{cloudModel ? 'Cloud primary' : 'Local primary'}{dirty ? ' · Unsaved changes' : ''}</span>
                </div>
                <div>
                    <button type="button" className="secondary-button" onClick={onDiscard} disabled={!dirty || saving}>Discard</button>
                    <button type="submit" className="primary-button" disabled={!dirty || !valid || saving}>{saving ? 'Saving…' : 'Save changes'}</button>
                </div>
            </footer>
        </form>
    );
}
