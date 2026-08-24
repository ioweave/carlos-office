export const COLORS = {
  nora: "#22d3ee",
  conversation: "#a78bfa",
  workflow: "#60a5fa",
  agent: "#f8fafc",
};

const STATUS_COLORS = {
  queued: "#94a3b8",
  running: "#f59e0b",
  waiting_authorization: "#fb7185",
  completed: "#4ade80",
  failed: "#f87171",
  cancelled: "#64748b",
};

export const ACTIVE = new Set(["queued", "running"]);
export const ATTENTION = new Set(["waiting_authorization", "failed"]);
export const PACKET_TTL_MS = 60_000;
export const DEFAULT_MAP_VIEW = { yaw: -0.18, pitch: 0.08, zoom: 0.72 };
export const WORKFLOW_SPHERE_RADIUS = 4.5;
const MAX_WORKFLOW_NODE_RADIUS = 0.13;
const HIDDEN_WORKFLOW_STATES = new Set(["completed", "cancelled", "skipped"]);
const LAYOUT_KEY = "carlos-office-map-layout-v4";
const VIEW_KEY = "carlos-office-map-view-v1";

export const EMPTY_MAP_DATA = {
  generatedAt: 0,
  nora: null,
  conversations: [],
  workflows: [],
  agentInstances: [],
  events: [],
  runner: { active: [] },
  activity: { active: [] },
};

const MAP_WORKFLOW_STATUS = {
  pending: "queued",
  ready: "queued",
  running: "running",
  blocked: "waiting_authorization",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  skipped: "cancelled",
};

const MAP_TASK_STATE = {
  pending: "pending",
  ready: "pending",
  running: "running",
  blocked: "paused",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  skipped: "cancelled",
};

const MAP_INSTANCE_STATE = {
  working: "working",
  blocked: "paused",
  failed: "failed",
  idle: "idle",
};
const VISIBLE_INSTANCE_STATES = new Set(["working", "paused", "failed"]);

const normStatus = status => MAP_WORKFLOW_STATUS[status] || "queued";
const deriveTitle = conversation => {
  const saved = conversation?.title?.trim();
  if (saved) return saved;
  const messages = conversation?.messages || [];
  const firstCarlos = messages.find(message => String(message.actor || "").toLowerCase() === "carlos" || message.role === "user");
  const text = firstCarlos?.content || firstCarlos?.text || "";
  return (String(text).trim().slice(0, 60) || `Conversation ${conversation?.id || ""}`).trim();
};

export const buildOfficeMapData = ({ nora = null, activeAgents = [], workflows = [], conversations = [], approvals = [] } = {}) => {
  const mapConversations = conversations.slice(0, 30).map(conversation => ({
    conversationId: conversation.id,
    title: deriveTitle(conversation),
    messageCount: conversation?.messages?.length || 0,
  }));

  // Operations keeps workflow history. The Office Map represents work that still exists in the office now.
  const mapWorkflows = workflows
    .filter(workflow => !HIDDEN_WORKFLOW_STATES.has(workflow.status))
    .slice(0, 100)
    .map(workflow => ({
      workflowId: workflow.id,
      conversationId: workflow.config?.conversationId || null,
      sourceMessageId: workflow.config?.sourceMessageId || null,
      title: workflow.process || workflow.id,
      name: workflow.process || workflow.id,
      status: normStatus(workflow.status),
      tasks: Object.entries(workflow.tasks || {}).map(([taskId, task]) => ({
        taskId,
        name: task.type === "task" ? (task.objective || taskId) : taskId,
        state: MAP_TASK_STATE[task.status] || "pending",
        attempts: task.attempts || [],
      })),
    }));

  const mapInstances = activeAgents
    .map(agent => ({
      instanceId: agent.id,
      label: agent.id || `agent-${agent.pid}`,
      pid: agent.pid ?? null,
      workflowId: agent.context?.workflowId || null,
      taskId: agent.taskId || null,
      provider: agent.provider || null,
      model: agent.model || null,
      tools: Array.isArray(agent.tools) ? agent.tools : [],
      skills: Array.isArray(agent.skills) ? agent.skills : [],
      state: MAP_INSTANCE_STATE[agent.status] || "idle",
    }))
    .filter(instance => VISIBLE_INSTANCE_STATES.has(instance.state))
    .slice(0, 100);

  const now = new Date().toISOString();
  const events = [];

  mapInstances.forEach(instance => {
    if (!instance.workflowId) return;
    events.push({
      eventId: `agent-running-${instance.instanceId}`,
      from: instance.workflowId,
      to: instance.instanceId,
      fromNode: `workflow:${instance.workflowId}`,
      toNode: `instance:${instance.instanceId}`,
      tone: "worker",
      summary: `${instance.taskId || "Task"} executing`,
      createdAt: now,
    });
  });

  approvals.filter(approval => approval.status === "pending").forEach(approval => {
    const workflowId = approval.context?.workflowId;
    if (!workflowId) return;
    events.push({
      eventId: `approval-${approval.id}`,
      from: workflowId,
      to: "nora",
      fromNode: `workflow:${workflowId}`,
      toNode: "agent:nora",
      tone: "warning",
      summary: `Authorization required: ${approval.action}`,
      createdAt: now,
    });
  });

  const noraActive = mapInstances.length > 0 || mapWorkflows.some(workflow => ACTIVE.has(workflow.status));
  return {
    generatedAt: Date.now(),
    nora: nora ? {
      name: "Nora",
      role: "Chief of Staff",
      status: nora.status || "idle",
      provider: nora.provider || null,
      model: nora.model || null,
      pid: nora.pid ?? null,
    } : null,
    conversations: mapConversations,
    workflows: mapWorkflows,
    agentInstances: mapInstances,
    events,
    runner: { active: noraActive ? [{ agentId: "nora" }] : [] },
    activity: { active: noraActive ? [{ agentId: "nora" }] : [] },
  };
};

