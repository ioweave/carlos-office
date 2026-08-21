import { randomUUID } from "node:crypto";

import {
  addTaskAttempt,
  getWorkflow,
  listTaskAttempts,
  setTaskStatus,
  updateTaskAttempt,
} from "./ProcessController.mjs";
import { getAgent, getBlueprint, setAgentStatus } from "./AgentController.mjs";
import { authorize, consumeApproval, listApprovals } from "./AuthorizationController.mjs";
import { recordEvent } from "./EventController.mjs";
import { getTool } from "../registry/Tools.mjs";
import { getSkill } from "../registry/Skills.mjs";

const MAX_TOOL_ROUNDS = 12;
const activeTaskControllers = new Map();
let providers = new Map();

export const setProviders = providerMap => {
  if (!(providerMap instanceof Map)) throw new Error("Providers must be supplied as a Map");
  providers = providerMap;
};

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const taskRunKey = (workflowId, taskId) => `${workflowId}\u0000${taskId}`;

const requireWorkflow = workflowId => {
  const workflow = getWorkflow(workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
  return workflow;
};

const requireTask = (workflow, taskId) => {
  const task = workflow.tasks?.[taskId];
  if (!task || task.type !== "task") throw new Error(`Unknown executable Task: ${taskId}`);
  return task;
};

const requireAgent = agentId => {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);

  const blueprint = getBlueprint(agent.blueprint);
  if (!blueprint) throw new Error(`Unknown Agent Blueprint: ${agent.blueprint}`);
  return { agent, blueprint };
};

const requireProvider = name => {
  const provider = providers.get(name);
  if (!provider) throw new Error(`Unknown model provider: ${name}`);
  if (typeof provider.generate !== "function") throw new Error(`Model provider ${name} does not expose generate()`);
  return provider;
};

const getUpstreamTaskIds = (workflow, taskId) => workflow.edges
  .filter(([, to]) => to === taskId)
  .map(([from]) => from)
  .filter(id => workflow.tasks[id]?.type === "task");

const latestCompletedAttempt = task => [...(task.attempts ?? [])]
  .reverse()
  .find(attempt => attempt.status === "completed") ?? null;

const resolveTaskInput = (workflow, taskId, task) => {
  const available = structuredClone(workflow.inputs ?? {});

  for (const upstreamId of getUpstreamTaskIds(workflow, taskId)) {
    const upstream = workflow.tasks[upstreamId];
    const attempt = latestCompletedAttempt(upstream);
    if (!attempt) continue;

    if (upstream.output) available[upstream.output] = structuredClone(attempt.output);
    available[upstreamId] = structuredClone(attempt.output);
  }

  if (!Array.isArray(task.inputs) || !task.inputs.length) return available;

  return Object.fromEntries(
    task.inputs
      .filter(name => Object.prototype.hasOwnProperty.call(available, name))
      .map(name => [name, available[name]]),
  );
};

