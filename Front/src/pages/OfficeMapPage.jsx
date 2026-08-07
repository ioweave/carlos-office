import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    IconBriefcase2,
    IconMessageCircle,
    IconRefresh,
    IconRotateClockwise,
    IconZoomIn,
    IconZoomOut,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';
import StatusBadge from '../components/StatusBadge';
import OfficeMapInspector from '../components/OfficeMapInspector';

const AGENT_COLORS = {
    nora: '#22d3ee', marco: '#f59e0b', luma: '#e879f9', dex: '#60a5fa', iris: '#a78bfa', vera: '#34d399',
};
const STATUS_COLORS = {
    queued: '#94a3b8', running: '#f59e0b', qc_review: '#34d399', awaiting_approval: '#fb7185',
    completed: '#4ade80', failed: '#f87171', cancelled: '#64748b',
};
const ACTIVE_STATUSES = new Set(['queued', 'running', 'qc_review']);
const INSPECTOR_WIDTH = 440;
const INSPECTOR_HEIGHT = 560;

const hash = value => {
    let result = 2166136261;
    const source = String(value || '');
    for (let index = 0; index < source.length; index += 1) {
        result ^= source.charCodeAt(index);
        result = Math.imul(result, 16777619);
    }
    return result >>> 0;
};
const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
const statusLabel = value => String(value || 'unknown').replaceAll('_', ' ');

const createTopology = data => {
    const agents = data?.agents || [];
    const conversations = (data?.conversations || []).slice(0, 100);
    const jobs = (data?.jobs || []).slice(0, 100);
    const positions = {
        nora: { x: 0, y: 0.1, z: 0 },
        marco: { x: -2.7, y: 1.3, z: -0.4 },
        luma: { x: 2.8, y: 1.25, z: -0.2 },
        iris: { x: 0, y: 2.7, z: 0.3 },
        dex: { x: -2.5, y: -1.7, z: 0.35 },
        vera: { x: 2.65, y: -1.7, z: 0.45 },
    };
    const nodes = agents.map(agent => ({
        id: `agent:${agent.agentId}`, kind: 'agent', agentId: agent.agentId,
        title: agent.name, subtitle: agent.role, color: AGENT_COLORS[agent.agentId] || '#cbd5e1',
        radius: agent.agentId === 'nora' ? 0.34 : 0.29,
        position: positions[agent.agentId] || { x: 0, y: 0, z: 0 }, data: agent,
    }));
    const links = [];

    conversations.forEach((conversation, index) => {
        const center = positions[conversation.agentId] || positions.nora;
        const seed = hash(conversation.conversationId);
        const angle = ((seed % 360) * Math.PI) / 180 + index * 0.21;
        const ring = 0.65 + ((seed >>> 8) % 100) / 170;
        const z = (((seed >>> 16) % 100) / 100 - 0.5) * 1.5;
        const node = {
            id: `conversation:${conversation.conversationId}`, kind: 'conversation', title: conversation.title,
            subtitle: `${conversation.messageCount} messages`, color: AGENT_COLORS[conversation.agentId] || '#94a3b8',
            radius: 0.095 + Math.min(conversation.messageCount || 0, 20) * 0.002,
            position: { x: center.x + Math.cos(angle) * ring, y: center.y + Math.sin(angle) * ring * 0.62, z: center.z + z },
            agentId: conversation.agentId, data: conversation,
        };
        nodes.push(node);
        links.push({ from: `agent:${conversation.agentId}`, to: node.id, kind: 'conversation' });
    });

    jobs.forEach((job, index) => {
        const worker = positions[job.assignedAgent] || positions.nora;
        const seed = hash(job.jobId);
        const t = 0.42 + ((seed % 100) / 100) * 0.2;
        const wobble = (((seed >>> 8) % 100) / 100 - 0.5) * 0.7;
        const active = ACTIVE_STATUSES.has(job.status);
        const node = {
            id: `job:${job.jobId}`, kind: 'job', title: job.title,
            subtitle: `${statusLabel(job.status)} · ${job.currentIteration || 0}/${job.maxIterations || 2}`,
            color: STATUS_COLORS[job.status] || AGENT_COLORS[job.assignedAgent] || '#94a3b8',
            radius: active ? 0.18 : 0.145, active,
            position: {
                x: worker.x * t + positions.vera.x * (1 - t) + wobble,
                y: worker.y * t + positions.vera.y * (1 - t) + Math.sin(index) * 0.25,
                z: 0.7 + (((seed >>> 16) % 100) / 100 - 0.5) * 1.4,
            },
            agentId: job.assignedAgent, data: job,
        };
        nodes.push(node);
        links.push({ from: 'agent:nora', to: node.id, kind: 'job', active });
        links.push({ from: node.id, to: `agent:${job.assignedAgent}`, kind: 'job', active });
        links.push({ from: node.id, to: 'agent:vera', kind: 'qc', active });
    });
    return { nodes, links };
};

