import { useEffect, useMemo, useRef, useState } from "react";
import { IconCircle, IconFlag, IconPlayerPlay, IconSparkles } from "@tabler/icons-react";

const NODE_WIDTH = 96;
const NODE_HEIGHT = 64;
const X_GAP = 130;
const Y_GAP = 78;
const PADDING = 72;

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

const graphGeometry = (positions, edges) => {
  const points = Object.values(positions).filter(validPosition);
  const width = Math.max(720, ...points.map(point => point.x + NODE_WIDTH + PADDING));
  const height = Math.max(420, ...points.map(point => point.y + NODE_HEIGHT + PADDING));
  const lines = (edges || []).map(([from, to]) => {
    const source = positions[from];
    const target = positions[to];
    if (!validPosition(source) || !validPosition(target)) return null;

    const x1 = source.x + NODE_WIDTH;
    const y1 = source.y + NODE_HEIGHT / 2;
    const x2 = target.x;
    const y2 = target.y + NODE_HEIGHT / 2;
    const mid = x1 + (x2 - x1) / 2;
    return { from, to, path: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}` };
  }).filter(Boolean);

  return { width, height, lines };
};

export default function ProcessGraph({
  tasks = {},
  edges = [],
  start = "",
  savedPositions,
  statuses = {},
  selectedId = "",
  onSelect,
  onRevise,
  onMove,
  onCanvasClick,
}) {
  const initialPositions = useMemo(
    () => resolvePositions(tasks, edges, start, savedPositions),
    [tasks, edges, start, savedPositions],
  );
  const [positions, setPositions] = useState(initialPositions);
  const [draggingId, setDraggingId] = useState("");
  const dragRef = useRef(null);

  useEffect(() => {
    if (!dragRef.current) setPositions(initialPositions);
  }, [initialPositions]);

  const geometry = useMemo(() => graphGeometry(positions, edges), [positions, edges]);
  const nodes = useMemo(
    () => Object.entries(tasks || {}).map(([id, task]) => ({ id, task, ...positions[id] })),
    [tasks, positions],
  );

  const beginDrag = (event, node) => {
    if (event.button !== 0 || !validPosition(positions[node.id])) return;
    event.stopPropagation();
    onSelect?.({ id: node.id, ...node.task });
    if (!onMove) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: node.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: positions[node.id],
      position: positions[node.id],
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

    drag.position = next;
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

  if (!nodes.length) {
    return <div className="process-graph process-graph--empty">No graph data.</div>;
  }

  return (
    <div className="process-graph" role="region" aria-label="Process graph" onClick={() => onCanvasClick?.()}>
      <div className="process-graph__canvas" style={{ width: geometry.width, height: geometry.height }}>
        <svg className="process-graph__edges" width={geometry.width} height={geometry.height} aria-hidden="true">
          {geometry.lines.map(line => <path key={`${line.from}-${line.to}`} d={line.path} />)}
        </svg>

        {nodes.map(node => {
          const Icon = nodeTypeIcon(node.task?.type);
          const status = statuses[node.id] || node.task?.status || "";
          const selected = selectedId === node.id;
          const dragging = draggingId === node.id;
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
              <button
                type="button"
                className={`process-node process-node--${node.task?.type || "task"} ${selected ? "process-node--selected" : ""} ${status ? `process-node--${status}` : ""}`}
                onPointerDown={event => beginDrag(event, node)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={cancelDrag}
                onClick={event => {
                  event.stopPropagation();
                  onSelect?.({ id: node.id, ...node.task });
                }}
                aria-label={`${nodeLabel(node.id, node.task)} · ${nodeSubtitle(node.task)}`}
              >
                <span className="process-node__icon"><Icon size={20} stroke={1.7} /></span>
                {status && <span className="process-node__status" title={status} />}
              </button>
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