const loadTools = names => {
  if (!Array.isArray(names)) throw new Error("Tools must be an array");

  return names.map(name => {
    const tool = getTool(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool;
  });
};

const loadSkills = names => {
  if (!Array.isArray(names)) throw new Error("Skills must be an array");

  return names.map(name => {
    const skill = getSkill(name);
    if (!skill) throw new Error(`Unknown skill: ${name}`);
    return skill;
  });
};

const describeTools = tools => tools.map(tool => ({
  name: tool.name,
  description: tool.description ?? "",
  input: tool.input ?? {},
  output: tool.output ?? null,
}));

const buildMessages = ({ blueprint, workflow, taskId, task, input, skills }) => {
  const messages = [];

  if (blueprint.instructions) messages.push({ role: "system", content: blueprint.instructions });
  if (skills.length) {
    messages.push({
      role: "system",
      content: [
        "The following Skills are available for this Task:",
        ...skills.map(skill => `\n# Skill: ${skill.name}\n${skill.content}`),
      ].join("\n"),
    });
  }

  messages.push({
    role: "system",
    content: [
      "You are executing one Task inside Carlos Office.",
      `Workflow: ${workflow.id}`,
      `Task: ${taskId}`,
      `Objective:\n${task.objective ?? ""}`,
      `Completion criteria:\n${task.completion ?? ""}`,
      `Resolved input:\n${JSON.stringify(input, null, 2)}`,
    ].join("\n\n"),
  });
  messages.push({
    role: "user",
    content: "Perform the Task. Use available Tools when needed. Return the completed Task output when finished.",
  });

  return messages;
};

const resultToText = result => {
  if (typeof result === "string") return result;
  if (Buffer.isBuffer(result)) return result.toString("utf8");
  if (result === undefined) return "";
  return JSON.stringify(result, null, 2);
};

const sameInput = (left, right) => {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

const findApprovedToolAction = ({ workflowId, taskId, toolName, input }) => listApprovals("approved").find(
  approval => (
    approval.action === `tool:${toolName}`
    && approval.context?.workflowId === workflowId
    && approval.context?.taskId === taskId
    && sameInput(approval.context?.input, input)
  ),
) ?? null;

const finishAttempt = async ({
  workflowId,
  taskId,
  attemptId,
  status,
  output = null,
  error = null,
  blockedReason = null,
  extra = {},
}) => updateTaskAttempt(workflowId, taskId, attemptId, {
  status,
  endedAt: new Date().toISOString(),
  output,
  error,
  blockedReason,
  ...extra,
});

const logSecondaryFailure = (stage, context, error) => {
  console.error(`[tasks] ${stage} failed while handling another Task failure.`, {
    ...context,
    message: error instanceof Error ? error.message : String(error),
  });
};

const cancellationMessage = signal => {
  if (signal.reason instanceof Error) return signal.reason.message;
  if (signal.reason) return String(signal.reason);
  return "Workflow cancelled";
};

const throwIfCancelled = signal => {
  if (!signal.aborted) return;
  const error = signal.reason instanceof Error ? signal.reason : new Error(cancellationMessage(signal));
  error.name = "AbortError";
  throw error;
};

export const cancelWorkflowTasks = (workflowId, reason = "Workflow cancelled") => {
  let cancelled = 0;

  for (const [key, controller] of activeTaskControllers) {
    if (!key.startsWith(`${workflowId}\u0000`) || controller.signal.aborted) continue;
    controller.abort(new Error(reason));
    cancelled += 1;
  }

  return cancelled;
};

export const runTask = async ({
  workflowId,
  taskId,
  agentId,
  provider: providerName,
  model,
  input = null,
  tools = null,
  skills = null,
}) => {
  const workflow = requireWorkflow(workflowId);
  const task = requireTask(workflow, taskId);
  if (task.status !== "ready") throw new Error(`Task ${taskId} is ${task.status}, not ready`);

  const { agent, blueprint } = requireAgent(agentId);
  const provider = requireProvider(providerName);
  if (!model || typeof model !== "string") throw new Error("Model must be a non-empty string");

  const previousAttempts = listTaskAttempts(workflowId, taskId);
  if (previousAttempts.some(attempt => attempt.status === "running")) {
    throw new Error(`Task ${taskId} already has an active Attempt`);
  }

  const runKey = taskRunKey(workflowId, taskId);
  if (activeTaskControllers.has(runKey)) throw new Error(`Task ${taskId} already has an active execution`);

  const controller = new AbortController();
  const { signal } = controller;
  activeTaskControllers.set(runKey, controller);

  const toolNames = tools === null ? [...(task.tools ?? [])] : [...tools];
  const skillNames = skills === null ? [...(task.skills ?? [])] : [...skills];
  const actualInput = input === null ? resolveTaskInput(workflow, taskId, task) : structuredClone(input);
  const attempt = {
    id: `attempt-${randomUUID()}`,
    workflowId,
    taskId,
    attempt: previousAttempts.length + 1,
    agent: agent.id,
    provider: providerName,
    model,
    status: "running",
    input: actualInput,
    tools: toolNames,
    skills: skillNames,
    startedAt: new Date().toISOString(),
    endedAt: null,
    output: null,
    error: null,
    blockedReason: null,
  };

  let attemptStored = false;

  try {
    throwIfCancelled(signal);
    await addTaskAttempt(workflowId, taskId, attempt);
    attemptStored = true;
    await setTaskStatus(workflowId, taskId, "running");
    setAgentStatus(agent.id, "working");
    await recordEvent("attempt.started", {
      workflowId,
      taskId,
      attemptId: attempt.id,
      agentId: agent.id,
      provider: providerName,
      model,
    });

    const availableTools = loadTools(toolNames);
    const availableSkills = loadSkills(skillNames);
    const messages = buildMessages({
      blueprint,
      workflow,
      taskId,
      task,
      input: actualInput,
      skills: availableSkills,
    });
    const modelTools = describeTools(availableTools);

    let toolRounds = 0;

    while (true) {
      throwIfCancelled(signal);
      const response = await provider.generate({ model, messages, tools: modelTools, signal });
      throwIfCancelled(signal);
      if (!isObject(response)) throw new Error(`Provider ${providerName} returned an invalid response`);

      const content = typeof response.content === "string" ? response.content : "";
      const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];

      if (!toolCalls.length) {
        if (!content.trim()) throw new Error(`Provider ${providerName} returned no usable Task output`);
        throwIfCancelled(signal);

        const completed = await finishAttempt({
          workflowId,
          taskId,
          attemptId: attempt.id,
          status: "completed",
          output: content,
        });
        await setTaskStatus(workflowId, taskId, "completed");
        setAgentStatus(agent.id, "idle");
        await recordEvent("attempt.completed", {
          workflowId,
          taskId,
          attemptId: attempt.id,
          agentId: agent.id,
        });
        return completed;
      }

      if (toolRounds >= MAX_TOOL_ROUNDS) {
        throw new Error(`Task exceeded the ${MAX_TOOL_ROUNDS}-round Tool limit`);
      }
      toolRounds += 1;
      messages.push({ role: "assistant", content, toolCalls: structuredClone(toolCalls) });

      for (const toolCall of toolCalls) {
        throwIfCancelled(signal);
        if (!toolCall || typeof toolCall.name !== "string") {
          throw new Error("Provider returned an invalid Tool call");
        }
        if (toolCall.input != null && !isObject(toolCall.input)) {
          throw new Error(`Provider returned invalid input for Tool: ${toolCall.name}`);
        }

        const tool = availableTools.find(item => item.name === toolCall.name);
        if (!tool) throw new Error(`Agent requested unavailable Tool: ${toolCall.name}`);

        const toolInput = toolCall.input ?? {};
        if (tool.requiresApproval) {
          const approved = findApprovedToolAction({
            workflowId,
            taskId,
            toolName: tool.name,
            input: toolInput,
          });

          if (!approved) {
            const authorization = await authorize({
              action: `tool:${tool.name}`,
              actor: agent.name,
              requiresApproval: true,
              context: {
                workflowId,
                taskId,
                attemptId: attempt.id,
                tool: tool.name,
                input: structuredClone(toolInput),
              },
            });
            const blocked = await finishAttempt({
              workflowId,
              taskId,
              attemptId: attempt.id,
              status: "blocked",
              blockedReason: `Carlos approval required for Tool: ${tool.name}`,
              extra: { approvalId: authorization.approval.id },
            });

            await setTaskStatus(workflowId, taskId, "blocked");
            setAgentStatus(agent.id, "blocked");
            await recordEvent("attempt.blocked", {
              workflowId,
              taskId,
              attemptId: attempt.id,
              agentId: agent.id,
              approvalId: authorization.approval.id,
              tool: tool.name,
            });
            return blocked;
          }

          throwIfCancelled(signal);
          await consumeApproval(approved.id);
        }

        throwIfCancelled(signal);
        const toolResult = await tool.execute(structuredClone(toolInput), {
          workflowId,
          taskId,
          attemptId: attempt.id,
          agentId: agent.id,
          provider: tool.provider ?? null,
          model: tool.model ?? null,
          signal,
        });
        throwIfCancelled(signal);
        await recordEvent("tool.executed", {
          workflowId,
          taskId,
          attemptId: attempt.id,
          agentId: agent.id,
          tool: tool.name,
          provider: tool.provider ?? null,
          model: tool.model ?? null,
        });
        messages.push({
          role: "tool",
          toolCallId: toolCall.id ?? null,
          name: tool.name,
          content: resultToText(toolResult),
        });
      }
    }
  } catch (error) {
    const cancelled = signal.aborted || getWorkflow(workflowId)?.status === "cancelled";
    const message = cancelled ? cancellationMessage(signal) : error instanceof Error ? error.message : String(error);

    if (cancelled) {
      let result = null;
      if (attemptStored) {
        try {
          result = await finishAttempt({
            workflowId,
            taskId,
            attemptId: attempt.id,
            status: "cancelled",
            error: message,
          });
        } catch (finishError) {
          logSecondaryFailure("Attempt cancellation finalization", {
            workflowId,
            taskId,
            attemptId: attempt.id,
          }, finishError);
        }
      }

      try {
        setAgentStatus(agent.id, "cancelled");
      } catch (agentError) {
        logSecondaryFailure("Agent cancellation state", { workflowId, taskId, agentId: agent.id }, agentError);
      }

      try {
        await recordEvent("attempt.cancelled", {
          workflowId,
          taskId,
          attemptId: attempt.id,
          agentId: agent.id,
          error: message,
        });
      } catch (eventError) {
        logSecondaryFailure("Attempt cancellation event", { workflowId, taskId, attemptId: attempt.id }, eventError);
      }

      return result ?? {
        ...structuredClone(attempt),
        status: "cancelled",
        endedAt: new Date().toISOString(),
        error: message,
      };
    }

    let failed = null;
    if (attemptStored) {
      try {
        failed = await finishAttempt({
          workflowId,
          taskId,
          attemptId: attempt.id,
          status: "failed",
          error: message,
        });
      } catch (finishError) {
        logSecondaryFailure("Attempt finalization", { workflowId, taskId, attemptId: attempt.id }, finishError);
      }
    }

    try {
      await setTaskStatus(workflowId, taskId, "failed");
    } catch (statusError) {
      logSecondaryFailure("Task failure persistence", { workflowId, taskId }, statusError);
      throw new Error(`Task ${taskId} failed and its failure state could not be persisted`, { cause: error });
    }

    try {
      setAgentStatus(agent.id, "failed");
    } catch (agentError) {
      logSecondaryFailure("Agent failure state", { workflowId, taskId, agentId: agent.id }, agentError);
    }

    try {
      await recordEvent("attempt.failed", {
        workflowId,
        taskId,
        attemptId: attempt.id,
        agentId: agent.id,
        error: message,
      });
    } catch (eventError) {
      logSecondaryFailure("Attempt failure event", { workflowId, taskId, attemptId: attempt.id }, eventError);
    }

    return failed ?? {
      ...structuredClone(attempt),
      status: "failed",
      endedAt: new Date().toISOString(),
      error: message,
    };
  } finally {
    if (activeTaskControllers.get(runKey) === controller) activeTaskControllers.delete(runKey);
  }
};
