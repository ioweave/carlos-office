import { useEffect, useMemo, useState } from 'react';
import {
    IconActivityHeartbeat,
    IconBraces,
    IconClock,
    IconPlayerPlay,
    IconRefresh,
    IconSearch,
    IconShieldLock,
    IconTool,
    IconUsers,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';

const defaultsFor = name => ({
    memory_search: { query: 'current operating decisions', limit: 8 },
    memory_read: { path: '90-System/Carlos Office Memory.md' },
    memory_list: { folder: '10-Shared', limit: 20 },
    web_search: { query: 'local AI agent architecture', maxResults: 5 },
    fetch_url: { url: 'https://example.com', maxChars: 6000 },
    project_list_files: { folder: 'Front/src', limit: 100 },
    project_read_file: { path: 'Front/src/App.jsx', maxChars: 30000 },
    project_search_files: { query: 'OfficeMapPage', folder: 'Front/src', limit: 20 },
    current_time: { timeZone: 'America/Guayaquil' },
    list_ollama_models: {},
    list_agents: {},
}[name] || {});

const label = value => String(value || '').replaceAll('_', ' ').replaceAll('-', ' ');
const schemaSummary = schema => {
    const properties = Object.keys(schema?.properties || {});
    if (!properties.length) return 'No arguments';
    return `${properties.length} argument${properties.length === 1 ? '' : 's'} · ${(schema.required || []).length} required`;
};

export default function ToolsPage({ tools }) {
    const [catalog, setCatalog] = useState(tools);
    const [selected, setSelected] = useState(tools[0]?.name || 'web_search');
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');
    const [args, setArgs] = useState(JSON.stringify(defaultsFor(selected), null, 2));
    const [result, setResult] = useState('');
    const [running, setRunning] = useState(false);
    useEffect(() => setCatalog(tools), [tools]);
    const tool = useMemo(() => catalog.find(item => item.name === selected) || catalog[0], [catalog, selected]);
    const filtered = useMemo(() => catalog.filter(item => {
        const matchesQuery = `${item.name} ${item.description} ${item.provider}`.toLowerCase().includes(query.toLowerCase());
        const matchesFilter = filter === 'all'
            || (filter === 'read' && item.sideEffect !== 'governed-write')
            || (filter === 'write' && item.sideEffect === 'governed-write')
            || (filter === 'provider' && item.provider !== 'native');
        return matchesQuery && matchesFilter;
    }), [catalog, query, filter]);

    const chooseTool = name => {
        setSelected(name);
        setResult('');
        setArgs(JSON.stringify(defaultsFor(name), null, 2));
    };
    const run = async () => {
        setRunning(true);
        try {
            const response = await api.post(`/tools/${encodeURIComponent(tool.name)}`, { agentId: 'nora', args: JSON.parse(args || '{}') });
            setResult(JSON.stringify(response.data, null, 2));
        } catch (error) {
            const message = error instanceof SyntaxError ? 'Arguments are not valid JSON.' : (error.response?.data?.error || error.message);
            toast.error(message);
            setResult(JSON.stringify({ error: message }, null, 2));
        } finally { setRunning(false); }
    };
    const refreshProviders = async () => {
        try {
            const response = await api.post('/tools/refresh');
            setCatalog(response.data.catalog || []);
            const available = (response.data.providers || []).filter(item => item.status === 'available').length;
            toast.success(`Refreshed ${available} MCP provider${available === 1 ? '' : 's'} and normalized ${response.data.tools || 0} methods.`);
        } catch (error) { toast.error(error.response?.data?.error || 'Could not refresh provider tools.'); }
    };

    return <div className="redesign-page tools-registry">
        <header className="redesign-header"><div><span className="eyebrow">Programmatic capability registry</span><h1>Tools</h1><p>Tools are versioned executable functions. Skills describe how to combine them; MCP methods are normalized here as first-class tools, never exposed through a generic escape hatch.</p></div><div className="redesign-header__actions"><div className="security-note"><IconShieldLock size={17} /> Effective access = agent × process × provider × authorization</div><button className="secondary-button" onClick={refreshProviders}><IconRefresh size={15} /> Refresh providers</button></div></header>
        <div className="registry-toolbar"><label><IconSearch size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tools, providers, or capabilities" /></label><nav>{['all', 'read', 'write', 'provider'].map(value => <button key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label(value)}</button>)}</nav><span>{filtered.length} of {catalog.length} tools</span></div>
        <div className="tools-registry__workspace">
            <aside className="tool-catalog">{filtered.map(item => <button key={item.name} className={item.name === tool?.name ? 'is-selected' : ''} onClick={() => chooseTool(item.name)}><i><IconTool size={17} /></i><span><strong>{item.name}</strong><small>{item.provider || 'native'} · {item.sideEffect === 'governed-write' ? 'authorized side effect' : 'read / idempotent'}</small></span><em className={`is-${item.health || 'unknown'}`}>{item.health || 'unknown'}</em></button>)}{!filtered.length && <p className="muted">No matching tools.</p>}</aside>
            {tool && <main className="tool-detail">
                <header><i><IconBraces size={22} /></i><div><span className="eyebrow">{tool.provider || 'native'} · v{tool.version || '1.0.0'}</span><h2>{tool.name}</h2><p>{tool.description}</p></div><span className={`status-pill status-pill--${tool.health === 'available' ? 'success' : 'warning'}`}><IconActivityHeartbeat size={14} /> {tool.health || 'unknown'}</span></header>
                <section className="tool-facts">
                    <article><IconShieldLock size={16} /><span><small>Side effects</small><strong>{tool.sideEffect === 'governed-write' ? 'Governed write' : 'Read only'}</strong></span></article>
                    <article><IconClock size={16} /><span><small>Timeout / retry</small><strong>{Math.round((tool.timeoutMs || 0) / 1000)}s · {tool.idempotent ? 'safe to retry' : 'reconcile first'}</strong></span></article>
                    <article><IconUsers size={16} /><span><small>Available agents</small><strong>{(tool.allowedAgents || []).join(', ') || 'None'}</strong></span></article>
                    <article><IconBraces size={16} /><span><small>Contract</small><strong>{schemaSummary(tool.inputSchema)}</strong></span></article>
                </section>
                <section className="tool-contract"><div><h3>Input contract</h3><pre>{JSON.stringify(tool.inputSchema || { type: 'object' }, null, 2)}</pre></div><div><h3>Governance</h3><dl><dt>Authorization scopes</dt><dd>{tool.authorizationScopes?.length ? tool.authorizationScopes.join(', ') : 'None required'}</dd><dt>Redaction</dt><dd>{tool.redaction || 'bounded'}</dd><dt>Availability</dt><dd>{tool.health || 'unknown'}</dd><dt>Provider</dt><dd>{tool.provider || 'native'}</dd></dl></div></section>
                <details className="tool-test"><summary>Test this tool as Nora</summary><p>Manual execution still passes through normal tool grants and authorization policy.</p><label><span>Arguments</span><textarea value={args} onChange={event => setArgs(event.target.value)} spellCheck="false" /></label><button className="primary-button" onClick={run} disabled={running}><IconPlayerPlay size={15} /> {running ? 'Running…' : 'Run governed test'}</button><pre>{result || 'Result will appear here.'}</pre></details>
            </main>}
        </div>
    </div>;
}
