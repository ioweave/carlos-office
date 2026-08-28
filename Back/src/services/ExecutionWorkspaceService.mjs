import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(here, "../../.runtime");
const workspacesRoot = resolve(runtimeRoot, "workspaces");
const deliverablesRoot = resolve(runtimeRoot, "deliverables");

const segment = (value, label) => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Execution workspace requires ${label}`);
  const readable = text.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56) || label;
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 10);
  return `${readable}-${digest}`;
};

const within = (parent, candidate) => {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const invocationPaths = ({ workflowId, taskId, attemptId, invocationId }) => {
  const workflow = segment(workflowId, "workflowId");
  const task = segment(taskId, "taskId");
  const attempt = segment(attemptId ?? "attempt", "attemptId");
  const invocation = segment(invocationId ?? "single", "invocationId");
  return {
    workspaceDir: resolve(workspacesRoot, workflow, task, attempt, invocation),
    deliverablesDir: resolve(deliverablesRoot, workflow, task, attempt, invocation),
  };
};

export const prepareInvocationWorkspace = async context => {
  const { workspaceDir } = invocationPaths(context);
  await mkdir(workspaceDir, { recursive: true });
  return workspaceDir;
};

export const resolveWorkspacePath = (workspaceDir, path) => {
  if (typeof path !== "string" || !path.trim()) throw new Error("Filesystem path must be a non-empty string");
  const value = path.trim();
  if (isAbsolute(value)) return resolve(value);
  if (!workspaceDir) throw new Error("Relative filesystem paths require an Agent execution workspace");
  const resolved = resolve(workspaceDir, value);
  if (!within(workspaceDir, resolved)) throw new Error(`Relative filesystem path escapes the Agent workspace: ${path}`);
  return resolved;
};

export const cleanupInvocationWorkspace = async workspaceDir => {
  if (!workspaceDir || !within(workspacesRoot, workspaceDir)) return false;
  await rm(workspaceDir, { recursive: true, force: true });
  return true;
};

const moveFile = async (source, destination) => {
  try {
    await rename(source, destination);
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    await copyFile(source, destination);
    await rm(source, { force: true });
  }
};

export const stageInvocationCompletion = async ({
  workflowId,
  taskId,
  attemptId,
  invocationId,
  workspaceDir,
  completion,
}) => {
  if (!workspaceDir) return completion;
  const artifacts = Array.isArray(completion?.artifacts) ? completion.artifacts : [];
  if (!artifacts.length) {
    await cleanupInvocationWorkspace(workspaceDir);
    return completion;
  }

  const { deliverablesDir } = invocationPaths({ workflowId, taskId, attemptId, invocationId });
  const staged = [];
  const stagedBySource = new Map();

  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object" || typeof artifact.path !== "string" || !artifact.path.trim()) {
      staged.push(artifact);
      continue;
    }

    const source = resolveWorkspacePath(workspaceDir, artifact.path);
    if (!within(workspaceDir, source)) {
      staged.push({ ...artifact, path: source });
      continue;
    }

    let destination = stagedBySource.get(source);
    if (!destination) {
      const info = await stat(source);
      if (!info.isFile()) throw new Error(`Declared Artifact is not a file: ${artifact.path}`);
      await mkdir(deliverablesDir, { recursive: true });
      destination = resolve(deliverablesDir, `${randomUUID()}-${basename(source)}`);
      await moveFile(source, destination);
      stagedBySource.set(source, destination);
    }
    staged.push({ ...artifact, path: destination });
  }

  await cleanupInvocationWorkspace(workspaceDir);
  return { ...completion, artifacts: staged };
};

const pruneEmptyParents = async start => {
  let current = dirname(start);
  while (within(deliverablesRoot, current) && current !== deliverablesRoot) {
    try {
      await rmdir(current);
    } catch (error) {
      if (["ENOTEMPTY", "EEXIST", "ENOENT"].includes(error?.code)) return;
      throw error;
    }
    current = dirname(current);
  }
};

export const consumeManagedDeliverable = async path => {
  if (!path) return false;
  const absolute = resolve(path);
  if (!within(deliverablesRoot, absolute)) return false;
  await rm(absolute, { force: true });
  await pruneEmptyParents(absolute);
  return true;
};

export const cleanupWorkflowRuntime = async workflowId => {
  const workflow = segment(workflowId, "workflowId");
  await Promise.all([
    rm(resolve(workspacesRoot, workflow), { recursive: true, force: true }),
    rm(resolve(deliverablesRoot, workflow), { recursive: true, force: true }),
  ]);
};

export const cleanupExecutionRuntime = async () => {
  await Promise.all([
    rm(workspacesRoot, { recursive: true, force: true }),
    rm(deliverablesRoot, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(workspacesRoot, { recursive: true }),
    mkdir(deliverablesRoot, { recursive: true }),
  ]);
};

export const executionRuntimePaths = Object.freeze({ runtimeRoot, workspacesRoot, deliverablesRoot });
