import {
  getProcess,
  listProcesses,
  saveProcess,
  createWorkflow,
  createAdHocWorkflow,
  getWorkflow,
  getReadyTasks,
  editTask,
  setTaskStatus,
  setWorkflowConfig,
  setWorkflowResult,
} from "./ProcessController.mjs";
import {
  getBlueprint,
  getNoraBlueprint,
  listBlueprints,
  setBlueprintModel,
  createAgent,
  disposeAgent,
} from "./AgentController.mjs";
import { runTask } from "./TaskController.mjs";
import {
  createConversation as persistConversation,
  getConversation,
  setConversationNoraModel,
  addMessage,
  addWorkflow,
} from "./ConversationController.mjs";
import { listApprovals } from "./AuthorizationController.mjs";
import { recordEvent } from "./EventController.mjs";
import { listTools, saveTool } from "../registry/Tools.mjs";
import { listSkills, saveSkill } from "../registry/Skills.mjs";

let providers = new Map();

const state = {
  name: "Nora",
  status: "idle",
  activeWorkflows: new Set(),
};

export const setProviders = (providerMap) => {
  if (!(providerMap instanceof Map)) throw new Error("Providers must be supplied as a Map");
  providers = providerMap;
}

const validateSelection = ({ provider, model }) => {
  if (!provider || typeof provider !== "string") throw new Error("Provider must be a non-empty string");
  if (!model || typeof model !== "string") throw new Error("Model must be a non-empty string");
  if (!providers.has(provider)) throw new Error(`Unknown model provider: ${provider}`);

  return {
    provider: provider.trim(),
    model: model.trim(),
  };
}

const selectionFrom = (value) => {
  if (!value?.provider && !value?.model) return null;
  if (!value?.provider || !value?.model) throw new Error("Provider and model must be configured together");
  return validateSelection(value);
}

const getDefaultNoraSelection = () => {
  const blueprint = getNoraBlueprint();
  if (!blueprint) throw new Error("Nora.md was not found in ObsidianVault/90-System/Agents");
  return selectionFrom(blueprint);
}

const getWorkflowNoraSelection = (workflow) => selectionFrom(workflow.config?.nora) ?? getDefaultNoraSelection();

export const initializeNora = () => {
  getDefaultNoraSelection();
  refreshNoraStatus();
  return getNoraState();
}

export const getNoraState = () => {
  const blueprint = getNoraBlueprint();

  return {
    name: state.name,
    status: state.status,
    provider: blueprint?.provider ?? null,
    model: blueprint?.model ?? null,
    activeWorkflows: [...state.activeWorkflows],
  };
}

export const listModels = () => [...providers.entries()].map(([name, provider]) => ({
  provider: name,
  models: Array.isArray(provider.models) ? [...provider.models] : [],
}));

export const setAgentModel = async (name, selection) => setBlueprintModel(name, validateSelection(selection));

export const createConversation = async ({
  id = null,
  provider = null,
  model = null,
} = {}) => {
  let selection;

  if (provider || model) {
    selection = validateSelection({ provider, model });
    await setBlueprintModel("Nora", selection);
  } else {
    selection = getDefaultNoraSelection();
  }

  return persistConversation({ id, nora: selection });
}

export const setConversationModel = async (conversationId, selection) => {
  const selected = validateSelection(selection);

  await setBlueprintModel("Nora", selected);
  const conversation = await setConversationNoraModel(conversationId, selected);

  for (const workflowId of conversation.workflows) {
    const workflow = getWorkflow(workflowId);
    if (!workflow || ["completed", "cancelled"].includes(workflow.status)) continue;

    await setWorkflowConfig(workflowId, {
      ...(workflow.config ?? {}),
      nora: structuredClone(selected),
    });
  }

  return conversation;
}

const requireProvider = (selection) => {
  const selected = validateSelection(selection);
  const provider = providers.get(selected.provider);

  if (typeof provider?.generate !== "function") {
    throw new Error(`Model provider ${selected.provider} does not expose generate()`);
  }

  return { provider, selection: selected };
}

const parseJson = (content) => {
  if (typeof content !== "string" || !content.trim()) throw new Error("Nora returned an empty response");

  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const source = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("Nora did not return valid JSON");
    return JSON.parse(source.slice(start, end + 1));
  }
}

