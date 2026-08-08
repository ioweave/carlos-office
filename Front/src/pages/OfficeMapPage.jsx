import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    IconBriefcase2,
    IconMessageCircle,
    IconPlayerPlay,
    IconRefresh,
    IconRotateClockwise,
    IconX,
    IconZoomIn,
    IconZoomOut,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';

const COLORS = {
    nora: '#22d3ee', marco: '#f59e0b', luma: '#e879f9', dex: '#60a5fa', iris: '#a78bfa', vera: '#34d399',
};
const STATUS_COLORS = {
    queued: '#94a3b8', running: '#f59e0b', qc_review: '#34d399', nora_review: '#22d3ee',
    needs_attention: '#fb7185', awaiting_approval: '#fb7185', completed: '#4ade80', failed: '#f87171', cancelled: '#64748b',
};
const DEFAULT_POSITIONS = {
    nora: { x: 0, y: 0.1, z: 0 },
    marco: { x: -2.7, y: 1.3, z: -0.4 },
    luma: { x: 2.8, y: 1.25, z: -0.2 },
    iris: { x: 0, y: 2.7, z: 0.3 },
    dex: { x: -2.5, y: -1.7, z: 0.35 },
    vera: { x: 2.65, y: -1.7, z: 0.45 },
};
const ACTIVE = new Set(['queued', 'running', 'qc_review', 'nora_review']);
const ATTENTION = new Set(['needs_attention', 'awaiting_approval', 'failed']);
const PACKET_TTL_MS = 60_000;
const LAYOUT_KEY = 'carlos-office-map-layout-v2';
const INSPECTOR_WIDTH = 420;
const INSPECTOR_HEIGHT = 580;

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
const label = value => String(value || 'unknown').replaceAll('_', ' ').replaceAll('-', ' ');
const age = value => Date.now() - new Date(value || 0).getTime();
const eventColor = tone => ({
    danger: '#fb7185', warning: '#f59e0b', success: '#34d399', qc: '#34d399', worker: '#f8fafc', nora: '#22d3ee',
}[tone] || '#67e8f9');
const rgba = (hex, alpha) => {
    const value = String(hex || '#67e8f9').replace('#', '');
    const normalized = value.length === 3 ? value.split('').map(char => `${char}${char}`).join('') : value.padEnd(6, '0').slice(0, 6);
    const number = Number.parseInt(normalized, 16);
    return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
};
const readLayout = () => {
    try {
        const parsed = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
        return Object.fromEntries(Object.entries(parsed).filter(([, position]) => (
            Number.isFinite(position?.x) && Number.isFinite(position?.y) && Number.isFinite(position?.z)
        )));
    } catch { return {}; }
};
const persistLayout = layout => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
};

