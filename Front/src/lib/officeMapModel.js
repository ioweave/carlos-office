export const COLORS = {
  nora: "#22d3ee", marco: "#f59e0b", luma: "#e879f9", dex: "#60a5fa", iris: "#a78bfa", vera: "#34d399",
};
const STATUS_COLORS = {
  queued: "#94a3b8", running: "#f59e0b", paused: "#fb7185", waiting_authorization: "#fb7185",
  completed: "#4ade80", failed: "#f87171", cancelled: "#64748b",
};
export const ACTIVE = new Set(["queued", "running"]);
export const ATTENTION = new Set(["paused", "waiting_authorization", "failed"]);
export const PACKET_TTL_MS = 60_000;
export const DEFAULT_MAP_VIEW = { yaw: -0.18, pitch: 0.08, zoom: 0.72 };
const DEFAULT_POSITIONS = {
  nora: { x: 0, y: 3.05, z: -0.2 },
  luma: { x: -3.35, y: 1.65, z: -0.3 },
  vera: { x: 3.35, y: 1.65, z: 0.35 },
  marco: { x: -3.15, y: -2.2, z: 0.3 },
  dex: { x: 3.15, y: -2.2, z: -0.15 },
  iris: { x: 0, y: -3.25, z: 0.45 },
};
export const WORKFLOW_SPHERE_RADIUS = 1.65;
const NODE_RADIUS_SCALE = 0.7;
const MAX_WORKFLOW_NODE_RADIUS = 0.19 * NODE_RADIUS_SCALE;
const LAYOUT_KEY = "carlos-office-map-layout-v3";
const VIEW_KEY = "carlos-office-map-view-v1";

export const EMPTY_MAP_DATA = { generatedAt: 0, agents: [], conversations: [], workflows: [], agentInstances: [], processes: [], events: [], runner: { active: [] }, activity: { active: [] } };

const MAP_WORKFLOW_STATUS = {
  pending: "queued", ready: "queued", running: "running", blocked: "waiting_authorization",
  completed: "completed", failed: "failed", cancelled: "cancelled", skipped: "cancelled",
};
const MAP_TASK_STATE = {
  pending: "pending", ready: "pending", running: "running", blocked: "paused",
  completed: "completed", failed: "failed", cancelled: "cancelled", skipped: "cancelled",
};
// Deliberate Agent Instance status mapping for the Office Map renderer.
// working → active packet; blocked → paused/attention; failed → attention; idle → not rendered.
const MAP_INSTANCE_STATE = { working: "working", blocked: "paused", failed: "failed", idle: "idle" };
const VISIBLE_INSTANCE_STATES = new Set(["working", "paused", "failed"]);
const normStatus = status => MAP_WORKFLOW_STATUS[status] || "queued";
const lowerAgent = name => String(name || "nora").toLowerCase();
const deriveTitle = conversation => {
  const messages = conversation?.messages || [];
  const firstCarlos = messages.find(message => String(message.actor || "").toLowerCase() === "carlos" || message.role === "user");
  const text = firstCarlos?.content || firstCarlos?.text || "";
  return (String(text).trim().slice(0, 60) || `Conversation ${conversation?.id || ""}`).trim();
};

