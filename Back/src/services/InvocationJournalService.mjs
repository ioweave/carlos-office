import { appendFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../ObsidianVault/System/Runtime/Invocations");
const writeQueues = new Map();

const encode = value => encodeURIComponent(String(value));
const attemptPath = (workflowId, taskId, attemptId) => resolve(
  root,
  encode(workflowId),
  encode(taskId),
  `${encode(attemptId)}.jsonl`,
);

const enqueue = (key, operation) => {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  writeQueues.set(key, next);
  return next.finally(() => {
    if (writeQueues.get(key) === next) writeQueues.delete(key);
  });
};

export const appendInvocationJournal = async ({ workflowId, taskId, attemptId, invocation }) => {
  const path = attemptPath(workflowId, taskId, attemptId);
  const record = { workflowId, taskId, attemptId, ...structuredClone(invocation) };
  await enqueue(path, async () => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
  });
};

export const clearInvocationJournal = async (workflowId, taskId, attemptId) => {
  const path = attemptPath(workflowId, taskId, attemptId);
  await (writeQueues.get(path) ?? Promise.resolve()).catch(() => {});
  await rm(path, { force: true });
};

const readJournalFile = async path => {
  const content = await readFile(path, "utf8");
  const result = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    result.push(JSON.parse(line));
  }
  return result;
};

/** Fold runtime invocation journals into Attempts without deleting them before the Workflow is durably saved. */
export const hydrateWorkflowInvocationJournals = async workflow => {
  const workflowDir = resolve(root, encode(workflow.id));
  let taskDirs;
  try { taskDirs = await readdir(workflowDir, { withFileTypes: true }); } catch (error) {
    if (error.code === "ENOENT") return { count: 0, paths: [] };
    throw error;
  }

  const attempts = new Map();
  for (const task of Object.values(workflow.tasks ?? {})) {
    if (task?.type !== "task") continue;
    for (const attempt of task.attempts ?? []) attempts.set(attempt.id, attempt);
  }

  let hydrated = 0;
  const paths = [];
  for (const taskDir of taskDirs.filter(entry => entry.isDirectory())) {
    const directory = resolve(workflowDir, taskDir.name);
    const files = await readdir(directory, { withFileTypes: true });
    for (const file of files.filter(entry => entry.isFile() && entry.name.endsWith(".jsonl"))) {
      const path = resolve(directory, file.name);
      try {
        const records = await readJournalFile(path);
        for (const invocation of records) {
          const attempt = attempts.get(invocation?.attemptId);
          if (!attempt || !invocation?.id) continue;
          attempt.invocations ??= [];
          const existing = attempt.invocations.findIndex(item => item.id === invocation.id);
          const { workflowId: _workflowId, taskId: _taskId, attemptId: _attemptId, ...stored } = invocation;
          if (existing >= 0) attempt.invocations[existing] = stored;
          else attempt.invocations.push(stored);
          hydrated += 1;
        }
        paths.push(path);
      } catch (error) {
        console.error("[invocations] Could not hydrate invocation journal.", {
          path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { count: hydrated, paths };
};

export const clearHydratedInvocationJournals = async paths => {
  for (const path of new Set(paths)) {
    await (writeQueues.get(path) ?? Promise.resolve()).catch(() => {});
    await rm(path, { force: true });
  }
};
