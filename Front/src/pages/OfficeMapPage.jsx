import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    IconBriefcase2,
    IconFile,
    IconMessageCircle,
    IconPlayerPause,
    IconPlayerPlay,
    IconRefresh,
    IconRotateClockwise,
    IconX,
    IconZoomIn,
    IconZoomOut,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';
import AgentConfigurationForm, { editableAgentConfig } from '../components/AgentConfigurationForm';
import ArtifactPreview from '../components/ArtifactPreview';
import useRuntimeEvents from '../hooks/useRuntimeEvents';

const COLORS = {
    nora: '#22d3ee', marco: '#f59e0b', luma: '#e879f9', dex: '#60a5fa', iris: '#a78bfa', vera: '#34d399',
};
const STATUS_COLORS = {
    queued: '#94a3b8', running: '#f59e0b', paused: '#fb7185', waiting_authorization: '#fb7185',
    completed: '#4ade80', failed: '#f87171', cancelled: '#64748b',
};
const DEFAULT_POSITIONS = {
    nora: { x: 0, y: 3.05, z: -0.2 },
    luma: { x: -3.35, y: 1.65, z: -0.3 },
    vera: { x: 3.35, y: 1.65, z: 0.35 },
    marco: { x: -3.15, y: -2.2, z: 0.3 },
    dex: { x: 3.15, y: -2.2, z: -0.15 },
    iris: { x: 0, y: -3.25, z: 0.45 },
};
const JOB_SPHERE_RADIUS = 1.65;
const NODE_RADIUS_SCALE = 0.7;
const MAX_JOB_NODE_RADIUS = 0.19 * NODE_RADIUS_SCALE;
const ACTIVE = new Set(['queued', 'running']);
const ATTENTION = new Set(['paused', 'waiting_authorization', 'failed']);
const PACKET_TTL_MS = 60_000;
const LAYOUT_KEY = 'carlos-office-map-layout-v3';
const INSPECTOR_WIDTH = 420;
const INSPECTOR_HEIGHT = 580;
const AGENT_DRAFTS_KEY = 'carlos-office-agent-config-drafts-v1';

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
const waitingLabel = job => job?.waitingOn
    || (ATTENTION.has(job?.status) ? 'Carlos'
        : job?.status === 'qc_review' ? 'Vera'
            : job?.status === 'nora_review' ? 'Nora'
                : ACTIVE.has(job?.status) ? job?.tasks?.find(task => task.state === 'running')?.agentId || 'office' : '');
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
const unitHash = value => (hash(value) + 0.5) / 4_294_967_296;
const jobNodeRadius = job => (ATTENTION.has(job?.status) ? 0.19 : ACTIVE.has(job?.status) ? 0.18 : 0.145) * NODE_RADIUS_SCALE;
const jobSphereLimit = (nodeRadius = MAX_JOB_NODE_RADIUS) => Math.max(0, JOB_SPHERE_RADIUS - nodeRadius * 1.12 - 0.025);
const constrainJobPosition = (position, nodeRadius = MAX_JOB_NODE_RADIUS) => {
    const next = {
        x: Number(position?.x) || 0,
        y: Number(position?.y) || 0,
        z: Number(position?.z) || 0,
    };
    const limit = jobSphereLimit(nodeRadius);
    const distance = Math.hypot(next.x, next.y, next.z);
    if (!distance || distance <= limit) return next;
    const scale = limit / distance;
    return { x: next.x * scale, y: next.y * scale, z: next.z * scale };
};
const readLayout = () => {
    try {
        const parsed = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
        return Object.fromEntries(Object.entries(parsed)
            .filter(([, position]) => (
                Number.isFinite(position?.x) && Number.isFinite(position?.y) && Number.isFinite(position?.z)
            ))
            .map(([id, position]) => [
                id,
                id.startsWith('job:') ? constrainJobPosition(position, MAX_JOB_NODE_RADIUS) : position,
            ]));
    } catch { return {}; }
};
const persistLayout = layout => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
};
const readAgentDrafts = () => {
    try {
        const value = JSON.parse(sessionStorage.getItem(AGENT_DRAFTS_KEY) || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
};
const sameAgentConfig = (left, right) => JSON.stringify(editableAgentConfig(left)) === JSON.stringify(editableAgentConfig(right));
const artifactsForJob = job => {
    const unique = new Map();
    [
        ...(job?.tasks || []).flatMap(task => task.artifacts || []),
    ].filter(item => item?.artifactId && item?.path).forEach(item => unique.set(item.artifactId, item));
    return [...unique.values()];
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

const screenDeltaToCameraPlane = (origin, deltaX, deltaY, rect, view) => {
    const cosY = Math.cos(view.yaw);
    const sinY = Math.sin(view.yaw);
    const cosP = Math.cos(view.pitch);
    const sinP = Math.sin(view.pitch);
    const yawDepth = origin.x * sinY + origin.z * cosY;
    const cameraDepth = origin.y * sinP + yawDepth * cosP;
    const perspective = 1 / Math.max(0.35, 1 + cameraDepth * 0.11);
    const scale = Math.min(rect.width, rect.height) * 0.14 * view.zoom * perspective;
    const cameraX = deltaX / scale;
    const cameraY = -deltaY / scale;
    const yawDepthDelta = -cameraY * sinP;
    return {
        x: origin.x + cameraX * cosY + yawDepthDelta * sinY,
        y: origin.y + cameraY * cosP,
        z: origin.z - cameraX * sinY + yawDepthDelta * cosY,
    };
};

const createTopology = (data, layout) => {
    const agents = (data?.agents || []).filter(agent => agent.permanent !== false);
    const conversations = (data?.conversations || []).filter(conversation => conversation.agentId === 'nora').slice(0, 3);
    const jobs = (data?.jobs || []).slice(0, 100);
    const instances = (data?.agentInstances || []).filter(instance => ['working', 'queued', 'paused'].includes(instance.state)).slice(0, 100);
    const positionFor = (id, fallback) => layout[id] || fallback;
    const agentById = new Map(agents.map(agent => [agent.agentId, agent]));
    const colorForAgent = agentId => agentById.get(agentId)?.color || COLORS[agentId] || '#cbd5e1';
    const agentPositions = Object.fromEntries(agents.map((agent, index) => {
        const angle = unitHash(`agent:${agent.agentId}`) * Math.PI * 2;
        const automatic = DEFAULT_POSITIONS[agent.agentId] || {
            x: Math.cos(angle) * (3.25 + (index % 3) * 0.22),
            y: Math.sin(angle) * (2.7 + (index % 2) * 0.18),
            z: (unitHash(`agent:${agent.agentId}:z`) - 0.5) * 1.2,
        };
        return [agent.agentId, positionFor(`agent:${agent.agentId}`, automatic)];
    }));
    const nodes = agents.map(agent => ({
        id: `agent:${agent.agentId}`, kind: 'agent', agentId: agent.agentId,
        title: agent.name, subtitle: agent.role, color: colorForAgent(agent.agentId),
        radius: agent.agentId === 'nora' ? 0.34 : 0.29,
        position: positionFor(`agent:${agent.agentId}`, agentPositions[agent.agentId] || DEFAULT_POSITIONS.nora),
        data: agent,
    }));
    const links = [];

    const conversationCounts = conversations.reduce((counts, conversation) => {
        counts.set(conversation.agentId, (counts.get(conversation.agentId) || 0) + 1);
        return counts;
    }, new Map());
    const conversationIndexes = new Map();
    conversations.forEach(conversation => {
        const center = agentPositions[conversation.agentId] || agentPositions.nora || DEFAULT_POSITIONS.nora;
        const seed = hash(conversation.conversationId);
        const clusterIndex = conversationIndexes.get(conversation.agentId) || 0;
        const row = Math.floor(clusterIndex / 5);
        const rowIndex = clusterIndex % 5;
        const rowSize = Math.min(5, Math.max(1, (conversationCounts.get(conversation.agentId) || 1) - row * 5));
        const distance = Math.max(1, Math.hypot(center.x, center.y));
        const outwardX = center.x / distance;
        const outwardY = center.y / distance;
        const tangentX = -outwardY;
        const tangentY = outwardX;
        const outwardOffset = 0.7 + row * 0.28 + ((seed >>> 8) % 18) / 180;
        const tangentOffset = (rowIndex - (rowSize - 1) / 2) * 0.27;
        const z = center.z + (((seed >>> 16) % 100) / 100 - 0.5) * 0.85;
        const id = `conversation:${conversation.conversationId}`;
        conversationIndexes.set(conversation.agentId, clusterIndex + 1);
        nodes.push({
            id, kind: 'conversation', title: conversation.title, subtitle: `${conversation.messageCount} messages`,
            color: colorForAgent(conversation.agentId), radius: (0.095 + Math.min(conversation.messageCount || 0, 20) * 0.002) * NODE_RADIUS_SCALE,
            position: positionFor(id, {
                x: center.x + outwardX * outwardOffset + tangentX * tangentOffset,
                y: center.y + outwardY * outwardOffset + tangentY * tangentOffset,
                z,
            }),
            agentId: conversation.agentId, data: conversation,
        });
        links.push({ from: `agent:${conversation.agentId}`, to: id, kind: 'conversation' });
    });

    jobs.forEach(job => {
        const id = `job:${job.jobId}`;
        const nodeRadius = jobNodeRadius(job);
        const limit = jobSphereLimit(nodeRadius) * 0.94;
        const radialDistance = limit * Math.cbrt(unitHash(`${id}:radius`));
        const vertical = unitHash(`${id}:vertical`) * 2 - 1;
        const angle = unitHash(`${id}:angle`) * Math.PI * 2;
        const planar = Math.sqrt(Math.max(0, 1 - vertical ** 2));
        const automaticPosition = {
            x: radialDistance * planar * Math.cos(angle),
            y: radialDistance * vertical,
            z: radialDistance * planar * Math.sin(angle),
        };
        nodes.push({
            id, kind: 'job', title: job.title,
            subtitle: `${label(job.status)} · ${job.tasks?.filter(task => task.state === 'completed').length || 0}/${job.tasks?.length || 0} tasks`,
            color: STATUS_COLORS[job.status] || colorForAgent(job.tasks?.find(task => task.state === 'running')?.agentId) || '#94a3b8',
            radius: nodeRadius,
            active: ACTIVE.has(job.status), attention: ATTENTION.has(job.status),
            position: constrainJobPosition(positionFor(id, automaticPosition), nodeRadius),
            agentId: job.tasks?.find(task => task.state === 'running')?.agentId || 'nora', data: job,
        });
        links.push({ from: 'agent:nora', to: id, kind: 'job' });
        [...new Set((job.tasks || []).map(task => task.agentId).filter(Boolean))].forEach(agentId => links.push({ from: id, to: `agent:${agentId}`, kind: 'collaboration' }));
    });
    instances.forEach((instance, index) => {
        const center = agentPositions[instance.agentId] || agentPositions.nora;
        const angle = unitHash(instance.instanceId) * Math.PI * 2;
        const id = `instance:${instance.instanceId}`;
        nodes.push({
            id, kind: 'instance', title: instance.label, subtitle: label(instance.state), color: colorForAgent(instance.agentId),
            radius: 0.09, active: instance.state === 'working', attention: instance.state === 'paused',
            position: positionFor(id, { x: center.x + Math.cos(angle) * (0.66 + (index % 3) * 0.08), y: center.y + Math.sin(angle) * (0.66 + (index % 3) * 0.08), z: center.z + (unitHash(`${id}:z`) - .5) * .45 }),
            agentId: instance.agentId, data: instance,
        });
        links.push({ from: `agent:${instance.agentId}`, to: id, kind: 'instance' });
        const job = jobs.find(item => item.tasks?.some(task => task.taskId === instance.taskId));
        if (job) links.push({ from: id, to: `job:${job.jobId}`, kind: 'instance-job' });
    });
    return { nodes, links };
};

export default function OfficeMapPage({ onOpenConversation, onAgentSaved }) {
    const [data, setData] = useState({ agents: [], conversations: [], jobs: [], processes: [], events: [], runner: {} });
    const [layout, setLayout] = useState(() => readLayout());
    const [selection, setSelection] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [hovered, setHovered] = useState(null);
    const [filter, setFilter] = useState('all');
    const [animationPaused, setAnimationPaused] = useState(false);
    const [loading, setLoading] = useState(true);
    const [draggingNodeId, setDraggingNodeId] = useState('');
    const [agentInspectorTab, setAgentInspectorTab] = useState('activity');
    const [agentDrafts, setAgentDrafts] = useState(() => readAgentDrafts());
    const [ollamaModels, setOllamaModels] = useState([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [modelsLoaded, setModelsLoaded] = useState(false);
    const [savingAgent, setSavingAgent] = useState(false);
    const [platformConfig, setPlatformConfig] = useState(null);
    const [previewArtifacts, setPreviewArtifacts] = useState([]);
    const [activeArtifactId, setActiveArtifactId] = useState('');
    const canvasRef = useRef(null);
    const shellRef = useRef(null);
    const inspectorRef = useRef(null);
    const inspectorTriggerRef = useRef(null);
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
        api.get('/platform-config').then(response => setPlatformConfig(response.data)).catch(() => {});
        const onFocus = () => load({ quiet: true });
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [load]);
    useRuntimeEvents(() => {
        if (!document.hidden) void load({ quiet: true });
    }, { fallbackMs: 5_000 });
    useEffect(() => {
        const timer = window.setInterval(() => { if (!document.hidden) void load({ quiet: true }); }, 5_000);
        return () => window.clearInterval(timer);
    }, [load]);

    useEffect(() => { layoutRef.current = layout; }, [layout]);
    useEffect(() => {
        try { sessionStorage.setItem(AGENT_DRAFTS_KEY, JSON.stringify(agentDrafts)); } catch {}
    }, [agentDrafts]);

    const topology = useMemo(() => createTopology(data, layout), [data, layout]);
    const nodeMap = useMemo(() => new Map(topology.nodes.map(node => [node.id, node])), [topology]);
    const selected = selection ? nodeMap.get(selection.id) || null : null;
    const selectedAgentDraft = selected?.kind === 'agent'
        ? agentDrafts[selected.agentId] || editableAgentConfig(selected.data)
        : null;
    const selectedAgentDirty = selected?.kind === 'agent' && !!agentDrafts[selected.agentId]
        && !sameAgentConfig(agentDrafts[selected.agentId], selected.data);
    const loadOllamaModels = useCallback(async () => {
        setLoadingModels(true);
        try {
            const response = await api.get('/models', { params: { provider: 'ollama' } });
            setOllamaModels(response.data || []);
            setModelsLoaded(true);
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not list Ollama models.');
        } finally {
            setLoadingModels(false);
        }
    }, []);
    useEffect(() => {
        if (selected?.kind === 'agent' && agentInspectorTab === 'configuration' && !modelsLoaded && !loadingModels) loadOllamaModels();
    }, [selected?.kind, agentInspectorTab, modelsLoaded, loadingModels, loadOllamaModels]);
    const recentEvents = useMemo(() => (data.events || []).filter(event => event.visibility !== 'detail' && age(event.createdAt) < PACKET_TTL_MS), [data.events]);
    const activeAgents = useMemo(() => new Set([
        ...(data.runner?.active || []).flatMap(item => item.agentIds?.length ? item.agentIds : [item.agentId]),
        ...(data.activity?.active || []).map(item => item.agentId),
        ...recentEvents.filter(event => age(event.createdAt) < 12_000).flatMap(event => [event.from, event.to]).filter(id => COLORS[id]),
    ]), [data.runner?.active, data.activity?.active, recentEvents]);

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
    const closeInspector = useCallback(() => {
        setSelection(null);
        requestAnimationFrame(() => inspectorTriggerRef.current?.focus?.());
    }, []);
    const openInspector = useCallback((node, point = null, trigger = null) => {
        if (!node) return;
        if (node.kind === 'agent' && selection?.id !== node.id) setAgentInspectorTab('activity');
        if (trigger?.focus) inspectorTriggerRef.current = trigger;
        setSelection({ id: node.id, ...inspectorPosition(point) });
        setDetail(node.data);
    }, [inspectorPosition, selection?.id]);

    useEffect(() => {
        if (!selection) return undefined;
        const onKeyDown = event => { if (event.key === 'Escape') closeInspector(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selection, closeInspector]);

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
        return undefined;
    }, [selected?.id, selected?.data?.status, data.generatedAt, loadDetail]);

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

            const sphereCenter = projectPosition({ x: 0, y: 0, z: 0 }, rect, viewRef.current, now, true);
            const sphereRadius = JOB_SPHERE_RADIUS * sphereCenter.scale
                / Math.sqrt(Math.max(0.5, 1 - (JOB_SPHERE_RADIUS * 0.11) ** 2));
            context.save();
            const sphereFill = context.createRadialGradient(sphereCenter.x - sphereRadius * 0.3, sphereCenter.y - sphereRadius * 0.35, sphereRadius * 0.1, sphereCenter.x, sphereCenter.y, sphereRadius);
            sphereFill.addColorStop(0, 'rgba(103,232,249,0.035)'); sphereFill.addColorStop(0.72, 'rgba(103,232,249,0.012)'); sphereFill.addColorStop(1, 'rgba(103,232,249,0.06)');
            context.beginPath();
            context.arc(sphereCenter.x, sphereCenter.y, sphereRadius, 0, Math.PI * 2);
            context.fillStyle = sphereFill; context.fill();
            context.shadowColor = 'rgba(103,232,249,0.3)'; context.shadowBlur = 10;
            context.lineWidth = 1.1;
            context.strokeStyle = 'rgba(103,232,249,0.34)';
            context.stroke();
            context.restore();

            const projected = new Map();
            visibleTopology.nodes.forEach(node => {
                const candidate = layoutRef.current[node.id] || node.position;
                const position = node.kind === 'job' ? constrainJobPosition(candidate, node.radius) : candidate;
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
                if (!reducedMotionRef.current && !animationPaused) {
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
                const pulse = (active || node.attention) && !reducedMotionRef.current && !animationPaused ? 1 + Math.sin(now / (node.attention ? 250 : 380)) * 0.1 : 1;
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
    }, [visibleTopology, recentEvents, activeAgents, selection?.id, hovered?.id, draggingNodeId, animationPaused]);

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
            mode: 'node', nodeId: hit.node.id, nodeKind: hit.node.kind, nodeRadius: hit.node.radius,
            origin: { ...(layoutRef.current[hit.node.id] || hit.node.position) },
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
            const projectedCandidate = screenDeltaToCameraPlane(
                interaction.origin,
                totalX,
                totalY,
                rect,
                viewRef.current,
            );
            const candidate = {
                x: clamp(projectedCandidate.x, -6.5, 6.5),
                y: clamp(projectedCandidate.y, -4.8, 4.8),
                z: clamp(projectedCandidate.z, -6.5, 6.5),
            };
            layoutRef.current = {
                ...layoutRef.current,
                [interaction.nodeId]: interaction.nodeKind === 'job'
                    ? constrainJobPosition(candidate, interaction.nodeRadius)
                    : candidate,
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
                if (hit.node) openInspector(hit.node, point, canvasRef.current);
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
            toast.success('Targeted recovery started for the unresolved criteria.');
            await load({ quiet: true });
        } catch (error) { toast.error(error.response?.data?.error || 'Could not continue job.'); }
    };
    const controlSelectedJob = async action => {
        if (!jobDetail) return;
        try { await api.post(`/jobs/${encodeURIComponent(jobDetail.jobId)}/action`, { action }); toast.success(`Job ${action} requested.`); await load({ quiet: true }); }
        catch (error) { toast.error(error.response?.data?.error || `Could not ${action} job.`); }
    };

    const updateSelectedAgentDraft = next => {
        if (selected?.kind !== 'agent') return;
        setAgentDrafts(current => {
            if (sameAgentConfig(next, selected.data)) {
                const clean = { ...current };
                delete clean[selected.agentId];
                return clean;
            }
            return { ...current, [selected.agentId]: next };
        });
    };
    const discardSelectedAgentDraft = () => {
        if (selected?.kind !== 'agent') return;
        setAgentDrafts(current => {
            const next = { ...current };
            delete next[selected.agentId];
            return next;
        });
        toast.success(`${selected.title}'s unsaved changes were discarded.`);
    };
    const saveSelectedAgent = async () => {
        if (selected?.kind !== 'agent' || !selectedAgentDraft || !selectedAgentDirty) return;
        setSavingAgent(true);
        try {
            const response = await api.put(`/agents/${selected.agentId}`, {
                ...selectedAgentDraft,
                temperature: Number(selectedAgentDraft.temperature),
                maxToolRounds: Number(selectedAgentDraft.maxToolRounds),
            });
            const updated = response.data;
            setData(current => ({
                ...current,
                agents: (current.agents || []).map(agent => agent.agentId === updated.agentId ? updated : agent),
            }));
            setAgentDrafts(current => {
                const next = { ...current };
                delete next[selected.agentId];
                return next;
            });
            onAgentSaved?.(updated);
            toast.success(`${selected.title} updated.`);
        } catch (error) {
            toast.error(error.response?.data?.error || error.message);
        } finally {
            setSavingAgent(false);
        }
    };

    const eventsForSelection = selected?.kind === 'job'
        ? (data.events || []).filter(event => event.jobId === selected.data.jobId).slice(-24).reverse()
        : selected?.kind === 'agent'
            ? (data.events || []).filter(event => event.from === selected.agentId || event.to === selected.agentId).slice(-24).reverse()
            : [];
    const selectedJobs = selected?.kind === 'agent'
        ? (data.jobs || []).filter(job => (job.tasks || []).some(task => task.agentId === selected.agentId))
        : [];
    const jobDetail = selected?.kind === 'job' ? (detail || selected.data) : null;
    const jobArtifacts = useMemo(() => artifactsForJob(jobDetail), [jobDetail]);
    const activeArtifact = previewArtifacts.find(item => item.artifactId === activeArtifactId) || null;
    const conversationDetail = selected?.kind === 'conversation' ? detail : null;
    const activeJobs = (data.jobs || []).filter(job => ACTIVE.has(job.status));
    const openJobArtifact = artifactId => {
        setPreviewArtifacts(jobArtifacts);
        setActiveArtifactId(artifactId);
        setSelection(null);
    };

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
                        <button type="button" className={animationPaused ? 'is-active' : ''} onClick={() => setAnimationPaused(value => !value)} aria-label={animationPaused ? 'Resume packet animation' : 'Pause packet animation'}><IconPlayerPause size={17} /></button>
                        <button type="button" className="office-map__reset-layout" onClick={resetLayout}>Reset layout</button>
                    </div>
                    <div className="office-map__help">Drag empty space to rotate · Scroll to zoom · Drag a node to move it · Double-click a node to reset it</div>
                    <div className="office-map__legend"><span><i className="is-live" /> moving packet = real runtime event</span><span><i className="is-attention" /> red = waiting on Carlos</span></div>
                    {hovered && !selection && <div className="office-map__tooltip" style={{ left: hovered.screenX + 16, top: hovered.screenY + 16 }}><strong>{hovered.title}</strong><span>{hovered.subtitle}</span></div>}
                    {loading && <div className="office-map__loading office-map__loading--overlay">Refreshing topology…</div>}

                    {selected && selection && <aside ref={inspectorRef} className={`office-map__inspector office-map__inspector--${selected.kind}`} style={{ left: selection.x, top: selection.y }}>
                        <header className="office-map__inspector-header" onPointerDown={startInspectorDrag}>
                            <div><small>{selected.kind}</small><strong>{selected.title}</strong><span>{selected.subtitle}</span></div>
                            <button type="button" onPointerDown={event => event.stopPropagation()} onClick={closeInspector} aria-label="Close inspector"><IconX size={17} /></button>
                        </header>
                        {detailLoading && <div className="office-map__inspector-loading">Refreshing live details…</div>}

                        {selected.kind === 'agent' && <div className="office-map__inspector-tabs" role="tablist" aria-label={`${selected.title} inspector`}>
                            <button type="button" role="tab" aria-selected={agentInspectorTab === 'activity'} className={agentInspectorTab === 'activity' ? 'is-active' : ''} onClick={() => setAgentInspectorTab('activity')}>Activity</button>
                            <button type="button" role="tab" aria-selected={agentInspectorTab === 'configuration'} className={agentInspectorTab === 'configuration' ? 'is-active' : ''} onClick={() => setAgentInspectorTab('configuration')}>Configuration{selectedAgentDirty && <span aria-label="unsaved changes" />}</button>
                        </div>}

                        {selected.kind === 'job' && jobDetail && <>
                            <div className={`office-map__state office-map__state--${jobDetail.status}`}><strong>{label(jobDetail.status)}</strong>{waitingLabel(jobDetail) && <span>Waiting on {waitingLabel(jobDetail)}</span>}</div>
                            <section className="office-map__story"><h3>Process execution</h3><p><strong>{jobDetail.name}</strong> · immutable v{jobDetail.processVersion} · {jobDetail.tasks?.length || 0} tasks</p>{jobDetail.tasks?.map(task => <article key={task.taskId}><span style={{ background: COLORS[task.agentId] || STATUS_COLORS[task.state], color: COLORS[task.agentId] || STATUS_COLORS[task.state] }} /><div><strong>{task.name}</strong><small>{task.agentId || 'system'} · {label(task.state)}{task.attempts?.length ? ` · ${task.attempts.length} attempt(s)` : ''}</small><p>{task.resultSummary || task.error || 'Waiting for execution.'}</p><small>{task.inputQuality ? `Input ${task.inputQuality.score}` : 'Input —'} · {task.outputQuality ? `Output ${task.outputQuality.score}` : 'Output —'}</small></div></article>)}</section>
                            {(jobDetail.error || jobDetail.tasks?.some(task => task.error)) && <div className="office-map__attention"><strong>Why this stopped</strong><p>{jobDetail.error || jobDetail.tasks.find(task => task.error)?.error}</p></div>}
                            <section className="office-map__story"><h3>Timeline</h3>{eventsForSelection.length ? eventsForSelection.map(event => <article key={event.eventId}><span style={{ background: eventColor(event.tone), color: eventColor(event.tone) }} /><div><strong>{event.from || event.agentId || 'system'} → {event.to || 'job'}</strong><small>{label(event.stage || event.type)}</small><p>{event.summary}</p></div></article>) : <p>No retained runtime events for this job.</p>}</section>
                            {!!jobDetail.agentInstances?.length && <section className="office-map__trace"><h3>Agent instances</h3>{jobDetail.agentInstances.map(instance => <article key={instance.instanceId}><header><strong>{instance.label}</strong><small>{label(instance.state)}</small></header><p>{instance.taskId}</p></article>)}</section>}
                            {!!jobArtifacts.length && <section className="office-map__trace"><h3>Artifacts</h3><div className="chat__artifacts">{jobArtifacts.map(artifact => <button type="button" key={artifact.artifactId} className="chat__artifact-link" onClick={() => openJobArtifact(artifact.artifactId)}><IconFile size={16} /><span><strong>{artifact.title || artifact.name}</strong><small>{artifact.path}</small></span></button>)}</div></section>}
                            <div className="office-map__job-controls"><button onClick={() => controlSelectedJob('pause')}>Pause</button><button onClick={() => controlSelectedJob('resume')}>Retry / resume</button><button onClick={() => controlSelectedJob('migrate')}>Migrate latest</button><button onClick={() => controlSelectedJob('restart')}>Restart v{jobDetail.processVersion}</button><button className="is-danger" onClick={() => controlSelectedJob('cancel')}>Cancel</button></div>
                            <button type="button" className="office-map__continue" onClick={() => { setSelection(null); onOpenConversation?.(jobDetail.conversationId); }}><IconMessageCircle size={16} /> Open originating chat</button>
                            {ATTENTION.has(jobDetail.status) && jobDetail.status !== 'waiting_authorization' && <button type="button" className="office-map__continue" onClick={() => continueJob(jobDetail)}><IconPlayerPlay size={16} /> Retry / resume job</button>}
                        </>}

                        {selected.kind === 'agent' && agentInspectorTab === 'activity' && <section className="office-map__story"><h3>Recent runtime activity</h3>{eventsForSelection.map(event => <article key={event.eventId}><span style={{ background: eventColor(event.tone), color: eventColor(event.tone) }} /><div><strong>{event.from || 'system'} → {event.to || 'office'}</strong><small>{label(event.stage || event.type)}</small><p>{event.summary}</p></div></article>)}{!eventsForSelection.length && <p>No recent traffic.</p>}<h3>Jobs</h3>{selectedJobs.slice(0, 10).map(job => <button type="button" className="office-map__job-link" key={job.jobId} onClick={() => openInspector(nodeMap.get(`job:${job.jobId}`))}><IconBriefcase2 size={14} /><span>{job.title}</span><small>{label(job.status)}</small></button>)}</section>}

                        {selected.kind === 'agent' && agentInspectorTab === 'configuration' && selectedAgentDraft && <AgentConfigurationForm
                            agent={selected.data}
                            draft={selectedAgentDraft}
                            dirty={selectedAgentDirty}
                            ollamaModels={ollamaModels}
                            modelOptions={platformConfig?.modelOptions || []}
                            loadingModels={loadingModels}
                            saving={savingAgent}
                            onChange={updateSelectedAgentDraft}
                            onDiscard={discardSelectedAgentDraft}
                            onRefreshModels={loadOllamaModels}
                            onSave={saveSelectedAgent}
                        />}

                        {selected.kind === 'conversation' && <section className="office-map__trace"><h3>Conversation</h3>{(conversationDetail?.messages || []).slice(-10).map((message, index) => <article key={`${message.createdAt}-${index}`}><header><strong>{message.role === 'user' ? 'Carlos' : selected.data.agentId}</strong><small>{label(message.role)}</small></header><p>{message.content}</p></article>)}{!conversationDetail?.messages?.length && <p>No transcript is loaded.</p>}<button type="button" className="office-map__continue" onClick={() => { setSelection(null); onOpenConversation?.(selected.data.conversationId); }}><IconMessageCircle size={16} /> Open conversation</button></section>}
                    </aside>}
                    {activeArtifact && <ArtifactPreview
                        artifact={activeArtifact}
                        artifacts={previewArtifacts}
                        onSelect={setActiveArtifactId}
                        onClose={() => { setActiveArtifactId(''); setPreviewArtifacts([]); }}
                    />}
                </section>

            </div>
        </div>
    );
}