const askNoraForJson = async (instruction, context, modelSelection) => {
  const { provider, selection } = requireProvider(modelSelection);
  const blueprint = getNoraBlueprint();
  const messages = [];

  if (blueprint.instructions) {
    messages.push({
      role: "system",
      content: blueprint.instructions,
    });
  }

  messages.push({
    role: "system",
    content: [
      "You are Nora, the Chief of Staff of Carlos Office.",
      "Carlos is the final human authority.",
      "Return only valid JSON for this decision.",
      "Do not wrap the JSON in explanation.",
    ].join("\n"),
  });

  messages.push({
    role: "user",
    content: [
      instruction,
      "",
      "Context:",
      JSON.stringify(context, null, 2),
    ].join("\n"),
  });

  const response = await provider.generate({
    model: selection.model,
    messages,
    tools: [],
  });

  return parseJson(response?.content);
}

const refreshNoraStatus = () => {
  let working = false;
  let blocked = false;

  for (const workflowId of [...state.activeWorkflows]) {
    const workflow = getWorkflow(workflowId);

    if (!workflow || ["completed", "cancelled"].includes(workflow.status)) {
      state.activeWorkflows.delete(workflowId);
      continue;
    }

    working = true;
    if (workflow.status === "blocked") blocked = true;
  }

  state.status = blocked ? "blocked" : working ? "working" : "idle";
  return state.status;
}

const summarizeProcesses = () => listProcesses().map(({ name, purpose = "", inputs = [] }) => ({
  name,
  purpose,
  inputs,
}));

const summarizeAgents = () => listBlueprints()
  .filter((blueprint) => !blueprint.isNora)
  .map(({ name, provider, model, instructions }) => ({
    name,
    provider,
    model,
    instructions,
  }));

const summarizeTools = () => listTools().map((tool) => ({
  name: tool.name,
  description: tool.description ?? "",
  requiresApproval: Boolean(tool.requiresApproval),
  provider: tool.provider ?? null,
  model: tool.model ?? null,
}));

const summarizeSkills = () => listSkills().map(({ name, content }) => ({
  name,
  content,
}));

const conversationForModel = (conversation) => conversation.messages.map(({ actor, content, artifacts = [] }) => ({
  actor,
  content,
  artifacts,
}));

const ensureConversationSelection = async (conversation) => {
  const selected = selectionFrom(conversation.nora);
  if (selected) return selected;

  const fallback = getDefaultNoraSelection();
  await setConversationNoraModel(conversation.id, fallback);
  return fallback;
}

const addNoraMessage = async (conversationId, content) => addMessage(conversationId, {
  actor: "Nora",
  content,
});

const toolMetadata = (tool) => ({
  name: tool.name,
  description: tool.description ?? "",
  requiresApproval: Boolean(tool.requiresApproval),
  provider: tool.provider ?? null,
  model: tool.model ?? null,
});

