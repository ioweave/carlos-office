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

const NODE_WIDTH = 108;
const NODE_HEIGHT = 68;
const X_GAP = 150;
const Y_GAP = 92;
const PADDING = 90;
const GROUP_MIN_WIDTH = 190;
const GROUP_MIN_HEIGHT = 120;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ROUTE_CLEARANCE = 16;

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

const center = rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const nodeRect = position => ({ x: position.x, y: position.y, width: NODE_WIDTH, height: NODE_HEIGHT });

const sideFor = (sourceRect, targetRect) => {
  const sourceCenter = center(sourceRect);
  const targetCenter = center(targetRect);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? ["right", "left"] : ["left", "right"];
  }
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
};

const port = (rect, side) => {
  if (side === "left") return { x: rect.x, y: rect.y + rect.height / 2 };
  if (side === "right") return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  if (side === "top") return { x: rect.x + rect.width / 2, y: rect.y };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
};

const expandRect = (rect, amount = ROUTE_CLEARANCE) => ({
  x: rect.x - amount,
  y: rect.y - amount,
  width: rect.width + amount * 2,
  height: rect.height + amount * 2,
});

const segmentHitsRect = (a, b, rect) => {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  if (a.x === b.x) {
    if (a.x <= left || a.x >= right) return false;
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return maxY > top && minY < bottom;
  }
  if (a.y === b.y) {
    if (a.y <= top || a.y >= bottom) return false;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    return maxX > left && minX < right;
  }
  return false;
};

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

const routeScore = points => {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.abs(points[index].x - points[index - 1].x) + Math.abs(points[index].y - points[index - 1].y);
  }
  return length + Math.max(0, points.length - 2) * 26;
};

const routeValid = (points, obstacles) => {
  for (let index = 1; index < points.length; index += 1) {
    if (obstacles.some(rect => segmentHitsRect(points[index - 1], points[index], rect))) return false;
  }
  return true;
};

const orthogonalRoute = (sourceRect, targetRect, obstacles) => {
  const [sourceSide, targetSide] = sideFor(sourceRect, targetRect);
  const start = port(sourceRect, sourceSide);
  const end = port(targetRect, targetSide);
  const expanded = obstacles.map(rect => expandRect(rect));
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const xCorridors = new Set([midX, start.x, end.x]);
  const yCorridors = new Set([midY, start.y, end.y]);

  for (const rect of expanded) {
    xCorridors.add(rect.x - ROUTE_CLEARANCE);
    xCorridors.add(rect.x + rect.width + ROUTE_CLEARANCE);
    yCorridors.add(rect.y - ROUTE_CLEARANCE);
    yCorridors.add(rect.y + rect.height + ROUTE_CLEARANCE);
  }

  const candidates = [
    [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end],
    [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end],
  ];
  for (const x of xCorridors) candidates.push([start, { x, y: start.y }, { x, y: end.y }, end]);
  for (const y of yCorridors) candidates.push([start, { x: start.x, y }, { x: end.x, y }, end]);

  const valid = candidates
    .map(cleanPoints)
    .filter(points => routeValid(points, expanded))
    .sort((left, right) => routeScore(left) - routeScore(right));
  return {
    sourceSide,
    targetSide,
    points: valid[0] || cleanPoints([start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]),
  };
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
  if (validGroup(group)) return { ...group, x: Number(group.x), y: Number(group.y), width: Number(group.width), height: Number(group.height) };
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
    x: Math.max(12, left),
    y: Math.max(12, top),
    width: Math.max(GROUP_MIN_WIDTH, right - left),
    height: Math.max(GROUP_MIN_HEIGHT, bottom - top),
  };
};

const resolveGroups = (groups, positions) => {
  const byId = new Map((groups || []).map(group => [group.id, group]));
  return (groups || []).map(group => fallbackGroupGeometry(group, positions, byId));
};

const graphGeometry = (positions, edges, groups) => {
  const points = Object.values(positions).filter(validPosition);
  const validGroups = (groups || []).filter(validGroup);
  return {
    width: Math.max(900, ...points.map(point => point.x + NODE_WIDTH + PADDING), ...validGroups.map(group => group.x + group.width + PADDING)),
    height: Math.max(560, ...points.map(point => point.y + NODE_HEIGHT + PADDING), ...validGroups.map(group => group.y + group.height + PADDING)),
    edges: (edges || []).map(([from, to]) => ({ from, to })),
  };
};

