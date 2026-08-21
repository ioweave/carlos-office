import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowsMove,
  IconBriefcase2,
  IconFilter,
  IconMessageCircle,
  IconPlayerPause,
  IconRefresh,
  IconRotateClockwise,
  IconSearch,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { toast } from "sonner";
import api, { endpoints } from "../api";
import AgentConfigurationForm, { editableAgentConfig, isAgentDraftDirty } from "../components/AgentConfigurationForm";
import {
  DEFAULT_MAP_VIEW,
  EMPTY_MAP_DATA,
  WORKFLOW_SPHERE_RADIUS,
  PACKET_TTL_MS,
  age,
  buildOfficeMapData,
  clamp,
  constrainWorkflowPosition,
  createTopology,
  eventColor,
  hash,
  label,
  loadMapView,
  persistLayout,
  persistMapView,
  projectPosition,
  readLayout,
  rgba,
  screenDeltaToCameraPlane,
} from "../lib/officeMapModel";

const INSPECTOR_WIDTH = 420;
const INSPECTOR_HEIGHT = 580;
const AGENT_DRAFTS_KEY = "carlos-office-agent-config-drafts-v1";

const readAgentDrafts = () => {
  try {
    const value = JSON.parse(sessionStorage.getItem(AGENT_DRAFTS_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    console.error("[office-map] Could not restore unsaved agent configuration.", error);
    return {};
  }
};

export default function OfficeMapPage({ onOpenConversation, onOpenOperations, onAgentSaved }) {
  const [data, setData] = useState(EMPTY_MAP_DATA);
  const [layout, setLayout] = useState(() => readLayout());
  const [selection, setSelection] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [hovered, setHovered] = useState(null);
  const [filter, setFilter] = useState("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [repositionMode, setRepositionMode] = useState(true);
  const [animationPaused, setAnimationPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState("");
  const [agentInspectorTab, setAgentInspectorTab] = useState("activity");
  const [agentDrafts, setAgentDrafts] = useState(() => readAgentDrafts());
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);
  const [approvalAction, setApprovalAction] = useState("");
  const canvasRef = useRef(null);
  const shellRef = useRef(null);
  const inspectorRef = useRef(null);
  const searchInputRef = useRef(null);
  const inspectorTriggerRef = useRef(null);
  const frameRef = useRef(null);
  const hitAreasRef = useRef([]);
  const interactionRef = useRef(null);
  const inspectorDragRef = useRef(null);
  const layoutRef = useRef(layout);
  const viewRef = useRef(loadMapView());
  const reducedMotionRef = useRef(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [agentsRes, activeRes, workflowsRes, conversationsRes, approvalsRes] = await Promise.all([
        api.get(endpoints.agents()),
        api.get(endpoints.agentsActive()),
        api.get(endpoints.workflows()),
        api.get(endpoints.conversations()),
        api.get(endpoints.approvals()),
      ]);
      setData(buildOfficeMapData({
        agents: agentsRes.data || [],
        activeAgents: activeRes.data || [],
        workflows: workflowsRes.data || [],
        conversations: conversationsRes.data || [],
        approvals: approvalsRes.data || [],
      }));
      setOffline(false);
    } catch (error) {
      if (!quiet) toast.error(error.response?.data?.error || "Could not load the Office Map.");
      setOffline(true);
      setData(EMPTY_MAP_DATA);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
    load();
    const onFocus = () => load({ quiet: true });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void load({ quiet: true }); }, 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => () => persistMapView(viewRef.current), []);
  useEffect(() => {
    try { sessionStorage.setItem(AGENT_DRAFTS_KEY, JSON.stringify(agentDrafts)); } catch { /* sessionStorage may be unavailable in private mode */ }
  }, [agentDrafts]);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const response = await api.get(endpoints.models());
      setModels(response.data || []);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not list models.");
    } finally {
      setLoadingModels(false);
    }
  }, []);
  const topology = useMemo(() => createTopology(data, layout), [data, layout]);
  const nodeMap = useMemo(() => new Map(topology.nodes.map(node => [node.id, node])), [topology]);
  const selected = selection ? nodeMap.get(selection.id) || null : null;
  const selectedAgentDraft = selected?.kind === "agent"
    ? agentDrafts[selected.agentId] || editableAgentConfig(selected.data)
    : null;
  const selectedAgentDirty = selected?.kind === "agent"
    ? isAgentDraftDirty(selectedAgentDraft, selected.data)
    : false;
  useEffect(() => {
    if (selected?.kind === "agent" && agentInspectorTab === "configuration" && !models.length && !loadingModels) loadModels();
  }, [selected?.kind, agentInspectorTab, models.length, loadingModels, loadModels]);
  const recentEvents = useMemo(() => (data.events || []).filter(event => event.visibility !== "detail" && age(event.createdAt) < PACKET_TTL_MS), [data.events]);
  const activeAgents = useMemo(() => new Set([
    ...(data.runner?.active || []).flatMap(item => item.agentIds?.length ? item.agentIds : [item.agentId]),
    ...(data.activity?.active || []).map(item => item.agentId),
    ...recentEvents.filter(event => age(event.createdAt) < 12_000).flatMap(event => [event.from, event.to]).filter(id => id),
  ]), [data.runner?.active, data.activity?.active, recentEvents]);

  const visibleTopology = useMemo(() => {
    let filtered;
    if (filter === "all") filtered = topology;
    if (filter === "active") {
      const keep = new Set(topology.nodes.filter(node => node.kind === "agent" || node.active || node.attention).map(node => node.id));
      filtered = { nodes: topology.nodes.filter(node => keep.has(node.id)), links: topology.links.filter(link => keep.has(link.from) && keep.has(link.to)) };
    }
    if (!filtered) {
      const keep = new Set(topology.nodes.filter(node => node.kind === "agent" || node.kind === filter).map(node => node.id));
      filtered = { nodes: topology.nodes.filter(node => keep.has(node.id)), links: topology.links.filter(link => keep.has(link.from) && keep.has(link.to)) };
    }
    const query = searchQuery.trim().toLowerCase();
    if (!query) return filtered;
    const keep = new Set(filtered.nodes.filter(node => `${node.title} ${node.subtitle} ${node.kind}`.toLowerCase().includes(query)).map(node => node.id));
    return { nodes: filtered.nodes.filter(node => keep.has(node.id)), links: filtered.links.filter(link => keep.has(link.from) && keep.has(link.to)) };
  }, [topology, filter, searchQuery]);

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
    if (node.kind === "agent" && selection?.id !== node.id) setAgentInspectorTab("activity");
    if (trigger?.focus) inspectorTriggerRef.current = trigger;
    setSelection({ id: node.id, ...inspectorPosition(point) });
    setDetail(node.data);
  }, [inspectorPosition, selection?.id]);

  useEffect(() => {
    if (!selection) return undefined;
    const onKeyDown = event => { if (event.key === "Escape") closeInspector(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection, closeInspector]);

  const loadDetail = useCallback(async node => {
    if (!node || node.kind === "agent") { setDetail(node?.data || null); return; }
    setDetailLoading(true);
    try {
      if (node.kind === "workflow") {
        const [workflowRes, inspectRes] = await Promise.all([
          api.get(endpoints.workflow(node.data.workflowId)),
          api.get(endpoints.workflowInspect(node.data.workflowId)),
        ]);
        setDetail({ workflow: workflowRes.data, approvals: inspectRes.data?.approvals || [] });
      } else {
        setDetail((await api.get(endpoints.conversation(node.data.conversationId))).data);
      }
    } catch (error) {
      console.error("[office-map] Could not load selected item details.", error);
      setDetail(node.data);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selected) { setDetail(null); return undefined; }
    loadDetail(selected);
    return undefined;
    // Re-fetch only when identity/runtime status changes — `selected` also carries
    // inspector x/y position from dragging, which must not trigger a re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
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
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--map-bg").trim() || "#07090d";
      context.fillRect(0, 0, rect.width, rect.height);
      stars.forEach(star => {
        context.beginPath(); context.fillStyle = `rgba(203,213,225,${star.a})`;
        context.arc(star.x, star.y, star.r, 0, Math.PI * 2); context.fill();
      });

      const sphereCenter = projectPosition({ x: 0, y: 0, z: 0 }, rect, viewRef.current, now, true);
      const sphereRadius = WORKFLOW_SPHERE_RADIUS * sphereCenter.scale
        / Math.sqrt(Math.max(0.5, 1 - (WORKFLOW_SPHERE_RADIUS * 0.11) ** 2));
      context.save();
      const sphereFill = context.createRadialGradient(sphereCenter.x - sphereRadius * 0.3, sphereCenter.y - sphereRadius * 0.35, sphereRadius * 0.1, sphereCenter.x, sphereCenter.y, sphereRadius);
      sphereFill.addColorStop(0, "rgba(103,232,249,0.035)"); sphereFill.addColorStop(0.72, "rgba(103,232,249,0.012)"); sphereFill.addColorStop(1, "rgba(103,232,249,0.06)");
      context.beginPath();
      context.arc(sphereCenter.x, sphereCenter.y, sphereRadius, 0, Math.PI * 2);
      context.fillStyle = sphereFill; context.fill();
      context.shadowColor = "rgba(103,232,249,0.3)"; context.shadowBlur = 10;
      context.lineWidth = 1.1;
      context.strokeStyle = "rgba(103,232,249,0.34)";
      context.stroke();
      context.restore();

      const projected = new Map();
      visibleTopology.nodes.forEach(node => {
        const candidate = layoutRef.current[node.id] || node.position;
        const position = node.kind === "workflow" ? constrainWorkflowPosition(candidate, node.radius) : candidate;
        projected.set(node.id, projectPosition(position, rect, viewRef.current, now, reducedMotionRef.current));
      });

      visibleTopology.links.forEach(link => {
        const from = projected.get(link.from); const to = projected.get(link.to);
        if (!from || !to) return;
        context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y);
        context.lineWidth = 0.7; context.strokeStyle = "rgba(148,163,184,0.15)"; context.stroke();
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
        const active = node.kind === "agent" ? activeAgents.has(node.agentId) : node.active;
        const pulse = (active || node.attention) && !reducedMotionRef.current && !animationPaused ? 1 + Math.sin(now / (node.attention ? 250 : 380)) * 0.1 : 1;
        const drawRadius = radius * pulse;
        const isSelected = selection?.id === node.id;
        const isHovered = hovered?.id === node.id;
        const isDragged = draggingNodeId === node.id;
        context.save(); context.shadowColor = node.color;
        context.shadowBlur = isSelected || isDragged ? 32 : node.kind === "agent" ? 22 : node.attention ? 24 : active ? 18 : 8;
        context.beginPath(); context.fillStyle = rgba(node.color, node.kind === "agent" ? 0.92 : 0.82);
        context.arc(point.x, point.y, drawRadius, 0, Math.PI * 2); context.fill();
        context.shadowBlur = 0; context.beginPath();
        context.lineWidth = isSelected || isHovered || isDragged ? 2.5 : node.kind === "agent" ? 1.5 : 0.9;
        context.strokeStyle = isSelected || isHovered || isDragged ? "#ffffff" : "rgba(255,255,255,0.65)";
        context.arc(point.x, point.y, drawRadius, 0, Math.PI * 2); context.stroke();
        const glyph = node.kind === "workflow" ? "◆" : node.kind === "conversation" ? "••" : node.title?.slice(0, 1).toUpperCase();
        context.textAlign = "center"; context.textBaseline = "middle"; context.fillStyle = "rgba(248,250,252,0.94)";
        context.font = `${node.kind === "agent" ? 700 : 600} ${node.kind === "agent" ? 11 : 8}px Inter, ui-sans-serif, system-ui`;
        context.fillText(glyph || "•", point.x, point.y + 0.5, Math.max(10, drawRadius * 1.4));
        context.textBaseline = "alphabetic";
        if (node.kind === "agent") {
          context.fillStyle = "rgba(245,247,250,0.96)";
          context.font = "600 12px Inter, ui-sans-serif, system-ui"; context.fillText(node.title, point.x, point.y + drawRadius + 18);
          context.fillStyle = "rgba(148,163,184,0.86)"; context.font = "500 9px Inter, ui-sans-serif, system-ui";
          context.fillText(node.subtitle || "", point.x, point.y + drawRadius + 31, 220);
        } else {
          context.fillStyle = "rgba(226,232,240,0.92)";
          context.font = `600 ${node.kind === "instance" ? 8 : 9}px Inter, ui-sans-serif, system-ui`;
          context.fillText(node.title || node.kind, point.x, point.y + drawRadius + 13, node.kind === "workflow" ? 150 : 120);
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
      mode: repositionMode ? "node" : "select", nodeId: hit.node.id, nodeKind: hit.node.kind, nodeRadius: hit.node.radius,
      origin: { ...(layoutRef.current[hit.node.id] || hit.node.position) },
      startX: point.x, startY: point.y, lastX: point.x, lastY: point.y, moved: false,
    } : { mode: "view", startX: point.x, startY: point.y, lastX: point.x, lastY: point.y, moved: false };
    if (hit && repositionMode) setDraggingNodeId(hit.node.id);
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
    if (interaction.mode === "view") {
      const dx = point.x - interaction.lastX;
      const dy = point.y - interaction.lastY;
      viewRef.current.yaw += dx * 0.006;
      viewRef.current.pitch = clamp(viewRef.current.pitch + dy * 0.004, -0.75, 0.75);
    } else if (interaction.mode === "node" && interaction.moved) {
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
        [interaction.nodeId]: interaction.nodeKind === "workflow"
          ? constrainWorkflowPosition(candidate, interaction.nodeRadius)
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
    if (interaction.mode === "node") {
      setDraggingNodeId("");
      if (interaction.moved) {
        const next = { ...layoutRef.current };
        setLayout(next);
        persistLayout(next);
      } else {
        const hit = hitAt(point) || { node: nodeMap.get(interaction.nodeId) };
        if (hit.node) openInspector(hit.node, point, canvasRef.current);
      }
    } else if (interaction.mode === "select") {
      const hit = hitAt(point) || { node: nodeMap.get(interaction.nodeId) };
      if (hit.node) openInspector(hit.node, point, canvasRef.current);
    } else if (interaction.mode === "view") {
      persistMapView(viewRef.current);
    }
  };

  const wheel = event => {
    event.preventDefault();
    viewRef.current.zoom = clamp(viewRef.current.zoom * (event.deltaY > 0 ? 0.92 : 1.08), 0.45, 2.2);
    persistMapView(viewRef.current);
  };
  const resetView = () => { viewRef.current = { ...DEFAULT_MAP_VIEW }; persistMapView(viewRef.current); };
  const resetLayout = () => {
    layoutRef.current = {};
    setLayout({});
    persistLayout({});
    toast.success("Office Map node layout reset.");
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

  const updateSelectedAgentDraft = next => {
    if (selected?.kind !== "agent") return;
    setAgentDrafts(current => {
      const nextDrafts = { ...current };
      if (isAgentDraftDirty(next, selected.data)) nextDrafts[selected.agentId] = next;
      else delete nextDrafts[selected.agentId];
      return nextDrafts;
    });
  };
  const saveSelectedAgent = async () => {
    if (selected?.kind !== "agent" || !selectedAgentDraft || !selectedAgentDirty) return;
    setSavingAgent(true);
    try {
      await api.patch(endpoints.agentModel(selected.data.name), { provider: selectedAgentDraft.provider, model: selectedAgentDraft.model });
      const updated = { ...selected.data, provider: selectedAgentDraft.provider, model: selectedAgentDraft.model };
      setData(current => ({ ...current, agents: (current.agents || []).map(agent => agent.agentId === selected.agentId ? updated : agent) }));
      setAgentDrafts(current => { const next = { ...current }; delete next[selected.agentId]; return next; });
      onAgentSaved?.(updated);
      toast.success(`${selected.title} model updated.`);
    } catch (error) {
      toast.error(error.response?.data?.error || error.message);
    } finally {
      setSavingAgent(false);
    }
  };

  const resolveApproval = async (approvalId, decision) => {
    setApprovalAction(`${approvalId}:${decision}`);
    try {
      const endpoint = decision === "approved" ? endpoints.approvalApprove(approvalId) : endpoints.approvalReject(approvalId);
      await api.post(endpoint);
      toast.success(decision === "approved" ? "Authorization granted." : "Authorization denied.");
      await load({ quiet: true });
      if (selected?.kind === "workflow") await loadDetail(selected);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not resolve authorization.");
    } finally {
      setApprovalAction("");
    }
  };

  const eventsForSelection = selected?.kind === "agent"
    ? (data.events || []).filter(event => event.from === selected.agentId || event.to === selected.agentId).slice(-24).reverse()
    : [];
  const selectedWorkflows = selected?.kind === "agent"
    ? (data.workflows || []).filter(workflow => (workflow.tasks || []).some(task => task.agentId === selected.agentId))
    : [];
  const workflowDetail = selected?.kind === "workflow" ? detail?.workflow || selected.data : null;
  const workflowApprovals = (selected?.kind === "workflow" ? (detail?.approvals || []) : []).filter(approval => approval.status === "pending");
  const conversationDetail = selected?.kind === "conversation" ? detail : null;

  return (
    <div className="office-map">
      <header className="office-map__header">
        <div><h1 className="office-map__title">Office Map</h1><p className="office-map__subtitle">Live operating topology</p><div className="office-map__summary"><span>{offline ? "Office offline" : "Office ready"}</span><span>{(data.workflows || []).length} Workflows · {(data.agentInstances || []).length} Agent Instances</span></div></div>
        <div className="office-map__toolbar">
          {["all", "active", "conversation", "workflow"].map(value => <button type="button" key={value} className={`office-map__toolbar-button ${filter === value ? "office-map__toolbar-button--active" : ""}`} onClick={() => setFilter(value)}>{value === "conversation" ? "Chats" : value === "workflow" ? "Workflows" : value[0].toUpperCase() + value.slice(1)}</button>)}
          <button type="button" className="office-map__toolbar-button" onClick={() => load()}><IconRefresh size={16} /> Refresh</button>
        </div>
      </header>

      <div className="office-map__workspace">
        <section className="office-map__canvas-shell" ref={shellRef}>
          <canvas
            ref={canvasRef}
            className={`office-map__canvas ${draggingNodeId ? "office-map__canvas--dragging" : ""}`}
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
            <button type="button" className={`office-map__canvas-button ${searchOpen ? "office-map__canvas-button--active" : ""}`} onClick={() => { setSearchOpen(value => !value); requestAnimationFrame(() => searchInputRef.current?.focus()); }} aria-label="Search map"><IconSearch size={17} /></button>
            <button type="button" className="office-map__canvas-button" onClick={() => setFilter(current => ({ all: "active", active: "conversation", conversation: "workflow", workflow: "all" }[current] || "all"))} aria-label={`Filter map: ${filter}`}><IconFilter size={17} /></button>
            <button type="button" className="office-map__canvas-button" onClick={() => { viewRef.current.yaw += Math.PI / 8; persistMapView(viewRef.current); }} aria-label="Rotate map"><IconRotateClockwise size={17} /></button>
            <button type="button" className={`office-map__canvas-button ${repositionMode ? "office-map__canvas-button--active" : ""}`} onClick={() => setRepositionMode(value => !value)} aria-label="Reposition nodes"><IconArrowsMove size={17} /></button>
            <button type="button" className="office-map__canvas-button" onClick={() => { viewRef.current.zoom = clamp(viewRef.current.zoom * 1.12, 0.45, 2.2); persistMapView(viewRef.current); }} aria-label="Zoom in"><IconZoomIn size={17} /></button>
            <button type="button" className="office-map__canvas-button" onClick={() => { viewRef.current.zoom = clamp(viewRef.current.zoom / 1.12, 0.45, 2.2); persistMapView(viewRef.current); }} aria-label="Zoom out"><IconZoomOut size={17} /></button>
            <button type="button" className="office-map__canvas-button" onClick={() => { resetView(); resetLayout(); }} aria-label="Reset map"><IconRefresh size={17} /></button>
            <button type="button" className={`office-map__canvas-button ${animationPaused ? "office-map__canvas-button--active" : ""}`} onClick={() => setAnimationPaused(value => !value)} aria-label={animationPaused ? "Resume packet animation" : "Pause packet animation"}><IconPlayerPause size={17} /></button>
          </div>
          {searchOpen && <label className="office-map__search"><IconSearch size={15} /><input className="office-map__search-input" ref={searchInputRef} value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search agents, workflows, or conversations" /><button type="button" className="office-map__search-button" onClick={() => { setSearchQuery(""); setSearchOpen(false); }} aria-label="Close search"><IconX size={14} /></button></label>}
          <div className="office-map__help">Drag space to rotate · Drag node to reposition · Scroll to zoom · Double-click node to reset</div>
          <div className="office-map__legend"><strong className="office-map__legend-title">Legend</strong><span className="office-map__legend-item"><i className="office-map__legend-mark office-map__legend-mark--agent" /> Permanent agent</span><span className="office-map__legend-item"><i className="office-map__legend-mark office-map__legend-mark--instance" /> Agent instance</span><span className="office-map__legend-item"><i className="office-map__legend-mark office-map__legend-mark--conversation" /> Conversation</span><span className="office-map__legend-item"><i className="office-map__legend-mark office-map__legend-mark--workflow" /> Workflow</span><span className="office-map__legend-item"><i className="office-map__legend-mark office-map__legend-mark--live" /> Runtime packet</span><span className="office-map__legend-item"><i className="office-map__legend-mark office-map__legend-mark--awaiting" /> Awaiting authorization</span><span className="office-map__legend-item"><i className="office-map__legend-mark office-map__legend-mark--failed" /> Failed / blocked</span></div>
          {hovered && !selection && <div className="office-map__tooltip" style={{ left: hovered.screenX + 16, top: hovered.screenY + 16 }}><strong className="office-map__tooltip-title">{hovered.title}</strong><span className="office-map__tooltip-meta">{hovered.subtitle}</span></div>}
          {loading && <div className="office-map__loading office-map__loading--overlay">Refreshing topology…</div>}
          {offline && !loading && <div className="office-map__loading office-map__loading--overlay">Office backend unavailable — showing empty topology.</div>}

          {selected && selection && (
            <aside ref={inspectorRef} className={`office-map__inspector office-map__inspector--${selected.kind}`} style={{ "--office-map-inspector-left": `${selection.x}px`, "--office-map-inspector-top": `${selection.y}px` }}>
              <header className="office-map__inspector-header" onPointerDown={startInspectorDrag}>
                <div><small className="office-map__inspector-eyebrow">{selected.kind}</small><strong className="office-map__inspector-title">{selected.title}</strong><span className="office-map__inspector-meta">{selected.subtitle}</span></div>
                <button type="button" className="office-map__inspector-close" onPointerDown={event => event.stopPropagation()} onClick={closeInspector} aria-label="Close inspector"><IconX size={17} /></button>
              </header>
              {detailLoading && <div className="office-map__inspector-loading">Refreshing live details…</div>}

              {selected.kind === "agent" && <div className="office-map__inspector-tabs" role="tablist" aria-label={`${selected.title} inspector`}>
                <button type="button" role="tab" aria-selected={agentInspectorTab === "activity"} className={`office-map__inspector-tab ${agentInspectorTab === "activity" ? "office-map__inspector-tab--active" : ""}`} onClick={() => setAgentInspectorTab("activity")}>Activity</button>
                <button type="button" role="tab" aria-selected={agentInspectorTab === "configuration"} className={`office-map__inspector-tab ${agentInspectorTab === "configuration" ? "office-map__inspector-tab--active" : ""}`} onClick={() => setAgentInspectorTab("configuration")}>Configuration{selectedAgentDirty && <span className="office-map__inspector-tab-dot" aria-label="unsaved changes" />}</button>
              </div>}

              {selected.kind === "agent" && agentInspectorTab === "activity" && <section className="office-map__story">
                <h3 className="office-map__story-heading">Recent runtime activity</h3>
                {eventsForSelection.map(event => <article key={event.eventId} className="office-map__story-item"><span className="office-map__story-dot" style={{ background: eventColor(event.tone), color: eventColor(event.tone) }} /><div><strong className="office-map__story-title">{event.from || "system"} → {event.to || "office"}</strong><small className="office-map__story-meta">{label(event.stage || event.type)}</small><p className="office-map__story-copy">{event.summary}</p></div></article>)}
                {!eventsForSelection.length && <p className="office-map__story-copy">No recent traffic.</p>}
                <h3 className="office-map__story-heading">Workflows</h3>
                {selectedWorkflows.slice(0, 10).map(workflow => <button type="button" className="office-map__workflow-link" key={workflow.workflowId} onClick={() => openInspector(nodeMap.get(`workflow:${workflow.workflowId}`))}><IconBriefcase2 size={14} /><span className="office-map__workflow-link-label">{workflow.title}</span><small className="office-map__workflow-link-meta">{label(workflow.status)}</small></button>)}
                {!selectedWorkflows.length && <p className="office-map__story-copy">No active workflows.</p>}
              </section>}

              {selected.kind === "agent" && agentInspectorTab === "configuration" && selectedAgentDraft && <AgentConfigurationForm
                agent={selected.data}
                draft={selectedAgentDraft}
                models={models}
                loadingModels={loadingModels}
                saving={savingAgent}
                onChange={updateSelectedAgentDraft}
                onRefreshModels={loadModels}
                onSave={saveSelectedAgent}
              />}

              {selected.kind === "workflow" && workflowDetail && <section className="office-map__trace">
                <h3 className="office-map__trace-heading">Workflow</h3>
                <p className="office-map__workflow-status"><strong className="office-map__workflow-status-title">{label(workflowDetail.status)}</strong>{workflowDetail.process ? <small className="office-map__workflow-status-meta">{workflowDetail.process}</small> : null}</p>
                <h3 className="office-map__trace-heading">Tasks</h3>
                {Object.values(workflowDetail.tasks || {}).map(task => <article key={task.id} className="office-map__task"><header className="office-map__task-header"><strong className="office-map__task-title">{task.objective || task.id}</strong><small className="office-map__task-meta">{label(task.status)}</small></header>{task.agent && <p className="office-map__task-agent">Agent: {task.agent}</p>}</article>)}
                {!Object.keys(workflowDetail.tasks || {}).length && <p className="office-map__trace-copy">No tasks.</p>}
                <h3 className="office-map__trace-heading">Authorizations</h3>
                {workflowApprovals.map(approval => <article key={approval.id} className="office-map__approval"><div><strong className="office-map__approval-title">{approval.action}</strong><small className="office-map__approval-meta">{approval.actor}</small></div><div className="office-map__approval-actions"><button type="button" className="primary-button office-map__approval-action" disabled={approvalAction === `${approval.id}:approved`} onClick={() => resolveApproval(approval.id, "approved")}>Approve</button><button type="button" className="secondary-button office-map__approval-action" disabled={approvalAction === `${approval.id}:rejected`} onClick={() => resolveApproval(approval.id, "rejected")}>Reject</button></div></article>)}
                {!workflowApprovals.length && <p className="office-map__trace-copy">No pending authorizations.</p>}
                <button type="button" className="office-map__continue" onClick={() => { const workflowId = selected.data.workflowId; setSelection(null); onOpenOperations?.(workflowId); }}><IconBriefcase2 size={16} /> Open in Operations</button>
              </section>}

              {selected.kind === "conversation" && <section className="office-map__trace">
                <h3 className="office-map__trace-heading">Conversation</h3>
                {(conversationDetail?.messages || []).slice(-10).map((message, index) => <article key={`${message.at || message.id || index}-${index}`} className="office-map__trace-item"><header className="office-map__trace-item-header"><strong className="office-map__trace-title">{String(message.actor || "").toLowerCase() === "carlos" || message.role === "user" ? "Carlos" : selected.data.agentId}</strong><small className="office-map__trace-meta">{label(message.actor || message.role)}</small></header><p className="office-map__trace-copy">{message.content}</p></article>)}
                {!conversationDetail?.messages?.length && <p className="office-map__trace-copy">No transcript is loaded.</p>}
                <button type="button" className="office-map__continue" onClick={() => { setSelection(null); onOpenConversation?.(selected.data.conversationId); }}><IconMessageCircle size={16} /> Open conversation</button>
              </section>}
            </aside>
          )}
        </section>

      </div>
    </div>
  );
}