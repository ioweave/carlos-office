import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowsHorizontal,
  IconArrowsVertical,
  IconCircle,
  IconFlag,
  IconFocus2,
  IconPlayerPlay,
  IconSparkles,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";

import { useAppContext } from "../AppContext";
import api, { endpoints } from "../api";

const NODE_WIDTH = 108;
const NODE_HEIGHT = 68;
const X_GAP = 150;
const Y_GAP = 92;
const PADDING = 90;
const GROUP_MIN_WIDTH = 190;
const GROUP_MIN_HEIGHT = 120;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.2;
const EDGE_OFFSET = 30;
const EDGE_BACKTRACK_OFFSET = 90;
const EDGE_RADIUS = 9;
const FIT_PADDING = 56;

const humanizeId = id => String(id || "")
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\b\w/g, character => character.toUpperCase());

const nodeLabel = (id, task) => task?.name?.trim() || humanizeId(id) || id;

const nodeTypeIcon = type => {
  if (type === "start") return IconPlayerPlay;
  if (type === "end") return IconFlag;
  return IconCircle;
};

const nodeSubtitle = task => {
  if (task?.tools?.length) return task.tools.join(", ");
  if (task?.skills?.length) return task.skills.join(", ");
  if (task?.provider && task?.model) return `${task.provider} · ${task.model}`;
  return task?.type || "Task";
};

const validPosition = value => value && Number.isFinite(value.x) && Number.isFinite(value.y);
const validGroup = group => (
  group
  && typeof group.id === "string"
  && Number.isFinite(Number(group.x))
  && Number.isFinite(Number(group.y))
  && Number.isFinite(Number(group.width))
  && Number.isFinite(Number(group.height))
);
const clampZoom = value => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
const edgeKey = (from, to) => JSON.stringify([from, to]);

const cloneEdgeRoutes = value => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, route] of Object.entries(value)) {
    if (!route || typeof route !== "object" || Array.isArray(route)) continue;
    const dx = Number(route.dx ?? 0);
    const dy = Number(route.dy ?? 0);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
    result[key] = { dx: Math.round(dx), dy: Math.round(dy) };
  }
  return result;
};

const autoLayout = (tasks, edges, start, direction = "horizontal") => {
  const ids = Object.keys(tasks || {});
  if (!ids.length) return {};

  const incoming = new Map(ids.map(id => [id, 0]));
  const outgoing = new Map(ids.map(id => [id, []]));
  for (const [from, to] of edges || []) {
    if (!incoming.has(to) || !outgoing.has(from)) continue;
    incoming.set(to, incoming.get(to) + 1);
    outgoing.get(from).push(to);
  }

  const level = new Map(ids.map(id => [id, 0]));
  const queue = [];
  if (start && incoming.has(start)) queue.push(start);
  for (const id of ids) if (id !== start && incoming.get(id) === 0) queue.push(id);

  const remaining = new Map(incoming);
  while (queue.length) {
    const id = queue.shift();
    for (const next of outgoing.get(id) || []) {
      level.set(next, Math.max(level.get(next) || 0, (level.get(id) || 0) + 1));
      remaining.set(next, remaining.get(next) - 1);
      if (remaining.get(next) === 0) queue.push(next);
    }
  }

  const levels = new Map();
  for (const id of ids) {
    const depth = level.get(id) || 0;
    if (!levels.has(depth)) levels.set(depth, []);
    levels.get(depth).push(id);
  }

  const positions = {};
  for (const [depth, group] of levels) {
    group.forEach((id, index) => {
      if (direction === "vertical") {
        positions[id] = {
          x: PADDING + index * (NODE_WIDTH + X_GAP),
          y: PADDING + depth * (NODE_HEIGHT + Y_GAP),
        };
      } else {
        positions[id] = {
          x: PADDING + depth * (NODE_WIDTH + X_GAP),
          y: PADDING + index * (NODE_HEIGHT + Y_GAP),
        };
      }
    });
  }
  return positions;
};