export const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
export const label = value => String(value || "unknown").replaceAll("_", " ").replaceAll("-", " ");
export const age = value => Date.now() - new Date(value || 0).getTime();
export const eventColor = tone => ({
  danger: "#fb7185",
  warning: "#f59e0b",
  success: "#34d399",
  qc: "#34d399",
  worker: "#f8fafc",
  nora: "#22d3ee",
}[tone] || "#67e8f9");

export const rgba = (hex, alpha) => {
  const value = String(hex || "#67e8f9").replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map(character => `${character}${character}`).join("")
    : value.padEnd(6, "0").slice(0, 6);
  const number = Number.parseInt(normalized, 16);
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
};

export const hash = value => {
  let result = 2166136261;
  const source = String(value || "");
  for (let index = 0; index < source.length; index += 1) {
    result ^= source.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};

const unitHash = value => (hash(value) + 0.5) / 4_294_967_296;
const workflowNodeRadius = workflow => (ATTENTION.has(workflow?.status) ? 0.13 : ACTIVE.has(workflow?.status) ? 0.12 : 0.105);

export const constrainWorkflowPosition = (position, nodeRadius = MAX_WORKFLOW_NODE_RADIUS) => {
  const next = {
    x: Number(position?.x) || 0,
    y: Number(position?.y) || 0,
    z: Number(position?.z) || 0,
  };
  const limit = Math.max(1, WORKFLOW_SPHERE_RADIUS - nodeRadius);
  const distance = Math.hypot(next.x, next.y, next.z);
  if (!distance || distance <= limit) return next;
  const scale = limit / distance;
  return { x: next.x * scale, y: next.y * scale, z: next.z * scale };
};

export const loadMapView = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
    return {
      yaw: Number.isFinite(saved.yaw) ? saved.yaw : DEFAULT_MAP_VIEW.yaw,
      pitch: Number.isFinite(saved.pitch) ? clamp(saved.pitch, -0.75, 0.75) : DEFAULT_MAP_VIEW.pitch,
      zoom: Number.isFinite(saved.zoom) ? clamp(saved.zoom, 0.45, 2.2) : DEFAULT_MAP_VIEW.zoom,
    };
  } catch (error) {
    console.error("[office-map] Could not restore the saved map view.", error);
    return { ...DEFAULT_MAP_VIEW };
  }
};

export const persistMapView = view => {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); }
  catch (error) { console.error("[office-map] Could not persist the map view.", error); }
};

export const readLayout = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}");
    return Object.fromEntries(Object.entries(parsed)
      .filter(([, position]) => Number.isFinite(position?.x) && Number.isFinite(position?.y) && Number.isFinite(position?.z)));
  } catch (error) {
    console.error("[office-map] Could not restore the saved node layout.", error);
    return {};
  }
};

export const persistLayout = layout => {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); }
  catch (error) { console.error("[office-map] Could not persist the node layout.", error); }
};