export const handleCarlosRequest = async ({
  conversationId,
  content,
  artifacts = [],
}) => {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Carlos request must be a non-empty string");
  }

  let conversation = await getConversation(conversationId);
  if (!conversation) throw new Error(`Unknown conversation: ${conversationId}`);

  const noraSelection = await ensureConversationSelection(conversation);

  await addMessage(conversationId, {
    actor: "Carlos",
    content,
    artifacts,
  });

  state.status = "working";
  await recordEvent("nora.request_received", { conversationId });

  try {
    conversation = await getConversation(conversationId);

    const decision = await askNoraForJson(
      [
        "Decide how Carlos's latest request should be handled.",
        "",
        "Allowed actions:",
        '- \"respond\": answer directly without a Workflow.',
        '- \"clarify\": ask Carlos for required information.',
        '- \"process\": instantiate an existing Process.',
        '- \"adhoc\": create a new ad-hoc Workflow.',
        '- \"tool\": create or update a reusable executable Tool when Carlos asks for a capability that must execute code.',
        '- \"skill\": create or update reusable Markdown guidance when Carlos asks for procedural knowledge or a playbook.',
        "",
        "For a Tool, return complete valid ESM source with no Markdown fences. The module must export a Tool object as default or as `tool`.",
        "For a Skill, return complete Markdown content.",
        "",
        "Return one of:",
        '{\"action\":\"respond\",\"response\":\"...\"}',
        '{\"action\":\"clarify\",\"response\":\"...\"}',
        '{\"action\":\"process\",\"process\":\"Process Name\",\"inputs\":{},\"config\":{},\"response\":\"optional\"}',
        '{\"action\":\"adhoc\",\"workflow\":{\"start\":\"start\",\"end\":\"end\",\"tasks\":{},\"edges\":[]},\"inputs\":{},\"config\":{},\"response\":\"optional\"}',
        '{\"action\":\"tool\",\"name\":\"tool-name\",\"source\":\"complete ESM source\",\"response\":\"optional\"}',
        '{\"action\":\"skill\",\"name\":\"skill-name\",\"content\":\"complete Markdown\",\"response\":\"optional\"}',
      ].join("\n"),
      {
        conversation: conversationForModel(conversation),
        availableProcesses: summarizeProcesses(),
        availableTools: summarizeTools(),
        availableSkills: summarizeSkills(),
      },
      noraSelection,
    );

    if (["respond", "clarify"].includes(decision.action)) {
      if (typeof decision.response !== "string" || !decision.response.trim()) {
        throw new Error(`Nora ${decision.action} decision requires a response`);
      }

      const message = await addNoraMessage(conversationId, decision.response);
      refreshNoraStatus();

      return {
        action: decision.action,
        message,
        workflow: null,
      };
    }

    if (decision.action === "tool") {
      if (!decision.name || typeof decision.name !== "string") throw new Error("Nora Tool decision requires a name");
      if (!decision.source || typeof decision.source !== "string") throw new Error("Nora Tool decision requires source");

      const tool = await createOrUpdateTool(decision.name, decision.source);
      const message = await addNoraMessage(
        conversationId,
        decision.response?.trim() || `Tool ${tool.name} saved.`,
      );

      refreshNoraStatus();
      return {
        action: "tool",
        message,
        workflow: null,
        tool: toolMetadata(tool),
      };
    }

    if (decision.action === "skill") {
      if (!decision.name || typeof decision.name !== "string") throw new Error("Nora Skill decision requires a name");

      if (!decision.content || typeof decision.content !== "string") {
        throw new Error("Nora Skill decision requires Markdown content");
      }

      const skill = await createOrUpdateSkill(decision.name, decision.content);
      const message = await addNoraMessage(
        conversationId,
        decision.response?.trim() || `Skill ${skill.name} saved.`,
      );

      refreshNoraStatus();
      return {
        action: "skill",
        message,
        workflow: null,
        skill: { name: skill.name },
      };
    }

    const config = {
      ...(decision.config ?? {}),
      nora: structuredClone(noraSelection),
    };

    let workflow;

    if (decision.action === "process") {
      if (!getProcess(decision.process)) throw new Error(`Nora selected unknown Process: ${decision.process}`);
      workflow = await createWorkflow(decision.process, decision.inputs ?? {}, config);
    } else if (decision.action === "adhoc") {
      if (!decision.workflow || typeof decision.workflow !== "object") {
        throw new Error("Nora did not provide an ad-hoc Workflow definition");
      }

      workflow = await createAdHocWorkflow({
        start: decision.workflow.start,
        end: decision.workflow.end,
        tasks: decision.workflow.tasks,
        edges: decision.workflow.edges,
        inputs: decision.inputs ?? {},
        config,
      });
    } else {
      throw new Error(`Unknown Nora action: ${decision.action}`);
    }

    state.activeWorkflows.add(workflow.id);

    await addWorkflow(conversationId, workflow.id);
    await recordEvent("nora.workflow_started", {
      conversationId,
      workflowId: workflow.id,
      process: workflow.process,
    });

    const execution = await runWorkflow(workflow.id);
    const finalWorkflow = execution.workflow;

    if (finalWorkflow.status === "completed") {
      const result = await summarizeWorkflow(finalWorkflow.id);
      const message = await addNoraMessage(conversationId, result.summary);

      refreshNoraStatus();
      return {
        action: decision.action,
        message,
        workflow: getWorkflow(workflow.id),
      };
    }

    const response = decision.response ?? (
      finalWorkflow.status === "blocked"
        ? `Workflow ${workflow.id} is blocked and requires attention.`
        : finalWorkflow.status === "failed"
          ? `Workflow ${workflow.id} stopped because a Task failed.`
          : `Workflow ${workflow.id} is active.`
    );

    const message = await addNoraMessage(conversationId, response);
    refreshNoraStatus();

    return {
      action: decision.action,
      message,
      workflow: finalWorkflow,
    };
  } catch (error) {
    refreshNoraStatus();
    throw error;
  }
}

