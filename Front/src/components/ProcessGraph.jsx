import { useMemo } from "react";
import { IconArrowRight, IconCircle, IconFlag, IconPlayerPlay } from "@tabler/icons-react";

const NODE_WIDTH = 190;
const NODE_HEIGHT = 82;
const X_GAP = 86;
const Y_GAP = 36;
const PADDING = 28;

const nodeLabel = (id, task) => task?.objective || task?.name || id;

const nodeTypeIcon = type => {
  if (type === "start") return IconPlayerPlay;
  if (type === "end") return IconFlag;
  return IconCircle;
};

const layoutGraph = (tasks, edges, start) => {
  const ids = Object.keys(tasks || {});
  if (!ids.length) return { nodes: [], lines: [], width: 0, height: 0 };

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

  const maxLevel = Math.max(...groups.keys());
  const maxRows = Math.max(...[...groups.values()].map(group => group.length));
  const width = PADDING * 2 + (maxLevel + 1) * NODE_WIDTH + maxLevel * X_GAP;
  const height = PADDING * 2 + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * Y_GAP;
  const positions = new Map();

  for (const [depth, group] of groups) {
    const groupHeight = group.length * NODE_HEIGHT + Math.max(0, group.length - 1) * Y_GAP;
    const top = PADDING + (height - PADDING * 2 - groupHeight) / 2;
    group.forEach((id, index) => {
      positions.set(id, {
        x: PADDING + depth * (NODE_WIDTH + X_GAP),
        y: top + index * (NODE_HEIGHT + Y_GAP),
      });
    });
  }

  const nodes = ids.map(id => ({ id, task: tasks[id], ...positions.get(id) }));
  const lines = (edges || []).map(([from, to]) => {
    const source = positions.get(from);
    const target = positions.get(to);
    if (!source || !target) return null;
    const x1 = source.x + NODE_WIDTH;
    const y1 = source.y + NODE_HEIGHT / 2;
    const x2 = target.x;
    const y2 = target.y + NODE_HEIGHT / 2;
    const mid = x1 + (x2 - x1) / 2;
    return { from, to, path: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}` };
  }).filter(Boolean);

  return { nodes, lines, width, height };
};

export default function ProcessGraph({ tasks = {}, edges = [], start = "", statuses = {}, selectedId = "", onSelect }) {
  const layout = useMemo(() => layoutGraph(tasks, edges, start), [tasks, edges, start]);

  if (!layout.nodes.length) {
    return <div className="process-graph process-graph--empty">No graph data.</div>;
  }

  return (
    <div className="process-graph" role="region" aria-label="Process graph">
      <div className="process-graph__canvas" style={{ width: layout.width, height: layout.height }}>
        <svg className="process-graph__edges" width={layout.width} height={layout.height} aria-hidden="true">
          <defs>
            <marker id="process-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          {layout.lines.map(line => (
            <path key={`${line.from}-${line.to}`} d={line.path} markerEnd="url(#process-arrow)" />
          ))}
        </svg>

        {layout.nodes.map(node => {
          const Icon = nodeTypeIcon(node.task?.type);
          const status = statuses[node.id] || node.task?.status || "";
          return (
            <button
              key={node.id}
              type="button"
              className={`process-node ${selectedId === node.id ? "process-node--selected" : ""} ${status ? `process-node--${status}` : ""}`}
              style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
              onClick={() => onSelect?.({ id: node.id, ...node.task })}
            >
              <span className="process-node__icon"><Icon size={15} /></span>
              <span className="process-node__copy">
                <small>{node.task?.type || "task"}</small>
                <strong>{nodeLabel(node.id, node.task)}</strong>
              </span>
              {status && <span className="process-node__status">{status}</span>}
            </button>
          );
        })}

        <div className="process-graph__legend" aria-hidden="true">
          <IconArrowRight size={14} /> dependency
        </div>
      </div>
    </div>
  );
}