// Build the Office Map data model from real backend entities.
// Permanent Agent Blueprint → temporary Agent Instance → Task / Workflow.
// Workflow runtime instances orbit the central Nora sphere.
export const buildOfficeMapData = ({ agents = [], activeAgents = [], workflows = [], conversations = [], approvals = [] } = {}) => {
  const mapAgents = agents.map(agent => {
    const id = lowerAgent(agent.name);
    return {
      agentId: id,
      name: agent.name,
      role: agent.isNora ? "Chief of Staff" : (agent.provider ? `${agent.provider} agent` : "Agent"),
      maxInstances: 1,
      permanent: true,
      enabled: true,
      color: COLORS[id] || "#94a3b8",
      provider: agent.provider || null,
      model: agent.model || null,
    };
  });
  const agentIds = new Set(mapAgents.map(agent => agent.agentId));

  const mapConversations = conversations
    .map(conversation => ({
      conversationId: conversation.id,
      agentId: "nora",
      title: deriveTitle(conversation),
      messageCount: conversation?.messages?.length || 0,
    }))
    .slice(0, 30);

  const mapWorkflows = workflows.slice(0, 100).map(workflow => {
    const tasks = Object.entries(workflow.tasks || {}).map(([taskId, task]) => ({
      taskId,
      name: task.type === "task" ? (task.objective || taskId) : taskId,
      agentId: task.agent ? lowerAgent(task.agent) : null,
      state: MAP_TASK_STATE[task.status] || "pending",
      attempts: task.attempts || [],
    }));
    return {
      workflowId: workflow.id,
      title: workflow.process || workflow.id,
      name: workflow.process || workflow.id,
      status: normStatus(workflow.status),
      tasks,
    };
  });

  const mapInstances = activeAgents
    .map(agent => ({
      instanceId: agent.id,
      label: agent.name,
      agentId: lowerAgent(agent.blueprint),
      workflowId: agent.context?.workflowId || null,
      taskId: agent.taskId || null,
      state: MAP_INSTANCE_STATE[agent.status] || "idle",
    }))
    .filter(instance => agentIds.has(instance.agentId) && VISIBLE_INSTANCE_STATES.has(instance.state))
    .slice(0, 100);

  const now = new Date().toISOString();
  const events = [];
  approvals.filter(approval => approval.status === "pending").forEach(approval => {
    const target = agentIds.has(lowerAgent(approval.actor)) ? lowerAgent(approval.actor) : "nora";
    events.push({
      eventId: `approval-${approval.id}`,
      from: "nora", to: target, fromNode: "agent:nora", toNode: `agent:${target}`,
      tone: "warning", summary: `Authorization required: ${approval.action}`, createdAt: now,
    });
  });
  mapWorkflows.forEach(workflow => {
    const runningTask = workflow.tasks.find(task => task.state === "running");
    if (runningTask) {
      const runningInstance = mapInstances.find(
        instance =>
          instance.workflowId === workflow.workflowId
          && instance.taskId === runningTask.taskId,
      );
      const source = runningInstance?.agentId || runningTask.agentId || "nora";
      events.push({
        eventId: `wf-running-${workflow.workflowId}`,
        from: source, to: "nora", fromNode: `agent:${source}`, toNode: "agent:nora",
        tone: "worker", summary: `${runningTask.name} running`, createdAt: now,
      });
    }
    if (workflow.status === "waiting_authorization") {
      const blockedTask = workflow.tasks.find(task => task.state === "paused") || workflow.tasks[0];
      const source = blockedTask?.agentId || "nora";
      events.push({
        eventId: `wf-blocked-${workflow.workflowId}`,
        from: source, to: "nora", fromNode: `agent:${source}`, toNode: "agent:nora",
        tone: "qc", summary: `${workflow.title} awaiting authorization`, createdAt: now,
      });
    }
  });

  return {
    generatedAt: Date.now(),
    agents: mapAgents,
    conversations: mapConversations,
    workflows: mapWorkflows,
    agentInstances: mapInstances,
    processes: [],
    events,
    runner: { active: mapInstances.map(instance => ({ agentId: instance.agentId })) },
    activity: { active: mapInstances.map(instance => ({ agentId: instance.agentId })) },
  };
};

