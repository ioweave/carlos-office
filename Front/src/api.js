import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3002",
  timeout: 2700000,
});

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
  conversationRequestJob: (id, requestId) => `/conversations/${id}/requests/${requestId}`,
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
