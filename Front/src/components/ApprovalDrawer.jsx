import { useMemo, useState } from "react";
import { IconCheck, IconKey, IconX } from "@tabler/icons-react";
import { toast } from "sonner";

import api, { endpoints } from "../api";

const formatTime = value => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};

const contextRows = context => Object.entries(context || {}).filter(([, value]) => value != null);

export default function ApprovalDrawer({ open, approvals, onClose, onChanged }) {
  const [view, setView] = useState("pending");
  const [busy, setBusy] = useState("");

  const items = useMemo(() => {
    const source = [...(approvals || [])].sort((left, right) => (
      String(right.createdAt || "").localeCompare(String(left.createdAt || ""))
    ));
    return view === "pending"
      ? source.filter(item => item.status === "pending")
      : source.filter(item => item.status !== "pending");
  }, [approvals, view]);

  const resolve = async (approval, decision) => {
    setBusy(approval.id);
    try {
      const endpoint = decision === "approve"
        ? endpoints.approvalApprove(approval.id)
        : endpoints.approvalReject(approval.id);
      await api.post(endpoint);
      toast.success(decision === "approve" ? "Approved." : "Rejected.");
      await onChanged?.();
    } catch (error) {
      toast.error(error.response?.data?.error || `Could not ${decision} authorization.`);
    } finally {
      setBusy("");
    }
  };

  if (!open) return null;

  return (
    <div className="approval-layer" role="presentation">
      <button type="button" className="approval-layer__backdrop" onClick={onClose} aria-label="Close approvals" />
      <aside className="approval-drawer" aria-label="Authorization inbox">
        <header className="approval-drawer__header">
          <div>
            <span className="eyebrow">Carlos authority boundary</span>
            <h2>Approvals</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close approvals">
            <IconX size={18} />
          </button>
        </header>

        <div className="segmented-control" role="tablist" aria-label="Authorization status">
          <button
            type="button"
            className={view === "pending" ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"}
            onClick={() => setView("pending")}
          >
            Pending
          </button>
          <button
            type="button"
            className={view === "history" ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"}
            onClick={() => setView("history")}
          >
            History
          </button>
        </div>

        <div className="approval-drawer__body">
          {!items.length ? (
            <div className="empty-state empty-state--compact">
              <IconKey size={24} stroke={1.5} />
              <strong>{view === "pending" ? "No decisions waiting" : "No authorization history"}</strong>
              <span>{view === "pending" ? "Nora and Agents can continue without your intervention." : "Resolved authorization requests will appear here."}</span>
            </div>
          ) : (
            <ul className="approval-list">
              {items.map(approval => (
                <li key={approval.id} className="approval-card">
                  <header className="approval-card__header">
                    <div>
                      <span className="approval-card__actor">{approval.actor}</span>
                      <strong>{approval.action}</strong>
                    </div>
                    <span className={`status-pill status-pill--${approval.status}`}>{approval.status}</span>
                  </header>

                  <div className="approval-card__context">
                    {contextRows(approval.context).map(([key, value]) => (
                      <div key={key} className="approval-card__row">
                        <span>{key}</span>
                        <code>{typeof value === "string" ? value : JSON.stringify(value)}</code>
                      </div>
                    ))}
                  </div>

                  <footer className="approval-card__footer">
                    <small>{formatTime(approval.createdAt)}</small>
                    {approval.status === "pending" && (
                      <div className="approval-card__actions">
                        <button
                          type="button"
                          className="button button--quiet"
                          onClick={() => resolve(approval, "reject")}
                          disabled={busy === approval.id}
                        >
                          <IconX size={15} /> Reject
                        </button>
                        <button
                          type="button"
                          className="button button--primary"
                          onClick={() => resolve(approval, "approve")}
                          disabled={busy === approval.id}
                        >
                          <IconCheck size={15} /> Approve
                        </button>
                      </div>
                    )}
                  </footer>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
