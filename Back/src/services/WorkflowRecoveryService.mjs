import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { recordEvent } from "../controllers/EventController.mjs";
import { normalizeGeneratedGraph, validateGraph } from "./WorkflowGraphService.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const workflowsDir = resolve(here, "../../ObsidianVault/System/Workflows");
const INTERRUPTION_REASON = "Backend restarted while Workflow execution was active";

const reconcileWorkflow = workflow => {
  const now = new Date().toISOString();
  let interrupted = workflow.status === "running";

  for (const task of Object.values(workflow.tasks ?? {})) {
    if (task?.type !== "task") continue;

    if (task.status === "running") {
      task.status = "blocked";
      interrupted = true;
    }

    for (const attempt of task.attempts ?? []) {
      if (attempt.status !== "running") continue;
      attempt.status = "failed";
      attempt.endedAt = now;
      attempt.error = INTERRUPTION_REASON;
      interrupted = true;
    }
  }

  if (!interrupted) return null;

  workflow.status = "blocked";
  workflow.interruption = {
    at: now,
    reason: INTERRUPTION_REASON,
  };
  return now;
};

const normalizePersistedWorkflow = workflow => {
  const normalized = normalizeGeneratedGraph(workflow);
  validateGraph(normalized);
  return normalized;
};

export const reconcileInterruptedWorkflows = async () => {
  await mkdir(workflowsDir, { recursive: true });
  const files = await readdir(workflowsDir);
  const reconciled = [];

  for (const filename of files.filter(file => file.endsWith(".json"))) {
    const path = resolve(workflowsDir, filename);

    try {
      const raw = JSON.parse(await readFile(path, "utf8"));
      const workflow = normalizePersistedWorkflow(raw);
      const migrated = JSON.stringify(workflow) !== JSON.stringify(raw);
      const interruptedAt = reconcileWorkflow(workflow);
      if (!migrated && !interruptedAt) continue;

      await writeFile(path, JSON.stringify(workflow, null, 2), "utf8");

      if (migrated) {
        await recordEvent("workflow.migrated", {
          workflowId: workflow.id ?? null,
          filename,
        });
      }

      if (interruptedAt) {
        await recordEvent("workflow.interrupted", {
          workflowId: workflow.id ?? null,
          interruptedAt,
          reason: INTERRUPTION_REASON,
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
