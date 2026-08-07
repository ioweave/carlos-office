import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconBriefcase2, IconMessageCircle, IconPlayerPlay, IconRefresh, IconX } from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';

const COLORS = {
    nora: '#22d3ee', marco: '#f59e0b', luma: '#e879f9', dex: '#60a5fa', iris: '#a78bfa', vera: '#34d399',
};
const POSITIONS = {
    nora: { x: 500, y: 325 }, iris: { x: 500, y: 105 }, marco: { x: 265, y: 220 },
    luma: { x: 735, y: 220 }, dex: { x: 300, y: 505 }, vera: { x: 700, y: 505 },
};
const ACTIVE = new Set(['queued', 'running', 'qc_review', 'nora_review']);
const label = value => String(value || 'unknown').replaceAll('_', ' ').replaceAll('-', ' ');
const age = value => Date.now() - new Date(value || 0).getTime();
const eventColor = tone => ({ danger: '#fb7185', warning: '#f59e0b', success: '#34d399', qc: '#34d399', worker: '#f8fafc', nora: '#22d3ee' }[tone] || '#67e8f9');

const buildMap = data => {
    const jobs = data.jobs || [];
    const nodes = (data.agents || []).map(agent => ({
        id: `agent:${agent.agentId}`, kind: 'agent', agentId: agent.agentId, title: agent.name, subtitle: agent.role,
        color: COLORS[agent.agentId] || '#cbd5e1', position: POSITIONS[agent.agentId] || POSITIONS.nora, data: agent,
    }));
    jobs.forEach((job, index) => {
        const worker = POSITIONS[job.assignedAgent] || POSITIONS.nora;
        const vera = POSITIONS.vera;
        const offset = ((index % 5) - 2) * 18;
        const t = 0.48;
        nodes.push({
            id: `job:${job.jobId}`, kind: 'job', title: job.title, subtitle: `${label(job.status)} · ${job.currentIteration || 0}/${job.maxIterations || 2}`,
            color: job.status === 'needs_attention' || job.status === 'awaiting_approval' ? '#fb7185' : job.status === 'completed' ? '#34d399' : '#f59e0b',
            position: { x: worker.x * t + vera.x * (1 - t) + offset, y: worker.y * t + vera.y * (1 - t) - 8 + offset * 0.25 }, data: job,
        });
    });
    return nodes;
};

