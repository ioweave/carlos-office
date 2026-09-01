import axios from "axios";

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const localBackendHost = hostname => {
  const value = String(hostname || "").toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return value === "localhost"
    || value === "0.0.0.0"
    || value === "::"
    || value === "::1"
    || value.startsWith("127.");
};
const defaultApiUrl = () => {
  const url = new URL(window.location.origin);
  url.port = "3002";
  return url.origin;
};
const resolveApiUrl = () => {
  if (!configuredApiUrl) return defaultApiUrl();
  try {
    const url = new URL(configuredApiUrl, window.location.href);
    if (localBackendHost(url.hostname)) url.hostname = new URL(window.location.href).hostname;
    return url.toString().replace(/\/$/, "");
  } catch (error) {
    console.error("[api] Ignoring invalid VITE_API_URL.", {
      value: configuredApiUrl,
      message: error instanceof Error ? error.message : String(error),
    });
    return defaultApiUrl();
  }
};

const api = axios.create({
  baseURL: resolveApiUrl(),
  timeout: 2700000,
});

export const endpoints = {
  health: () => "/health",
  models: () => "/models",
  nora: () => "/nora",
  events: () => "/events",

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
  workflowDesign: id => `/workflows/${id}/design`,
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
  provider: provider => `/providers/${encodeURIComponent(provider)}`,
  providerTest: () => "/providers/test-connection",
  providerModels: provider => `/providers/${encodeURIComponent(provider)}/models`,
  providerModel: (provider, model) => `/providers/${encodeURIComponent(provider)}/models/${encodeURIComponent(model)}`,

  schedules: () => "/schedules",
  schedule: id => `/schedules/${id}`,
  scheduleTrigger: id => `/schedules/${id}/trigger`,
};

export default api;