const resolvePositions = (tasks, edges, start, savedPositions) => {
  const automatic = autoLayout(tasks, edges, start);
  return Object.fromEntries(Object.keys(tasks || {}).map(id => [
    id,
    validPosition(savedPositions?.[id]) ? savedPositions[id] : automatic[id],
  ]));
};

const nodeRect = position => ({ x: position.x, y: position.y, width: NODE_WIDTH, height: NODE_HEIGHT });

const port = (rect, side) => side === "left"
  ? { x: rect.x, y: rect.y + rect.height / 2 }
  : { x: rect.x + rect.width, y: rect.y + rect.height / 2 };

const outwardPoint = (point, side, amount = EDGE_OFFSET) => side === "left"
  ? { x: point.x - amount, y: point.y }
  : { x: point.x + amount, y: point.y };

const cleanPoints = points => {
  const result = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (previous && previous.x === point.x && previous.y === point.y) continue;
    result.push(point);
  }
  let changed = true;
  while (changed && result.length > 2) {
    changed = false;
    for (let index = 1; index < result.length - 1; index += 1) {
      const a = result[index - 1];
      const b = result[index];
      const c = result[index + 1];
      if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) {
        result.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return result;
};

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const pointToward = (from, to, amount) => {
  const length = distance(from, to);
  if (!length) return { ...from };
  const ratio = amount / length;
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
  };
};