export const projectPosition = (position, rect, view, now = 0, reducedMotion = true) => {
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

export const screenDeltaToCameraPlane = (origin, deltaX, deltaY, rect, view) => {
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

const orbitPosition = (seed, index, count, radius, zRange = 0.8) => {
  const angle = (index / Math.max(1, count)) * Math.PI * 2 + unitHash(seed) * 0.55;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    z: (unitHash(`${seed}:z`) - 0.5) * zRange,
  };
};

export const createTopology = (data, layout) => {
  const conversations = data?.conversations || [];
  const workflows = data?.workflows || [];
  const instances = (data?.agentInstances || []).filter(instance => VISIBLE_INSTANCE_STATES.has(instance.state));
  const positionFor = (id, fallback) => layout[id] || fallback;
  const nodes = [];
  const links = [];

  const noraPosition = positionFor("agent:nora", { x: 0, y: 0, z: 0 });
  nodes.push({
    id: "agent:nora",
    kind: "agent",
    agentId: "nora",
    title: "Nora",
    subtitle: `${data?.nora?.role || "Chief of Staff"} · ${label(data?.nora?.status || "idle")}`,
    color: COLORS.nora,
    radius: 0.34,
    active: (data?.nora?.status || "idle") === "working",
    attention: (data?.nora?.status || "idle") === "blocked",
    position: noraPosition,
    data: data?.nora || { name: "Nora", status: "unavailable" },
  });

  const conversationPositions = new Map();
  conversations.forEach((conversation, index) => {
    const ring = Math.floor(index / 10);
    const ringItems = Math.min(10, conversations.length - ring * 10);
    const ringIndex = index % 10;
    const automatic = orbitPosition(
      `conversation:${conversation.conversationId}`,
      ringIndex,
      ringItems,
      1.7 + ring * 0.52,
      1.2,
    );
    const id = `conversation:${conversation.conversationId}`;
    const position = positionFor(id, automatic);
    conversationPositions.set(conversation.conversationId, position);
    nodes.push({
      id,
      kind: "conversation",
      title: conversation.title,
      subtitle: `${conversation.messageCount} messages`,
      color: COLORS.conversation,
      radius: 0.17,
      position,
      data: conversation,
    });
    links.push({ from: "agent:nora", to: id, kind: "conversation" });
  });

  const workflowsByParent = new Map();
  workflows.forEach(workflow => {
    const key = workflow.conversationId || "nora";
    if (!workflowsByParent.has(key)) workflowsByParent.set(key, []);
    workflowsByParent.get(key).push(workflow);
  });

  const workflowPositions = new Map();
  for (const [parent, items] of workflowsByParent.entries()) {
    const center = parent === "nora"
      ? noraPosition
      : conversationPositions.get(parent) || noraPosition;
    items.forEach((workflow, index) => {
      const offset = orbitPosition(
        `workflow:${workflow.workflowId}`,
        index,
        items.length,
        parent === "nora" ? 1.05 : 0.62,
        0.55,
      );
      const automatic = constrainWorkflowPosition({
        x: center.x + offset.x,
        y: center.y + offset.y,
        z: center.z + offset.z,
      }, workflowNodeRadius(workflow));
      const id = `workflow:${workflow.workflowId}`;
      const position = positionFor(id, automatic);
      workflowPositions.set(workflow.workflowId, position);
      nodes.push({
        id,
        kind: "workflow",
        title: workflow.title,
        subtitle: `${label(workflow.status)} · ${workflow.tasks.filter(task => task.state === "completed").length}/${workflow.tasks.length} tasks`,
        color: STATUS_COLORS[workflow.status] || COLORS.workflow,
        radius: workflowNodeRadius(workflow),
        active: ACTIVE.has(workflow.status),
        attention: ATTENTION.has(workflow.status),
        position,
        data: workflow,
      });
      links.push({
        from: parent === "nora" || !conversationPositions.has(parent) ? "agent:nora" : `conversation:${parent}`,
        to: id,
        kind: "workflow",
      });
    });
  }

  const instancesByWorkflow = new Map();
  instances.forEach(instance => {
    if (!instancesByWorkflow.has(instance.workflowId)) instancesByWorkflow.set(instance.workflowId, []);
    instancesByWorkflow.get(instance.workflowId).push(instance);
  });

  for (const [workflowId, items] of instancesByWorkflow.entries()) {
    const center = workflowPositions.get(workflowId) || noraPosition;
    items.forEach((instance, index) => {
      const offset = orbitPosition(`instance:${instance.instanceId}`, index, items.length, 0.4, 0.28);
      const id = `instance:${instance.instanceId}`;
      nodes.push({
        id,
        kind: "instance",
        title: instance.label,
        subtitle: `${instance.taskId || "Task"} · ${instance.model || "model"}`,
        color: COLORS.agent,
        radius: 0.08,
        active: instance.state === "working",
        attention: instance.state === "paused" || instance.state === "failed",
        position: positionFor(id, {
          x: center.x + offset.x,
          y: center.y + offset.y,
          z: center.z + offset.z,
        }),
        data: instance,
      });
      if (workflowPositions.has(workflowId)) {
        links.push({ from: `workflow:${workflowId}`, to: id, kind: "instance" });
      }
    });
  }

  return { nodes, links };
};