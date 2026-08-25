import axios from "axios";

export const SEND_REQUEST_TIMEOUT_MS = 60_000;

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://127.0.0.1:3002",
  timeout: 2700000,
});

let stateBridge = null;
let pendingMutationRevision = null;

export const setOfficeStateBridge = bridge => {
  stateBridge = bridge && typeof bridge.read === "function" ? bridge : null;
  if (!stateBridge) pendingMutationRevision = null;
};

const isConversationSend = config => {
  const method = String(config.method || "get").toLowerCase();
  const path = String(config.url || "").split("?", 1)[0];

  return (
    (method === "post" && /\/conversations\/[^/]+\/requests$/.test(path))
    || (method === "patch" && /\/conversations\/[^/]+\/messages\/[^/]+$/.test(path))
  );
};

const decodePart = value => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const stateBackedRead = (url, snapshot) => {
  if (!snapshot?.state) return { matched: false, data: null };
  const path = String(url || "").split("?", 1)[0];
  const parts = path.split("/").filter(Boolean).map(decodePart);
  const state = snapshot.state;

  if (parts.length === 1 && parts[0] === "models") {
    return { matched: true, data: state.models || [] };
  }
  if (parts.length === 1 && parts[0] === "conversations") {
    return { matched: true, data: state.conversations || [] };
  }
  if (parts[0] !== "conversations" || !parts[1]) return { matched: false, data: null };

  const conversationId = parts[1];
  if (parts.length === 2) {
    const conversation = (state.conversations || []).find(item => item.id === conversationId) || null;
    return { matched: true, data: conversation };
  }
  if (parts.length === 3 && parts[2] === "attachments") {
    return { matched: true, data: state.attachments?.[conversationId] || [] };
  }
  if (parts.length === 3 && parts[2] === "artifacts") {
    return { matched: true, data: state.artifacts?.[conversationId] || [] };
  }

  return { matched: false, data: null };
};

const localStateAdapter = config => async () => {
  if (pendingMutationRevision !== null && stateBridge?.waitForRevision) {
    const waitingFor = pendingMutationRevision;
    await stateBridge.waitForRevision(waitingFor, 2_500);
    if (pendingMutationRevision === waitingFor) pendingMutationRevision = null;
  }

  const snapshot = stateBridge?.read?.() || null;
  const resolved = stateBackedRead(config.url, snapshot);
  if (!resolved.matched) throw new Error(`State-backed request no longer matches: ${config.url}`);

  return {
    data: structuredClone(resolved.data),
    status: resolved.data === null ? 404 : 200,
    statusText: resolved.data === null ? "Not Found" : "OK",
    headers: {},
    config,
    request: null,
  };
};

api.interceptors.request.use(config => {
  if (isConversationSend(config)) config.timeout = SEND_REQUEST_TIMEOUT_MS;

  const method = String(config.method || "get").toLowerCase();
  if (method === "get" && stateBridge) {
    const resolved = stateBackedRead(config.url, stateBridge.read());
    if (resolved.matched) config.adapter = localStateAdapter(config);
  } else if (method !== "get" && stateBridge) {
    config.__officeStateRevision = stateBridge.read()?.revision ?? null;
  }

  return config;
});

api.interceptors.response.use(response => {
  const method = String(response.config?.method || "get").toLowerCase();
  if (method !== "get" && Number.isSafeInteger(response.config?.__officeStateRevision)) {
    const baseline = response.config.__officeStateRevision;
    pendingMutationRevision = pendingMutationRevision === null
      ? baseline
      : Math.max(pendingMutationRevision, baseline);
  }
  return response;
}, error => Promise.reject(error));

export const endpoints = {
  ping: () => "/ping",
  health: () => "/health",
  models: () => "/models",
  nora: () => "/nora",
  events: () => "/events",

  conversations: () => "/conversations",
  conversation: id => `/conversations/${id}`,
  conversationMessage: (id, messageId) => `/conversations/${id}/messages/${messageId}`,
  conversationModel: id => `/conversations/${id}/model`,
  conversationRequest: id => `/conversations/${id}/requests`,
  conversationAttachments: id => `/conversations/${id}/attachments`,
  conversationAttachment: (id, attachmentId) => `/conversations/${id}/attachments/${attachmentId}`,
  conversationArtifacts: id => `/conversations/${id}/artifacts`,
  conversationArtifact: (id, artifactId) => `/conversations/${id}/artifacts/${artifactId}`,

  processes: () => "/processes",
  process: id => `/processes/${id}`,

  workflows: () => "/workflows",
  workflow: id => `/workflows/${id}`,
  workflowInspect: id => `/workflows/${id}/inspect`,
  workflowRun: id => `/workflows/${id}/run`,
  workflowStop: id => `/workflows/${id}/stop`,
  workflowResume: id => `/workflows/${id}/resume`,
  workflowRestart: id => `/workflows/${id}/restart`,
  workflowCancel: id => `/workflows/${id}/cancel`,
  workflowInputs: id => `/workflows/${id}/inputs`,
  workflowConfig: id => `/workflows/${id}/config`,
  workflowEdges: id => `/workflows/${id}/edges`,
  workflowTask: (id, taskId) => `/workflows/${id}/tasks/${taskId}`,
  workflowTaskSkip: (id, taskId) => `/workflows/${id}/tasks/${taskId}/skip`,
  workflowTaskCancel: (id, taskId) => `/workflows/${id}/tasks/${taskId}/cancel`,
  workflowTaskReview: (id, taskId) => `/workflows/${id}/tasks/${taskId}/review`,
  workflowPromote: id => `/workflows/${id}/promote`,

  approvals: () => "/approvals",
  approvalApprove: id => `/approvals/${id}/approve`,
  approvalReject: id => `/approvals/${id}/reject`,

  agentsActive: () => "/agents/active",

  tools: () => "/tools",
  tool: name => `/tools/${name}`,
  toolRun: name => `/tools/${name}/run`,
  skills: () => "/skills",

  credentials: () => "/credentials",
  credential: service => `/credentials/${encodeURIComponent(service)}`,
  variables: () => "/variables",
  variable: key => `/variables/${encodeURIComponent(key)}`,
  knowledge: () => "/knowledge",

  providers: (refresh = false) => `/providers${refresh ? "?refresh=1" : ""}`,
  providerModel: (provider, model) => `/providers/${encodeURIComponent(provider)}/models/${encodeURIComponent(model)}`,

  schedules: () => "/schedules",
  schedule: id => `/schedules/${id}`,
  scheduleTrigger: id => `/schedules/${id}/trigger`,
};

export default api;
