import { useEffect, useMemo, useState } from 'react';
import { IconActivity, IconAdjustments, IconCpu, IconPlus, IconTool, IconX } from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';

const colors = { nora: '#22d3ee', marco: '#f59e0b', luma: '#e879f9', dex: '#60a5fa', iris: '#a78bfa', vera: '#34d399' };
const newAgent = () => ({ name: '', role: '', description: '', system: '', parentAgentId: 'dex', permanent: false, maxInstances: 1, enabled: true, toolGrants: [], capabilities: [] });

export default function AgentsPage({ agents, onAgentSaved }) {
    const [selectedId, setSelectedId] = useState('nora');
    const [draft, setDraft] = useState(null);
    const [platform, setPlatform] = useState(null);
    const [toolCatalog, setToolCatalog] = useState([]);
    const [saving, setSaving] = useState(false);
    const [jobs, setJobs] = useState([]);
    const [filter, setFilter] = useState('all');
    const [creating, setCreating] = useState(false);
    const [newDraft, setNewDraft] = useState(newAgent);
    const selected = useMemo(() => agents.find(agent => agent.agentId === selectedId) || agents[0], [agents, selectedId]);
    useEffect(() => { Promise.all([api.get('/platform-config'), api.get('/jobs?limit=300'), api.get('/tools')]).then(([config, work, tools]) => { setPlatform(config.data); setJobs(work.data || []); setToolCatalog(tools.data || []); }).catch(() => {}); }, []);
    useEffect(() => { if (selected) setDraft(JSON.parse(JSON.stringify(selected))); }, [selected]);
    const update = (field, value) => setDraft(current => ({ ...current, [field]: value }));
    const save = async () => {
        setSaving(true);
        try { const response = await api.put(`/agents/${selected.agentId}`, draft); onAgentSaved(response.data); toast.success(`${selected.name} configuration saved.`); }
        catch (error) { toast.error(error.response?.data?.error || error.message); }
        finally { setSaving(false); }
    };
    const create = async () => {
        if (!newDraft.name.trim() || !newDraft.role.trim() || !newDraft.system.trim()) return toast.error('Name, role, and system instructions are required.');
        setSaving(true);
        try { const response = await api.post('/agents', newDraft); onAgentSaved(response.data); setSelectedId(response.data.agentId); setCreating(false); setNewDraft(newAgent()); toast.success(`${response.data.name} joined the workforce.`); }
        catch (error) { toast.error(error.response?.data?.error || error.message); } finally { setSaving(false); }
    };
    const promote = async () => {
        setSaving(true);
        try { const response = await api.post(`/agents/${selected.agentId}/promote`); onAgentSaved(response.data); toast.success(`${selected.name} promoted to permanent staff without changing inherited authority.`); }
        catch (error) { toast.error(error.response?.data?.error || error.message); } finally { setSaving(false); }
    };
    const activeFor = agentId => jobs.flatMap(job => job.tasks || []).filter(task => task.agentId === agentId && ['running', 'pending', 'retry'].includes(task.state));
    const availableTools = useMemo(() => {
        if (!draft) return [];
        const parent = agents.find(agent => agent.agentId === draft.parentAgentId);
        const boundaryId = parent?.parentAgentId || parent?.agentId || draft.agentId;
        if (!draft.parentAgentId && draft.creationSource !== 'built-in') return toolCatalog;
        return toolCatalog.filter(tool => tool.allowedAgents?.includes(boundaryId));
    }, [agents, draft, toolCatalog]);
    const implicitToolSet = Boolean(draft?.parentAgentId || draft?.creationSource === 'built-in');
    const toolChecked = name => draft.toolGrants?.length ? draft.toolGrants.includes(name) : implicitToolSet;
    const toggleTool = (name, enabled) => {
        const effective = draft.toolGrants?.length ? draft.toolGrants : (implicitToolSet ? availableTools.map(tool => tool.name) : []);
        update('toolGrants', enabled ? [...new Set([...effective, name])] : effective.filter(item => item !== name));
    };
    const modelOptions = (platform?.modelOptions || []).filter(model => model.enabled !== false);
    const allowedModels = draft?.modelPolicy?.allowedModelOptionIds || [];
    const updateModelPolicy = values => update('modelPolicy', { ...(draft.modelPolicy || {}), ...values });
    const visibleAgents = agents.filter(agent => {
        if (filter === 'all') return true;
        if (filter === 'permanent') return agent.permanent !== false;
        if (filter === 'temporary') return agent.permanent === false;
        const active = activeFor(agent.agentId).length > 0;
        return filter === 'active' ? active : !active;
    });
    return <div className="redesign-page agents-page">
        <header className="redesign-header"><div><span className="eyebrow">Workforce configuration</span><h1>Agents</h1><p>Permanent staff definitions, temporary specialists, runtime policies, exact tools, and bounded concurrency. Active workers appear as instances inside jobs.</p></div><button className="primary-button" onClick={() => setCreating(true)}><IconPlus size={16} /> Define agent</button></header>
        <nav className="agents-filters">{['all', 'permanent', 'temporary', 'active', 'idle'].map(value => <button key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{value}</button>)}</nav>
        <div className="agents-workspace">
            <aside className="agents-roster">{visibleAgents.map(agent => { const active = activeFor(agent.agentId); return <button key={agent.agentId} className={agent.agentId === selected?.agentId ? 'is-selected' : ''} onClick={() => setSelectedId(agent.agentId)}><i style={{ '--agent-color': agent.color || colors[agent.agentId] || '#64748b' }}><span>{agent.name?.[0]}</span></i><span><strong>{agent.name}</strong><small>{agent.role}{agent.permanent === false ? ' · temporary' : ''}</small>{active[0] && <small>{active[0].name}</small>}</span><em className={agent.enabled === false ? 'is-off' : active.length ? 'is-active' : ''}>{agent.enabled === false ? 'Off' : active.length ? `${active.length} active` : 'Ready'}</em></button>; })}</aside>
            {draft && <main className="agent-editor">
                <header><i style={{ '--agent-color': selected.color || colors[selected.agentId] || '#64748b' }}>{selected.name[0]}</i><div><span className="eyebrow">{selected.permanent === false ? 'Temporary specialist' : 'Agent definition'}</span><h2>{selected.name}</h2><p>{selected.role}</p></div><label className="switch-field"><input type="checkbox" checked={draft.enabled !== false} onChange={event => update('enabled', event.target.checked)} /><span /> Enabled</label></header>
                <section className="editor-section"><h3>Identity & instructions</h3><div className="field-grid"><label><span>Name</span><input value={draft.name || ''} onChange={event => update('name', event.target.value)} /></label><label><span>Role</span><input value={draft.role || ''} onChange={event => update('role', event.target.value)} /></label><label className="span-2"><span>System instructions</span><textarea rows="7" value={draft.system || ''} onChange={event => update('system', event.target.value)} /></label></div></section>
                <section className="editor-section"><h3><IconActivity size={18} /> Runtime</h3><div className="field-grid">
                    <label><span>Maximum instances</span><input type="number" min="1" max="20" value={draft.maxInstances || 1} onChange={event => update('maxInstances', Number(event.target.value))} /><small>Each instance executes one task at a time.</small></label>
                    <label><span>Maximum tool rounds</span><input type="number" min="0" max="50" value={draft.maxToolRounds || 0} onChange={event => update('maxToolRounds', Number(event.target.value))} /></label>
                    <label><span>Task timeout (minutes)</span><input type="number" min="1" value={Math.round((draft.timeouts?.taskMs || platform?.timeouts?.processNodeMs || 2700000) / 60000)} onChange={event => update('timeouts', { ...(draft.timeouts || {}), taskMs: Number(event.target.value) * 60000 })} /></label>
                    <label><span>Temperature</span><input type="number" min="0" max="2" step=".05" value={draft.temperature ?? .2} onChange={event => update('temperature', Number(event.target.value))} /></label>
                </div></section>
                <section className="editor-section"><h3><IconCpu size={18} /> Model policy</h3><div className="field-grid">
                    <label><span>Selection mode</span><select value={draft.modelPolicy?.mode || 'adaptive'} onChange={event => updateModelPolicy({ mode: event.target.value })}><option value="adaptive">Best model for task</option><option value="fixed">Fixed catalog model</option></select></label>
                    <label><span>{draft.modelPolicy?.mode === 'fixed' ? 'Fixed model' : 'Default preference'}</span><select value={draft.modelPolicy?.defaultModelOptionId || ''} onChange={event => updateModelPolicy({ defaultModelOptionId: event.target.value })}><option value="">Global default</option>{modelOptions.map(model => <option key={model.id} value={model.id}>{model.label} · {model.provider}</option>)}</select></label>
                </div>{draft.modelPolicy?.mode === 'adaptive' && <><div className="agent-model-options"><strong>Models this agent may choose</strong>{modelOptions.map(model => { const checked = !allowedModels.length || allowedModels.includes(model.id); return <label key={model.id}><input type="checkbox" checked={checked} onChange={event => { const baseline = allowedModels.length ? allowedModels : modelOptions.map(item => item.id); updateModelPolicy({ allowedModelOptionIds: event.target.checked ? [...new Set([...baseline, model.id])] : baseline.filter(id => id !== model.id) }); }} /><span><b>{model.label}</b><small>{model.provider} · {Intl.NumberFormat('en', { notation: 'compact' }).format(model.contextWindow)} context</small></span></label>; })}</div><label className="model-capability-input"><span>Preferred capabilities</span><input value={(draft.modelPolicy?.preferredCapabilities || []).join(', ')} onChange={event => updateModelPolicy({ preferredCapabilities: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })} placeholder="coding, reasoning, research" /></label></>}</section>
                <section className="editor-section"><h3><IconAdjustments size={18} /> Capability, context & recovery</h3><div className="field-grid"><label className="span-2"><span>Declared capabilities</span><input value={(draft.capabilities || []).join(', ')} onChange={event => update('capabilities', event.target.value.split(',').map(item => item.trim()).filter(Boolean))} placeholder="planning, coding, research" /></label><label><span>Equivalent-provider fallback</span><select value={draft.fallback?.enabled === false ? 'off' : 'on'} onChange={event => update('fallback', { ...(draft.fallback || {}), enabled: event.target.value === 'on' })}><option value="on">Enabled when allowed</option><option value="off">Disabled</option></select></label><label><span>Fallback model</span><input value={draft.fallback?.model || ''} onChange={event => update('fallback', { ...(draft.fallback || {}), model: event.target.value })} /></label></div><div className="agent-governance-summary"><article><strong>Context</strong><span>Conversation-scoped checkpoints; latest {platform?.context?.recentMessages || 24} messages retained verbatim.</span></article><article><strong>Memory</strong><span>Saved chat is searched explicitly. Durable facts and agent knowledge remain separate.</span></article><article><strong>Authorization</strong><span>Effective authority is the intersection of this definition, process, tool/provider, and Carlos’s scoped grants.</span></article><article><strong>Recovery</strong><span>Bounded task attempts; unsafe side effects reconcile before retry. Process steps may narrow this policy.</span></article></div></section>
                <section className="editor-section"><h3><IconTool size={18} /> Tools & quality</h3><div className="field-grid">
                    <label><span>Normal quality threshold</span><input type="number" min="0" max="100" value={draft.qualityPolicy?.normalThreshold || 90} onChange={event => update('qualityPolicy', { ...(draft.qualityPolicy || {}), normalThreshold: Number(event.target.value) })} /></label>
                    <label><span>Final quality threshold</span><input type="number" min="0" max="100" value={draft.qualityPolicy?.finalThreshold || 95} onChange={event => update('qualityPolicy', { ...(draft.qualityPolicy || {}), finalThreshold: Number(event.target.value) })} /></label>
                </div><div className="agent-tool-grants"><header><span>Executable tools</span>{draft.toolGrants?.length > 0 && implicitToolSet && <button type="button" onClick={() => update('toolGrants', [])}>Reset to inherited set</button>}</header><div>{availableTools.map(tool => <label key={tool.name}><input type="checkbox" checked={toolChecked(tool.name)} onChange={event => toggleTool(tool.name, event.target.checked)} /><span><strong>{tool.name}</strong><small>{tool.sideEffect === 'governed-write' ? 'Governed side effect' : 'Read / idempotent'}</small></span></label>)}{!availableTools.length && <p className="muted">No tools are inside this definition’s current permission boundary.</p>}</div></div><p className="muted">Effective tools are the intersection of this definition, its parent boundary, the process plan, provider availability, and Carlos’s authorization policy.</p></section>
                <footer><span>Config v{draft.configVersion || 1} · created {draft.createdAt ? new Date(draft.createdAt).toLocaleDateString() : 'with office'} · updated {draft.updatedAt ? new Date(draft.updatedAt).toLocaleString() : 'not yet'}<br />Changes apply to the next task; running instances keep their execution binding.</span><div>{selected.permanent === false && <button className="secondary-button" disabled={saving} onClick={promote}>Promote to staff</button>}<button className="primary-button" disabled={saving} onClick={save}><IconAdjustments size={16} /> {saving ? 'Saving…' : 'Save agent'}</button></div></footer>
            </main>}
        </div>
        {creating && <div className="dialog"><section className="dialog__panel agent-create"><header><div><span className="eyebrow">New workforce definition</span><h2>Define an agent</h2></div><button onClick={() => setCreating(false)}><IconX size={17} /></button></header><label><span>Name</span><input value={newDraft.name} onChange={event => setNewDraft({ ...newDraft, name: event.target.value })} /></label><label><span>Role</span><input value={newDraft.role} onChange={event => setNewDraft({ ...newDraft, role: event.target.value })} /></label><label><span>Type</span><select value={newDraft.permanent ? 'permanent' : 'temporary'} onChange={event => setNewDraft({ ...newDraft, permanent: event.target.value === 'permanent', parentAgentId: event.target.value === 'temporary' ? newDraft.parentAgentId || 'dex' : '' })}><option value="temporary">Temporary specialist</option><option value="permanent">Permanent staff</option></select></label>{!newDraft.permanent && <label><span>Permission parent</span><select value={newDraft.parentAgentId} onChange={event => setNewDraft({ ...newDraft, parentAgentId: event.target.value })}>{agents.filter(agent => agent.permanent !== false).map(agent => <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>)}</select><small>Cannot gain tools or authority beyond this parent.</small></label>}<label><span>System instructions</span><textarea rows="8" value={newDraft.system} onChange={event => setNewDraft({ ...newDraft, system: event.target.value })} /></label><label><span>Maximum instances</span><input type="number" min="1" max="20" value={newDraft.maxInstances} onChange={event => setNewDraft({ ...newDraft, maxInstances: Number(event.target.value) })} /></label><footer><button className="secondary-button" onClick={() => setCreating(false)}>Cancel</button><button className="primary-button" onClick={create} disabled={saving}>Create definition</button></footer></section></div>}
    </div>;
}
