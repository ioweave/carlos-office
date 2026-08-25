import { useEffect, useMemo, useRef, useState } from "react";
import { IconCircle, IconFlag, IconPlayerPlay, IconSparkles } from "@tabler/icons-react";

const NODE_WIDTH = 96;
const NODE_HEIGHT = 64;
const X_GAP = 130;
const Y_GAP = 78;
const PADDING = 72;
const GROUP_MIN_WIDTH = 180;
const GROUP_MIN_HEIGHT = 120;

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

const validPosition = value => (
  value
  && Number.isFinite(value.x)
  && Number.isFinite(value.y)
);

const validGroup = group => (
  group
  && typeof group.id === "string"
  && Number.isFinite(group.x)
  && Number.isFinite(group.y)
  && Number.isFinite(group.width)
  && Number.isFinite(group.height)
);

const autoLayout = (tasks, edges, start) => {
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
  for (const id of ids) {
    if (id !== start && incoming.get(id) === 0) queue.push(id);
  }

  const remaining = new Map(incoming);
  while (queue.length) {
    const id = queue.shift();
    for (const next of outgoing.get(id) || []) {
      level.set(next, Math.max(level.get(next) || 0, (level.get(id) || 0) + 1));
      remaining.set(next, remaining.get(next) - 1);
      if (remaining.get(next) === 0) queue.push(next);
    }
  }

  const groups = new Map();
  for (const id of ids) {
    const depth = level.get(id) || 0;
    if (!groups.has(depth)) groups.set(depth, []);
    groups.get(depth).push(id);
  }

  const maxRows = Math.max(...[...groups.values()].map(group => group.length));
  const graphHeight = PADDING * 2 + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * Y_GAP;
  const positions = {};

  for (const [depth, group] of groups) {
    const groupHeight = group.length * NODE_HEIGHT + Math.max(0, group.length - 1) * Y_GAP;
    const top = PADDING + (graphHeight - PADDING * 2 - groupHeight) / 2;
    group.forEach((id, index) => {
      positions[id] = {
        x: PADDING + depth * (NODE_WIDTH + X_GAP),
        y: top + index * (NODE_HEIGHT + Y_GAP),
      };
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

const edgePath = (source, target) => {
  const x1 = source.x + NODE_WIDTH;
  const y1 = source.y + NODE_HEIGHT / 2;
  const x2 = target.x;
  const y2 = target.y + NODE_HEIGHT / 2;
  const mid = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
};

const graphGeometry = (positions, edges, groups) => {
  const points = Object.values(positions).filter(validPosition);
  const validGroups = (groups || []).filter(validGroup);
  const width = Math.max(
    720,
    ...points.map(point => point.x + NODE_WIDTH + PADDING),
    ...validGroups.map(group => group.x + group.width + PADDING),
  );
  const height = Math.max(
    420,
    ...points.map(point => point.y + NODE_HEIGHT + PADDING),
    ...validGroups.map(group => group.y + group.height + PADDING),
  );
  const lines = (edges || []).map(([from, to]) => {
    const source = positions[from];
    const target = positions[to];
    if (!validPosition(source) || !validPosition(target)) return null;
    return { from, to, path: edgePath(source, target) };
  }).filter(Boolean);

  return { width, height, lines };
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
  groups = [],
  editable = false,
  onSelect,
  onEdgeSelect,
  onRevise,
  onMove,
  onConnect,
  onGroupsChange,
  onCanvasClick,
}) {
  const initialPositions = useMemo(
    () => resolvePositions(tasks, edges, start, savedPositions),
    [tasks, edges, start, savedPositions],
  );
  const [positions, setPositions] = useState(initialPositions);
  const [draggingId, setDraggingId] = useState("");
  const [panning, setPanning] = useState(false);
  const [connecting, setConnecting] = useState(null);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const groupDragRef = useRef(null);
  const connectRef = useRef(null);
  const suppressCanvasClickRef = useRef(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!dragRef.current) setPositions(initialPositions);
  }, [initialPositions]);

  const geometry = useMemo(() => graphGeometry(positions, edges, groups), [positions, edges, groups]);
  const nodes = useMemo(
    () => Object.entries(tasks || {}).map(([id, task]) => ({ id, task, ...positions[id] })),
    [tasks, positions],
  );

  const canvasPoint = event => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.round(event.clientX - rect.left)),
      y: Math.max(0, Math.round(event.clientY - rect.top)),
    };
  };

  const beginDrag = (event, node) => {
    if (event.button !== 0 || !validPosition(positions[node.id])) return;
    event.stopPropagation();
    onSelect?.({ id: node.id, ...node.task });
    onEdgeSelect?.(null);
    if (!onMove) return;

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

  const moveDrag = event => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const next = {
      x: Math.max(24, Math.round(drag.origin.x + dx)),
      y: Math.max(24, Math.round(drag.origin.y + dy)),
    };

    drag.positions = { ...drag.positions, [drag.id]: next };
    drag.moved = drag.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2;
    setPositions(drag.positions);
  };

  const endDrag = event => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragRef.current = null;
    setDraggingId("");

    if (drag.moved) {
      setPositions(drag.positions);
      onMove?.(drag.positions);
    }
  };

  const cancelDrag = event => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDraggingId("");
    setPositions({ ...drag.positions, [drag.id]: drag.origin });
  };

  const beginPan = event => {
    if (
      event.button !== 0
      || event.target.closest?.(".process-node-wrap")
      || event.target.closest?.(".workflow-group")
      || event.target.closest?.(".process-edge-hit")
      || event.target.closest?.(".process-node__connector")
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
    pan.moved = pan.moved || Math.abs(dx) > 3 || Math.abs(dy) > 3;
  };

  const endPan = event => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    suppressCanvasClickRef.current = pan.moved;
    panRef.current = null;
    setPanning(false);
  };

  const cancelPan = event => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
  };

  const beginConnect = (event, from) => {
    if (!editable || !onConnect || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const source = positions[from];
    if (!validPosition(source)) return;
    const pointer = canvasPoint(event);
    connectRef.current = { pointerId: event.pointerId, from };
    setConnecting({
      from,
      start: { x: source.x + NODE_WIDTH, y: source.y + NODE_HEIGHT / 2 },
      pointer,
    });
  };

  const moveConnect = event => {
    const connection = connectRef.current;
    if (!connection || connection.pointerId !== event.pointerId) return;
    event.preventDefault();
    setConnecting(current => current ? { ...current, pointer: canvasPoint(event) } : current);
  };

  const endConnect = event => {
    const connection = connectRef.current;
    if (!connection || connection.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-connect-input]");
    const to = target?.dataset?.connectInput;
    if (to && to !== connection.from) onConnect?.(connection.from, to);
    connectRef.current = null;
    setConnecting(null);
  };

  const cancelConnect = event => {
    const connection = connectRef.current;
    if (!connection || connection.pointerId !== event.pointerId) return;
    connectRef.current = null;
    setConnecting(null);
  };

  const beginGroupDrag = (event, group, mode) => {
    if (!editable || !onGroupsChange || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    groupDragRef.current = {
      pointerId: event.pointerId,
      id: group.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: group,
      groups,
      moved: false,
    };
  };

  const moveGroup = event => {
    const drag = groupDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const next = drag.mode === "resize"
      ? {
          ...drag.origin,
          width: Math.max(GROUP_MIN_WIDTH, Math.round(drag.origin.width + dx)),
          height: Math.max(GROUP_MIN_HEIGHT, Math.round(drag.origin.height + dy)),
        }
      : {
          ...drag.origin,
          x: Math.max(12, Math.round(drag.origin.x + dx)),
          y: Math.max(12, Math.round(drag.origin.y + dy)),
        };
    drag.groups = groups.map(item => item.id === drag.id ? next : item);
    drag.moved = drag.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2;
    onGroupsChange?.(drag.groups, false);
  };

  const endGroup = event => {
    const drag = groupDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    groupDragRef.current = null;
    if (drag.moved) onGroupsChange?.(drag.groups, true);
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
    ) return;
    onCanvasClick?.(canvasPoint(event));
  };

  if (!nodes.length) {
    return <div className="process-graph process-graph--empty">No graph data.</div>;
  }

  const previewPath = connecting
    ? `M ${connecting.start.x} ${connecting.start.y} C ${(connecting.start.x + connecting.pointer.x) / 2} ${connecting.start.y}, ${(connecting.start.x + connecting.pointer.x) / 2} ${connecting.pointer.y}, ${connecting.pointer.x} ${connecting.pointer.y}`
    : null;

  return (
    <div
      className={`process-graph process-graph--pannable ${panning ? "process-graph--panning" : ""} ${editable ? "process-graph--editable" : ""}`}
      role="region"
      aria-label="Process graph"
      onPointerDown={beginPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={cancelPan}
      onClick={handleCanvasClick}
    >
      <div ref={canvasRef} className="process-graph__canvas" style={{ width: geometry.width, height: geometry.height }}>
        {(groups || []).filter(validGroup).map(group => (
          <div
            key={group.id}
            className="workflow-group"
            style={{ left: group.x, top: group.y, width: group.width, height: group.height }}
            onPointerDown={event => beginGroupDrag(event, group, "move")}
            onPointerMove={moveGroup}
            onPointerUp={endGroup}
            onPointerCancel={endGroup}
          >
            <span className="workflow-group__title">{group.title || "Group"}</span>
            {editable && (
              <span
                className="workflow-group__resize"
                onPointerDown={event => beginGroupDrag(event, group, "resize")}
                onPointerMove={moveGroup}
                onPointerUp={endGroup}
                onPointerCancel={endGroup}
              />
            )}
          </div>
        ))}

        <svg className="process-graph__edges" width={geometry.width} height={geometry.height} aria-hidden="true">
          {geometry.lines.map(line => (
            <g key={`${line.from}-${line.to}`}>
              <path
                className={sameEdge(selectedEdge, line.from, line.to) ? "process-edge process-edge--selected" : "process-edge"}
                d={line.path}
              />
              {editable && (
                <path
                  className="process-edge-hit"
                  d={line.path}
                  onClick={event => {
                    event.stopPropagation();
                    onEdgeSelect?.([line.from, line.to]);
                    onSelect?.(null);
                  }}
                />
              )}
            </g>
          ))}
          {previewPath && <path className="process-edge process-edge--preview" d={previewPath} />}
        </svg>

        {nodes.map(node => {
          const Icon = nodeTypeIcon(node.task?.type);
          const status = statuses[node.id] || node.task?.status || "";
          const selected = selectedId === node.id;
          const dragging = draggingId === node.id;
          const canInput = editable && node.task?.type !== "start";
          const canOutput = editable && node.task?.type !== "end";
          return (
            <div
              key={node.id}
              className={`process-node-wrap ${selected ? "process-node-wrap--selected" : ""} ${dragging ? "process-node-wrap--dragging" : ""}`}
              style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
            >
              {onRevise && (
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
              {canInput && (
                <span
                  className="process-node__connector process-node__connector--input"
                  data-connect-input={node.id}
                  title="Connection input"
                />
              )}
              <button
                type="button"
                className={`process-node process-node--${node.task?.type || "task"} ${selected ? "process-node--selected" : ""} ${status ? `process-node--${status}` : ""}`}
                onPointerDown={event => beginDrag(event, node)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={cancelDrag}
                onDoubleClick={event => {
                  event.stopPropagation();
                  onSelect?.({ id: node.id, ...node.task, edit: editable });
                }}
                onClick={event => {
                  event.stopPropagation();
                  onEdgeSelect?.(null);
                  onSelect?.({ id: node.id, ...node.task });
                }}
                aria-label={`${nodeLabel(node.id, node.task)} · ${nodeSubtitle(node.task)}`}
              >
                <span className="process-node__icon"><Icon size={20} stroke={1.7} /></span>
                {status && <span className="process-node__status" title={status} />}
              </button>
              {canOutput && (
                <span
                  className="process-node__connector process-node__connector--output"
                  onPointerDown={event => beginConnect(event, node.id)}
                  onPointerMove={moveConnect}
                  onPointerUp={endConnect}
                  onPointerCancel={cancelConnect}
                  title="Drag to connect"
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