const projectPosition = (position, rect, view, now = 0, reducedMotion = true) => {
    const floating = reducedMotion ? 0 : Math.sin(now / 1900 + position.x * 2.1) * 0.025;
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

const screenDeltaToWorld = (origin, deltaX, deltaY, rect, view) => {
    const epsilon = 0.01;
    const base = projectPosition(origin, rect, view);
    const xStep = projectPosition({ ...origin, x: origin.x + epsilon }, rect, view);
    const yStep = projectPosition({ ...origin, y: origin.y + epsilon }, rect, view);
    const a = xStep.x - base.x;
    const c = xStep.y - base.y;
    const b = yStep.x - base.x;
    const d = yStep.y - base.y;
    const determinant = a * d - b * c;
    if (Math.abs(determinant) < 0.000001) return { x: 0, y: 0 };
    const xUnits = (deltaX * d - b * deltaY) / determinant;
    const yUnits = (a * deltaY - deltaX * c) / determinant;
    return { x: xUnits * epsilon, y: yUnits * epsilon };
};

const createTopology = (data, layout) => {
    const agents = data?.agents || [];
    const conversations = (data?.conversations || []).slice(0, 100);
    const jobs = (data?.jobs || []).slice(0, 100);
    const positionFor = (id, fallback) => layout[id] || fallback;
    const agentPositions = Object.fromEntries(Object.keys(DEFAULT_POSITIONS).map(agentId => [
        agentId,
        positionFor(`agent:${agentId}`, DEFAULT_POSITIONS[agentId]),
    ]));
    const nodes = agents.map(agent => ({
        id: `agent:${agent.agentId}`, kind: 'agent', agentId: agent.agentId,
        title: agent.name, subtitle: agent.role, color: COLORS[agent.agentId] || '#cbd5e1',
        radius: agent.agentId === 'nora' ? 0.34 : 0.29,
        position: positionFor(`agent:${agent.agentId}`, agentPositions[agent.agentId] || DEFAULT_POSITIONS.nora),
        data: agent,
    }));
    const links = [];

    conversations.forEach((conversation, index) => {
        const center = agentPositions[conversation.agentId] || agentPositions.nora || DEFAULT_POSITIONS.nora;
        const seed = hash(conversation.conversationId);
        const angle = ((seed % 360) * Math.PI) / 180 + index * 0.21;
        const ring = 0.65 + ((seed >>> 8) % 100) / 170;
        const z = (((seed >>> 16) % 100) / 100 - 0.5) * 1.5;
        const id = `conversation:${conversation.conversationId}`;
        nodes.push({
            id, kind: 'conversation', title: conversation.title, subtitle: `${conversation.messageCount} messages`,
            color: COLORS[conversation.agentId] || '#94a3b8', radius: 0.095 + Math.min(conversation.messageCount || 0, 20) * 0.002,
            position: positionFor(id, { x: center.x + Math.cos(angle) * ring, y: center.y + Math.sin(angle) * ring * 0.62, z: center.z + z }),
            agentId: conversation.agentId, data: conversation,
        });
        links.push({ from: `agent:${conversation.agentId}`, to: id, kind: 'conversation' });
    });

    jobs.forEach((job, index) => {
        const worker = agentPositions[job.assignedAgent] || agentPositions.nora || DEFAULT_POSITIONS.nora;
        const vera = agentPositions.vera || DEFAULT_POSITIONS.vera;
        const seed = hash(job.jobId);
        const t = 0.42 + ((seed % 100) / 100) * 0.2;
        const wobble = (((seed >>> 8) % 100) / 100 - 0.5) * 0.7;
        const id = `job:${job.jobId}`;
        nodes.push({
            id, kind: 'job', title: job.title,
            subtitle: `${label(job.status)} · ${job.currentIteration || 0}/${job.maxIterations || 2}`,
            color: STATUS_COLORS[job.status] || COLORS[job.assignedAgent] || '#94a3b8',
            radius: ATTENTION.has(job.status) ? 0.19 : ACTIVE.has(job.status) ? 0.18 : 0.145,
            active: ACTIVE.has(job.status), attention: ATTENTION.has(job.status),
            position: positionFor(id, {
                x: worker.x * t + vera.x * (1 - t) + wobble,
                y: worker.y * t + vera.y * (1 - t) + Math.sin(index) * 0.25,
                z: 0.7 + (((seed >>> 16) % 100) / 100 - 0.5) * 1.4,
            }),
            agentId: job.assignedAgent, data: job,
        });
        links.push({ from: 'agent:nora', to: id, kind: 'job' });
        links.push({ from: id, to: `agent:${job.assignedAgent}`, kind: 'job' });
        links.push({ from: id, to: 'agent:vera', kind: 'qc' });
    });
    return { nodes, links };
};

export default function OfficeMapPage({ onOpenConversation }) {
    const [data, setData] = useState({ agents: [], conversations: [], jobs: [], workflows: [], events: [], runner: {} });
    const [layout, setLayout] = useState(() => readLayout());
    const [selection, setSelection] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [hovered, setHovered] = useState(null);
    const [filter, setFilter] = useState('all');
    const [loading, setLoading] = useState(true);
    const [draggingNodeId, setDraggingNodeId] = useState('');
    const canvasRef = useRef(null);
    const shellRef = useRef(null);
    const inspectorRef = useRef(null);
    const frameRef = useRef(null);
    const hitAreasRef = useRef([]);
    const interactionRef = useRef(null);
    const inspectorDragRef = useRef(null);
    const layoutRef = useRef(layout);
    const viewRef = useRef({ yaw: -0.18, pitch: 0.08, zoom: 1 });
    const reducedMotionRef = useRef(false);

    const load = useCallback(async ({ quiet = false } = {}) => {
        if (!quiet) setLoading(true);
        try { setData((await api.get('/office-map')).data || {}); }
        catch (error) { if (!quiet) toast.error(error.response?.data?.error || 'Could not load the Office Map.'); }
        finally { if (!quiet) setLoading(false); }
    }, []);

    useEffect(() => {
        reducedMotionRef.current = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
        load();
        const sync = setInterval(() => { if (!document.hidden) load({ quiet: true }); }, 1250);
        const onFocus = () => load({ quiet: true });
        window.addEventListener('focus', onFocus);
        return () => { clearInterval(sync); window.removeEventListener('focus', onFocus); };
    }, [load]);

    useEffect(() => { layoutRef.current = layout; }, [layout]);

    const topology = useMemo(() => createTopology(data, layout), [data, layout]);
    const nodeMap = useMemo(() => new Map(topology.nodes.map(node => [node.id, node])), [topology]);
    const selected = selection ? nodeMap.get(selection.id) || null : null;
    const recentEvents = useMemo(() => (data.events || []).filter(event => age(event.createdAt) < PACKET_TTL_MS), [data.events]);
    const activeAgents = useMemo(() => new Set([
        ...(data.runner?.active || []).map(item => item.agentId),
        ...recentEvents.filter(event => age(event.createdAt) < 12_000).flatMap(event => [event.from, event.to]).filter(id => COLORS[id]),
    ]), [data.runner?.active, recentEvents]);

    const visibleTopology = useMemo(() => {
        if (filter === 'all') return topology;
        if (filter === 'active') {
            const keep = new Set(topology.nodes.filter(node => node.kind === 'agent' || node.active || node.attention).map(node => node.id));
            return { nodes: topology.nodes.filter(node => keep.has(node.id)), links: topology.links.filter(link => keep.has(link.from) && keep.has(link.to)) };
        }
        const keep = new Set(topology.nodes.filter(node => node.kind === 'agent' || node.kind === filter).map(node => node.id));
        return { nodes: topology.nodes.filter(node => keep.has(node.id)), links: topology.links.filter(link => keep.has(link.from) && keep.has(link.to)) };
    }, [topology, filter]);

    const inspectorPosition = useCallback(point => {
        const shell = shellRef.current?.getBoundingClientRect();
        if (!shell) return { x: 14, y: 14 };
        return {
            x: clamp(point ? point.x + 20 : shell.width - INSPECTOR_WIDTH - 18, 10, shell.width - Math.min(INSPECTOR_WIDTH, shell.width - 20) - 10),
            y: clamp(point ? point.y - 36 : 14, 10, shell.height - Math.min(INSPECTOR_HEIGHT, shell.height - 20) - 10),
        };
    }, []);
    const openInspector = useCallback((node, point = null) => {
        if (!node) return;
        setSelection({ id: node.id, ...inspectorPosition(point) });
        setDetail(node.data);
    }, [inspectorPosition]);

    const loadDetail = useCallback(async node => {
        if (!node || node.kind === 'agent') { setDetail(node?.data || null); return; }
        setDetailLoading(true);
        try {
            const endpoint = node.kind === 'job'
                ? `/jobs/${encodeURIComponent(node.data.jobId)}`
                : `/conversations/${encodeURIComponent(node.data.conversationId)}`;
            setDetail((await api.get(endpoint)).data);
        } catch { setDetail(node.data); }
        finally { setDetailLoading(false); }
    }, []);

    useEffect(() => {
        if (!selected) { setDetail(null); return undefined; }
        loadDetail(selected);
        if (!(selected.kind === 'job' && ACTIVE.has(selected.data.status))) return undefined;
        const timer = setInterval(() => loadDetail(selected), 1500);
        return () => clearInterval(timer);
    }, [selected?.id, selected?.data?.status, loadDetail]);

    useEffect(() => {
        const move = event => {
            const drag = inspectorDragRef.current;
            const shell = shellRef.current?.getBoundingClientRect();
            const card = inspectorRef.current?.getBoundingClientRect();
            if (!drag || !shell || !card) return;
            setSelection(current => current ? {
                ...current,
                x: clamp(event.clientX - shell.left - drag.offsetX, 8, shell.width - card.width - 8),
                y: clamp(event.clientY - shell.top - drag.offsetY, 8, shell.height - card.height - 8),
            } : current);
        };
        const stop = () => { inspectorDragRef.current = null; };
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
            stars = Array.from({ length: Math.min(160, Math.floor(rect.width / 8)) }, (_, index) => ({
                x: (hash(`star-x-${index}`) % 1000) / 1000 * rect.width,
                y: (hash(`star-y-${index}`) % 1000) / 1000 * rect.height,
                a: 0.08 + (hash(`star-a-${index}`) % 25) / 100,
                r: 0.35 + (hash(`star-r-${index}`) % 80) / 100,
            }));
        };
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        resize();

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
            visibleTopology.nodes.forEach(node => {
                const position = layoutRef.current[node.id] || node.position;
                projected.set(node.id, projectPosition(position, rect, viewRef.current, now, reducedMotionRef.current));
            });

            visibleTopology.links.forEach(link => {
                const from = projected.get(link.from); const to = projected.get(link.to);
                if (!from || !to) return;
                context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y);
                context.lineWidth = 0.7; context.strokeStyle = 'rgba(148,163,184,0.15)'; context.stroke();
            });

            recentEvents.forEach(event => {
                const from = projected.get(event.fromNode); const to = projected.get(event.toNode);
                if (!from || !to || event.fromNode === event.toNode) return;
                const elapsed = Math.max(0, Date.now() - new Date(event.createdAt).getTime());
                const opacity = Math.max(0.08, 1 - elapsed / PACKET_TTL_MS);
                const color = eventColor(event.tone);
                context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y);
                context.lineWidth = 1.25; context.strokeStyle = rgba(color, opacity * 0.38); context.stroke();
                if (!reducedMotionRef.current) {
                    const progress = ((now + (hash(event.eventId) % 1700)) % 1700) / 1700;
                    const x = from.x + (to.x - from.x) * progress;
                    const y = from.y + (to.y - from.y) * progress;
                    context.save(); context.shadowColor = color; context.shadowBlur = 13;
                    context.beginPath(); context.fillStyle = rgba(color, Math.min(1, opacity + 0.2));
                    context.arc(x, y, 2.4, 0, Math.PI * 2); context.fill(); context.restore();
                }
            });

            const sorted = [...visibleTopology.nodes].sort((a, b) => projected.get(b.id).z - projected.get(a.id).z);
            const hits = [];
            sorted.forEach(node => {
                const point = projected.get(node.id);
                if (!point) return;
                const radius = Math.max(4, node.radius * point.scale);
                const active = node.kind === 'agent' ? activeAgents.has(node.agentId) : node.active;
                const pulse = (active || node.attention) && !reducedMotionRef.current ? 1 + Math.sin(now / (node.attention ? 250 : 380)) * 0.1 : 1;
                const drawRadius = radius * pulse;
                const isSelected = selection?.id === node.id;
                const isHovered = hovered?.id === node.id;
                const isDragged = draggingNodeId === node.id;
                context.save(); context.shadowColor = node.color;
                context.shadowBlur = isSelected || isDragged ? 32 : node.kind === 'agent' ? 22 : node.attention ? 24 : active ? 18 : 8;
                context.beginPath(); context.fillStyle = rgba(node.color, node.kind === 'agent' ? 0.92 : 0.82);
                context.arc(point.x, point.y, drawRadius, 0, Math.PI * 2); context.fill();
                context.shadowBlur = 0; context.beginPath();
                context.lineWidth = isSelected || isHovered || isDragged ? 2.5 : node.kind === 'agent' ? 1.5 : 0.9;
                context.strokeStyle = isSelected || isHovered || isDragged ? '#ffffff' : 'rgba(255,255,255,0.65)';
                context.arc(point.x, point.y, drawRadius, 0, Math.PI * 2); context.stroke();
                if (node.kind === 'agent') {
                    context.textAlign = 'center'; context.fillStyle = 'rgba(245,247,250,0.96)';
                    context.font = '600 12px Inter, ui-sans-serif, system-ui'; context.fillText(node.title, point.x, point.y + drawRadius + 18);
                    context.fillStyle = 'rgba(148,163,184,0.86)'; context.font = '500 9px Inter, ui-sans-serif, system-ui';
                    context.fillText(node.subtitle || '', point.x, point.y + drawRadius + 31);
                }
                context.restore();
                hits.push({ node, x: point.x, y: point.y, radius: Math.max(drawRadius + 8, 13) });
            });
            hitAreasRef.current = hits.reverse();
            frameRef.current = requestAnimationFrame(draw);
        };
        frameRef.current = requestAnimationFrame(draw);
        return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frameRef.current); };
    }, [visibleTopology, recentEvents, activeAgents, selection?.id, hovered?.id, draggingNodeId]);

    const canvasPoint = event => {
        const rect = canvasRef.current.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const hitAt = point => hitAreasRef.current.find(hit => Math.hypot(hit.x - point.x, hit.y - point.y) <= hit.radius);

    const pointerDown = event => {
        if (event.button !== undefined && event.button !== 0) return;
        const point = canvasPoint(event);
        const hit = hitAt(point);
        interactionRef.current = hit ? {
            mode: 'node', nodeId: hit.node.id, origin: { ...(layoutRef.current[hit.node.id] || hit.node.position) },
            startX: point.x, startY: point.y, lastX: point.x, lastY: point.y, moved: false,
        } : { mode: 'view', startX: point.x, startY: point.y, lastX: point.x, lastY: point.y, moved: false };
        if (hit) setDraggingNodeId(hit.node.id);
        canvasRef.current.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    };

    const pointerMove = event => {
        const point = canvasPoint(event);
        const interaction = interactionRef.current;
        if (!interaction) {
            const hit = hitAt(point);
            setHovered(hit ? { ...hit.node, screenX: point.x, screenY: point.y } : null);
            return;
        }
        const totalX = point.x - interaction.startX;
        const totalY = point.y - interaction.startY;
        if (Math.abs(totalX) + Math.abs(totalY) > 4) interaction.moved = true;
        if (interaction.mode === 'view') {
            const dx = point.x - interaction.lastX;
            const dy = point.y - interaction.lastY;
            viewRef.current.yaw += dx * 0.006;
            viewRef.current.pitch = clamp(viewRef.current.pitch + dy * 0.004, -0.75, 0.75);
        } else if (interaction.moved) {
            const rect = canvasRef.current.getBoundingClientRect();
            const delta = screenDeltaToWorld(interaction.origin, totalX, totalY, rect, viewRef.current);
            layoutRef.current = {
                ...layoutRef.current,
                [interaction.nodeId]: {
                    x: clamp(interaction.origin.x + delta.x, -6.5, 6.5),
                    y: clamp(interaction.origin.y + delta.y, -4.8, 4.8),
                    z: interaction.origin.z,
                },
            };
        }
        interaction.lastX = point.x;
        interaction.lastY = point.y;
        setHovered(null);
    };

    const pointerUp = event => {
        const point = canvasPoint(event);
        const interaction = interactionRef.current;
        interactionRef.current = null;
        canvasRef.current.releasePointerCapture?.(event.pointerId);
        if (!interaction) return;
        if (interaction.mode === 'node') {
            setDraggingNodeId('');
            if (interaction.moved) {
                const next = { ...layoutRef.current };
                setLayout(next);
                persistLayout(next);
            } else {
                const hit = hitAt(point) || { node: nodeMap.get(interaction.nodeId) };
                if (hit.node) openInspector(hit.node, point);
            }
        }
    };

    const wheel = event => {
        event.preventDefault();
        viewRef.current.zoom = clamp(viewRef.current.zoom * (event.deltaY > 0 ? 0.92 : 1.08), 0.55, 2.2);
    };
    const resetView = () => { viewRef.current = { yaw: -0.18, pitch: 0.08, zoom: 1 }; };
    const resetLayout = () => {
        layoutRef.current = {};
        setLayout({});
        persistLayout({});
        toast.success('Office Map node layout reset.');
    };
    const resetNodeAt = event => {
        const hit = hitAt(canvasPoint(event));
        if (!hit) return;
        const next = { ...layoutRef.current };
        delete next[hit.node.id];
        layoutRef.current = next;
        setLayout(next);
        persistLayout(next);
        toast.success(`${hit.node.title} returned to its automatic position.`);
    };
    const startInspectorDrag = event => {
        const rect = inspectorRef.current?.getBoundingClientRect();
        if (!rect) return;
        inspectorDragRef.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
        event.preventDefault();
    };

    const continueJob = async job => {
        try {
            await api.post(`/jobs/${encodeURIComponent(job.jobId)}/run`);
            toast.success('Two more bounded iterations authorized.');
            await load({ quiet: true });
        } catch (error) { toast.error(error.response?.data?.error || 'Could not continue job.'); }
    };

    const eventsForSelection = selected?.kind === 'job'
        ? (data.events || []).filter(event => event.jobId === selected.data.jobId).slice(-24).reverse()
        : selected?.kind === 'agent'
            ? (data.events || []).filter(event => event.from === selected.agentId || event.to === selected.agentId).slice(-24).reverse()
            : [];
    const selectedJobs = selected?.kind === 'agent'
        ? (data.jobs || []).filter(job => job.assignedAgent === selected.agentId || (selected.agentId === 'vera' && ['qc_review', 'completed', 'needs_attention'].includes(job.status)))
        : [];
    const jobDetail = selected?.kind === 'job' ? (detail || selected.data) : null;
    const conversationDetail = selected?.kind === 'conversation' ? detail : null;
    const activeJobs = (data.jobs || []).filter(job => ACTIVE.has(job.status));

    return (
        <div className="office-map">
            <header className="office-map__header">
                <div><div className="eyebrow">Live operating topology</div><h1>Office Map</h1><p>Rotate the 3D projection, arrange nodes freely, and watch real runtime traffic between Nora, workers, Vera, and jobs.</p></div>
                <div className="office-map__toolbar">
                    {['all', 'active', 'conversation', 'job'].map(value => <button type="button" key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{value === 'conversation' ? 'Chats' : value === 'job' ? 'Jobs' : value[0].toUpperCase() + value.slice(1)}</button>)}
                    <button type="button" onClick={() => load()}><IconRefresh size={16} /> Refresh</button>
                </div>
            </header>

            <div className="office-map__workspace">
                <section className="office-map__canvas-shell" ref={shellRef}>
                    <canvas
                        ref={canvasRef}
                        className={`office-map__canvas ${draggingNodeId ? 'is-node-dragging' : ''}`}
                        onPointerDown={pointerDown}
                        onPointerMove={pointerMove}
                        onPointerUp={pointerUp}
                        onPointerCancel={pointerUp}
                        onPointerLeave={() => { if (!interactionRef.current) setHovered(null); }}
                        onDoubleClick={resetNodeAt}
                        onWheel={wheel}
                        aria-label="Interactive Office Map. Drag empty space to rotate, scroll to zoom, and drag a node to reposition it."
                    />
                    <div className="office-map__canvas-toolbar" aria-label="Map controls">
                        <button type="button" onClick={() => { viewRef.current.zoom = clamp(viewRef.current.zoom * 1.12, 0.55, 2.2); }} aria-label="Zoom in"><IconZoomIn size={17} /></button>
                        <button type="button" onClick={() => { viewRef.current.zoom = clamp(viewRef.current.zoom / 1.12, 0.55, 2.2); }} aria-label="Zoom out"><IconZoomOut size={17} /></button>
                        <button type="button" onClick={resetView} aria-label="Reset camera"><IconRotateClockwise size={17} /></button>
                        <button type="button" className="office-map__reset-layout" onClick={resetLayout}>Reset layout</button>
                    </div>
                    <div className="office-map__help">Drag empty space to rotate · Scroll to zoom · Drag a node to move it · Double-click a node to reset it</div>
                    <div className="office-map__legend"><span><i className="is-live" /> moving packet = real runtime event</span><span><i className="is-attention" /> red = waiting on Carlos</span></div>
                    {hovered && !selection && <div className="office-map__tooltip" style={{ left: hovered.screenX + 16, top: hovered.screenY + 16 }}><strong>{hovered.title}</strong><span>{hovered.subtitle}</span></div>}
                    {loading && <div className="office-map__loading office-map__loading--overlay">Refreshing topology…</div>}

                    {selected && selection && <aside ref={inspectorRef} className="office-map__inspector" style={{ left: selection.x, top: selection.y }}>
                        <header className="office-map__inspector-header" onPointerDown={startInspectorDrag}>
                            <div><small>{selected.kind}</small><strong>{selected.title}</strong><span>{selected.subtitle}</span></div>
                            <button type="button" onPointerDown={event => event.stopPropagation()} onClick={() => setSelection(null)} aria-label="Close inspector"><IconX size={17} /></button>
                        </header>
                        {detailLoading && <div className="office-map__inspector-loading">Refreshing live details…</div>}

                        {selected.kind === 'job' && jobDetail && <>
                            <div className={`office-map__state office-map__state--${jobDetail.status}`}><strong>{label(jobDetail.status)}</strong><span>Waiting on {jobDetail.waitingOn || (ATTENTION.has(jobDetail.status) ? 'Carlos' : jobDetail.status === 'qc_review' ? 'Vera' : jobDetail.status === 'nora_review' ? 'Nora' : jobDetail.assignedAgent)}</span></div>
                            {jobDetail.attentionMessage && <div className="office-map__attention"><strong>Why this stopped</strong><p>{jobDetail.attentionMessage}</p></div>}
                            <section className="office-map__story"><h3>Workflow story</h3>{eventsForSelection.length ? eventsForSelection.map(event => <article key={event.eventId}><span style={{ background: eventColor(event.tone), color: eventColor(event.tone) }} /><div><strong>{event.from || 'system'} → {event.to || 'office'}</strong><small>{label(event.stage || event.type)}</small><p>{event.summary}</p></div></article>) : <p>No retained runtime events for this job.</p>}</section>
                            {!!jobDetail.messages?.length && <section className="office-map__trace"><h3>Agent messages</h3>{jobDetail.messages.slice(-12).reverse().map(message => <article key={message.messageId}><header><strong>{message.from} → {message.to || 'office'}</strong><small>{label(message.type)}</small></header><p>{message.content}</p></article>)}</section>}
                            {!!jobDetail.attempts?.length && <section className="office-map__trace"><h3>Execution trace</h3>{jobDetail.attempts.slice().reverse().map(attempt => <details key={attempt.iteration}><summary>Iteration {attempt.iteration} · Vera {attempt.qcVerdict} · {attempt.qcScore}/100</summary><h4>Worker deliverable</h4><pre>{attempt.workerOutput}</pre><h4>Vera review</h4><p>{attempt.qcSummary || attempt.qcFeedback || 'No review text recorded.'}</p></details>)}</section>}
                            {ATTENTION.has(jobDetail.status) && <button type="button" className="office-map__continue" onClick={() => continueJob(jobDetail)}><IconPlayerPlay size={16} /> Give 2 more iterations</button>}
                        </>}

                        {selected.kind === 'agent' && <section className="office-map__story"><h3>Recent runtime activity</h3>{eventsForSelection.map(event => <article key={event.eventId}><span style={{ background: eventColor(event.tone), color: eventColor(event.tone) }} /><div><strong>{event.from || 'system'} → {event.to || 'office'}</strong><small>{label(event.stage || event.type)}</small><p>{event.summary}</p></div></article>)}{!eventsForSelection.length && <p>No recent traffic.</p>}<h3>Jobs</h3>{selectedJobs.slice(0, 10).map(job => <button type="button" className="office-map__job-link" key={job.jobId} onClick={() => openInspector(nodeMap.get(`job:${job.jobId}`))}><IconBriefcase2 size={14} /><span>{job.title}</span><small>{label(job.status)}</small></button>)}</section>}

                        {selected.kind === 'conversation' && <section className="office-map__trace"><h3>Conversation</h3>{(conversationDetail?.messages || []).slice(-10).map((message, index) => <article key={`${message.createdAt}-${index}`}><header><strong>{message.role === 'user' ? 'Carlos' : selected.data.agentId}</strong><small>{label(message.role)}</small></header><p>{message.content}</p></article>)}{!conversationDetail?.messages?.length && <p>No transcript is loaded.</p>}<button type="button" className="office-map__continue" onClick={() => { setSelection(null); onOpenConversation?.(selected.data.conversationId); }}><IconMessageCircle size={16} /> Open conversation</button></section>}
                    </aside>}
                </section>

                <aside className="office-map__sidebar">
                    <div className="office-map__stats"><div><strong>{data.agents?.length || 0}</strong><span>Agents</span></div><div><strong>{activeAgents.size}</strong><span>Working</span></div><div><strong>{data.jobs?.length || 0}</strong><span>Jobs</span></div></div>
                    <section><h2>Agents</h2>{(data.agents || []).map(agent => <button type="button" key={agent.agentId} className="office-map__workflow-row" onClick={() => openInspector(nodeMap.get(`agent:${agent.agentId}`))}><span><strong>{agent.name}</strong><small>{activeAgents.has(agent.agentId) ? 'working' : 'ready'} · {agent.role}</small></span><em style={{ color: COLORS[agent.agentId] }}>●</em></button>)}</section>
                    <section><h2>Workflows</h2>{(data.workflows || []).slice(0, 8).map(workflow => <button type="button" key={workflow.workflowId} className={`office-map__workflow-row is-${workflow.status}`} onClick={() => workflow.jobs?.[0] && openInspector(nodeMap.get(`job:${workflow.jobs[0].jobId}`))}><span><strong>{workflow.title}</strong><small>{label(workflow.stage)} · waiting on {workflow.waitingOn || '—'}</small></span><em>{workflow.jobs?.filter(job => job.status === 'completed').length || 0}/{workflow.jobs?.length || 0}</em></button>)}{!data.workflows?.length && <p className="office-map__empty">No live workflows yet.</p>}</section>
                    <section><h2>Jobs</h2>{(data.jobs || []).slice(0, 10).map(job => <button type="button" key={job.jobId} className="office-map__job-link" onClick={() => openInspector(nodeMap.get(`job:${job.jobId}`))}><IconBriefcase2 size={14} /><span>{job.title}</span><small>{label(job.status)}</small></button>)}{!data.jobs?.length && <p className="office-map__empty">No jobs stored.</p>}</section>
                    <section><h2>Recent chats</h2>{(data.conversations || []).slice(0, 6).map(chat => <button type="button" key={chat.conversationId} className="office-map__chat-row" onClick={() => openInspector(nodeMap.get(`conversation:${chat.conversationId}`))}><IconMessageCircle size={14} /><span>{chat.title}</span></button>)}{!data.conversations?.length && <p className="office-map__empty">No conversations.</p>}</section>
                </aside>
            </div>
        </div>
    );
}
