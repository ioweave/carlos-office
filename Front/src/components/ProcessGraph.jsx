import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowsHorizontal,
  IconArrowsVertical,
  IconFocus2,
  IconFlag,
  IconPlayerPlay,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { useAppContext } from "../AppContext";
import api, { endpoints } from "../api";
import TaskNode, {
  COMPACT_NODE_HEIGHT,
  COMPACT_NODE_WIDTH,
  TASK_NODE_HEIGHT,
  TASK_NODE_WIDTH,
} from "./TaskNode";
import "../styles/comfy-workflow.scss";

const X_GAP = 170;
const Y_GAP = 86;
const PADDING = 110;
const GROUP_MIN_WIDTH = 190;
const GROUP_MIN_HEIGHT = 120;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.2;
const FIT_PADDING = 70;
const MINIMAP_WIDTH = 170;
const MINIMAP_HEIGHT = 104;
const MINIMAP_PADDING = 8;

const humanizeId = id => String(id || "")
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\b\w/g, character => character.toUpperCase());

const nodeLabel = (id, task) => task?.name?.trim() || humanizeId(id) || id;
const isTask = task => task?.type === "task";
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
const dimensions = task => isTask(task)
  ? { width: TASK_NODE_WIDTH, height: TASK_NODE_HEIGHT }
  : { width: COMPACT_NODE_WIDTH, height: COMPACT_NODE_HEIGHT };