export default function OfficeMapPage({ onOpenConversation }) {
    const [data, setData] = useState({ agents: [], conversations: [], jobs: [], workflows: [], events: [], runner: {} });
    const [selectedId, setSelectedId] = useState('');
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all');
    const [tick, setTick] = useState(0);

    const load = useCallback(async ({ quiet = false } = {}) => {
        if (!quiet) setLoading(true);
        try { setData((await api.get('/office-map')).data || {}); }
        catch (error) { if (!quiet) toast.error(error.response?.data?.error || 'Could not load the Office Map.'); }
        finally { if (!quiet) setLoading(false); }
    }, []);

    useEffect(() => {
        load();
        const sync = setInterval(() => { if (!document.hidden) load({ quiet: true }); }, 1250);
        const animate = setInterval(() => setTick(value => value + 1), 1000);
        return () => { clearInterval(sync); clearInterval(animate); };
    }, [load]);

    const nodes = useMemo(() => buildMap(data), [data]);
    const nodeMap = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
    const selected = nodeMap.get(selectedId) || null;
    const recentEvents = useMemo(() => (data.events || []).filter(event => age(event.createdAt) < 60_000), [data.events, tick]);
    const activeAgents = useMemo(() => new Set([
        ...(data.runner?.active || []).map(item => item.agentId),
        ...recentEvents.filter(event => age(event.createdAt) < 12_000).flatMap(event => [event.from, event.to]).filter(id => COLORS[id]),
    ]), [data.runner?.active, recentEvents]);
    const visibleNodes = nodes.filter(node => filter === 'all' || (filter === 'active' ? node.kind === 'agent' || ACTIVE.has(node.data.status) || node.data.status === 'needs_attention' : node.kind === 'agent' || node.kind === filter));
    const visibleIds = new Set(visibleNodes.map(node => node.id));
    const links = [];
    (data.jobs || []).forEach(job => {
        const jobId = `job:${job.jobId}`;
        if (!visibleIds.has(jobId)) return;
        links.push(['agent:nora', jobId], [jobId, `agent:${job.assignedAgent}`], [jobId, 'agent:vera']);
    });

    const eventsForSelection = selected?.kind === 'job'
        ? (data.events || []).filter(event => event.jobId === selected.data.jobId).slice(-20).reverse()
        : selected?.kind === 'agent'
            ? (data.events || []).filter(event => event.from === selected.agentId || event.to === selected.agentId).slice(-20).reverse()
            : [];
    const selectedJobs = selected?.kind === 'agent'
        ? (data.jobs || []).filter(job => job.assignedAgent === selected.agentId || (selected.agentId === 'vera' && ['qc_review', 'completed', 'needs_attention'].includes(job.status)))
        : [];

    const continueJob = async job => {
        try {
            await api.post(`/jobs/${encodeURIComponent(job.jobId)}/run`);
            toast.success('Two more bounded iterations authorized.');
            await load({ quiet: true });
        } catch (error) { toast.error(error.response?.data?.error || 'Could not continue job.'); }
    };

    return (
        <div className="office-map">
            <header className="office-map__header">
                <div><div className="eyebrow">Live operating topology</div><h1>Office Map</h1><p>Real runtime traffic between Nora, workers, Vera, and delegated jobs.</p></div>
                <div className="office-map__toolbar">
                    {['all', 'active', 'job'].map(value => <button key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{value === 'job' ? 'Jobs' : value[0].toUpperCase() + value.slice(1)}</button>)}
                    <button onClick={() => load()}><IconRefresh size={16} /> Refresh</button>
                </div>
            </header>

            <div className="office-map__workspace">
                <section className="office-map__canvas-shell">
                    <svg className="office-map__canvas" viewBox="0 0 1000 650" role="img" aria-label="Carlos Office live agent topology">
                        <defs>
                            {Object.entries(COLORS).map(([id, color]) => <filter id={`glow-${id}`} key={id}><feDropShadow dx="0" dy="0" stdDeviation="8" floodColor={color} floodOpacity="0.75" /></filter>)}
                            <filter id="glow-job"><feDropShadow dx="0" dy="0" stdDeviation="7" floodColor="#67e8f9" floodOpacity="0.65" /></filter>
                        </defs>
                        <rect x="0" y="0" width="1000" height="650" className="office-map__space" />
                        {links.map(([fromId, toId], index) => {
                            const from = nodeMap.get(fromId); const to = nodeMap.get(toId);
                            if (!from || !to || !visibleIds.has(fromId) || !visibleIds.has(toId)) return null;
                            return <line key={`${fromId}-${toId}-${index}`} x1={from.position.x} y1={from.position.y} x2={to.position.x} y2={to.position.y} className="office-map__link" />;
                        })}
                        {recentEvents.map(event => {
                            const from = nodeMap.get(event.fromNode); const to = nodeMap.get(event.toNode);
                            if (!from || !to || from.id === to.id || !visibleIds.has(from.id) || !visibleIds.has(to.id)) return null;
                            const opacity = Math.max(0.12, 1 - age(event.createdAt) / 60_000);
                            const color = eventColor(event.tone);
                            const path = `M ${from.position.x} ${from.position.y} L ${to.position.x} ${to.position.y}`;
                            return <g key={event.eventId} opacity={opacity} className="office-map__traffic">
                                <line x1={from.position.x} y1={from.position.y} x2={to.position.x} y2={to.position.y} stroke={color} strokeOpacity="0.35" strokeWidth="2" />
                                <circle r="5" fill={color} className="office-map__packet">
                                    <animateMotion dur="1.6s" repeatCount="indefinite" path={path} />
                                </circle>
                            </g>;
                        })}
                        {visibleNodes.map(node => {
                            const activeNode = node.kind === 'agent' ? activeAgents.has(node.agentId) : ACTIVE.has(node.data.status);
                            const attention = node.kind === 'job' && ['needs_attention', 'awaiting_approval'].includes(node.data.status);
                            const radius = node.kind === 'agent' ? (node.agentId === 'nora' ? 36 : 31) : attention ? 17 : activeNode ? 15 : 12;
                            return <g key={node.id} className={`office-map__node office-map__node--${node.kind} ${activeNode ? 'is-active' : ''} ${attention ? 'is-attention' : ''}`} onClick={() => setSelectedId(node.id)} role="button" tabIndex="0">
                                {(activeNode || attention) && <circle cx={node.position.x} cy={node.position.y} r={radius + 11} fill="none" stroke={attention ? '#fb7185' : node.color} strokeOpacity="0.23" strokeWidth="6" className="office-map__halo" />}
                                <circle cx={node.position.x} cy={node.position.y} r={radius} fill={node.color} filter={node.kind === 'agent' ? `url(#glow-${node.agentId})` : 'url(#glow-job)'} stroke="rgba(255,255,255,.72)" strokeWidth="1.5" />
                                <text x={node.position.x} y={node.position.y + radius + 20} textAnchor="middle" className="office-map__node-title">{node.kind === 'agent' ? node.title : node.title.slice(0, 22)}</text>
                                <text x={node.position.x} y={node.position.y + radius + 35} textAnchor="middle" className="office-map__node-subtitle">{node.subtitle}</text>
                            </g>;
                        })}
                    </svg>
                    <div className="office-map__legend"><span><i className="is-live" /> moving packet = real recent runtime event</span><span><i className="is-attention" /> red = waiting on Carlos</span></div>

                    {selected && <aside className="office-map__inspector">
                        <header className="office-map__inspector-header"><div><small>{selected.kind}</small><strong>{selected.title}</strong><span>{selected.subtitle}</span></div><button onClick={() => setSelectedId('')}><IconX size={17} /></button></header>
                        {selected.kind === 'job' && <>
                            <div className={`office-map__state office-map__state--${selected.data.status}`}><strong>{label(selected.data.status)}</strong><span>Waiting on {selected.data.waitingOn || (selected.data.status === 'needs_attention' ? 'Carlos' : selected.data.assignedAgent)}</span></div>
                            {selected.data.attentionMessage && <div className="office-map__attention"><strong>Why this stopped</strong><p>{selected.data.attentionMessage}</p></div>}
                            <section className="office-map__story"><h3>Workflow story</h3>{eventsForSelection.length ? eventsForSelection.map(event => <article key={event.eventId}><span style={{ background: eventColor(event.tone) }} /><div><strong>{event.from || 'system'} → {event.to || 'office'}</strong><small>{label(event.stage || event.type)}</small><p>{event.summary}</p></div></article>) : <p>No retained runtime events for this job.</p>}</section>
                            {['needs_attention', 'awaiting_approval', 'failed'].includes(selected.data.status) && <button className="office-map__continue" onClick={() => continueJob(selected.data)}><IconPlayerPlay size={16} /> Give 2 more iterations</button>}
                        </>}
                        {selected.kind === 'agent' && <section className="office-map__story"><h3>Recent activity</h3>{eventsForSelection.map(event => <article key={event.eventId}><span style={{ background: eventColor(event.tone) }} /><div><strong>{event.from || 'system'} → {event.to || 'office'}</strong><small>{label(event.stage || event.type)}</small><p>{event.summary}</p></div></article>)}{!eventsForSelection.length && <p>No recent traffic.</p>}<h3>Jobs</h3>{selectedJobs.slice(0, 8).map(job => <button className="office-map__job-link" key={job.jobId} onClick={() => setSelectedId(`job:${job.jobId}`)}><IconBriefcase2 size={14} /><span>{job.title}</span><small>{label(job.status)}</small></button>)}</section>}
                    </aside>}
                </section>

                <aside className="office-map__sidebar">
                    <div className="office-map__stats"><div><strong>{data.agents?.length || 0}</strong><span>Agents</span></div><div><strong>{data.runner?.active?.length || 0}</strong><span>Working</span></div><div><strong>{data.jobs?.length || 0}</strong><span>Jobs</span></div></div>
                    <section><h2>Workflows</h2>{(data.workflows || []).slice(0, 8).map(workflow => <button key={workflow.workflowId} className={`office-map__workflow-row is-${workflow.status}`} onClick={() => workflow.jobs?.[0] && setSelectedId(`job:${workflow.jobs[0].jobId}`)}><span><strong>{workflow.title}</strong><small>{label(workflow.stage)} · waiting on {workflow.waitingOn || '—'}</small></span><em>{workflow.jobs?.filter(job => job.status === 'completed').length || 0}/{workflow.jobs?.length || 0}</em></button>)}{!data.workflows?.length && <p className="office-map__empty">No live workflows yet.</p>}</section>
                    <section><h2>Recent saved chats</h2>{(data.conversations || []).slice(0, 5).map(chat => <button key={chat.conversationId} className="office-map__chat-row" onClick={() => onOpenConversation?.(chat.conversationId)}><IconMessageCircle size={14} /><span>{chat.title}</span></button>)}{!data.conversations?.length && <p className="office-map__empty">No saved conversations.</p>}</section>
                </aside>
            </div>
            {loading && <div className="office-map__loading">Refreshing topology…</div>}
        </div>
    );
}
