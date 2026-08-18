import { recordEvent } from "./EventController.mjs";

const approvals = new Map();
let nextApprovalId = 1;

export const authorize = async ({
  action,
  actor,
  requiresApproval = false,
  context = {}
}) => {
  if (!action || typeof action !== "string") {
    throw new Error("Authorization action must be a non-empty string");
  }

  if (!actor || typeof actor !== "string") {
    throw new Error("Authorization actor must be a non-empty string");
  }

  if (!requiresApproval) {
    return {
      allowed: true,
      requiresApproval: false
    };
  }

  const id = `approval-${nextApprovalId++}`;

  const approval = {
    id,
    action,
    actor,
    context,
    status: "pending",
    approvedBy: null,
    resolvedAt: null
  };

  approvals.set(id, approval);

  await recordEvent("approval.requested", {
    approvalId: id,
    action,
    actor,
    context
  });

  return {
    allowed: false,
    requiresApproval: true,
    approval
  };
}

export const getApproval = (id) => {
  return approvals.get(id) ?? null;
}

export const listApprovals = (status = null) => {
  const items = [...approvals.values()];

  if (!status) {
    return items;
  }

  return items.filter((approval) => approval.status === status);
}

export const approve = async (id) => {
  const approval = approvals.get(id);

  if (!approval) {
    throw new Error(`Unknown approval: ${id}`);
  }

  if (approval.status !== "pending") {
    throw new Error(`Approval ${id} is already ${approval.status}`);
  }

  approval.status = "approved";
  approval.approvedBy = "Carlos";
  approval.resolvedAt = new Date().toISOString();

  await recordEvent("approval.approved", {
    approvalId: id,
    action: approval.action,
    actor: approval.actor,
    approvedBy: "Carlos"
  });

  return approval;
}

export const reject = async (id) => {
  const approval = approvals.get(id);

  if (!approval) {
    throw new Error(`Unknown approval: ${id}`);
  }

  if (approval.status !== "pending") {
    throw new Error(`Approval ${id} is already ${approval.status}`);
  }

  approval.status = "rejected";
  approval.approvedBy = "Carlos";
  approval.resolvedAt = new Date().toISOString();

  await recordEvent("approval.rejected", {
    approvalId: id,
    action: approval.action,
    actor: approval.actor,
    approvedBy: "Carlos"
  });

  return approval;
}

export const canProceed = (id) => {
  const approval = approvals.get(id);

  if (!approval) {
    return false;
  }

  return approval.status === "approved";
}

export const clearApproval = (id) => {
  return approvals.delete(id);
}