const nodeRect = (position, task) => ({ ...position, ...dimensions(task) });

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
          x: PADDING + index * (TASK_NODE_WIDTH + X_GAP),
          y: PADDING + depth * (TASK_NODE_HEIGHT + Y_GAP),
        };
      } else {
        positions[id] = {
          x: PADDING + depth * (TASK_NODE_WIDTH + X_GAP),
          y: PADDING + index * (TASK_NODE_HEIGHT + Y_GAP),
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

const fallbackGroupGeometry = (group, positions, tasks, groupsById) => {
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
    if (validPosition(positions[member]) && tasks[member]) boxes.push(nodeRect(positions[member], tasks[member]));
    const child = groupsById.get(member);
    if (child) for (const nested of child.members || []) visit(nested);
  };
  for (const member of group.members || []) visit(member);
  if (!boxes.length) return { ...group, x: PADDING, y: PADDING, width: 390, height: 260 };

  const left = Math.min(...boxes.map(box => box.x)) - 46;
  const top = Math.min(...boxes.map(box => box.y)) - 58;
  const right = Math.max(...boxes.map(box => box.x + box.width)) + 46;
  const bottom = Math.max(...boxes.map(box => box.y + box.height)) + 50;
  return {
    ...group,
    x: left,
    y: top,
    width: Math.max(GROUP_MIN_WIDTH, right - left),
    height: Math.max(GROUP_MIN_HEIGHT, bottom - top),
  };
};

const resolveGroups = (groups, positions, tasks) => {
  const byId = new Map((groups || []).map(group => [group.id, group]));
  return (groups || []).map(group => fallbackGroupGeometry(group, positions, tasks, byId));
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

const worldBounds = (nodes, groups) => {
  const boxes = nodes.filter(node => validPosition(node)).map(node => nodeRect(node, node.task));
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

const port = (rect, side) => side === "left"
  ? { x: rect.x, y: rect.y + rect.height / 2 }
  : { x: rect.x + rect.width, y: rect.y + rect.height / 2 };

const bezierPath = (start, end) => {
  const distance = Math.abs(end.x - start.x);
  const control = Math.max(72, Math.min(220, distance * 0.48));
  return `M ${start.x} ${start.y} C ${start.x + control} ${start.y}, ${end.x - control} ${end.y}, ${end.x} ${end.y}`;
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
  workflowId = null,
  onSelect,
  onEdgeSelect,
  onGroupSelect,
  onRevise,
  onMove,
  onConnect,
  onGroupsChange,
  onCanvasClick,
}) {
  const { officeState, refresh } = useAppContext();
  const workflowForGraph = useMemo(
    () => (workflowId
      ? (officeState.workflows || []).find(item => item.id === workflowId)
      : (officeState.workflows || []).find(item => item.tasks === tasks)) || null,
    [officeState.workflows, tasks, workflowId],
  );
  const [catalog, setCatalog] = useState({ models: [], tools: [], skills: [] });
  const initialPositions = useMemo(
    () => resolvePositions(tasks, edges, start, savedPositions),
    [tasks, edges, start, savedPositions],
  );
  const [positions, setPositions] = useState(initialPositions);
  const [zoom, setZoom] = useState(0.9);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draggingId, setDraggingId] = useState("");
  const [panning, setPanning] = useState(false);
  const [connecting, setConnecting] = useState(null);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const groupDragRef = useRef(null);
  const connectRef = useRef(null);
  const viewportRef = useRef(null);
  const suppressCanvasClickRef = useRef(false);
  const initialFitRef = useRef(false);

  useEffect(() => {
    if (!dragRef.current) setPositions(initialPositions);
  }, [initialPositions]);

  useEffect(() => {
    if (!editable || !workflowForGraph?.id) return undefined;
    let active = true;
    const loadCatalog = async () => {
      try {
        const [modelsResponse, toolsResponse, skillsResponse] = await Promise.all([
          api.get(endpoints.models()),
          api.get(endpoints.tools()),
          api.get(endpoints.skills()),
        ]);
        if (!active) return;
        setCatalog({
          models: modelsResponse.data || [],
          tools: toolsResponse.data || [],
          skills: skillsResponse.data || [],
        });
      } catch (error) {
        console.error("[workflow-graph] Could not load inline Task options.", error);
      }
    };
    void loadCatalog();
    return () => { active = false; };
  }, [editable, workflowForGraph?.id]);

  const nodes = useMemo(
    () => Object.entries(tasks || {}).map(([id, task]) => ({ id, task, ...positions[id] })),
    [tasks, positions],
  );
  const rectangles = useMemo(
    () => Object.fromEntries(nodes.filter(node => validPosition(node)).map(node => [node.id, nodeRect(node, node.task)])),
    [nodes],
  );
  const resolvedGroups = useMemo(() => resolveGroups(groups, positions, tasks), [groups, positions, tasks]);
  const depths = useMemo(() => groupDepths(resolvedGroups), [resolvedGroups]);
  const bounds = useMemo(() => worldBounds(nodes, resolvedGroups), [nodes, resolvedGroups]);
  const routedEdges = useMemo(() => (edges || []).map(([from, to]) => {
    const source = rectangles[from];
    const target = rectangles[to];
    if (!source || !target) return null;
    const fromPoint = port(source, "right");
    const toPoint = port(target, "left");
    return { from, to, start: fromPoint, end: toPoint, path: bezierPath(fromPoint, toPoint) };
  }).filter(Boolean), [edges, rectangles]);

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
      1,
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
    event.preventDefault();
    event.stopPropagation();
    if (!editable || !onMove) return;
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
      x: Math.max(0, Math.round(drag.origin.x + dx)),
      y: Math.max(0, Math.round(drag.origin.y + dy)),
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
      || event.target.closest?.(".comfy-graph__controls")
      || event.target.closest?.(".comfy-graph__minimap")
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
        x: Math.max(0, Math.round(item.x + dx)),
        y: Math.max(0, Math.round(item.y + dy)),
      } : item);
      nextPositions = { ...drag.positions };
      for (const taskId of drag.descendants.taskIds) {
        const point = drag.positions[taskId];
        if (!point) continue;
        nextPositions[taskId] = {
          x: Math.max(0, Math.round(point.x + dx)),
          y: Math.max(0, Math.round(point.y + dy)),
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
      || event.target.closest?.(".comfy-graph__controls")
      || event.target.closest?.(".comfy-graph__minimap")
    ) return;
    onCanvasClick?.(graphPoint(event));
  };

  const handleWheel = event => {
    event.preventDefault();
    if (event.deltaY === 0) return;
    zoomAt(zoom * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX, event.clientY);
  };

  const saveTask = async (taskId, task) => {
    if (!editable || !workflowForGraph?.id) return;
    try {
      await api.patch(endpoints.workflowTask(workflowForGraph.id, taskId), task);
      await refresh();
    } catch (error) {
      toast.error(error.response?.data?.error || `Could not save Task ${taskId}.`);
      throw error;
    }
  };

  const deleteTask = async node => {
    if (!editable || !workflowForGraph?.id || node.task?.type !== "task") return;
    if (!window.confirm(`Remove Task "${nodeLabel(node.id, node.task)}"?`)) return;
    try {
      await api.delete(endpoints.workflowTask(workflowForGraph.id, node.id));
      onSelect?.(null);
      await refresh();
      toast.success("Task removed.");
    } catch (error) {
      toast.error(error.response?.data?.error || `Could not remove Task ${node.id}.`);
    }
  };

  if (!nodes.length) return <div className="process-graph process-graph--empty">No graph data.</div>;

  const sortedGroups = [...resolvedGroups].sort((left, right) => (depths[left.id] || 0) - (depths[right.id] || 0));
  const previewPath = connecting ? bezierPath(connecting.start, connecting.pointer) : "";
  const viewport = viewportRef.current;
  const minimapScale = Math.min(
    (MINIMAP_WIDTH - MINIMAP_PADDING * 2) / Math.max(1, bounds.width),
    (MINIMAP_HEIGHT - MINIMAP_PADDING * 2) / Math.max(1, bounds.height),
  );
  const minimapX = value => MINIMAP_PADDING + (value - bounds.left) * minimapScale;
  const minimapY = value => MINIMAP_PADDING + (value - bounds.top) * minimapScale;
  const visibleWorld = viewport ? {
    x: -pan.x / zoom,
    y: -pan.y / zoom,
    width: viewport.clientWidth / zoom,
    height: viewport.clientHeight / zoom,
  } : null;

  return (
    <div
      ref={viewportRef}
      className={`process-graph comfy-graph ${panning ? "comfy-graph--panning" : ""} ${editable ? "comfy-graph--editable" : "comfy-graph--locked"}`}
      role="region"
      aria-label="Workflow graph"
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
      <div
        className="comfy-graph__world"
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
              {group.type === "map" && <small>{group.concurrency ?? 1}×</small>}
              {group.type === "loop" && <small>QC {Math.round((group.minimumScore ?? 0.8) * 100)}%</small>}
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

        <svg className="comfy-graph__edges" width="1" height="1" aria-hidden="true">
          {routedEdges.map(edge => (
            <g key={`${edge.from}:${edge.to}`}>
              <path
                className={sameEdge(selectedEdge, edge.from, edge.to) ? "comfy-edge comfy-edge--selected" : "comfy-edge"}
                d={edge.path}
              />
              {editable && (
                <path
                  className="process-edge-hit"
                  d={edge.path}
                  onClick={event => {
                    event.stopPropagation();
                    onEdgeSelect?.([edge.from, edge.to]);
                    onGroupSelect?.(null);
                  }}
                />
              )}
            </g>
          ))}
          {connecting && <path className="comfy-edge comfy-edge--preview" d={previewPath} />}
        </svg>

        {nodes.map(node => {
          const selected = selectedId === node.id;
          const dragging = draggingId === node.id;
          const canInput = node.task?.type !== "start";
          const canOutput = node.task?.type !== "end";
          const size = dimensions(node.task);
          const nodeEditable = editable && Boolean(workflowForGraph?.id) && node.task?.type === "task";
          const hasRuntime = Boolean((node.task?.attempts || []).length || statuses[node.id] || node.task?.status);

          return (
            <div
              key={node.id}
              className={`process-node-wrap comfy-node-wrap ${selected ? "comfy-node-wrap--selected" : ""} ${dragging ? "comfy-node-wrap--dragging" : ""}`}
              style={{ left: node.x, top: node.y, width: size.width, height: size.height }}
            >
              {node.task?.type === "task" ? (
                <TaskNode
                  taskId={node.id}
                  task={node.task}
                  status={statuses[node.id] || node.task?.status || ""}
                  selected={selected}
                  editable={nodeEditable}
                  catalog={catalog}
                  onSave={nodeEditable ? saveTask : null}
                  onDelete={nodeEditable ? () => deleteTask(node) : null}
                  onRevise={onRevise ? () => onRevise({ id: node.id, ...node.task }) : null}
                  onInspect={!nodeEditable && onSelect && (hasRuntime || !workflowForGraph?.id) ? () => onSelect({ id: node.id, ...node.task }) : null}
                  dragHandlers={{
                    onPointerDown: event => beginNodeDrag(event, node),
                    onPointerMove: moveNode,
                    onPointerUp: endNodeDrag,
                    onPointerCancel: endNodeDrag,
                  }}
                />
              ) : (
                <div
                  className={`workflow-terminal-node workflow-terminal-node--${node.task?.type || "task"}`}
                  onPointerDown={event => beginNodeDrag(event, node)}
                  onPointerMove={moveNode}
                  onPointerUp={endNodeDrag}
                  onPointerCancel={endNodeDrag}
                >
                  {node.task?.type === "start" ? <IconPlayerPlay size={15} /> : <IconFlag size={15} />}
                  <strong>{nodeLabel(node.id, node.task)}</strong>
                </div>
              )}

              {canInput && <span className="workflow-node-socket workflow-node-socket--input" data-connect-input={node.id} title="Input" />}
              {canOutput && (
                <span
                  className={`workflow-node-socket workflow-node-socket--output ${editable ? "workflow-node-socket--interactive" : ""}`}
                  onPointerDown={editable ? event => beginConnect(event, node.id) : undefined}
                  onPointerMove={editable ? moveConnect : undefined}
                  onPointerUp={editable ? endConnect : undefined}
                  onPointerCancel={editable ? endConnect : undefined}
                  title={editable ? "Drag to connect" : "Output"}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="comfy-graph__controls" onPointerDown={event => event.stopPropagation()}>
        <button type="button" onClick={() => zoomAt(zoom / 1.2)} title="Zoom out" aria-label="Zoom out"><IconZoomOut size={14} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => zoomAt(zoom * 1.2)} title="Zoom in" aria-label="Zoom in"><IconZoomIn size={14} /></button>
        <button type="button" onClick={fitView} title="Fit graph" aria-label="Fit graph"><IconFocus2 size={14} /></button>
        {editable && <button type="button" onClick={() => applyAutoLayout("horizontal")} title="Auto-layout left to right" aria-label="Auto-layout horizontally"><IconArrowsHorizontal size={14} /></button>}
        {editable && <button type="button" onClick={() => applyAutoLayout("vertical")} title="Auto-layout top to bottom" aria-label="Auto-layout vertically"><IconArrowsVertical size={14} /></button>}
      </div>

      <div className="comfy-graph__minimap" onPointerDown={event => event.stopPropagation()}>
        <svg viewBox={`0 0 ${MINIMAP_WIDTH} ${MINIMAP_HEIGHT}`} width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT} aria-label="Workflow minimap">
          {resolvedGroups.filter(validGroup).map(group => (
            <rect
              key={`group-${group.id}`}
              className="comfy-minimap-group"
              x={minimapX(group.x)}
              y={minimapY(group.y)}
              width={Math.max(2, group.width * minimapScale)}
              height={Math.max(2, group.height * minimapScale)}
            />
          ))}
          {nodes.filter(validPosition).map(node => {
            const size = dimensions(node.task);
            return (
              <rect
                key={node.id}
                className={`comfy-minimap-node comfy-minimap-node--${node.task?.type || "task"}`}
                x={minimapX(node.x)}
                y={minimapY(node.y)}
                width={Math.max(3, size.width * minimapScale)}
                height={Math.max(3, size.height * minimapScale)}
              />
            );
          })}
          {visibleWorld && (
            <rect
              className="comfy-minimap-viewport"
              x={minimapX(visibleWorld.x)}
              y={minimapY(visibleWorld.y)}
              width={Math.max(4, visibleWorld.width * minimapScale)}
              height={Math.max(4, visibleWorld.height * minimapScale)}
            />
          )}
        </svg>
      </div>
    </div>
  );
}
