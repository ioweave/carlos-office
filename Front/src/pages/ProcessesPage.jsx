import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconArrowsSplit, IconBolt, IconCheck, IconClock, IconGitBranch, IconPlayerPlay, IconPlus, IconRefresh, IconRobot, IconRoute, IconSearch, IconTrash, IconUserCheck, IconX } from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';

const NODE_TYPES = [
    ['agent-task', 'Agent task', IconRobot], ['human-input', 'Human input', IconUserCheck], ['human-approval', 'Human approval', IconCheck],
    ['condition', 'Condition', IconGitBranch], ['parallel-fork', 'Parallel fork', IconArrowsSplit], ['parallel-join', 'Parallel join', IconRoute],
    ['subprocess', 'Subprocess', IconRoute], ['delay', 'Delay / wait', IconClock], ['handover', 'Handover', IconRoute],
];
const blank = () => ({ definitionId: '', name: 'Untitled process', description: '', governed: true, enabled: true, failFast: false, status: 'draft', latestVersion: 0, triggers: [{ type: 'chat' }, { type: 'manual' }], authorizationScopes: [], normalQualityThreshold: 90, finalQualityThreshold: 95, nodes: [
    { nodeId: 'start', type: 'start', name: 'Start', agentId: '', prompt: '', dependsOn: [], tools: [], position: { x: 70, y: 260 } },
    { nodeId: 'work', type: 'agent-task', name: 'Agent task', agentId: 'dex', taskClass: 'general', prompt: '', dependsOn: ['start'], tools: [], maxAttempts: 3, timeoutMs: 2700000, qualityThreshold: 90, failurePolicy: 'pause', position: { x: 330, y: 260 } },
    { nodeId: 'end', type: 'end', name: 'Nora handover', agentId: 'nora', prompt: '', dependsOn: ['work'], tools: [], position: { x: 650, y: 260 } },
] });
const clone = value => JSON.parse(JSON.stringify(value));
const label = value => String(value || '').replaceAll('-', ' ').replaceAll('_', ' ');
const stateColor = value => ({ completed: '#34d399', running: '#22d3ee', paused: '#fb7185', failed: '#ef4444', waiting_authorization: '#f59e0b' }[value] || '#64748b');
function JsonEditor({ label: title, value, onChange, rows = 3 }) {
    const [textValue, setTextValue] = useState(() => JSON.stringify(value, null, 2));
    const [valid, setValid] = useState(true);
    const update = event => {
        const next = event.target.value;
        setTextValue(next);
        try {
            const parsed = JSON.parse(next);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected an object');
            setValid(true);
            onChange(parsed);
        } catch {
            setValid(false);
        }
    };
    return <label className={valid ? '' : 'json-editor--invalid'}><span>{title} {valid ? '' : '· invalid JSON'}</span><textarea rows={rows} value={textValue} onChange={update} spellCheck="false" /></label>;
}
export default function ProcessesPage() {
    const [definitions, setDefinitions] = useState([]); const [jobs, setJobs] = useState([]); const [platform, setPlatform] = useState(null);
    const [agents, setAgents] = useState([]); const [tools, setTools] = useState([]); const [connectFrom, setConnectFrom] = useState(''); const [runtimeJob, setRuntimeJob] = useState(null);
    const [selectedId, setSelectedId] = useState('governed-product-change'); const [selectedNodeId, setSelectedNodeId] = useState('');
    const [draft, setDraft] = useState(blank()); const [objective, setObjective] = useState(''); const [busy, setBusy] = useState('');
    const [view, setView] = useState('library'); const [search, setSearch] = useState(''); const [libraryFilter, setLibraryFilter] = useState('All');
    const [versions, setVersions] = useState([]);
    const canvasRef = useRef(null); const dragRef = useRef(null);
    const load = useCallback(async () => {
        try { const [defs, runData, config, staff, toolCatalog] = await Promise.all([api.get('/processes'), api.get('/process-runs'), api.get('/platform-config'), api.get('/agents'), api.get('/tools')]); setDefinitions(defs.data || []); setJobs(runData.data || []); setPlatform(config.data); setAgents(staff.data || []); setTools(toolCatalog.data || []); }
        catch (error) { toast.error(error.response?.data?.error || 'Could not load processes.'); }
    }, []);
    useEffect(() => { load(); const timer = setInterval(load, 7000); return () => clearInterval(timer); }, [load]);
    useEffect(() => { if (!selectedId) return setVersions([]); api.get(`/processes/${selectedId}/versions`).then(response => setVersions(response.data || [])).catch(() => setVersions([])); }, [selectedId, draft.latestVersion]);
    useEffect(() => { const found = definitions.find(item => item.definitionId === selectedId); if (found) { setDraft(clone(found)); setSelectedNodeId(found.nodes?.find(node => node.type === 'agent-task')?.nodeId || found.nodes?.[0]?.nodeId || ''); } }, [selectedId, definitions]);
    const selectedNode = useMemo(() => draft.nodes.find(node => node.nodeId === selectedNodeId), [draft, selectedNodeId]);
    const selectedJobs = useMemo(() => jobs.filter(job => job.processDefinitionId === draft.definitionId), [jobs, draft.definitionId]);
    const toolsForSelectedAgent = useMemo(() => {
        const agent = agents.find(item => item.agentId === selectedNode?.agentId);
        const effectiveAgentId = agent?.parentAgentId || agent?.agentId;
        const grants = new Set(agent?.toolGrants || []);
        return tools.filter(tool => (
            (!effectiveAgentId || tool.allowedAgents?.includes(effectiveAgentId) || (agent?.permanent && agent?.creationSource !== 'built-in' && grants.has(tool.name)))
            && (!grants.size || grants.has(tool.name))
        ));
    }, [agents, selectedNode?.agentId, tools]);
    const updateNode = values => setDraft(current => ({ ...current, nodes: current.nodes.map(node => node.nodeId === selectedNodeId ? { ...node, ...values } : node) }));
    const save = async () => {
        setBusy('save');
        try { const response = await (draft.definitionId ? api.put(`/processes/${draft.definitionId}`, draft) : api.post('/processes', draft)); setDraft(response.data); setSelectedId(response.data.definitionId); toast.success('Draft saved.'); await load(); }
        catch (error) { toast.error(error.response?.data?.error || error.message); } finally { setBusy(''); }
    };
    const publish = async () => {
        if (!draft.definitionId) return toast.error('Save the draft first.'); setBusy('publish');
        try { const response = await api.post(`/processes/${draft.definitionId}/publish`); toast.success(`Published immutable version ${response.data.version}.`); await load(); }
        catch (error) { toast.error(error.response?.data?.error || error.message); } finally { setBusy(''); }
    };
    const run = async () => {
        if (!draft.definitionId) return toast.error('Save and publish the process first.'); setBusy('run');
        try { const response = await api.post('/process-runs', { definitionId: draft.definitionId, objective: objective || draft.description }); toast.success(response.data.status === 'waiting_authorization' ? 'Job is waiting for authorization.' : 'Job started.'); setObjective(''); await load(); }
        catch (error) { toast.error(error.response?.data?.error || error.message); } finally { setBusy(''); }
    };
    const addNode = type => {
        const index = draft.nodes.length; const end = draft.nodes.find(node => node.type === 'end'); const previous = draft.nodes.filter(node => node.type !== 'end').at(-1);
        const nodeId = `${type}-${index}`; const next = { nodeId, type, name: label(type), agentId: type === 'agent-task' ? 'iris' : type === 'handover' ? 'nora' : '', taskClass: 'general', prompt: '', dependsOn: previous ? [previous.nodeId] : ['start'], tools: [], maxAttempts: 3, timeoutMs: 2700000, qualityThreshold: 90, failurePolicy: 'pause', position: { x: Math.max(220, (end?.position?.x || 700) - 220), y: 100 + (index % 4) * 150 } };
        setDraft(current => ({ ...current, nodes: current.nodes.map(item => item.type === 'end' ? { ...item, dependsOn: [nodeId] } : item).concat(next).sort((a, b) => a.type === 'end' ? 1 : b.type === 'end' ? -1 : 0) })); setSelectedNodeId(nodeId);
    };
    const removeNode = () => {
        if (!selectedNode || ['start', 'end'].includes(selectedNode.type)) return;
        setDraft(current => ({ ...current, nodes: current.nodes.filter(node => node.nodeId !== selectedNode.nodeId).map(node => ({ ...node, dependsOn: node.dependsOn?.flatMap(id => id === selectedNode.nodeId ? selectedNode.dependsOn : [id]) || [] })) })); setSelectedNodeId('start');
    };
    const connectTo = nodeId => {
        if (!connectFrom || connectFrom === nodeId) return setConnectFrom('');
        setDraft(current => ({ ...current, nodes: current.nodes.map(node => node.nodeId === nodeId ? { ...node, dependsOn: [...new Set([...(node.dependsOn || []), connectFrom])] } : node) })); setConnectFrom('');
    };
    const updateTool = (index, values) => updateNode({ tools: selectedNode.tools.map((item, itemIndex) => itemIndex === index ? { ...item, ...values } : item) });
    const moveTool = (index, delta) => { const next = [...selectedNode.tools]; const target = index + delta; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; updateNode({ tools: next }); };
    const pointerDown = (event, node) => {
        if (event.button !== 0) return; const rect = canvasRef.current.getBoundingClientRect(); dragRef.current = { nodeId: node.nodeId, offsetX: event.clientX - rect.left - node.position.x, offsetY: event.clientY - rect.top - node.position.y };
        const move = moveEvent => { const active = dragRef.current; if (!active) return; const box = canvasRef.current.getBoundingClientRect(); setDraft(current => ({ ...current, nodes: current.nodes.map(item => item.nodeId === active.nodeId ? { ...item, position: { x: Math.max(20, moveEvent.clientX - box.left - active.offsetX), y: Math.max(20, moveEvent.clientY - box.top - active.offsetY) } } : item) })); };
        const up = () => { dragRef.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true }); event.preventDefault();
    };
    const nodeMap = useMemo(() => new Map(draft.nodes.map(node => [node.nodeId, node])), [draft.nodes]);
    const validationIssues = useMemo(() => {
        const issues = [];
        if (draft.nodes.filter(node => node.type === 'start').length !== 1) issues.push('Exactly one Start node is required.');
        if (draft.nodes.filter(node => node.type === 'end').length !== 1) issues.push('Exactly one End node is required.');
        for (const node of draft.nodes.filter(node => node.type === 'agent-task')) {
            if (!node.agentId) issues.push(`${node.name} has no agent.`);
            if (!node.prompt?.trim()) issues.push(`${node.name} needs task instructions.`);
            if ((node.tools || []).some(tool => !tool.toolName)) issues.push(`${node.name} has an incomplete tool plan.`);
        }
        return issues;
    }, [draft]);
    const lifecycle = async (item, action) => {
        try {
            const response = await api.post(`/processes/${item.definitionId}/lifecycle`, { action });
            toast.success(`${item.name}: ${action}.`);
            if (action === 'duplicate') { setSelectedId(response.data.definitionId); setView('designer'); }
            await load();
        } catch (error) { toast.error(error.response?.data?.error || error.message); }
    };
    const filteredDefinitions = definitions.filter(item => {
        const matchesSearch = `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase());
        const matchesFilter = libraryFilter === 'All' || (libraryFilter === 'Draft' && !item.latestVersion) || (libraryFilter === 'Published' && item.latestVersion && !item.archivedAt) || (libraryFilter === 'One-off' && item.kind === 'one-off') || (libraryFilter === 'Archived' && item.archivedAt);
        return matchesSearch && matchesFilter;
    });
    if (view === 'library') return <div className="process-library redesign-page">
        <header className="redesign-header"><div><span className="eyebrow">Process definitions, not executions</span><h1>Processes</h1><p>Design reusable office procedures. Every run becomes a durable Job tied to its originating Request and Conversation.</p></div><div><button className="secondary-button" onClick={() => toast.message('Ask Nora in Chat; she will select, adapt, or generate a one-off process for the request.')}>Ask Nora</button><button className="primary-button" onClick={() => { setSelectedId(''); setDraft(blank()); setSelectedNodeId('work'); setView('designer'); }}><IconPlus size={15} /> Create process</button></div></header>
        <div className="process-library__controls"><label><IconSearch size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search process definitions" /></label><nav>{['All', 'Draft', 'Published', 'One-off', 'Archived'].map(value => <button key={value} className={libraryFilter === value ? 'is-active' : ''} onClick={() => setLibraryFilter(value)}>{value}</button>)}</nav></div>
        <section className="process-library__table"><header><span>Process</span><span>Owner / version</span><span>Triggers</span><span>Last run</span><span>Success / quality</span><span /></header>{filteredDefinitions.map(item => { const itemJobs = jobs.filter(job => job.processDefinitionId === item.definitionId); const last = itemJobs[0]; const completed = itemJobs.filter(job => job.status === 'completed'); const success = itemJobs.length ? Math.round(completed.length / itemJobs.length * 100) : null; const quality = completed.map(job => job.finalAssessment?.score).filter(Number.isFinite); return <article key={item.definitionId}><span><i className={item.archivedAt ? 'is-archived' : item.enabled ? 'is-active' : ''} /><div><strong>{item.name}</strong><small>{item.description || 'No description'} · {item.nodes?.length || 0} nodes</small></div></span><span><strong>{item.owner || 'Carlos'}</strong><small>{item.kind === 'one-off' ? 'One-off' : 'Reusable'} · v{item.latestVersion || 0}</small></span><span>{(item.triggers || []).map(trigger => <b key={trigger.type}>{trigger.type}</b>)}</span><span>{last ? <><strong>{last.status.replaceAll('_', ' ')}</strong><small>{new Date(last.updatedAt).toLocaleString()}</small></> : <small>Never run</small>}</span><span><strong>{success === null ? '—' : `${success}%`}</strong><small>{quality.length ? `${Math.round(quality.reduce((a, b) => a + b, 0) / quality.length)} quality` : 'No assessment'}</small></span><span><button className="primary-button" onClick={() => { setSelectedId(item.definitionId); setView('designer'); }}>Open</button><button className="secondary-button" onClick={() => lifecycle(item, 'duplicate')}>Duplicate</button><button className="secondary-button" onClick={() => lifecycle(item, item.archivedAt ? 'restore' : 'archive')}>{item.archivedAt ? 'Restore' : 'Archive'}</button>{item.kind === 'one-off' && <button className="secondary-button" onClick={() => lifecycle(item, 'promote')}>Promote</button>}</span></article>; })}{!filteredDefinitions.length && <div className="process-library__empty"><IconRoute size={28} /><strong>No process definitions match</strong><span>Change the filters or create a process.</span></div>}</section>
    </div>;
    return <div className="process-studio">
        <header className="process-toolbar"><button className="process-toolbar__back" onClick={() => setView('library')} aria-label="Close designer"><IconX size={17} /></button><div><span className="eyebrow">Process designer</span><h1>{draft.name}</h1><p>Draft · {draft.latestVersion ? `Published v${draft.latestVersion}` : 'Not published'} · {validationIssues.length ? `${validationIssues.length} issue(s)` : 'Valid graph'}</p></div><div><button className="secondary-button" onClick={load}><IconRefresh size={15} /> Discard changes</button><button className="secondary-button" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button><button className="secondary-button" onClick={publish} disabled={!!busy || validationIssues.length}><IconBolt size={15} /> Publish</button><button className="primary-button" onClick={run} disabled={!!busy}><IconPlayerPlay size={15} /> Test run</button></div></header>
        <div className="process-body">
            <aside className="process-left"><h3>Add node</h3>{NODE_TYPES.map(([type, name, Icon]) => <button key={type} onClick={() => addNode(type)}><Icon size={17} /><span><strong>{name}</strong><small>Add to canvas</small></span></button>)}</aside>
            <main className="process-graph" ref={canvasRef}>
                <div className="process-grid" />
                <svg className="process-edges">{draft.nodes.flatMap(node => (node.dependsOn || []).map(parentId => { const parent = nodeMap.get(parentId); if (!parent) return null; const x1 = parent.position.x + 190; const y1 = parent.position.y + 44; const x2 = node.position.x; const y2 = node.position.y + 44; return <path key={`${parentId}-${node.nodeId}`} d={`M ${x1} ${y1} C ${x1 + 70} ${y1}, ${x2 - 70} ${y2}, ${x2} ${y2}`} />; }))}</svg>
                {draft.nodes.map(node => <article key={node.nodeId} className={`graph-node type-${node.type} ${selectedNodeId === node.nodeId ? 'is-selected' : ''} ${connectFrom === node.nodeId ? 'is-connecting' : ''}`} style={{ left: node.position.x, top: node.position.y }} onPointerDown={event => pointerDown(event, node)} onClick={() => setSelectedNodeId(node.nodeId)}>
                    {node.type !== 'start' && <button className="graph-port graph-port--input" title="Connect into this node" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); connectTo(node.nodeId); }} />}
                    <header><i>{node.type === 'agent-task' ? <IconRobot size={16} /> : node.type === 'start' ? <IconPlayerPlay size={16} /> : node.type === 'end' ? <IconCheck size={16} /> : <IconGitBranch size={16} />}</i><span>{label(node.type)}</span><em>{node.agentId || 'system'}</em></header>
                    <strong>{node.name}</strong><p>{node.prompt || node.description || 'Configure this node in the inspector.'}</p>
                    {!['start', 'end'].includes(node.type) && <footer><span>Input quality</span><b><i style={{ width: `${node.qualityThreshold || 90}%` }} /></b><small>{node.qualityThreshold || 90}</small></footer>}
                    {node.type === 'end' && <footer><span>Output quality</span><b><i style={{ width: `${draft.finalQualityThreshold || 95}%` }} /></b><small>{draft.finalQualityThreshold || 95}</small></footer>}
                    {node.type !== 'end' && <button className="graph-port graph-port--output" title="Start connection" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setConnectFrom(current => current === node.nodeId ? '' : node.nodeId); }} />}
                </article>)}
                <div className="process-minimap" aria-label="Process minimap">{draft.nodes.map(node => <i key={node.nodeId} style={{ left: `${Math.min(92, node.position.x / 12)}%`, top: `${Math.min(84, node.position.y / 8)}%` }} />)}</div>
            </main>
            <aside className="process-inspector">
                <section><span className="eyebrow">Process definition</span><label><span>Name</span><input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label><span>Description</span><textarea rows="3" value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label><div className="thresholds"><label><span>Step threshold</span><input type="number" value={draft.normalQualityThreshold || 90} onChange={event => setDraft({ ...draft, normalQualityThreshold: Number(event.target.value) })} /></label><label><span>Final threshold</span><input type="number" value={draft.finalQualityThreshold || 95} onChange={event => setDraft({ ...draft, finalQualityThreshold: Number(event.target.value) })} /></label></div><label className="switch-field"><input type="checkbox" checked={draft.failFast === true} onChange={event => setDraft({ ...draft, failFast: event.target.checked })} /><span /> Fail fast (otherwise independent branches continue)</label><div className="process-scope-picker"><span>Triggers</span>{['chat', 'manual', 'schedule', 'webhook', 'api'].map(type => <label key={type}><input type="checkbox" checked={(draft.triggers || []).some(item => item.type === type)} onChange={event => setDraft({ ...draft, triggers: event.target.checked ? [...(draft.triggers || []), { type }] : (draft.triggers || []).filter(item => item.type !== type) })} /> {label(type)}</label>)}</div><div className="process-scope-picker"><span>Required authorizations</span>{(platform?.authorization?.scopes || []).map(scope => <label key={scope.id}><input type="checkbox" checked={(draft.authorizationScopes || []).includes(scope.id)} onChange={event => setDraft({ ...draft, authorizationScopes: event.target.checked ? [...new Set([...(draft.authorizationScopes || []), scope.id])] : (draft.authorizationScopes || []).filter(item => item !== scope.id) })} /> {scope.label}</label>)}</div></section>
                {selectedNode && <section><header><div><span className="eyebrow">Selected node</span><h2>{selectedNode.name}</h2></div>{!['start', 'end'].includes(selectedNode.type) && <button onClick={removeNode}><IconTrash size={16} /></button>}</header><label><span>Name</span><input value={selectedNode.name} onChange={event => updateNode({ name: event.target.value })} /></label>
                    {selectedNode.type === 'handover' && <><label><span>Recipient — who</span><select value={selectedNode.agentId} onChange={event => updateNode({ agentId: event.target.value })}>{agents.map(agent => <option key={agent.agentId} value={agent.agentId}>{agent.name} · {agent.role}</option>)}</select></label><label><span>Handover contract</span><textarea rows="4" value={selectedNode.prompt} onChange={event => updateNode({ prompt: event.target.value })} placeholder="What the recipient receives and why" /></label></>}
                    {selectedNode.type === 'agent-task' && <><label><span>Agent — who</span><select value={selectedNode.agentId} onChange={event => updateNode({ agentId: event.target.value })}>{agents.map(agent => <option key={agent.agentId} value={agent.agentId}>{agent.name} · {agent.role}</option>)}</select></label><label><span>Instructions — what</span><textarea rows="5" value={selectedNode.prompt} onChange={event => updateNode({ prompt: event.target.value })} /></label><label><span>Depends on — when</span><input value={(selectedNode.dependsOn || []).join(', ')} onChange={event => updateNode({ dependsOn: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })} /></label><label><span>Model policy</span><select value={selectedNode.modelOptionId || ''} onChange={event => updateNode({ modelOptionId: event.target.value })}><option value="">Best available for task</option>{(platform?.modelOptions || []).filter(model => model.enabled !== false).map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label><div className="thresholds"><label><span>Temperature</span><input type="number" min="0" max="2" step=".05" value={selectedNode.modelSettings?.temperature ?? .2} onChange={event => updateNode({ modelSettings: { ...(selectedNode.modelSettings || {}), temperature: Number(event.target.value) } })} /></label><label><span>Attempts</span><input type="number" value={selectedNode.maxAttempts || 3} onChange={event => updateNode({ maxAttempts: Number(event.target.value) })} /></label><label><span>Timeout minutes</span><input type="number" value={Math.round((selectedNode.timeoutMs || 2700000) / 60000)} onChange={event => updateNode({ timeoutMs: Number(event.target.value) * 60000 })} /></label><label><span>Quality</span><input type="number" value={selectedNode.qualityThreshold || 90} onChange={event => updateNode({ qualityThreshold: Number(event.target.value) })} /></label></div><JsonEditor key={`${selectedNode.nodeId}-input`} label="Input JSON Schema" value={selectedNode.inputSchema || { type: 'object' }} onChange={inputSchema => updateNode({ inputSchema })} /><JsonEditor key={`${selectedNode.nodeId}-output`} label="Output JSON Schema" value={selectedNode.outputSchema || { type: 'string' }} onChange={outputSchema => updateNode({ outputSchema })} /><label><span>Failure route</span><select value={selectedNode.failurePolicy || 'pause'} onChange={event => updateNode({ failurePolicy: event.target.value })}><option value="pause">Pause and ask Carlos</option><option value="fail">Fail job</option><option value="continue">Continue</option><option value="reassign">Reassign</option></select></label>{selectedNode.failurePolicy === 'reassign' && <label><span>Fallback agents</span><input value={(selectedNode.fallbackAgentIds || []).join(', ')} onChange={event => updateNode({ fallbackAgentIds: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} /></label>}<div className="tool-plan"><header><span>Exact ordered tools</span><button onClick={() => updateNode({ tools: [...(selectedNode.tools || []), { toolName: '', args: {}, resultPath: '' }] })}><IconPlus size={14} /></button></header>{(selectedNode.tools || []).map((tool, index) => <div key={index} className="tool-plan__row"><em>{index + 1}</em><select value={tool.toolName} onChange={event => updateTool(index, { toolName: event.target.value })}><option value="">Choose tool</option>{toolsForSelectedAgent.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select><label><span>Result key</span><input value={tool.resultPath || ''} placeholder={tool.toolName || 'step result'} onChange={event => updateTool(index, { resultPath: event.target.value })} /></label><JsonEditor key={`${selectedNode.nodeId}-tool-${index}`} label="Arguments · use {{objective}}, {{inputs.*}}, or prior result keys" value={tool.args || {}} rows={2} onChange={args => updateTool(index, { args })} /><button onClick={() => moveTool(index, -1)}>↑</button><button onClick={() => moveTool(index, 1)}>↓</button><button onClick={() => updateNode({ tools: selectedNode.tools.filter((_, itemIndex) => itemIndex !== index) })}>×</button></div>)}</div></>}
                    {['human-input', 'human-approval'].includes(selectedNode.type) && <label><span>Question / decision</span><textarea rows="5" value={selectedNode.prompt} onChange={event => updateNode({ prompt: event.target.value })} /></label>}
                    {selectedNode.type === 'condition' && <><label><span>Field</span><input value={selectedNode.condition?.field || ''} placeholder="inputs.priority" onChange={event => updateNode({ condition: { ...(selectedNode.condition || {}), field: event.target.value } })} /></label><label><span>Operator</span><select value={selectedNode.condition?.operator || 'equals'} onChange={event => updateNode({ condition: { ...(selectedNode.condition || {}), operator: event.target.value } })}>{['equals', 'not-equals', 'contains', 'not-contains', 'exists', 'greater-than', 'less-than', 'in'].map(value => <option key={value}>{value}</option>)}</select></label><label><span>Comparison value (JSON)</span><input value={JSON.stringify(selectedNode.condition?.value ?? '')} onChange={event => updateNode({ condition: { ...(selectedNode.condition || {}), value: (() => { try { return JSON.parse(event.target.value); } catch { return event.target.value; } })() } })} /></label><p className="muted">Set each immediate downstream node’s branch to true or false.</p></>}
                    {selectedNode.type === 'subprocess' && <label><span>Published subprocess</span><select value={selectedNode.processDefinitionId || ''} onChange={event => updateNode({ processDefinitionId: event.target.value })}><option value="">Choose process</option>{definitions.filter(item => item.definitionId !== draft.definitionId && item.latestVersion).map(item => <option key={item.definitionId} value={item.definitionId}>{item.name}</option>)}</select></label>}
                    {selectedNode.type === 'delay' && <label><span>Delay seconds</span><input type="number" min="0" value={Math.round((selectedNode.delayMs || 0) / 1000)} onChange={event => updateNode({ delayMs: Number(event.target.value) * 1000 })} /></label>}
                    {!['start'].includes(selectedNode.type) && <label><span>Condition branch</span><select value={selectedNode.conditionBranch || 'always'} onChange={event => updateNode({ conditionBranch: event.target.value })}><option value="always">Always</option><option value="true">True branch</option><option value="false">False branch</option></select></label>}
                </section>}
                {!!versions.length && <section className="process-versions"><span className="eyebrow">Immutable history</span>{versions.map(version => <article key={version.version}><strong>Version {version.version}</strong><small>Published {new Date(version.publishedAt).toLocaleString()} · {version.nodes.length} nodes</small></article>)}</section>}
                <section className="run-process"><span className="eyebrow">Start a job</span><textarea rows="3" value={objective} onChange={event => setObjective(event.target.value)} placeholder="Objective for this execution" /><button className="primary-button" onClick={run}><IconPlayerPlay size={15} /> Run published version</button></section>
            </aside>
        </div>
        <footer className={`process-validation ${validationIssues.length ? 'has-issues' : 'is-valid'}`}><strong>{validationIssues.length ? `${validationIssues.length} validation issue(s)` : 'Process is valid'}</strong><span>{validationIssues[0] || 'Exactly one Start and End; all branches converge; tool plans and agent assignments are valid.'}</span><em>Execution panel · jobs remain immutable</em></footer>
        {!!selectedJobs.length && <section className="process-job-strip"><header><h2>Recent jobs</h2><span>Each card is one immutable process execution</span></header>{selectedJobs.slice(0, 8).map(job => <button className="process-job-card" key={job.jobId} onClick={() => setRuntimeJob(job)}><i style={{ background: stateColor(job.status) }} /><span><strong>{job.title}</strong><small>{label(job.status)} · v{job.processVersion} · {new Date(job.updatedAt).toLocaleString()}</small></span><div>{job.tasks.map(task => <em className={`is-${task.state}`} key={task.taskId}>{task.agentId || 'system'} · {label(task.state)} {task.outputQuality ? `· ${task.outputQuality.score}` : ''}</em>)}</div></button>)}</section>}
        {runtimeJob && <div className="dialog" onMouseDown={event => event.target === event.currentTarget && setRuntimeJob(null)}><section className="dialog__panel process-runtime"><header><div><span className="eyebrow">Job execution · process v{runtimeJob.processVersion}</span><h2>{runtimeJob.title}</h2><p>{label(runtimeJob.status)} · {runtimeJob.finalAssessment ? `final quality ${runtimeJob.finalAssessment.score}/${runtimeJob.finalAssessment.threshold}` : 'final assessment pending'}</p></div><button onClick={() => setRuntimeJob(null)}>×</button></header><div className="runtime-timeline">{runtimeJob.tasks.map(task => <article key={task.taskId} className={`is-${task.state}`}><i style={{ background: stateColor(task.state) }} /><span><strong>{task.name}</strong><small>{task.agentId || 'system'} · {label(task.state)} · {task.attempts.length} attempt(s)</small><p>{task.resultSummary || task.error || 'Waiting'}</p></span><em>{task.inputQuality ? `In ${task.inputQuality.score}` : 'In —'}<br />{task.outputQuality ? `Out ${task.outputQuality.score}` : 'Out —'}</em></article>)}</div></section></div>}
    </div>;
}
