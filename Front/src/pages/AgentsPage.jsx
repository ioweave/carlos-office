import { useEffect, useState } from 'react';
import { IconCloud, IconDeviceDesktop, IconRefresh, IconRobot, IconSelector } from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';
import StatusBadge from '../components/StatusBadge';

const providerOptions = [
    { id: 'ollama', label: 'Ollama · local' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'openai-compatible', label: 'OpenAI-compatible' },
    { id: 'claude', label: 'Anthropic Claude' },
    { id: 'gemini', label: 'Google Gemini' },
];

function AgentEditor({ agent, ollamaModels, onSaved }) {
    const [form, setForm] = useState(agent);
    const [saving, setSaving] = useState(false);

    useEffect(() => setForm(agent), [agent]);

    const update = (field, value) => setForm(current => ({ ...current, [field]: value }));
    const updateFallback = (field, value) => setForm(current => ({
        ...current,
        fallback: { ...(current.fallback || {}), [field]: value },
    }));

    const save = async () => {
        setSaving(true);
        try {
            const response = await api.put(`/agents/${agent.agentId}`, {
                provider: form.provider,
                model: form.model,
                baseUrl: form.baseUrl,
                temperature: Number(form.temperature),
                maxToolRounds: Number(form.maxToolRounds),
                enabled: form.enabled,
                fallback: form.fallback,
            });
            onSaved(response.data);
            toast.success(`${agent.name} updated`);
        } catch (error) {
            toast.error(error.response?.data?.error || error.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <article className="agent-card">
            <div className="agent-card-header">
                <div className="agent-identity">
                    <div className={`agent-icon agent-${agent.agentId}`}><IconRobot size={23} /></div>
                    <div><h3>{agent.name}</h3><p>{agent.role}</p></div>
                </div>
                <label className="switch-line">
                    <input type="checkbox" checked={!!form.enabled} onChange={event => update('enabled', event.target.checked)} />
                    <span />
                </label>
            </div>

            <div className="form-grid">
                <label>
                    <span>Provider</span>
                    <select value={form.provider} onChange={event => update('provider', event.target.value)}>
                        {providerOptions.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                    </select>
                </label>
                <label>
                    <span>Model</span>
                    {form.provider === 'ollama' && ollamaModels.length ? (
                        <select value={form.model} onChange={event => update('model', event.target.value)}>
                            {!ollamaModels.includes(form.model) && <option value={form.model}>{form.model}</option>}
                            {ollamaModels.map(model => <option key={model} value={model}>{model}</option>)}
                        </select>
                    ) : (
                        <input value={form.model || ''} onChange={event => update('model', event.target.value)} placeholder="Model identifier" />
                    )}
                </label>
                <label className="span-2">
                    <span>Base URL</span>
                    <input value={form.baseUrl || ''} onChange={event => update('baseUrl', event.target.value)} placeholder="Provider base URL" />
                </label>
                <label>
                    <span>Temperature</span>
                    <input type="number" min="0" max="2" step="0.1" value={form.temperature} onChange={event => update('temperature', event.target.value)} />
                </label>
                <label>
                    <span>Maximum tool rounds</span>
                    <input type="number" min="0" max="12" value={form.maxToolRounds} onChange={event => update('maxToolRounds', event.target.value)} />
                </label>
            </div>

            <div className="fallback-box">
                <div className="fallback-heading">
                    <div><IconCloud size={17} /><strong>Cloud fallback</strong></div>
                    <label className="switch-line compact">
                        <input type="checkbox" checked={!!form.fallback?.enabled} onChange={event => updateFallback('enabled', event.target.checked)} />
                        <span />
                    </label>
                </div>
                {form.fallback?.enabled && (
                    <div className="form-grid fallback-fields">
                        <label>
                            <span>Provider</span>
                            <select value={form.fallback.provider || 'openai'} onChange={event => updateFallback('provider', event.target.value)}>
                                {providerOptions.filter(item => item.id !== 'ollama').map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                            </select>
                        </label>
                        <label>
                            <span>Model</span>
                            <input value={form.fallback.model || ''} onChange={event => updateFallback('model', event.target.value)} />
                        </label>
                        <label className="span-2">
                            <span>Base URL</span>
                            <input value={form.fallback.baseUrl || ''} onChange={event => updateFallback('baseUrl', event.target.value)} />
                        </label>
                    </div>
                )}
            </div>

            <div className="agent-card-footer">
                <StatusBadge tone={form.provider === 'ollama' ? 'info' : 'warning'}>
                    {form.provider === 'ollama' ? <><IconDeviceDesktop size={13} /> Local</> : <><IconCloud size={13} /> Cloud</>}
                </StatusBadge>
                <button className="primary-button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save agent'}</button>
            </div>
        </article>
    );
}

export default function AgentsPage({ agents, setAgents }) {
    const [ollamaModels, setOllamaModels] = useState([]);
    const [loadingModels, setLoadingModels] = useState(false);

    const loadModels = async () => {
        setLoadingModels(true);
        try {
            const response = await api.get('/models', { params: { provider: 'ollama' } });
            setOllamaModels(response.data || []);
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not list Ollama models');
        } finally {
            setLoadingModels(false);
        }
    };

    useEffect(() => { loadModels(); }, []);

    const onSaved = updated => setAgents(current => current.map(item => item.agentId === updated.agentId ? updated : item));

    return (
        <div className="standard-page">
            <div className="page-header">
                <div><div className="eyebrow">Runtime configuration</div><h1>Agents</h1><p>Hot-swap models and providers without restarting Carlos Office.</p></div>
                <button className="secondary-button" onClick={loadModels} disabled={loadingModels}><IconRefresh size={17} /> Refresh Ollama</button>
            </div>
            <div className="summary-strip">
                <div><IconRobot /><span><strong>{agents.length}</strong> configured agents</span></div>
                <div><IconSelector /><span><strong>{ollamaModels.length}</strong> local models detected</span></div>
            </div>
            <div className="agent-grid">
                {agents.map(agent => <AgentEditor key={agent.agentId} agent={agent} ollamaModels={ollamaModels} onSaved={onSaved} />)}
            </div>
        </div>
    );
}