const roundedPath = points => {
  const cleaned = cleanPoints(points);
  if (!cleaned.length) return "";
  if (cleaned.length === 1) return `M ${cleaned[0].x} ${cleaned[0].y}`;

  let path = `M ${cleaned[0].x} ${cleaned[0].y}`;
  for (let index = 1; index < cleaned.length - 1; index += 1) {
    const previous = cleaned[index - 1];
    const current = cleaned[index];
    const next = cleaned[index + 1];
    const radius = Math.min(EDGE_RADIUS, distance(previous, current) / 2, distance(current, next) / 2);
    const before = pointToward(current, previous, radius);
    const after = pointToward(current, next, radius);
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`;
  }
  const last = cleaned.at(-1);
  return `${path} L ${last.x} ${last.y}`;
};

const edgeRoute = (sourceRect, targetRect, override = null) => {
  const start = port(sourceRect, "right");
  const end = port(targetRect, "left");
  const sourceOut = outwardPoint(start, "right");
  const targetOut = outwardPoint(end, "left");
  const forward = targetOut.x >= sourceOut.x + EDGE_OFFSET;
  const baseControl = {
    x: forward
      ? (sourceOut.x + targetOut.x) / 2
      : Math.max(sourceOut.x, targetOut.x) + EDGE_BACKTRACK_OFFSET,
    y: (sourceOut.y + targetOut.y) / 2,
  };
  const dx = Number(override?.dx ?? 0);
  const dy = Number(override?.dy ?? 0);
  const control = {
    x: baseControl.x + (Number.isFinite(dx) ? dx : 0),
    y: baseControl.y + (Number.isFinite(dy) ? dy : 0),
  };

  const points = Math.abs(control.y - baseControl.y) < 0.5
    ? [
        start,
        sourceOut,
        { x: control.x, y: sourceOut.y },
        { x: control.x, y: targetOut.y },
        targetOut,
        end,
      ]
    : [
        start,
        sourceOut,
        { x: control.x, y: sourceOut.y },
        control,
        { x: targetOut.x, y: control.y },
        targetOut,
        end,
      ];

  const cleaned = cleanPoints(points);
  return { start, end, sourceOut, targetOut, baseControl, control, points: cleaned, path: roundedPath(cleaned) };
};

const groupDepths = groups => {
  const byId = new Map((groups || []).map(group => [group.id, group]));
  const owner = new Map();
  for (const group of groups || []) for (const member of group.members || []) if (byId.has(member)) owner.set(member, group.id);
  const depth = id => {
    let value = 0;
    let current = id;
    const seen = new Set();
    while (owner.has(current) && !seen.has(current)) {
      seen.add(current);
      current = owner.get(current);
      value += 1;
    }
    return value;
  };
  return Object.fromEntries((groups || []).map(group => [group.id, depth(group.id)]));
};

const fallbackGroupGeometry = (group, positions, groupsById) => {
  if (validGroup(group)) {
    return {
      ...group,
      x: Number(group.x),
      y: Number(group.y),
      width: Number(group.width),
      height: Number(group.height),
    };
  }

  const boxes = [];
  const visit = member => {
    if (validPosition(positions[member])) boxes.push(nodeRect(positions[member]));
    const child = groupsById.get(member);
    if (child) for (const nested of child.members || []) visit(nested);
  };
  for (const member of group.members || []) visit(member);
  if (!boxes.length) return { ...group, x: PADDING, y: PADDING, width: 320, height: 190 };

  const left = Math.min(...boxes.map(box => box.x)) - 42;
  const top = Math.min(...boxes.map(box => box.y)) - 54;
  const right = Math.max(...boxes.map(box => box.x + box.width)) + 42;
  const bottom = Math.max(...boxes.map(box => box.y + box.height)) + 48;
  return {
    ...group,
    x: left,
    y: top,
    width: Math.max(GROUP_MIN_WIDTH, right - left),
    height: Math.max(GROUP_MIN_HEIGHT, bottom - top),
  };
};

const resolveGroups = (groups, positions) => {
  const byId = new Map((groups || []).map(group => [group.id, group]));
  return (groups || []).map(group => fallbackGroupGeometry(group, positions, byId));
};

const worldBounds = (positions, groups) => {
  const boxes = Object.values(positions || {})
    .filter(validPosition)
    .map(position => ({ x: position.x, y: position.y, width: NODE_WIDTH, height: NODE_HEIGHT + 46 }));
  for (const group of groups || []) {
    if (validGroup(group)) boxes.push({ x: group.x, y: group.y, width: group.width, height: group.height });
  }
  if (!boxes.length) return { left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 };

  const left = Math.min(...boxes.map(box => box.x));
  const top = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.width));
  const bottom = Math.max(...boxes.map(box => box.y + box.height));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
};

const sameEdge = (edge, from, to) => edge?.[0] === from && edge?.[1] === to;

export default function ProcessGraph({
  tasks = {},
  edges = [],
  start = "",
  savedPositions,
  statuses = {},
  selectedId = "",
  selectedEdge = null,
  selectedGroupId = "",
  groups = [],
  editable = false,
  onSelect,
  onEdgeSelect,
  onGroupSelect,
  onRevise,
  onMove,
  onConnect,
  onGroupsChange,
  onCanvasClick,
}) {
  const { officeState } = useAppContext();
  const workflowForGraph = useMemo(
    () => (officeState.workflows || []).find(item => item.tasks === tasks) || null,
    [officeState.workflows, tasks],
  );
  const storedEdgeRoutes = useMemo(
    () => cloneEdgeRoutes(workflowForGraph?.config?._ui?.edgeRoutes),
    [workflowForGraph?.id, workflowForGraph?.config?._ui?.edgeRoutes],
  );
  const initialPositions = useMemo(
    () => resolvePositions(tasks, edges, start, savedPositions),
    [tasks, edges, start, savedPositions],
  );
  const [positions, setPositions] = useState(initialPositions);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draggingId, setDraggingId] = useState("");
  const [panning, setPanning] = useState(false);
  const [connecting, setConnecting] = useState(null);
  const [edgeRoutes, setEdgeRoutes] = useState(storedEdgeRoutes);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const groupDragRef = useRef(null);
  const connectRef = useRef(null);
  const edgeDragRef = useRef(null);
  const edgeRoutesRef = useRef(storedEdgeRoutes);
  const viewportRef = useRef(null);
  const suppressCanvasClickRef = useRef(false);
  const initialFitRef = useRef(false);

  useEffect(() => {
    if (!dragRef.current) setPositions(initialPositions);
  }, [initialPositions]);

  useEffect(() => {
    if (edgeDragRef.current) return;
    edgeRoutesRef.current = storedEdgeRoutes;
    setEdgeRoutes(storedEdgeRoutes);
  }, [storedEdgeRoutes]);

  const setEdgeRoutesLive = next => {
    edgeRoutesRef.current = next;
    setEdgeRoutes(next);
  };

  const persistEdgeRoutes = async routes => {
    if (!workflowForGraph?.id) return;
    const liveKeys = new Set((edges || []).map(([from, to]) => edgeKey(from, to)));
    const compact = {};
    for (const [key, route] of Object.entries(routes || {})) {
      if (!liveKeys.has(key)) continue;
      const dx = Math.round(Number(route?.dx ?? 0));
      const dy = Math.round(Number(route?.dy ?? 0));
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      compact[key] = { dx, dy };
    }

    const nextConfig = { ...(workflowForGraph.config || {}) };
    const nextUi = { ...(nextConfig._ui || {}) };
    if (Object.keys(compact).length) nextUi.edgeRoutes = compact;
    else delete nextUi.edgeRoutes;
    if (Object.keys(nextUi).length) nextConfig._ui = nextUi;
    else delete nextConfig._ui;

    try {
      await api.patch(endpoints.workflowConfig(workflowForGraph.id), nextConfig);
    } catch (error) {
      console.error("[workflow-graph] Could not persist edge route.", error);
      const fallback = cloneEdgeRoutes(workflowForGraph?.config?._ui?.edgeRoutes);
      edgeRoutesRef.current = fallback;
      setEdgeRoutes(fallback);
    }
  };

  const resolvedGroups = useMemo(() => resolveGroups(groups, positions), [groups, positions]);
  const depths = useMemo(() => groupDepths(resolvedGroups), [resolvedGroups]);
  const bounds = useMemo(() => worldBounds(positions, resolvedGroups), [positions, resolvedGroups]);
  const nodes = useMemo(
    () => Object.entries(tasks || {}).map(([id, task]) => ({ id, task, ...positions[id] })),
    [tasks, positions],
  );
  const rectangles = useMemo(
    () => Object.fromEntries(nodes.filter(node => validPosition(node)).map(node => [node.id, nodeRect(node)])),
    [nodes],
  );
  const routedEdges = useMemo(() => (edges || []).map(([from, to]) => {
    const source = rectangles[from];
    const target = rectangles[to];
    if (!source || !target) return null;
    const key = edgeKey(from, to);
    return { from, to, key, ...edgeRoute(source, target, edgeRoutes[key]) };
  }).filter(Boolean), [edges, rectangles, edgeRoutes]);

  const graphPoint = event => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.round((event.clientX - rect.left - pan.x) / zoom),
      y: Math.round((event.clientY - rect.top - pan.y) / zoom),
    };
  };

  const zoomAt = (value, clientX = null, clientY = null) => {
    const viewport = viewportRef.current;
    const rect = viewport?.getBoundingClientRect();
    const next = clampZoom(value);
    if (!viewport || !rect || next === zoom) return setZoom(next);

    const anchorX = clientX ?? rect.left + viewport.clientWidth / 2;
    const anchorY = clientY ?? rect.top + viewport.clientHeight / 2;
    const worldX = (anchorX - rect.left - pan.x) / zoom;
    const worldY = (anchorY - rect.top - pan.y) / zoom;
    setPan({
      x: anchorX - rect.left - worldX * next,
      y: anchorY - rect.top - worldY * next,
    });
    setZoom(next);
  };

  const fitView = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const availableWidth = Math.max(1, viewport.clientWidth - FIT_PADDING * 2);
    const availableHeight = Math.max(1, viewport.clientHeight - FIT_PADDING * 2);
    const next = clampZoom(Math.min(
      availableWidth / Math.max(1, bounds.width),
      availableHeight / Math.max(1, bounds.height),
      1.25,
    ));
    setZoom(next);
    setPan({
      x: viewport.clientWidth / 2 - (bounds.left + bounds.width / 2) * next,
      y: viewport.clientHeight / 2 - (bounds.top + bounds.height / 2) * next,
    });
  };

  useEffect(() => {
    if (initialFitRef.current || !nodes.length) return;
    initialFitRef.current = true;
    const frame = requestAnimationFrame(fitView);
    return () => cancelAnimationFrame(frame);
  }, [nodes.length]);

  const applyAutoLayout = direction => {
    if (!editable || !onMove) return;
    const next = autoLayout(tasks, edges, start, direction);
    setPositions(next);
    onMove(next);
    requestAnimationFrame(fitView);
  };

  const beginNodeDrag = (event, node) => {
    if (event.button !== 0 || !validPosition(positions[node.id])) return;
    event.stopPropagation();
    onSelect?.({ id: node.id, ...node.task });
    onEdgeSelect?.(null);
    onGroupSelect?.(null);
    if (!editable || !onMove) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: node.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: positions[node.id],
      positions,
      moved: false,
    };
    setDraggingId(node.id);
  };

  const moveNode = event => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.startX) / zoom;
    const dy = (event.clientY - drag.startY) / zoom;
    const next = {
      x: Math.round(drag.origin.x + dx),
      y: Math.round(drag.origin.y + dy),
    };
    drag.positions = { ...drag.positions, [drag.id]: next };
    drag.moved ||= Math.abs(dx) > 2 || Math.abs(dy) > 2;
    setPositions(drag.positions);
  };

  const endNodeDrag = event => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDraggingId("");
    if (drag.moved) onMove?.(drag.positions);
  };

  const beginPan = event => {
    if (
      event.button !== 0
      || event.target.closest?.(".process-node-wrap")
      || event.target.closest?.(".workflow-group")
      || event.target.closest?.(".process-edge-hit")
      || event.target.closest?.(".process-edge-handle")
      || event.target.closest?.(".process-graph__controls")
    ) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: pan,
      moved: false,
    };
    setPanning(true);
  };

  const movePan = event => {
    const active = panRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    setPan({ x: active.origin.x + dx, y: active.origin.y + dy });
    active.moved ||= Math.abs(dx) > 3 || Math.abs(dy) > 3;
  };

  const endPan = event => {
    const active = panRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    suppressCanvasClickRef.current = active.moved;
    panRef.current = null;
    setPanning(false);
  };

  const beginConnect = (event, from) => {
    if (!editable || !onConnect || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = rectangles[from];
    if (!rect) return;
    connectRef.current = { pointerId: event.pointerId, from };
    setConnecting({ from, start: port(rect, "right"), pointer: graphPoint(event) });
  };

  const moveConnect = event => {
    const connection = connectRef.current;
    if (!connection || connection.pointerId !== event.pointerId) return;
    setConnecting(current => current ? { ...current, pointer: graphPoint(event) } : current);
  };

  const endConnect = event => {
    const connection = connectRef.current;
    if (!connection || connection.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-connect-input]");
    const to = target?.dataset?.connectInput;
    if (to && to !== connection.from) onConnect?.(connection.from, to);
    connectRef.current = null;
    setConnecting(null);
  };

  const beginEdgeDrag = (event, edge) => {
    if (!editable || !workflowForGraph?.id || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onEdgeSelect?.([edge.from, edge.to]);
    onSelect?.(null);
    onGroupSelect?.(null);
    const origin = edgeRoutesRef.current[edge.key] || { dx: 0, dy: 0 };
    edgeDragRef.current = {
      pointerId: event.pointerId,
      key: edge.key,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      moved: false,
    };
  };

  const moveEdgeDrag = event => {
    const drag = edgeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.startX) / zoom;
    const dy = (event.clientY - drag.startY) / zoom;
    const next = {
      ...edgeRoutesRef.current,
      [drag.key]: {
        dx: Math.round((drag.origin.dx || 0) + dx),
        dy: Math.round((drag.origin.dy || 0) + dy),
      },
    };
    drag.moved ||= Math.abs(dx) > 2 || Math.abs(dy) > 2;
    setEdgeRoutesLive(next);
  };

  const endEdgeDrag = event => {
    const drag = edgeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    edgeDragRef.current = null;
    if (drag.moved) void persistEdgeRoutes(edgeRoutesRef.current);
  };

  const resetEdgeRoute = (event, edge) => {
    if (!editable || !workflowForGraph?.id) return;
    event.preventDefault();
    event.stopPropagation();
    const next = { ...edgeRoutesRef.current };
    delete next[edge.key];
    setEdgeRoutesLive(next);
    void persistEdgeRoutes(next);
  };

  const groupDescendants = groupId => {
    const byId = new Map(resolvedGroups.map(group => [group.id, group]));
    const taskIds = new Set();
    const groupIds = new Set();
    const visit = id => {
      const group = byId.get(id);
      if (!group) return;
      for (const member of group.members || []) {
        if (tasks[member]) taskIds.add(member);
        else if (byId.has(member) && !groupIds.has(member)) {
          groupIds.add(member);
          visit(member);
        }
      }
    };
    visit(groupId);
    return { taskIds, groupIds };
  };

  const beginGroupDrag = (event, group, mode) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onGroupSelect?.(group);
    onSelect?.(null);
    onEdgeSelect?.(null);
    if (!editable || !onGroupsChange) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const descendants = groupDescendants(group.id);
    groupDragRef.current = {
      pointerId: event.pointerId,
      id: group.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: group,
      groups: resolvedGroups,
      positions,
      descendants,
      moved: false,
    };
  };

  const moveGroup = event => {
    const drag = groupDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.startX) / zoom;
    const dy = (event.clientY - drag.startY) / zoom;
    let nextGroups;
    let nextPositions = drag.positions;

    if (drag.mode === "resize") {
      nextGroups = drag.groups.map(item => item.id === drag.id ? {
        ...item,
        width: Math.max(GROUP_MIN_WIDTH, Math.round(drag.origin.width + dx)),
        height: Math.max(GROUP_MIN_HEIGHT, Math.round(drag.origin.height + dy)),
      } : item);
    } else {
      const moveIds = new Set([drag.id, ...drag.descendants.groupIds]);
      nextGroups = drag.groups.map(item => moveIds.has(item.id) ? {
        ...item,
        x: Math.round(item.x + dx),
        y: Math.round(item.y + dy),
      } : item);
      nextPositions = { ...drag.positions };
      for (const taskId of drag.descendants.taskIds) {
        const point = drag.positions[taskId];
        if (!point) continue;
        nextPositions[taskId] = {
          x: Math.round(point.x + dx),
          y: Math.round(point.y + dy),
        };
      }
    }

    drag.nextGroups = nextGroups;
    drag.nextPositions = nextPositions;
    drag.moved ||= Math.abs(dx) > 2 || Math.abs(dy) > 2;
    onGroupsChange?.(nextGroups, false);
    if (drag.mode === "move") setPositions(nextPositions);
  };

  const endGroup = event => {
    const drag = groupDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    groupDragRef.current = null;
    if (!drag.moved) return;
    onGroupsChange?.(drag.nextGroups || drag.groups, true);
    if (drag.mode === "move") onMove?.(drag.nextPositions || drag.positions);
  };

  const handleCanvasClick = event => {
    if (suppressCanvasClickRef.current) {
      suppressCanvasClickRef.current = false;
      return;
    }
    if (
      event.target.closest?.(".process-node-wrap")
      || event.target.closest?.(".workflow-group")
      || event.target.closest?.(".process-edge-hit")
      || event.target.closest?.(".process-edge-handle")
      || event.target.closest?.(".process-graph__controls")
    ) return;
    onCanvasClick?.(graphPoint(event));
  };

  const handleWheel = event => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      zoomAt(zoom * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX, event.clientY);
      return;
    }
    setPan(current => ({
      x: current.x - event.deltaX,
      y: current.y - event.deltaY,
    }));
  };

  if (!nodes.length) return <div className="process-graph process-graph--empty">No graph data.</div>;

  const sortedGroups = [...resolvedGroups].sort((left, right) => (depths[left.id] || 0) - (depths[right.id] || 0));
  const previewPath = connecting
    ? roundedPath(cleanPoints([
        connecting.start,
        { x: (connecting.start.x + connecting.pointer.x) / 2, y: connecting.start.y },
        { x: (connecting.start.x + connecting.pointer.x) / 2, y: connecting.pointer.y },
        connecting.pointer,
      ]))
    : "";

  return (
    <div
      ref={viewportRef}
      className={`process-graph process-graph--infinite ${panning ? "process-graph--panning" : ""} ${editable ? "process-graph--editable" : "process-graph--locked"}`}
      role="region"
      aria-label="Process graph"
      style={{
        "--graph-grid-size": `${20 * zoom}px`,
        "--graph-grid-x": `${pan.x}px`,
        "--graph-grid-y": `${pan.y}px`,
      }}
      onPointerDown={beginPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onClick={handleCanvasClick}
      onWheel={handleWheel}
    >
      <div className="process-graph__controls" onPointerDown={event => event.stopPropagation()}>
        <button type="button" onClick={() => zoomAt(zoom / 1.2)} title="Zoom out" aria-label="Zoom out"><IconZoomOut size={15} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => zoomAt(zoom * 1.2)} title="Zoom in" aria-label="Zoom in"><IconZoomIn size={15} /></button>
        <button type="button" onClick={fitView} title="Fit graph" aria-label="Fit graph"><IconFocus2 size={15} /></button>
        {editable && <button type="button" onClick={() => applyAutoLayout("horizontal")} title="Auto-layout left to right" aria-label="Auto-layout horizontally"><IconArrowsHorizontal size={15} /></button>}
        {editable && <button type="button" onClick={() => applyAutoLayout("vertical")} title="Auto-layout top to bottom" aria-label="Auto-layout vertically"><IconArrowsVertical size={15} /></button>}
      </div>

      <div
        className="process-graph__world"
        style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
      >
        {sortedGroups.map(group => (
          <div
            key={group.id}
            className={`workflow-group workflow-group--${group.type || "group"} ${selectedGroupId === group.id ? "workflow-group--selected" : ""}`}
            style={{
              left: group.x,
              top: group.y,
              width: group.width,
              height: group.height,
              zIndex: Math.max(0, depths[group.id] || 0),
            }}
            onPointerDown={event => beginGroupDrag(event, group, "move")}
            onPointerMove={moveGroup}
            onPointerUp={endGroup}
            onPointerCancel={endGroup}
          >
            <span className="workflow-group__title">
              <strong>{group.type === "map" ? "Map" : group.type === "loop" ? "Loop" : "Group"}</strong>
              {group.name && <span>{group.name}</span>}
              {group.type === "map" && <small>Concurrency {group.concurrency ?? 1}</small>}
              {group.type === "loop" && <small>QC ≥ {Math.round((group.minimumScore ?? 0.8) * 100)}%</small>}
            </span>
            {editable && (
              <span
                className="workflow-group__resize"
                onPointerDown={event => beginGroupDrag(event, group, "resize")}
                onPointerMove={moveGroup}
                onPointerUp={endGroup}
                onPointerCancel={endGroup}
                title="Resize execution group"
              />
            )}
          </div>
        ))}

        <svg className="process-graph__edges" width="1" height="1" aria-hidden="true">
          <defs>
            <marker id="workflow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M 0 0 L 8 4 L 0 8 z" className="process-edge__arrow" />
            </marker>
          </defs>
          {routedEdges.map(edge => (
            <g key={edge.key}>
              <path
                className={sameEdge(selectedEdge, edge.from, edge.to) ? "process-edge process-edge--selected" : "process-edge"}
                d={edge.path}
                markerEnd="url(#workflow-arrow)"
              />
              {editable && (
                <path
                  className="process-edge-hit"
                  d={edge.path}
                  onClick={event => {
                    event.stopPropagation();
                    onEdgeSelect?.([edge.from, edge.to]);
                    onSelect?.(null);
                    onGroupSelect?.(null);
                  }}
                />
              )}
            </g>
          ))}
          {connecting && <path className="process-edge process-edge--preview" d={previewPath} />}
        </svg>

        {editable && workflowForGraph?.id && routedEdges
          .filter(edge => sameEdge(selectedEdge, edge.from, edge.to))
          .map(edge => (
            <button
              key={`route-${edge.key}`}
              type="button"
              className="process-edge-handle"
              style={{ left: edge.control.x, top: edge.control.y }}
              onPointerDown={event => beginEdgeDrag(event, edge)}
              onPointerMove={moveEdgeDrag}
              onPointerUp={endEdgeDrag}
              onPointerCancel={endEdgeDrag}
              onDoubleClick={event => resetEdgeRoute(event, edge)}
              onClick={event => event.stopPropagation()}
              title="Drag to reroute this edge · double-click to reset"
              aria-label={`Reroute ${edge.from} to ${edge.to}`}
            />
          ))}

        {nodes.map(node => {
          const Icon = nodeTypeIcon(node.task?.type);
          const status = statuses[node.id] || node.task?.status || "";
          const selected = selectedId === node.id;
          const dragging = draggingId === node.id;
          const canInput = node.task?.type !== "start";
          const canOutput = node.task?.type !== "end";
          return (
            <div
              key={node.id}
              className={`process-node-wrap ${selected ? "process-node-wrap--selected" : ""} ${dragging ? "process-node-wrap--dragging" : ""}`}
              style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
            >
              {onRevise && node.task?.type === "task" && (
                <div className="process-node__toolbar">
                  <button
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      onRevise({ id: node.id, ...node.task });
                    }}
                    aria-label={`Ask Nora to revise ${nodeLabel(node.id, node.task)}`}
                    title="Ask Nora to revise"
                  >
                    <IconSparkles size={14} />
                  </button>
                </div>
              )}
              <button
                type="button"
                className={`process-node process-node--${node.task?.type || "task"} ${selected ? "process-node--selected" : ""} ${status ? `process-node--${status}` : ""}`}
                onPointerDown={event => beginNodeDrag(event, node)}
                onPointerMove={moveNode}
                onPointerUp={endNodeDrag}
                onPointerCancel={endNodeDrag}
                onClick={event => {
                  event.stopPropagation();
                  onSelect?.({ id: node.id, ...node.task });
                  onEdgeSelect?.(null);
                  onGroupSelect?.(null);
                }}
              >
                <span className="process-node__icon"><Icon size={20} stroke={1.7} /></span>
                {status && <span className="process-node__status" title={status} />}
              </button>
              {canInput && (
                <span
                  className="process-node__port process-node__port--input"
                  data-connect-input={node.id}
                  title="Incoming connection"
                />
              )}
              {canOutput && (
                <span
                  className={`process-node__port process-node__port--output ${editable ? "process-node__port--interactive" : ""}`}
                  onPointerDown={editable ? event => beginConnect(event, node.id) : undefined}
                  onPointerMove={editable ? moveConnect : undefined}
                  onPointerUp={editable ? endConnect : undefined}
                  onPointerCancel={editable ? endConnect : undefined}
                  title={editable ? "Drag to connect" : "Outgoing connection"}
                />
              )}
              <span className="process-node__description">
                <strong>{nodeLabel(node.id, node.task)}</strong>
                <small>{nodeSubtitle(node.task)}</small>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
