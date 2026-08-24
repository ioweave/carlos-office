import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowsMove,
  IconBriefcase2,
  IconFilter,
  IconMessageCircle,
  IconRefresh,
  IconSearch,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { useAppContext } from "../AppContext";
import api, { endpoints } from "../api";
import NoraConfig from "../components/NoraConfig";
import {
  DEFAULT_MAP_VIEW,
  buildOfficeMapData,
  clamp,
  createTopology,
  label,
  loadMapView,
  persistLayout,
  persistMapView,
  projectPosition,
  readLayout,
  rgba,
  screenDeltaToCameraPlane,
} from "../lib/officeMapModel";

export default function OfficeMapPage({ onOpenConversation, onOpenOperations }) {
  const { officeState, connected, refresh } = useAppContext();
  const [conversations, setConversations] = useState([]);
  const [layout, setLayout] = useState(() => readLayout());
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [repositionMode, setRepositionMode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [approvalAction, setApprovalAction] = useState("");
  const [inspectorPosition, setInspectorPosition] = useState({ x: 14, y: 14 });
  const [inspectorDragging, setInspectorDragging] = useState(false);
  const canvasRef = useRef(null);
  const inspectorRef = useRef(null);
  const hitAreasRef = useRef([]);
  const dragRef = useRef(null);
  const inspectorDragRef = useRef(null);
  const layoutRef = useRef(layout);
  const viewRef = useRef(loadMapView());

  const loadConversations = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await api.get(endpoints.conversations());
      setConversations(response.data || []);
    } catch (error) {
      if (!quiet) toast.error(error.response?.data?.error || "Could not load Office conversations.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    refresh();
    await loadConversations();
  }, [loadConversations, refresh]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => () => persistMapView(viewRef.current), []);

  const data = useMemo(() => buildOfficeMapData({
    nora: officeState.nora,
    activeAgents: officeState.agents || [],
    workflows: officeState.workflows || [],
    conversations,
    approvals: officeState.approvals || [],
  }), [officeState.nora, officeState.agents, officeState.workflows, officeState.approvals, conversations]);

  const topology = useMemo(() => createTopology(data, layout), [data, layout]);
  const nodeMap = useMemo(() => new Map(topology.nodes.map(node => [node.id, node])), [topology]);
  const selected = selectedId ? nodeMap.get(selectedId) || null : null;

  const visibleTopology = useMemo(() => {
    let nodes = topology.nodes;
    if (filter === "active") nodes = nodes.filter(node => node.kind === "agent" || node.active || node.attention);
    if (filter === "conversation") nodes = nodes.filter(node => node.kind === "agent" || node.kind === "conversation");
    if (filter === "workflow") nodes = nodes.filter(node => node.kind === "agent" || node.kind === "workflow" || node.kind === "instance");

    const query = searchQuery.trim().toLowerCase();
    if (query) nodes = nodes.filter(node => `${node.title} ${node.subtitle}`.toLowerCase().includes(query));
    const keep = new Set(nodes.map(node => node.id));
    return {
      nodes,
      links: topology.links.filter(link => keep.has(link.from) && keep.has(link.to)),
    };
  }, [topology, filter, searchQuery]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    if (selected.kind === "agent" || selected.kind === "instance") {
      setDetail(selected.data);
      return;
    }
    if (selected.kind === "workflow") {
      const workflow = (officeState.workflows || []).find(item => item.id === selected.data.workflowId) || null;
      const approvals = (officeState.approvals || []).filter(
        item => item.status === "pending" && item.context?.workflowId === selected.data.workflowId,
      );
      setDetail({ workflow, approvals });
      return;
    }

    void (async () => {
      try {
        setDetail((await api.get(endpoints.conversation(selected.data.conversationId))).data);
      } catch (error) {
        toast.error(error.response?.data?.error || "Could not load map details.");
      }
    })();
  }, [
    selectedId,
    selected?.kind,
    selected?.data?.status,
    selected?.data?.provider,
    selected?.data?.model,
    officeState.approvals,
    officeState.workflows,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    let frame = 0;

    const draw = now => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.floor(rect.width * ratio) || canvas.height !== Math.floor(rect.height * ratio)) {
        canvas.width = Math.max(1, Math.floor(rect.width * ratio));
        canvas.height = Math.max(1, Math.floor(rect.height * ratio));
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
      }

      context.clearRect(0, 0, rect.width, rect.height);
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--map-bg").trim() || "#07090d";
      context.fillRect(0, 0, rect.width, rect.height);

      const projected = new Map(visibleTopology.nodes.map(node => [
        node.id,
        projectPosition(layoutRef.current[node.id] || node.position, rect, viewRef.current, now, false),
      ]));

      visibleTopology.links.forEach(link => {
        const from = projected.get(link.from);
        const to = projected.get(link.to);
        if (!from || !to) return;
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.lineWidth = 1;
        context.strokeStyle = "rgba(148,163,184,0.28)";
        context.stroke();
      });

      const hits = [];
      [...visibleTopology.nodes]
        .sort((left, right) => projected.get(right.id).z - projected.get(left.id).z)
        .forEach(node => {
          const point = projected.get(node.id);
          const radius = Math.max(6, node.radius * point.scale);
          const pulse = node.active || node.attention ? 1 + Math.sin(now / 350) * 0.08 : 1;
          const drawRadius = radius * pulse;
          const chosen = node.id === selectedId;
          context.save();
          context.shadowColor = node.color;
          context.shadowBlur = chosen ? 28 : node.active || node.attention ? 18 : 8;
          context.beginPath();
          context.fillStyle = rgba(node.color, node.kind === "agent" ? 0.95 : 0.82);
          context.arc(point.x, point.y, drawRadius, 0, Math.PI * 2);
          context.fill();
          context.shadowBlur = 0;
          context.lineWidth = chosen ? 2.5 : 1;
          context.strokeStyle = chosen ? "#ffffff" : "rgba(255,255,255,0.62)";
          context.stroke();
          context.fillStyle = "rgba(248,250,252,0.96)";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.font = node.kind === "agent" ? "700 11px Inter" : "600 8px Inter";
          const glyph = node.kind === "agent" ? "N" : node.kind === "conversation" ? "••" : node.kind === "workflow" ? "◆" : "●";
          context.fillText(glyph, point.x, point.y + 0.5);
          context.textBaseline = "alphabetic";
          context.font = node.kind === "agent" ? "600 12px Inter" : "600 9px Inter";
          context.fillText(node.title, point.x, point.y + drawRadius + 15, 150);
          context.restore();
          hits.push({ node, x: point.x, y: point.y, radius: Math.max(drawRadius + 8, 14) });
        });

      hitAreasRef.current = hits.reverse();
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [visibleTopology, selectedId]);

  const pointFor = event => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const hitAt = point => hitAreasRef.current.find(hit => Math.hypot(hit.x - point.x, hit.y - point.y) <= hit.radius);

  const pointerDown = event => {
    if (event.button !== 0) return;
    const point = pointFor(event);
    const hit = hitAt(point);
    canvasRef.current.setPointerCapture?.(event.pointerId);
    if (!hit) {
      dragRef.current = { mode: "view", x: point.x, y: point.y };
      return;
    }

    setSelectedId(hit.node.id);
    if (!repositionMode) return;
    dragRef.current = {
      mode: "node",
      id: hit.node.id,
      origin: { ...(layoutRef.current[hit.node.id] || hit.node.position) },
      startX: point.x,
      startY: point.y,
    };
  };

  const pointerMove = event => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointFor(event);
    if (drag.mode === "view") {
      viewRef.current.yaw += (point.x - drag.x) * 0.006;
      viewRef.current.pitch = clamp(viewRef.current.pitch + (point.y - drag.y) * 0.004, -0.75, 0.75);
      drag.x = point.x;
      drag.y = point.y;
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const next = screenDeltaToCameraPlane(
      drag.origin,
      point.x - drag.startX,
      point.y - drag.startY,
      rect,
      viewRef.current,
    );
    layoutRef.current = {
      ...layoutRef.current,
      [drag.id]: {
        x: clamp(next.x, -6.5, 6.5),
        y: clamp(next.y, -4.8, 4.8),
        z: clamp(next.z, -6.5, 6.5),
      },
    };
  };

  const pointerUp = event => {
    if (!dragRef.current) return;
    if (dragRef.current.mode === "node") {
      const next = { ...layoutRef.current };
      setLayout(next);
      persistLayout(next);
    } else {
      persistMapView(viewRef.current);
    }
    dragRef.current = null;
    canvasRef.current.releasePointerCapture?.(event.pointerId);
  };

  const inspectorPointerDown = event => {
    if (event.button !== 0 || event.target.closest("button, input, select, textarea, a")) return;
    const shell = canvasRef.current?.parentElement;
    const inspector = inspectorRef.current;
    if (!shell || !inspector) return;

    const shellRect = shell.getBoundingClientRect();
    const inspectorRect = inspector.getBoundingClientRect();
    inspectorDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: inspectorRect.left - shellRect.left,
      originY: inspectorRect.top - shellRect.top,
    };
    setInspectorDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const inspectorPointerMove = event => {
    const drag = inspectorDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const shell = canvasRef.current?.parentElement;
    const inspector = inspectorRef.current;
    if (!shell || !inspector) return;

    const shellRect = shell.getBoundingClientRect();
    const inspectorRect = inspector.getBoundingClientRect();
    const next = {
      x: clamp(drag.originX + event.clientX - drag.startX, 8, Math.max(8, shellRect.width - inspectorRect.width - 8)),
      y: clamp(drag.originY + event.clientY - drag.startY, 8, Math.max(8, shellRect.height - inspectorRect.height - 8)),
    };
    setInspectorPosition(next);
  };

  const inspectorPointerUp = event => {
    const drag = inspectorDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    inspectorDragRef.current = null;
    setInspectorDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const resolveApproval = async (approval, decision) => {
    setApprovalAction(approval.id);
    try {
      await api.post(decision === "approve"
        ? endpoints.approvalApprove(approval.id)
        : endpoints.approvalReject(approval.id));
      refresh();
      toast.success(decision === "approve" ? "Authorization granted." : "Authorization denied.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not resolve authorization.");
    } finally {
      setApprovalAction("");
    }
  };

  const workflow = selected?.kind === "workflow" ? detail?.workflow : null;
  const approvals = selected?.kind === "workflow"
    ? (detail?.approvals || []).filter(item => item.status === "pending")
    : [];
  const offline = !connected;

  return (
    <div className="office-map">
      <header className="office-map__header">
        <div>
          <h1 className="office-map__title">Office Map</h1>
          <p className="office-map__subtitle">Nora → Conversations → Workflows → temporary Agent processes</p>
          <div className="office-map__summary">
            <span>{offline ? "Office offline" : "Office ready"}</span>
            <span>{data.workflows.length} Workflows · {data.agentInstances.length} Agent processes</span>
          </div>
        </div>
        <div className="office-map__toolbar">
          {["all", "active", "conversation", "workflow"].map(value => (
            <button key={value} type="button" className={`office-map__toolbar-button ${filter === value ? "office-map__toolbar-button--active" : ""}`} onClick={() => setFilter(value)}>
              {value === "conversation" ? "Chats" : value === "workflow" ? "Workflows" : value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
          <button type="button" className="office-map__toolbar-button" onClick={() => void load()}><IconRefresh size={16} /> Refresh</button>
        </div>
      </header>

      <div className="office-map__workspace">
        <section className="office-map__canvas-shell">
          <canvas
            ref={canvasRef}
            className="office-map__canvas"
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            onWheel={event => {
              event.preventDefault();
              viewRef.current.zoom = clamp(viewRef.current.zoom * (event.deltaY > 0 ? 0.92 : 1.08), 0.45, 2.2);
              persistMapView(viewRef.current);
            }}
            aria-label="Interactive Office Map"
          />

          <div className="office-map__canvas-toolbar" aria-label="Map controls">
            <button type="button" className={`office-map__canvas-button ${searchOpen ? "office-map__canvas-button--active" : ""}`} onClick={() => setSearchOpen(value => !value)} aria-label="Search map"><IconSearch size={17} /></button>
            <button type="button" className="office-map__canvas-button" onClick={() => setFilter(current => ({ all: "active", active: "conversation", conversation: "workflow", workflow: "all" }[current]))} aria-label="Filter map"><IconFilter size={17} /></button>
            <button type="button" className={`office-map__canvas-button ${repositionMode ? "office-map__canvas-button--active" : ""}`} onClick={() => setRepositionMode(value => !value)} aria-label="Reposition nodes"><IconArrowsMove size={17} /></button>
            <button type="button" className="office-map__canvas-button" onClick={() => { viewRef.current.zoom = clamp(viewRef.current.zoom * 1.12, 0.45, 2.2); }} aria-label="Zoom in"><IconZoomIn size={17} /></button>
            <button type="button" className="office-map__canvas-button" onClick={() => { viewRef.current.zoom = clamp(viewRef.current.zoom / 1.12, 0.45, 2.2); }} aria-label="Zoom out"><IconZoomOut size={17} /></button>
            <button type="button" className="office-map__canvas-button" onClick={() => { viewRef.current = { ...DEFAULT_MAP_VIEW }; layoutRef.current = {}; setLayout({}); persistLayout({}); persistMapView(viewRef.current); }} aria-label="Reset map"><IconRefresh size={17} /></button>
          </div>

          {searchOpen && (
            <label className="office-map__search">
              <IconSearch size={15} />
              <input className="office-map__search-input" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search chats, Workflows, or Agent processes" />
              <button type="button" className="office-map__search-button" onClick={() => { setSearchQuery(""); setSearchOpen(false); }} aria-label="Close search"><IconX size={14} /></button>
            </label>
          )}

          <div className="office-map__help">Drag space to rotate · Drag nodes to reposition · Scroll to zoom</div>
          {loading && <div className="office-map__loading office-map__loading--overlay">Loading conversations…</div>}
          {offline && !loading && <div className="office-map__loading office-map__loading--overlay">Office backend unavailable.</div>}

          {selected && (
            <aside
              ref={inspectorRef}
              className={`office-map__inspector office-map__inspector--${selected.kind}`}
              style={{
                "--office-map-inspector-left": `${inspectorPosition.x}px`,
                "--office-map-inspector-top": `${inspectorPosition.y}px`,
              }}
            >
              <header
                className="office-map__inspector-header"
                onPointerDown={inspectorPointerDown}
                onPointerMove={inspectorPointerMove}
                onPointerUp={inspectorPointerUp}
                onPointerCancel={inspectorPointerUp}
                style={{ cursor: inspectorDragging ? "grabbing" : "grab", touchAction: "none" }}
              >
                <div>
                  <small className="office-map__inspector-eyebrow">{selected.kind === "agent" ? "Chief of Staff" : selected.kind}</small>
                  <strong className="office-map__inspector-title">{selected.title}</strong>
                  <span className="office-map__inspector-meta">{selected.subtitle}</span>
                </div>
                <button type="button" className="office-map__inspector-close" onClick={() => setSelectedId("")} aria-label="Close inspector"><IconX size={17} /></button>
              </header>

              {selected.kind === "agent" && (
                <>
                  <section className="office-map__trace">
                    <div className="definition-list">
                      <div><span>Status</span><strong>{label(detail?.status)}</strong></div>
                      <div><span>PID</span><strong>{detail?.pid || "—"}</strong></div>
                      <div><span>Model</span><strong>{detail?.provider && detail?.model ? `${detail.provider} · ${detail.model}` : "—"}</strong></div>
                    </div>
                  </section>
                  <NoraConfig nora={officeState.nora} onChanged={refresh} />
                </>
              )}

              {selected.kind === "conversation" && (
                <section className="office-map__trace">
                  {(detail?.messages || []).slice(-10).map(message => (
                    <article key={message.id} className="office-map__trace-item">
                      <header className="office-map__trace-item-header"><strong className="office-map__trace-title">{message.actor}</strong></header>
                      <p className="office-map__trace-copy">{message.content}</p>
                    </article>
                  ))}
                  <button type="button" className="office-map__continue" onClick={() => onOpenConversation?.(selected.data.conversationId)}><IconMessageCircle size={16} /> Open conversation</button>
                </section>
              )}

              {selected.kind === "workflow" && workflow && (
                <section className="office-map__trace">
                  <div className="definition-list">
                    <div><span>Status</span><strong>{workflow.status}</strong></div>
                    <div><span>Process</span><strong>{workflow.process || "Ad hoc"}</strong></div>
                    <div><span>Tasks</span><strong>{Object.keys(workflow.tasks || {}).length}</strong></div>
                  </div>
                  {approvals.map(approval => (
                    <article key={approval.id} className="office-map__approval">
                      <div><strong className="office-map__approval-title">{approval.action}</strong><small className="office-map__approval-meta">{approval.actor}</small></div>
                      <div className="office-map__approval-actions">
                        <button type="button" className="primary-button office-map__approval-action" disabled={approvalAction === approval.id} onClick={() => resolveApproval(approval, "approve")}>Approve</button>
                        <button type="button" className="secondary-button office-map__approval-action" disabled={approvalAction === approval.id} onClick={() => resolveApproval(approval, "reject")}>Reject</button>
                      </div>
                    </article>
                  ))}
                  <button type="button" className="office-map__continue" onClick={() => onOpenOperations?.(selected.data.workflowId)}><IconBriefcase2 size={16} /> Open in Operations</button>
                </section>
              )}

              {selected.kind === "instance" && (
                <section className="office-map__trace">
                  <div className="definition-list">
                    <div><span>PID</span><strong>{detail?.pid || "—"}</strong></div>
                    <div><span>Task</span><strong>{detail?.taskId || "—"}</strong></div>
                    <div><span>Model</span><strong>{detail?.provider && detail?.model ? `${detail.provider} · ${detail.model}` : "—"}</strong></div>
                    <div><span>Tools</span><strong>{detail?.tools?.join(", ") || "—"}</strong></div>
                    <div><span>Skills</span><strong>{detail?.skills?.join(", ") || "—"}</strong></div>
                  </div>
                  {detail?.workflowId && <button type="button" className="office-map__continue" onClick={() => onOpenOperations?.(detail.workflowId)}><IconBriefcase2 size={16} /> Open Workflow</button>}
                </section>
              )}
            </aside>
          )}
        </section>
      </div>
    </div>
  );
}
