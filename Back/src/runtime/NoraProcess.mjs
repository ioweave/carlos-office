import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { NORA_DECISION_SCHEMA } from "../NoraActions.mjs";
import { filterModelOptions, getRoutingModels } from "../controllers/ProviderController.mjs";
import { getNora } from "../registry/Nora.mjs";
import { getKnowledge } from "../services/KnowledgeService.mjs";
import {
  LOOP_REVIEW_SCHEMA,
  TASK_EXECUTION_SELECTION_SCHEMA,
  TASK_RECOVERY_SCHEMA,
  WORKFLOW_GRAPH_SCHEMA,
} from "../services/WorkflowSchema.mjs";

const noraProgram = fileURLToPath(new URL("./nora.mjs", import.meta.url));
const pending = new Map();
let child = null;
let models = [];
let readyPromise = null;

const abortError = () => Object.assign(new Error("Nora request cancelled"), { name: "AbortError", code: "nora_request_cancelled" });

const rejectPending = error => {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
};

const includeConfiguredNoraModel = discovered => {
  const result = Array.isArray(discovered) ? structuredClone(discovered) : [];
  const definition = getNora();
  if (!definition?.provider || !definition?.model) return result;

  let provider = result.find(entry => entry.provider === definition.provider);
  if (!provider) {
    provider = { provider: definition.provider, models: [] };
    result.push(provider);
  }

  if (!Array.isArray(provider.models)) provider.models = [];
  if (!provider.models.includes(definition.model)) provider.models.push(definition.model);
  return result;
};

const defaultFormat = context => {
  if (typeof context?.validationError === "string" && context?.invalidDefinition) return WORKFLOW_GRAPH_SCHEMA;
  if (context?.loop && context?.candidate && context?.task) return LOOP_REVIEW_SCHEMA;
  if (
    context?.task
    && context?.fixed
    && Array.isArray(context?.availableModels)
    && Array.isArray(context?.availableTools)
    && Array.isArray(context?.availableSkills)
  ) {
    return TASK_EXECUTION_SELECTION_SCHEMA;
  }
  if (context?.workflowId && context?.taskId && context?.task) return TASK_RECOVERY_SCHEMA;
  if (
    Array.isArray(context?.conversation)
    && Array.isArray(context?.availableProcesses)
    && Array.isArray(context?.availableTools)
    && Array.isArray(context?.availableSkills)
  ) {
    return NORA_DECISION_SCHEMA;
  }
  return null;
};

const routedDecision = async (instruction, context) => {
  if (!Array.isArray(context?.availableModels) || !context.availableModels.some(entry => Array.isArray(entry?.models))) {
    return { instruction, context };
  }

  const availableModels = await getRoutingModels(context.availableModels);
  return {
    context: { ...context, availableModels },
    instruction: [
      instruction,
      "",
      "Model routing policy:",
      "- availableModels is the complete set of models currently enabled and available for this Task.",
      "- Each capability has supported and enabled values. A capability is eligible only when both are true.",
      "- Infer which special capabilities the Task actually requires: thinking, vision, audio, or embeddings.",
      "- When a special capability is required, select only a model where that capability is eligible.",
      "- Do not infer support from the model name when supported is false or unknown.",
      "- Prefer a model intentionally enabled for the Task's relevant capability instead of using one general model for everything.",
      "- If multiple eligible models are otherwise equally suitable, prefer the lower token cost when cost metadata is known.",
      "- Return a provider/model pair exactly matching one availableModels entry.",
    ].join("\n"),
  };
};

export const startNora = async () => {
  if (child && readyPromise) return readyPromise;

  let spawned;
  const starting = new Promise((resolve, reject) => {
    let started = false;
    spawned = fork(noraProgram, [], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      serialization: "advanced",
    });
    child = spawned;

    spawned.on("message", message => {
      if (child !== spawned) return;
      if (message?.type === "ready") {
        started = true;
        models = includeConfiguredNoraModel(message.models);
        resolve(getNoraProcessState());
        return;
      }

      if (message?.type !== "decision") return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      request.cleanup?.();

      if (message.cancelled) request.reject(abortError());
      else if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
    });

    spawned.once("error", error => {
      if (child === spawned) rejectPending(error);
      if (!started) reject(error);
    });

    spawned.on("exit", (code, signal) => {
      if (child !== spawned) return;
      const error = new Error(`Nora process exited (${signal ?? code ?? "unknown"})`);
      rejectPending(error);
      if (!started) reject(error);
      child = null;
      readyPromise = null;
      models = [];
    });
  });

  readyPromise = starting;
  return starting;
};

export const decide = async ({ definition, selection, instruction, context, format = null, signal = null }) => {
  if (signal?.aborted) throw abortError();
  await startNora();
  const target = child;
  if (!target?.connected) throw new Error("Nora process is not available");

  const id = randomUUID();
  const responseFormat = format ?? defaultFormat(context);
  const routed = await routedDecision(instruction, context);
  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      request.cleanup?.();
      if (target.connected) target.send({ type: "cancel", id });
      reject(abortError());
    };
    const cleanup = () => signal?.removeEventListener("abort", handleAbort);

    pending.set(id, { resolve, reject, cleanup });
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }

    target.send({
      type: "decide",
      id,
      definition: structuredClone(definition),
      selection: structuredClone(selection),
      instruction: routed.instruction,
      context: structuredClone(routed.context),
      knowledge: getKnowledge(),
      format: responseFormat ? structuredClone(responseFormat) : null,
    });
  });
};

export const listModels = () => filterModelOptions(models);

export const getNoraProcessState = () => ({
  pid: child?.pid ?? null,
  running: Boolean(child?.connected),
  status: pending.size ? "working" : "idle",
});

export const stopNora = () => {
  const target = child;
  if (!target) return;
  rejectPending(new Error("Nora process stopped"));
  child = null;
  readyPromise = null;
  models = [];
  target.kill("SIGTERM");
};
