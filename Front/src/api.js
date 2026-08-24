import axios from "axios";

export const SEND_REQUEST_TIMEOUT_MS = 60_000;

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://127.0.0.1:3002",
  timeout: 2700000,
});

let mutationListener = null;

export const setOfficeMutationListener = listener => {
  mutationListener = typeof listener === "function" ? listener : null;
};

const isConversationSend = config => {
  const method = String(config.method || "get").toLowerCase();
  const path = String(config.url || "").split("?", 1)[0];

  return (
    (method === "post" && /\/conversations\/[^/]+\/requests$/.test(path))
    || (method === "patch" && /\/conversations\/[^/]+\/messages\/[^/]+$/.test(path))
  );
};

api.interceptors.request.use(config => {
  if (isConversationSend(config)) config.timeout = SEND_REQUEST_TIMEOUT_MS;
  return config;
});

api.interceptors.response.use(
  response => {
    const method = String(response.config?.method || "get").toLowerCase();
    if (method !== "get") mutationListener?.();
    return response;
  },
  error => Promise.reject(error),
);

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

  schedules: () => "/schedules",
  schedule: id => `/schedules/${id}`,
  scheduleTrigger: id => `/schedules/${id}/trigger`,
};

export default api;
