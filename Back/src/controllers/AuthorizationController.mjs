import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { recordEvent } from "./EventController.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const authorizationsDir = resolve(here, "../../ObsidianVault/System/Runtime/Authorizations");
const approvalsFile = resolve(authorizationsDir, "approvals.json");
const approvals = new Map();
const STATUSES = new Set(["pending", "approved", "rejected", "consumed"]);

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const normalizeUtc = (value, label, nullable = false) => {
  if (nullable && value == null) return null;
  const date = new Date(value);
  if (typeof value !== "string" || Number.isNaN(date.getTime())) throw new Error(`Invalid ${label}: ${value}`);
  return date.toISOString();
};

const validateApproval = approval => {
  if (!isObject(approval)) throw new Error("Authorization record must be an object");
  if (!approval.id || typeof approval.id !== "string") throw new Error("Authorization must have an ID");
  if (!approval.action || typeof approval.action !== "string") throw new Error("Authorization must have an action");
  if (!approval.actor || typeof approval.actor !== "string") throw new Error("Authorization must have an actor");
  if (!STATUSES.has(approval.status)) throw new Error(`Invalid authorization status: ${approval.status}`);
  if (!isObject(approval.context)) throw new Error("Authorization context must be an object");
};

const persistApprovals = async () => {
  await mkdir(authorizationsDir, { recursive: true });
  await writeFile(approvalsFile, JSON.stringify([...approvals.values()], null, 2), "utf8");
};

export const loadAuthorizations = async () => {
  approvals.clear();
  await mkdir(authorizationsDir, { recursive: true });

  let stored;
  try {
    stored = JSON.parse(await readFile(approvalsFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  if (!Array.isArray(stored)) throw new Error("Persisted authorizations must be an array");

  for (const entry of stored) {
    validateApproval(entry);
    const approval = {
      ...structuredClone(entry),
      createdAt: normalizeUtc(entry.createdAt, "authorization createdAt"),
      resolvedAt: normalizeUtc(entry.resolvedAt, "authorization resolvedAt", true),
      consumedAt: normalizeUtc(entry.consumedAt, "authorization consumedAt", true),
    };
    if (approvals.has(approval.id)) throw new Error(`Duplicate authorization ID: ${approval.id}`);
    approvals.set(approval.id, approval);
  }

  return listApprovals();
};

export const authorize = async ({
  action,
  actor,
  requiresApproval = false,
  context = {},
}) => {
  if (!action || typeof action !== "string") {
    throw new Error("Authorization action must be a non-empty string");
  }
  if (!actor || typeof actor !== "string") {
    throw new Error("Authorization actor must be a non-empty string");
  }
  if (!isObject(context)) throw new Error("Authorization context must be an object");

  if (!requiresApproval) {
    return { allowed: true, requiresApproval: false };
  }

  const id = `approval-${randomUUID()}`;
  const approval = {
    id,
    action,
    actor,
    context: structuredClone(context),
    status: "pending",
    approvedBy: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    consumedAt: null,
  };

  approvals.set(id, approval);
  await persistApprovals();
  await recordEvent("approval.requested", {
    approvalId: id,
    action,
    actor,
    context: structuredClone(context),
  });

  return { allowed: false, requiresApproval: true, approval: structuredClone(approval) };
};

export const getApproval = id => {
  const approval = approvals.get(id);
  return approval ? structuredClone(approval) : null;
};

export const listApprovals = (status = null) => {
  const items = [...approvals.values()];
  const filtered = status ? items.filter(approval => approval.status === status) : items;
  return filtered.map(approval => structuredClone(approval));
};

export const approve = async id => {
  const current = approvals.get(id);
  if (!current) throw new Error(`Unknown approval: ${id}`);
  if (current.status !== "pending") throw new Error(`Approval ${id} is already ${current.status}`);

  const approval = {
    ...current,
    status: "approved",
    approvedBy: "Carlos",
    resolvedAt: new Date().toISOString(),
  };

  approvals.set(id, approval);
  await persistApprovals();
  await recordEvent("approval.approved", {
    approvalId: id,
    action: approval.action,
    actor: approval.actor,
    approvedBy: "Carlos",
  });

  return structuredClone(approval);
};

export const reject = async id => {
  const current = approvals.get(id);
  if (!current) throw new Error(`Unknown approval: ${id}`);
  if (current.status !== "pending") throw new Error(`Approval ${id} is already ${current.status}`);

  const approval = {
    ...current,
    status: "rejected",
    approvedBy: "Carlos",
    resolvedAt: new Date().toISOString(),
  };

  approvals.set(id, approval);
  await persistApprovals();
  await recordEvent("approval.rejected", {
    approvalId: id,
    action: approval.action,
    actor: approval.actor,
    approvedBy: "Carlos",
  });

  return structuredClone(approval);
};

export const consumeApproval = async id => {
  const current = approvals.get(id);
  if (!current) throw new Error(`Unknown approval: ${id}`);
  if (current.status !== "approved") throw new Error(`Approval ${id} is ${current.status}, not approved`);

  const approval = {
    ...current,
    status: "consumed",
    consumedAt: new Date().toISOString(),
  };

  approvals.set(id, approval);
  await persistApprovals();
  await recordEvent("approval.consumed", {
    approvalId: id,
    action: approval.action,
    actor: approval.actor,
  });

  return structuredClone(approval);
};

export const deleteApprovalsForWorkflows = async workflowIds => {
  if (!Array.isArray(workflowIds)) throw new Error("Workflow IDs must be an array");
  const targets = new Set(workflowIds);
  const deleted = [];

  for (const [id, approval] of approvals.entries()) {
    if (!targets.has(approval.context?.workflowId)) continue;
    approvals.delete(id);
    deleted.push(id);
  }

  if (deleted.length) await persistApprovals();
  return deleted;
};

export const canProceed = id => approvals.get(id)?.status === "approved";
