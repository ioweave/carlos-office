import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://127.0.0.1:3002",
  timeout: 2700000,
  headers: { "Content-Type": "application/json" },
});

export const endpoints = {
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
  workflowResume: id => `/workflows/${id}/resume`,
  workflowRestart: id => `/workflows/${id}/restart`,
  workflowCancel: id => `/workflows/${id}/cancel`,
  workflowInputs: id => `/workflows/${id}/inputs`,
  workflowConfig: id => `/workflows/${id}/config`,
  workflowEdges: id => `/workflows/${id}/edges`,
  workflowTask: (id, taskId) => `/workflows/${id}/tasks/${taskId}`,
  workflowTaskSkip: (id, taskId) => `/workflows/${id}/tasks/${taskId}/skip`,
  workflowTaskReview: (id, taskId) => `/workflows/${id}/tasks/${taskId}/review`,
  workflowPromote: id => `/workflows/${id}/promote`,

  approvals: () => "/approvals",
  approvalApprove: id => `/approvals/${id}/approve`,
  approvalReject: id => `/approvals/${id}/reject`,

  agents: () => "/agents",
  agentsActive: () => "/agents/active",
  agentModel: id => `/agents/${id}/model`,

  tools: () => "/tools",
  skills: () => "/skills",

  schedules: () => "/schedules",
  schedule: id => `/schedules/${id}`,
  scheduleTrigger: id => `/schedules/${id}/trigger`,
};

export default api;