export const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
export const label = value => String(value || "unknown").replaceAll("_", " ").replaceAll("-", " ");
export const age = value => Date.now() - new Date(value || 0).getTime();
export const eventColor = tone => ({
  danger: "#fb7185", warning: "#f59e0b", success: "#34d399", qc: "#34d399", worker: "#f8fafc", nora: "#22d3ee",
}[tone] || "#67e8f9");
export const rgba = (hex, alpha) => {
  const value = String(hex || "#67e8f9").replace("#", "");
  const normalized = value.length === 3 ? value.split("").map(character => `${character}${character}`).join("") : value.padEnd(6, "0").slice(0, 6);
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
const workflowNodeRadius = workflow => (ATTENTION.has(workflow?.status) ? 0.19 : ACTIVE.has(workflow?.status) ? 0.18 : 0.145) * NODE_RADIUS_SCALE;
const workflowSphereLimit = (nodeRadius = MAX_WORKFLOW_NODE_RADIUS) => Math.max(0, WORKFLOW_SPHERE_RADIUS - nodeRadius * 1.12 - 0.025);

export const constrainWorkflowPosition = (position, nodeRadius = MAX_WORKFLOW_NODE_RADIUS) => {
  const next = { x: Number(position?.x) || 0, y: Number(position?.y) || 0, z: Number(position?.z) || 0 };
  const limit = workflowSphereLimit(nodeRadius);
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
      .filter(([, position]) => Number.isFinite(position?.x) && Number.isFinite(position?.y) && Number.isFinite(position?.z))
      .map(([id, position]) => [id, id.startsWith("workflow:") ? constrainWorkflowPosition(position, MAX_WORKFLOW_NODE_RADIUS) : position]));
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

export const createTopology = (data, layout) => {
  const agents = (data?.agents || []).filter(agent => agent.permanent !== false);
  const conversations = (data?.conversations || []).filter(conversation => conversation.agentId === "nora").slice(0, 3);
  const workflows = (data?.workflows || []).slice(0, 100);
  const instances = (data?.agentInstances || []).filter(instance => VISIBLE_INSTANCE_STATES.has(instance.state)).slice(0, 100);
  const positionFor = (id, fallback) => layout[id] || fallback;
  const agentById = new Map(agents.map(agent => [agent.agentId, agent]));
  const colorForAgent = agentId => agentById.get(agentId)?.color || COLORS[agentId] || "#cbd5e1";
  const agentPositions = Object.fromEntries(agents.map((agent, index) => {
    const angle = unitHash(`agent:${agent.agentId}`) * Math.PI * 2;
    const automatic = DEFAULT_POSITIONS[agent.agentId] || {
      x: Math.cos(angle) * (3.25 + (index % 3) * 0.22),
      y: Math.sin(angle) * (2.7 + (index % 2) * 0.18),
      z: (unitHash(`agent:${agent.agentId}:z`) - 0.5) * 1.2,
    };
    return [agent.agentId, positionFor(`agent:${agent.agentId}`, automatic)];
  }));
  const nodes = agents.map(agent => {
    const activeInstances = instances.filter(instance => instance.agentId === agent.agentId).length;
    const availability = agent.enabled === false ? "Unavailable" : "Available";
    return {
      id: `agent:${agent.agentId}`, kind: "agent", agentId: agent.agentId,
      title: agent.name, subtitle: `${agent.role} · ${availability} · ${activeInstances}/${agent.maxInstances || 1}`, color: colorForAgent(agent.agentId),
      radius: agent.agentId === "nora" ? 0.34 : 0.29,
      position: positionFor(`agent:${agent.agentId}`, agentPositions[agent.agentId] || DEFAULT_POSITIONS.nora), data: agent,
    };
  });
  const links = [];
  const conversationCounts = conversations.reduce((counts, conversation) => counts.set(conversation.agentId, (counts.get(conversation.agentId) || 0) + 1), new Map());
  const conversationIndexes = new Map();

  conversations.forEach(conversation => {
    const center = agentPositions[conversation.agentId] || agentPositions.nora || DEFAULT_POSITIONS.nora;
    const seed = hash(conversation.conversationId);
    const clusterIndex = conversationIndexes.get(conversation.agentId) || 0;
    const row = Math.floor(clusterIndex / 5);
    const rowIndex = clusterIndex % 5;
    const rowSize = Math.min(5, Math.max(1, (conversationCounts.get(conversation.agentId) || 1) - row * 5));
    const distance = Math.max(1, Math.hypot(center.x, center.y));
    const outwardX = center.x / distance;
    const outwardY = center.y / distance;
    const tangentX = -outwardY;
    const tangentY = outwardX;
    const outwardOffset = 0.7 + row * 0.28 + ((seed >>> 8) % 18) / 180;
    const tangentOffset = (rowIndex - (rowSize - 1) / 2) * 0.27;
    const id = `conversation:${conversation.conversationId}`;
    conversationIndexes.set(conversation.agentId, clusterIndex + 1);
    nodes.push({
      id, kind: "conversation", title: conversation.title, subtitle: `${conversation.messageCount} messages`,
      color: colorForAgent(conversation.agentId), radius: (0.095 + Math.min(conversation.messageCount || 0, 20) * 0.002) * NODE_RADIUS_SCALE,
      position: positionFor(id, {
        x: center.x + outwardX * outwardOffset + tangentX * tangentOffset,
        y: center.y + outwardY * outwardOffset + tangentY * tangentOffset,
        z: center.z + (((seed >>> 16) % 100) / 100 - 0.5) * 0.85,
      }),
      agentId: conversation.agentId, data: conversation,
    });
    links.push({ from: `agent:${conversation.agentId}`, to: id, kind: "conversation" });
  });

  workflows.forEach(workflow => {
    const id = `workflow:${workflow.workflowId}`;
    const nodeRadius = workflowNodeRadius(workflow);
    const limit = workflowSphereLimit(nodeRadius) * 0.94;
    const radialDistance = limit * Math.cbrt(unitHash(`${id}:radius`));
    const vertical = unitHash(`${id}:vertical`) * 2 - 1;
    const angle = unitHash(`${id}:angle`) * Math.PI * 2;
    const planar = Math.sqrt(Math.max(0, 1 - vertical ** 2));
    const automaticPosition = { x: radialDistance * planar * Math.cos(angle), y: radialDistance * vertical, z: radialDistance * planar * Math.sin(angle) };
    const runningTask = workflow.tasks?.find(task => task.state === "running");
    const runningInstance = runningTask
      ? instances.find(
        instance =>
          instance.workflowId === workflow.workflowId
            && instance.taskId === runningTask.taskId,
      )
      : null;
    const activeAgentId = runningInstance?.agentId || runningTask?.agentId || "nora";
    nodes.push({
      id, kind: "workflow", title: workflow.title,
      subtitle: `${label(workflow.status)} · ${workflow.tasks?.filter(task => task.state === "completed").length || 0}/${workflow.tasks?.length || 0} tasks`,
      color: STATUS_COLORS[workflow.status] || colorForAgent(activeAgentId) || "#94a3b8",
      radius: nodeRadius, active: ACTIVE.has(workflow.status), attention: ATTENTION.has(workflow.status),
      position: constrainWorkflowPosition(positionFor(id, automaticPosition), nodeRadius),
      agentId: activeAgentId, data: workflow,
    });
    links.push({ from: "agent:nora", to: id, kind: "workflow" });
    [...new Set((workflow.tasks || []).map(task => task.agentId).filter(Boolean))].forEach(agentId => {
      const hasInstance = instances.some(
        instance =>
          instance.workflowId === workflow.workflowId
          && instance.agentId === agentId
          && workflow.tasks?.some(task => task.taskId === instance.taskId),
      );
      if (!hasInstance) links.push({ from: id, to: `agent:${agentId}`, kind: "collaboration" });
    });
  });

  instances.forEach((instance, index) => {
    const center = agentPositions[instance.agentId] || agentPositions.nora;
    const angle = unitHash(instance.instanceId) * Math.PI * 2;
    const id = `instance:${instance.instanceId}`;
    nodes.push({
      id, kind: "instance", title: instance.label, subtitle: label(instance.state), color: colorForAgent(instance.agentId),
      radius: 0.09, active: instance.state === "working", attention: instance.state === "paused",
      position: positionFor(id, { x: center.x + Math.cos(angle) * (0.66 + (index % 3) * 0.08), y: center.y + Math.sin(angle) * (0.66 + (index % 3) * 0.08), z: center.z + (unitHash(`${id}:z`) - 0.5) * 0.45 }),
      agentId: instance.agentId, data: instance,
    });
    links.push({ from: `agent:${instance.agentId}`, to: id, kind: "instance" });
    const workflow = workflows.find(
      item =>
        item.workflowId === instance.workflowId
        && item.tasks?.some(task => task.taskId === instance.taskId),
    );
    if (workflow) links.push({ from: id, to: `workflow:${workflow.workflowId}`, kind: "instance-workflow" });
  });
  return { nodes, links };
};