const resolveTaskModel = (task, agentBlueprint, noraSelection) => (
  selectionFrom(task) ?? selectionFrom(agentBlueprint) ?? noraSelection
);

export const selectTaskExecution = async (workflowId, taskId) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);

  const task = workflow.tasks?.[taskId];
  if (!task || task.type !== "task") throw new Error(`Unknown executable Task: ${taskId}`);

  const noraSelection = getWorkflowNoraSelection(workflow);
  const decision = await askNoraForJson(
    [
      "Choose how this ready Task should be executed.",
      "",
      "Select one Agent Blueprint, zero or more Tools, and zero or more Skills.",
      "Choose the specialist whose instructions best match the Task.",
      "",
      "Agent provider/model is a reasoning default.",
      "A Task provider/model overrides it.",
      "Tool provider/model belongs to that Tool's own execution and must not be used as the Agent reasoning model.",
      "",
      "Return:",
      '{\"agent\":\"Blueprint Name\",\"tools\":[],\"skills\":[]}',
    ].join("\n"),
    {
      workflow: {
        id: workflow.id,
        process: workflow.process,
        inputs: workflow.inputs,
        config: workflow.config,
      },
      task: {
        id: taskId,
        ...task,
      },
      availableAgents: summarizeAgents(),
      availableTools: summarizeTools(),
      availableSkills: summarizeSkills(),
    },
    noraSelection,
  );

  const agents = new Set(summarizeAgents().map((agent) => agent.name));
  const tools = new Set(summarizeTools().map((tool) => tool.name));
  const skills = new Set(summarizeSkills().map((skill) => skill.name));

  if (!agents.has(decision.agent)) {
    throw new Error(`Nora selected unknown Agent Blueprint: ${decision.agent}`);
  }

  if (!Array.isArray(decision.tools) || decision.tools.some((tool) => !tools.has(tool))) {
    throw new Error("Nora selected an invalid Tool set");
  }

  if (!Array.isArray(decision.skills) || decision.skills.some((skill) => !skills.has(skill))) {
    throw new Error("Nora selected an invalid Skill set");
  }

  const agentBlueprint = getBlueprint(decision.agent);
  const modelSelection = resolveTaskModel(task, agentBlueprint, noraSelection);

  return {
    agent: decision.agent,
    tools: decision.tools,
    skills: decision.skills,
    ...modelSelection,
  };
}

export const runWorkflow = async (workflowId) => {
  let workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);

  state.activeWorkflows.add(workflowId);
  refreshNoraStatus();

  const attempts = [];

  while (true) {
    workflow = getWorkflow(workflowId);

    if (["completed", "cancelled", "blocked", "failed"].includes(workflow.status)) break;

    const readyTasks = getReadyTasks(workflowId);
    if (!readyTasks.length) break;

    const batch = await Promise.all(
      readyTasks.map(async (task) => {
        const execution = await selectTaskExecution(workflowId, task.id);
        const agent = createAgent(execution.agent, task.id, { workflowId });

        try {
          return await runTask({
            workflowId,
            taskId: task.id,
            agentId: agent.id,
            provider: execution.provider,
            model: execution.model,
            tools: execution.tools,
            skills: execution.skills,
          });
        } finally {
          disposeAgent(agent.id);
        }
      }),
    );

    attempts.push(...batch);
  }

  workflow = getWorkflow(workflowId);
  refreshNoraStatus();

  return {
    workflow,
    attempts,
  };
}