const sameEdge = (edge, from, to) => edge?.[0] === from && edge?.[1] === to;
const pointsText = points => points.map(point => `${Math.round(point.x)},${Math.round(point.y)}`).join(" ");

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
  const initialPositions = useMemo(() => resolvePositions(tasks, edges, start, savedPositions), [tasks, edges, start, savedPositions]);
  const [positions, setPositions] = useState(initialPositions);
  const [zoom, setZoom] = useState(1);
  const [draggingId, setDraggingId] = useState("");
  const [panning, setPanning] = useState(false);
  const [connecting, setConnecting] = useState(null);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const groupDragRef = useRef(null);
  const connectRef = useRef(null);
  const viewportRef = useRef(null);
  const suppressCanvasClickRef = useRef(false);

  useEffect(() => {
    if (!dragRef.current) setPositions(initialPositions);
  }, [initialPositions]);

  const resolvedGroups = useMemo(() => resolveGroups(groups, positions), [groups, positions]);
  const depths = useMemo(() => groupDepths(resolvedGroups), [resolvedGroups]);
  const geometry = useMemo(() => graphGeometry(positions, edges, resolvedGroups), [positions, edges, resolvedGroups]);
  const nodes = useMemo(() => Object.entries(tasks || {}).map(([id, task]) => ({ id, task, ...positions[id] })), [tasks, positions]);
  const rectangles = useMemo(() => Object.fromEntries(nodes.filter(node => validPosition(node)).map(node => [node.id, nodeRect(node)])), [nodes]);
  const routedEdges = useMemo(() => geometry.edges.map(edge => {
    const source = rectangles[edge.from];
    const target = rectangles[edge.to];
    if (!source || !target) return null;
    const obstacles = Object.entries(rectangles)
      .filter(([id]) => id !== edge.from && id !== edge.to)
      .map(([, rect]) => rect);
    return { ...edge, ...orthogonalRoute(source, target, obstacles) };
  }).filter(Boolean), [geometry.edges, rectangles]);

  const graphPoint = event => {
    const viewport = viewportRef.current;
    const rect = viewport?.getBoundingClientRect();
    if (!viewport || !rect) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.round((event.clientX - rect.left + viewport.scrollLeft) / zoom)),
      y: Math.max(0, Math.round((event.clientY - rect.top + viewport.scrollTop) / zoom)),
    };
  };

  const setZoomAroundCenter = value => {
    const viewport = viewportRef.current;
    const next = clampZoom(value);
    if (!viewport || next === zoom) return setZoom(next);
    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / zoom;
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / zoom;
    setZoom(next);
    requestAnimationFrame(() => {
      viewport.scrollLeft = centerX * next - viewport.clientWidth / 2;
      viewport.scrollTop = centerY * next - viewport.clientHeight / 2;
    });
  };

  const fitView = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const next = clampZoom(Math.min(
      (viewport.clientWidth - 40) / Math.max(1, geometry.width),
      (viewport.clientHeight - 40) / Math.max(1, geometry.height),
    ));
    setZoom(next);
    requestAnimationFrame(() => {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    });
  };

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
      x: Math.max(18, Math.round(drag.origin.x + dx)),
      y: Math.max(18, Math.round(drag.origin.y + dy)),
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
      || event.target.closest?.(".process-graph__controls")
    ) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop,
      moved: false,
    };
    setPanning(true);
  };

  const movePan = event => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    event.currentTarget.scrollLeft = pan.scrollLeft - dx;
    event.currentTarget.scrollTop = pan.scrollTop - dy;
    pan.moved ||= Math.abs(dx) > 3 || Math.abs(dy) > 3;
  };

  const endPan = event => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    suppressCanvasClickRef.current = pan.moved;
    panRef.current = null;
    setPanning(false);
  };

  const beginConnect = (event, from, side) => {
    if (!editable || !onConnect || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = rectangles[from];
    if (!rect) return;
    connectRef.current = { pointerId: event.pointerId, from };
    setConnecting({ from, start: port(rect, side), pointer: graphPoint(event) });
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
        x: Math.max(8, Math.round(item.x + dx)),
        y: Math.max(8, Math.round(item.y + dy)),
      } : item);
      nextPositions = { ...drag.positions };
      for (const taskId of drag.descendants.taskIds) {
        const point = drag.positions[taskId];
        if (!point) continue;
        nextPositions[taskId] = {
          x: Math.max(8, Math.round(point.x + dx)),
          y: Math.max(8, Math.round(point.y + dy)),
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
      || event.target.closest?.(".process-graph__controls")
    ) return;
    onCanvasClick?.(graphPoint(event));
  };

  const handleWheel = event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoomAroundCenter(zoom * (event.deltaY > 0 ? 0.9 : 1.1));
  };

  if (!nodes.length) return <div className="process-graph process-graph--empty">No graph data.</div>;

  const sortedGroups = [...resolvedGroups].sort((left, right) => (depths[left.id] || 0) - (depths[right.id] || 0));

  return (
    <div
      ref={viewportRef}
      className={`process-graph process-graph--pannable ${panning ? "process-graph--panning" : ""} ${editable ? "process-graph--editable" : "process-graph--locked"}`}
      role="region"
      aria-label="Process graph"
      onPointerDown={beginPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onClick={handleCanvasClick}
      onWheel={handleWheel}
    >
      <div className="process-graph__controls" onPointerDown={event => event.stopPropagation()}>
        <button type="button" onClick={() => setZoomAroundCenter(zoom / 1.2)} title="Zoom out" aria-label="Zoom out"><IconZoomOut size={15} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoomAroundCenter(zoom * 1.2)} title="Zoom in" aria-label="Zoom in"><IconZoomIn size={15} /></button>
        <button type="button" onClick={fitView} title="Fit graph" aria-label="Fit graph"><IconFocus2 size={15} /></button>
        {editable && <button type="button" onClick={() => applyAutoLayout("horizontal")} title="Auto-layout left to right" aria-label="Auto-layout horizontally"><IconArrowsHorizontal size={15} /></button>}
        {editable && <button type="button" onClick={() => applyAutoLayout("vertical")} title="Auto-layout top to bottom" aria-label="Auto-layout vertically"><IconArrowsVertical size={15} /></button>}
      </div>

      <div className="process-graph__zoom-space" style={{ width: geometry.width * zoom, height: geometry.height * zoom }}>
        <div
          className="process-graph__canvas"
          style={{ width: geometry.width, height: geometry.height, transform: `scale(${zoom})`, transformOrigin: "0 0" }}
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

          <svg className="process-graph__edges" width={geometry.width} height={geometry.height} aria-hidden="true">
            <defs>
              <marker id="workflow-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth">
                <path d="M 0 0 L 7 3.5 L 0 7 z" className="process-edge__arrow" />
              </marker>
            </defs>
            {routedEdges.map(edge => (
              <g key={`${edge.from}-${edge.to}`}>
                <polyline
                  className={sameEdge(selectedEdge, edge.from, edge.to) ? "process-edge process-edge--selected" : "process-edge"}
                  points={pointsText(edge.points)}
                  markerEnd="url(#workflow-arrow)"
                />
                {editable && (
                  <polyline
                    className="process-edge-hit"
                    points={pointsText(edge.points)}
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
            {connecting && (
              <polyline
                className="process-edge process-edge--preview"
                points={pointsText(cleanPoints([
                  connecting.start,
                  { x: connecting.pointer.x, y: connecting.start.y },
                  connecting.pointer,
                ]))}
              />
            )}
          </svg>

          {nodes.map(node => {
            const Icon = nodeTypeIcon(node.task?.type);
            const status = statuses[node.id] || node.task?.status || "";
            const selected = selectedId === node.id;
            const dragging = draggingId === node.id;
            const canOutput = editable && node.task?.type !== "end";
            return (
              <div
                key={node.id}
                className={`process-node-wrap ${selected ? "process-node-wrap--selected" : ""} ${dragging ? "process-node-wrap--dragging" : ""}`}
                style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
                data-connect-input={node.task?.type !== "start" ? node.id : undefined}
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
                {canOutput && ["top", "right", "bottom", "left"].map(side => (
                  <span
                    key={side}
                    className={`process-node__connector process-node__connector--${side}`}
                    onPointerDown={event => beginConnect(event, node.id, side)}
                    onPointerMove={moveConnect}
                    onPointerUp={endConnect}
                    onPointerCancel={endConnect}
                    title={`Connect from ${side}`}
                  />
                ))}
                <span className="process-node__description">
                  <strong>{nodeLabel(node.id, node.task)}</strong>
                  <small>{nodeSubtitle(node.task)}</small>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
