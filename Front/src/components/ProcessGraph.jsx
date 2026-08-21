import { IconCheck, IconCircleDot, IconPlayerPlay } from "@tabler/icons-react";
import StatusBadge from "./StatusBadge";

const COL_WIDTH = 230;
const ROW_HEIGHT = 130;
const NODE_W = 200;
const NODE_H = 96;

const statusTone = {
  running: "info",
  ready: "info",
  pending: "neutral",
  blocked: "warning",
  completed: "success",
  failed: "danger",
  skipped: "neutral",
  cancelled: "neutral",
};

const typeIcon = type => {
  if (type === "start") return IconPlayerPlay;
  if (type === "end") return IconCheck;
  return IconCircleDot;
};

// Topological layering: depth(node) = max(depth(predecessors)) + 1, start = 0.
const layout = (tasks, edges, start) => {
  const nodes = Object.entries(tasks).map(([id, task]) => ({ id, ...task }));
  const incoming = new Map(nodes.map(node => [node.id, []]));
  edges.forEach(([from, to]) => incoming.get(to)?.push(from));

  const depth = new Map();
  const resolve = id => {
    if (depth.has(id)) return depth.get(id);
    const preds = incoming.get(id) || [];
    const base = preds.length ? Math.max(...preds.map(resolve)) : -1;
    const value = base + 1;
    depth.set(id, value);
    return value;
  };
  nodes.forEach(node => resolve(node.id));
  if (start && !depth.has(start)) depth.set(start, 0);

  const columns = new Map();
  nodes.forEach(node => {
    const list = columns.get(depth.get(node.id)) || [];
    list.push(node);
    columns.set(depth.get(node.id), list);
  });

  const positioned = new Map();
  [...columns.entries()].sort((a, b) => a[0] - b[0]).forEach(([col, list]) => {
    list.forEach((node, index) => {
      positioned.set(node.id, { ...node, x: col * COL_WIDTH + 24, y: index * ROW_HEIGHT + 24 });
    });
  });

  return { positioned, depth, columnCount: columns.size };
};

const TaskNode = ({ node, status, selected, onSelect }) => {
  const Icon = typeIcon(node.type);
  const isTask = node.type === "task";
  const primary = isTask ? (node.objective || node.id) : node.id;
  const secondary = isTask ? (node.agent ? `Agent · ${node.agent}` : "") : node.type;
  return (
    <button
      type="button"
      className={`process-graph__node process-graph__node--${node.type} ${selected ? "process-graph__node--selected" : ""}`}
      style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
      onClick={() => onSelect?.(node)}
    >
      <span className={`process-graph__node-icon${node.type === "start" ? " process-graph__node-icon--start" : node.type === "end" ? " process-graph__node-icon--end" : ""}`}><Icon size={15} stroke={1.7} /></span>
      <span className="process-graph__node-body">
        <strong className="process-graph__node-title">{primary}</strong>
        {secondary && <small className="process-graph__node-meta">{secondary}</small>}
      </span>
      {status && <StatusBadge tone={statusTone[status] || "neutral"}>{status}</StatusBadge>}
    </button>
  );
};

export default function ProcessGraph({ tasks, edges, start, statuses, selectedId, onSelect }) {
  const { positioned, columnCount } = layout(tasks, edges || [], start);
  const nodes = [...positioned.values()];
  const width = Math.max(columnCount * COL_WIDTH + 48, 320);
  const height = Math.max(nodes.length * ROW_HEIGHT / Math.max(columnCount, 1) + 48, 200);
  const coords = id => positioned.get(id);
  const edgePath = (from, to) => {
    const a = coords(from);
    const b = coords(to);
    if (!a || !b) return null;
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const bend = Math.max(30, Math.abs(x2 - x1) * 0.4);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  };

  return (
    <div className="process-graph" aria-label="Process graph">
      <svg className="process-graph__edges" width={width} height={height}>
        {(edges || []).map(([from, to]) => {
          const d = edgePath(from, to);
          return d ? <path key={`${from}-${to}`} className="process-graph__edge" d={d} /> : null;
        })}
      </svg>
      <div className="process-graph__canvas" style={{ width, height }}>
        {nodes.map(node => (
          <TaskNode
            key={node.id}
            node={node}
            status={statuses?.[node.id]}
            selected={selectedId === node.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}