export const reviewFailedTask = async (workflowId, taskId) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);

  const task = workflow.tasks?.[taskId];
  if (!task || task.type !== "task") throw new Error(`Unknown executable Task: ${taskId}`);
  if (task.status !== "failed") throw new Error(`Task ${taskId} is not failed`);

  const decision = await askNoraForJson(
    [
      "Review this failed Task.",
      "",
      "Retry only if the problem is operational, safe to recover, and does not require new human authority.",
      "",
      "Return one of:",
      '{\"action\":\"retry\",\"reason\":\"...\",\"taskChanges\":{}}',
      '{\"action\":\"escalate\",\"reason\":\"...\"}',
    ].join("\n"),
    { workflowId, taskId, task },
    getWorkflowNoraSelection(workflow),
  );

  if (decision.action === "escalate") {
    await recordEvent("nora.task_escalated", {
      workflowId,
      taskId,
      reason: decision.reason ?? null,
    });
    return decision;
  }

  if (decision.action !== "retry") throw new Error(`Unknown recovery action: ${decision.action}`);

  if (decision.taskChanges && Object.keys(decision.taskChanges).length) {
    await editTask(workflowId, taskId, decision.taskChanges);
  }

  await setTaskStatus(workflowId, taskId, "pending");
  await recordEvent("nora.task_retry_requested", {
    workflowId,
    taskId,
    reason: decision.reason ?? null,
  });

  return decision;
}

export const inspectWorkflow = (workflowId) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) return null;

  return {
    workflow,
    approvals: listApprovals("pending").filter(
      (approval) => approval.context?.workflowId === workflowId,
    ),
  };
}

export const summarizeWorkflow = async (workflowId) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
  if (workflow.status !== "completed") throw new Error(`Workflow ${workflowId} is not completed`);

  const decision = await askNoraForJson(
    [
      "Review this completed Workflow and prepare the result for Carlos.",
      "",
      "Return:",
      '{\"summary\":\"concise useful result for Carlos\",\"result\":null}',
    ].join("\n"),
    { workflow },
    getWorkflowNoraSelection(workflow),
  );

  if (typeof decision.summary !== "string" || !decision.summary.trim()) {
    throw new Error("Nora did not produce a Workflow summary");
  }

  await setWorkflowResult(workflowId, decision.result ?? null);
  await recordEvent("nora.workflow_reviewed", { workflowId });

  return {
    summary: decision.summary,
    result: decision.result ?? null,
  };
}

export const createOrUpdateTool = async (name, source) => {
  const tool = await saveTool(name, source);
  await recordEvent("nora.tool_saved", { tool: name });
  return tool;
}

export const createOrUpdateSkill = async (name, content) => {
  const skill = await saveSkill(name, content);
  await recordEvent("nora.skill_saved", { skill: name });
  return skill;
}

export const promoteWorkflow = async (workflowId, { name, purpose = null }) => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
  if (!name || typeof name !== "string") throw new Error("Promoted Process must have a name");

  const decision = await askNoraForJson(
    [
      "Carlos explicitly instructed you to promote this Workflow into a reusable Process.",
      "",
      "Remove runtime-only state, attempts, timestamps, outputs, errors, and one-off values.",
      "Preserve reusable Task configuration, including explicit provider/model requirements when present.",
      "",
      "Return:",
      '{\"purpose\":\"...\",\"inputs\":[],\"start\":\"start\",\"end\":\"end\",\"tasks\":{},\"edges\":[]}',
    ].join("\n"),
    {
      requestedName: name,
      requestedPurpose: purpose,
      workflow,
    },
    getWorkflowNoraSelection(workflow),
  );

  const cleanTasks = Object.fromEntries(
    Object.entries(decision.tasks ?? workflow.tasks).map(([taskId, task]) => {
      const { status, attempts, ...definition } = task;
      return [taskId, definition];
    }),
  );

  const process = await saveProcess({
    name,
    purpose: purpose ?? decision.purpose ?? "",
    inputs: Array.isArray(decision.inputs) ? decision.inputs : Object.keys(workflow.inputs ?? {}),
    start: decision.start ?? workflow.start,
    end: decision.end ?? workflow.end,
    tasks: cleanTasks,
    edges: Array.isArray(decision.edges) ? decision.edges : workflow.edges,
  });

  await recordEvent("process.promoted", {
    workflowId,
    process: process.name,
  });

  return process;
}