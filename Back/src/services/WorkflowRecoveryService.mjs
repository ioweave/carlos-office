import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { listEvents, recordEvent } from "../controllers/EventController.mjs";
import { atomicWriteFile } from "../lib/AtomicFile.mjs";
import { cleanupExecutionRuntime } from "./ExecutionWorkspaceService.mjs";
import { hydrateWorkflowInvocationJournals } from "./InvocationJournalService.mjs";
import { normalizeGeneratedGraph, validateGraph } from "./WorkflowGraphService.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const workflowsDir = resolve(here, "../../ObsidianVault/System/Workflows");
const INTERRUPTION_REASON = "Backend restarted while LangGraph Workflow execution was active";

const latestRunMarker = workflowId => {
  const events = [
    ...listEvents({ type: "workflow.started", workflowId }),
    ...listEvents({ type: "workflow.restarted", workflowId }),
  ].filter(event => event.at).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return events.at(-1)?.at ?? "initial";
};

const reconcileWorkflow = workflow => {
  const wasRunning = workflow.status === "running"
    || Object.values(workflow.tasks ?? {}).some(task => task?.status === "running");
  if (!wasRunning) return null;

  const now = new Date().toISOString();
  for (const task of Object.values(workflow.tasks ?? {})) {
    if (task?.type !== "task") continue;
    let interruptedAttemptId = null;
    for (const attempt of task.attempts ?? []) {
      if (attempt.status !== "running") continue;
      attempt.status = "failed";
      attempt.endedAt = now;
      attempt.error = INTERRUPTION_REASON;
      attempt.diagnostics = {
        phase: "process",
        code: "backend_interrupted",
        message: INTERRUPTION_REASON,
        retryable: true,
        recovery: "langgraph_resume",
      };
      interruptedAttemptId = attempt.id;
    }
    if (task.status === "running") {
      task.status = "pending";
      if (interruptedAttemptId) task.resumeCheckpointAttemptId = interruptedAttemptId;
    }
  }

  workflow.status = "pending";
  workflow.interruption = {
    at: now,
    reason: INTERRUPTION_REASON,
    recovery: "langgraph_resume",
    threadMarker: latestRunMarker(workflow.id),
  };
  delete workflow.stalled;
  return now;
};

const normalizePersistedWorkflow = workflow => {
  const normalized = normalizeGeneratedGraph(workflow);
  validateGraph(normalized);
  return normalized;
};

export const reconcileInterruptedWorkflows = async () => {
  await cleanupExecutionRuntime();
  await mkdir(workflowsDir, { recursive: true });
  const files = await readdir(workflowsDir);
  const reconciled = [];

  for (const filename of files.filter(file => file.endsWith(".json"))) {
    const path = resolve(workflowsDir, filename);
    try {
      const raw = JSON.parse(await readFile(path, "utf8"));
      const workflow = normalizePersistedWorkflow(raw);
      const hydratedInvocations = await hydrateWorkflowInvocationJournals(workflow);
      const migrated = JSON.stringify(workflow) !== JSON.stringify(raw);
      const interruptedAt = reconcileWorkflow(workflow);
      if (!migrated && !interruptedAt && !hydratedInvocations) continue;

      await atomicWriteFile(path, JSON.stringify(workflow, null, 2), "utf8");
      if (migrated) await recordEvent("workflow.migrated", { workflowId: workflow.id ?? null, filename });
      if (hydratedInvocations) {
        await recordEvent("workflow.invocations_recovered", {
          workflowId: workflow.id ?? null,
          count: hydratedInvocations,
        });
      }
      if (interruptedAt) {
        await recordEvent("workflow.interrupted", {
          workflowId: workflow.id ?? null,
          interruptedAt,
          reason: INTERRUPTION_REASON,
          recovery: "langgraph_resume",
          threadMarker: workflow.interruption.threadMarker,
        });
      }
      reconciled.push(workflow.id ?? filename);
    } catch (error) {
      console.error("[workflow-recovery] Could not reconcile persisted Workflow.", {
        filename,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return reconciled;
};