export default function OfficeMapPage({ agents, onOpenConversation }) {
    const [data, setData] = useState({ agents, conversations: [], jobs: [], runner: {} });
    const [loading, setLoading] = useState(true);
    const [selection, setSelection] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [inspectorTab, setInspectorTab] = useState('activity');
    const [hovered, setHovered] = useState(null);
    const [filter, setFilter] = useState('all');
    const canvasRef = useRef(null);
    const shellRef = useRef(null);
    const inspectorRef = useRef(null);
    const frameRef = useRef(null);
    const hitAreasRef = useRef([]);
    const dragRef = useRef(null);
    const viewRef = useRef({ yaw: -0.18, pitch: 0.08, zoom: 1, dragging: false, moved: false, x: 0, y: 0 });
    const reducedMotionRef = useRef(false);

    const load = useCallback(async ({ quiet = false } = {}) => {
        if (!quiet) setLoading(true);
        try {
            const response = await api.get('/office-map');
            setData(response.data || { agents: [], conversations: [], jobs: [], runner: {} });
        } catch (error) {
            if (!quiet) toast.error(error.response?.data?.error || 'Could not load the Office Map.');
        } finally {
            if (!quiet) setLoading(false);
        }
    }, []);

    useEffect(() => {
        reducedMotionRef.current = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
        load();
        const timer = setInterval(() => { if (!document.hidden) load({ quiet: true }); }, 2500);
        const onFocus = () => load({ quiet: true });
        window.addEventListener('focus', onFocus);
        return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
    }, [load]);

    const topology = useMemo(() => createTopology(data), [data]);
    const selected = useMemo(() => selection ? topology.nodes.find(node => node.id === selection.id) || null : null, [selection, topology]);
    const visibleTopology = useMemo(() => {
        if (filter === 'all') return topology;
        if (filter === 'active') {
            const keep = new Set(topology.nodes.filter(node => node.kind === 'agent' || node.active).map(node => node.id));
            return { nodes: topology.nodes.filter(node => keep.has(node.id)), links: topology.links.filter(link => keep.has(link.from) && keep.has(link.to)) };
        }
        const keep = new Set(topology.nodes.filter(node => node.kind === 'agent' || node.kind === filter).map(node => node.id));
        return { nodes: topology.nodes.filter(node => keep.has(node.id)), links: topology.links.filter(link => keep.has(link.from) && keep.has(link.to)) };
    }, [topology, filter]);

    const loadDetail = useCallback(async node => {
        if (!node || node.kind === 'agent') { setDetail(node?.data || null); return; }
        setDetailLoading(true);
        try {
            const endpoint = node.kind === 'job'
                ? `/jobs/${encodeURIComponent(node.data.jobId)}`
                : `/conversations/${encodeURIComponent(node.data.conversationId)}`;
            setDetail((await api.get(endpoint)).data);
        } catch (error) {
            toast.error(error.response?.data?.error || `Could not load ${node.kind} details.`);
            setDetail(node.data);
        } finally { setDetailLoading(false); }
    }, []);

    useEffect(() => {
        if (!selected) { setDetail(null); return undefined; }
        loadDetail(selected);
        if (!(selected.kind === 'job' && ACTIVE_STATUSES.has(selected.data.status))) return undefined;
        const timer = setInterval(() => loadDetail(selected), 1500);
        return () => clearInterval(timer);
    }, [selected?.id, selected?.data?.status, loadDetail]);

    const inspectorPosition = useCallback(point => {
        const shell = shellRef.current?.getBoundingClientRect();
        if (!shell) return { x: 20, y: 20 };
        const proposedX = point ? point.x + 20 : shell.width - INSPECTOR_WIDTH - 20;
        const proposedY = point ? point.y - 40 : 20;
        return {
            x: clamp(proposedX, 12, shell.width - Math.min(INSPECTOR_WIDTH, shell.width - 24) - 12),
            y: clamp(proposedY, 12, shell.height - Math.min(INSPECTOR_HEIGHT, shell.height - 24) - 12),
        };
    }, []);
    const openInspector = useCallback((node, point = null) => {
        if (!node) return;
        setSelection({ id: node.id, ...inspectorPosition(point) });
        setInspectorTab('activity');
        setDetail(node.data);
    }, [inspectorPosition]);

    useEffect(() => { if (selection && !selected) setSelection(null); }, [selection, selected]);
    useEffect(() => {
        const move = event => {
            const drag = dragRef.current;
            const shell = shellRef.current?.getBoundingClientRect();
            const card = inspectorRef.current?.getBoundingClientRect();
            if (!drag || !shell || !card) return;
            setSelection(current => current ? {
                ...current,
                x: clamp(event.clientX - shell.left - drag.offsetX, 8, shell.width - card.width - 8),
                y: clamp(event.clientY - shell.top - drag.offsetY, 8, shell.height - card.height - 8),
            } : current);
        };
        const stop = () => { dragRef.current = null; };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
        return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        const context = canvas.getContext('2d');
        let disposed = false;
        let stars = [];
        const resize = () => {
            const rect = canvas.getBoundingClientRect();
            const ratio = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.max(1, Math.floor(rect.width * ratio));
            canvas.height = Math.max(1, Math.floor(rect.height * ratio));
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            stars = Array.from({ length: Math.min(150, Math.floor(rect.width / 8)) }, (_, index) => ({
                x: (hash(`star-x-${index}`) % 1000) / 1000 * rect.width,
                y: (hash(`star-y-${index}`) % 1000) / 1000 * rect.height,
                a: 0.08 + (hash(`star-a-${index}`) % 25) / 100,
                r: 0.35 + (hash(`star-r-${index}`) % 80) / 100,
            }));
        };
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        resize();

        const project = (position, rect, now) => {
            const view = viewRef.current;
            const floating = reducedMotionRef.current ? 0 : Math.sin(now / 1900 + position.x * 2.1) * 0.025;
            let x = position.x;
            let y = position.y + floating;
            let z = position.z;
            const cosY = Math.cos(view.yaw);
            const sinY = Math.sin(view.yaw);
            const rotatedX = x * cosY - z * sinY;
            z = x * sinY + z * cosY;
            x = rotatedX;
            const cosP = Math.cos(view.pitch);
            const sinP = Math.sin(view.pitch);
            const rotatedY = y * cosP - z * sinP;
            z = y * sinP + z * cosP;
            y = rotatedY;
            const perspective = 1 / Math.max(0.35, 1 + z * 0.11);
            const scale = Math.min(rect.width, rect.height) * 0.14 * view.zoom * perspective;
            return { x: rect.width / 2 + x * scale, y: rect.height / 2 - y * scale, z, scale };
        };

        const draw = now => {
            if (disposed) return;
            const rect = canvas.getBoundingClientRect();
            context.clearRect(0, 0, rect.width, rect.height);
            context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--map-bg').trim() || '#07090d';
            context.fillRect(0, 0, rect.width, rect.height);
            stars.forEach(star => {
                context.beginPath(); context.fillStyle = `rgba(203,213,225,${star.a})`;
                context.arc(star.x, star.y, star.r, 0, Math.PI * 2); context.fill();
            });
            const projected = new Map();
            visibleTopology.nodes.forEach(node => projected.set(node.id, project(node.position, rect, now)));
            visibleTopology.links.forEach(link => {
                const from = projected.get(link.from); const to = projected.get(link.to);
                if (!from || !to) return;
                context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y);
                context.lineWidth = link.active ? 1.2 : 0.65;
                context.strokeStyle = link.active ? `rgba(103,232,249,${0.32 + Math.sin(now / 500) * 0.08})` : 'rgba(148,163,184,0.16)';
                context.stroke();
                if (link.active && !reducedMotionRef.current) {
                    const progress = (now % 1600) / 1600;
                    context.beginPath(); context.fillStyle = 'rgba(103,232,249,0.9)';
                    context.arc(from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress, 1.7, 0, Math.PI * 2); context.fill();
                }
            });
            const sorted = [...visibleTopology.nodes].sort((a, b) => projected.get(b.id).z - projected.get(a.id).z);
            const hits = [];
            sorted.forEach(node => {
                const point = projected.get(node.id);
                const radius = Math.max(4, node.radius * point.scale);
                const pulse = node.active && !reducedMotionRef.current ? 1 + Math.sin(now / 380) * 0.11 : 1;
                const drawRadius = radius * pulse;
                const isSelected = selection?.id === node.id;
                context.save(); context.shadowColor = node.color;
                context.shadowBlur = isSelected ? 30 : node.kind === 'agent' ? 22 : node.active ? 18 : 8;
                context.beginPath(); context.fillStyle = `${node.color}${node.kind === 'agent' ? 'e8' : 'c9'}`;
                context.arc(point.x, point.y, drawRadius, 0, Math.PI * 2); context.fill();
                context.shadowBlur = 0; context.beginPath(); context.lineWidth = isSelected ? 2.5 : node.kind === 'agent' ? 1.5 : 0.8;
                context.strokeStyle = isSelected ? '#ffffff' : 'rgba(255,255,255,0.65)';
                context.arc(point.x, point.y, drawRadius, 0, Math.PI * 2); context.stroke();
                if (node.kind === 'agent') {
                    context.textAlign = 'center'; context.fillStyle = 'rgba(245,247,250,0.95)';
                    context.font = '600 12px Inter, ui-sans-serif, system-ui'; context.fillText(node.title, point.x, point.y + drawRadius + 18);
                    context.fillStyle = 'rgba(148,163,184,0.85)'; context.font = '500 9px Inter, ui-sans-serif, system-ui';
                    context.fillText(node.subtitle || '', point.x, point.y + drawRadius + 31);
                }
                context.restore();
                hits.push({ node, x: point.x, y: point.y, radius: Math.max(drawRadius + 7, 12) });
            });
            hitAreasRef.current = hits.reverse();
            frameRef.current = requestAnimationFrame(draw);
        };
        frameRef.current = requestAnimationFrame(draw);
        return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frameRef.current); };
    }, [visibleTopology, selection?.id]);

    const canvasPoint = event => {
        const rect = canvasRef.current.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const hitAt = point => hitAreasRef.current.find(hit => Math.hypot(hit.x - point.x, hit.y - point.y) <= hit.radius);
    const pointerDown = event => {
        const point = canvasPoint(event);
        Object.assign(viewRef.current, { dragging: true, moved: false, x: point.x, y: point.y });
        canvasRef.current.setPointerCapture?.(event.pointerId);
    };
    const pointerMove = event => {
        const point = canvasPoint(event);
        const view = viewRef.current;
        if (view.dragging) {
            const dx = point.x - view.x; const dy = point.y - view.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) view.moved = true;
            view.yaw += dx * 0.006; view.pitch = clamp(view.pitch + dy * 0.004, -0.75, 0.75);
            view.x = point.x; view.y = point.y; setHovered(null); return;
        }
        const hit = hitAt(point);
        setHovered(hit ? { ...hit.node, screenX: point.x, screenY: point.y } : null);
    };
    const pointerUp = event => {
        const point = canvasPoint(event); const moved = viewRef.current.moved;
        viewRef.current.dragging = false; canvasRef.current.releasePointerCapture?.(event.pointerId);
        if (!moved) { const hit = hitAt(point); if (hit) openInspector(hit.node, point); }
    };
    const wheel = event => { event.preventDefault(); viewRef.current.zoom = clamp(viewRef.current.zoom * (event.deltaY > 0 ? 0.92 : 1.08), 0.55, 2.2); };
    const resetView = () => Object.assign(viewRef.current, { yaw: -0.18, pitch: 0.08, zoom: 1 });
    const startInspectorDrag = event => {
        const rect = inspectorRef.current?.getBoundingClientRect();
        if (!rect) return;
        dragRef.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
        event.preventDefault();
    };

    const activeJobs = data.jobs?.filter(job => ACTIVE_STATUSES.has(job.status)) || [];

    return (
        <div className="office-map-page">
            <header className="map-header">
                <div><div className="eyebrow">Live operating topology</div><h1>Office Map</h1><p>Conversations and Vera-gated jobs projected around the agents that own them.</p></div>
                <div className="map-header-actions">
                    <div className="map-segmented" role="group" aria-label="Map filter">
                        {['all', 'active', 'conversation', 'job'].map(value => <button type="button" key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value === 'conversation' ? 'Chats' : value === 'job' ? 'Jobs' : value[0].toUpperCase() + value.slice(1)}</button>)}
                    </div>
                    <button type="button" className="compact-button" onClick={() => load()} disabled={loading}><IconRefresh size={16} /> Refresh</button>
                </div>
            </header>

            <div className="map-layout">
                <section className="map-canvas-shell" ref={shellRef}>
                    <canvas ref={canvasRef} className="office-map-canvas" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerLeave={() => { viewRef.current.dragging = false; setHovered(null); }} onWheel={wheel} aria-label="Interactive Office Map. Use the accessible activity list beside the canvas for keyboard navigation." />
                    <div className="map-toolbar" aria-label="Map controls">
                        <button type="button" onClick={() => { viewRef.current.zoom = clamp(viewRef.current.zoom * 1.12, 0.55, 2.2); }} aria-label="Zoom in"><IconZoomIn size={17} /></button>
                        <button type="button" onClick={() => { viewRef.current.zoom = clamp(viewRef.current.zoom / 1.12, 0.55, 2.2); }} aria-label="Zoom out"><IconZoomOut size={17} /></button>
                        <button type="button" onClick={resetView} aria-label="Reset map view"><IconRotateClockwise size={17} /></button>
                    </div>
                    <div className="map-help">Drag to rotate · Scroll to zoom · Select a node for its live inspector</div>
                    {hovered && !selection && <div className="map-tooltip" style={{ left: hovered.screenX + 16, top: hovered.screenY + 16 }}><strong>{hovered.title}</strong><span>{hovered.subtitle}</span></div>}
                    {loading && <div className="map-loading"><span className="loader" /> Loading topology…</div>}
                    <OfficeMapInspector
                        node={selected}
                        detail={detail}
                        loading={detailLoading}
                        tab={inspectorTab}
                        setTab={setInspectorTab}
                        position={selection}
                        inspectorRef={inspectorRef}
                        onStartDrag={startInspectorDrag}
                        onClose={() => setSelection(null)}
                        data={data}
                        topology={topology}
                        agentColors={AGENT_COLORS}
                        onSelectNode={openInspector}
                        onOpenConversation={onOpenConversation}
                    />
                </section>

                <aside className="map-activity-panel" aria-label="Accessible Office Map activity list">
                    <section className="map-summary">
                        <div><strong>{data.agents?.length || 0}</strong><span>Agents</span></div>
                        <div><strong>{activeJobs.length}</strong><span>Working</span></div>
                        <div><strong>{data.jobs?.length || 0}</strong><span>Jobs</span></div>
                    </section>
                    <section>
                        <div className="panel-heading"><span>Agents</span><small>Select to inspect</small></div>
                        <div className="map-agent-list">
                            {(data.agents || []).map(agent => {
                                const active = activeJobs.filter(job => job.assignedAgent === agent.agentId || (agent.agentId === 'vera' && job.status === 'qc_review'));
                                const node = topology.nodes.find(item => item.id === `agent:${agent.agentId}`);
                                return <button type="button" key={agent.agentId} onClick={() => openInspector(node)}><span className="agent-list-dot" style={{ '--dot': AGENT_COLORS[agent.agentId] }} /><span><strong>{agent.name}</strong><small>{active.length ? `${active.length} active job${active.length === 1 ? '' : 's'}` : 'Idle'}</small></span><StatusBadge tone={active.length ? 'warning' : 'success'}>{active.length ? 'working' : 'ready'}</StatusBadge></button>;
                            })}
                        </div>
                    </section>
                    <section>
                        <div className="panel-heading"><span>Current jobs</span><small>{data.jobs?.length || 0}</small></div>
                        <div className="map-record-list">
                            {!data.jobs?.length && <p>No jobs are stored.</p>}
                            {(data.jobs || []).slice(0, 12).map(job => {
                                const node = topology.nodes.find(item => item.id === `job:${job.jobId}`);
                                return <button type="button" key={job.jobId} onClick={() => openInspector(node)}><IconBriefcase2 size={16} /><span><strong>{job.title}</strong><small>{job.assignedAgent} · {statusLabel(job.status)}</small></span></button>;
                            })}
                        </div>
                    </section>
                    <section>
                        <div className="panel-heading"><span>Recent chats</span><small>{Math.min(data.conversations?.length || 0, 8)}</small></div>
                        <div className="map-record-list">
                            {(data.conversations || []).slice(0, 8).map(conversation => {
                                const node = topology.nodes.find(item => item.id === `conversation:${conversation.conversationId}`);
                                return <button type="button" key={conversation.conversationId} onClick={() => openInspector(node)}><IconMessageCircle size={16} /><span><strong>{conversation.title}</strong><small>{conversation.agentId} · {conversation.messageCount} messages</small></span></button>;
                            })}
                        </div>
                    </section>
                </aside>
            </div>
        </div>
    );
}
