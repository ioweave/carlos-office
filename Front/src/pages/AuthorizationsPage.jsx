import { useCallback, useEffect, useState } from "react";
import { IconCheck, IconClock, IconKey, IconRefresh, IconShieldCheck, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import api, { endpoints } from "../api";
import StateView from "../components/StateView";
import StatusBadge from "../components/StatusBadge";

const TABS = ["pending", "approved", "consumed", "rejected"];

const formatTime = value => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};

const toneFor = status => ({
  pending: "warning",
  approved: "success",
  consumed: "neutral",
  rejected: "danger",
})[status] || "neutral";

export default function AuthorizationsPage() {
  const [approvals, setApprovals] = useState([]);
  const [tab, setTab] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const list = (await api.get(endpoints.approvals(), { params: { status: tab } })).data || [];
      setApprovals(list);
      setError("");
    } catch (fetchError) {
      setError(fetchError.response?.data?.error || "Could not load approvals.");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const resolve = async (id, decision) => {
    setBusy(id);
    try {
      const action = decision === "approve" ? endpoints.approvalApprove(id) : endpoints.approvalReject(id);
      await api.post(action);
      toast.success(decision === "approve" ? "Approved." : "Rejected.");
      await load();
    } catch (fetchError) {
      toast.error(fetchError.response?.data?.error || "Could not resolve approval.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="authorizations-page redesign-page">
      <header className="redesign-header">
        <div className="redesign-header__leading">
          <span className="eyebrow">Human authority boundary</span>
          <h1 className="redesign-header__title">Authorizations</h1>
          <p className="redesign-header__subtitle">
            Durable approvals requested during Workflow execution. Times are shown in your local timezone.
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={load}>
          <IconRefresh size={15} /> Refresh
        </button>
      </header>

      <nav className="redesign-tabs" aria-label="Authorization status">
        {TABS.map(value => (
          <button
            key={value}
            type="button"
            className={tab === value ? "redesign-tabs__tab redesign-tabs__tab--active" : "redesign-tabs__tab"}
            onClick={() => setTab(value)}
          >
            {value}
          </button>
        ))}
      </nav>

      <section className="authorizations-list">
        {loading ? (
          <StateView variant="loading" />
        ) : error ? (
          <StateView
            variant="error"
            message={error}
            actions={(
              <button type="button" className="secondary-button" onClick={load}>
                <IconRefresh size={15} /> Retry
              </button>
            )}
          />
        ) : !approvals.length ? (
          <StateView
            variant="empty"
            icon={tab === "pending" ? IconShieldCheck : IconKey}
            title={`No ${tab} approvals`}
            message={tab === "pending" ? "No actions are waiting for your authority." : undefined}
          />
        ) : (
          <ul className="approval-list">
            {approvals.map(approval => (
              <li key={approval.id} className="approval-card">
                <div className="approval-card__icon"><IconClock size={18} /></div>
                <div className="approval-card__body">
                  <div className="approval-card__heading">
                    <strong className="approval-card__title">{approval.action}</strong>
                    <StatusBadge tone={toneFor(approval.status)}>{approval.status}</StatusBadge>
                  </div>
                  <p className="muted-copy">Requested by {approval.actor}</p>
                  <dl className="meta-list">
                    <div className="meta-list__row">
                      <dt className="meta-list__term">Workflow</dt>
                      <dd className="meta-list__value">{approval.context?.workflowId || "—"}</dd>
                    </div>
                    <div className="meta-list__row">
                      <dt className="meta-list__term">Task</dt>
                      <dd className="meta-list__value">{approval.context?.taskId || "—"}</dd>
                    </div>
                    <div className="meta-list__row">
                      <dt className="meta-list__term">Created</dt>
                      <dd className="meta-list__value">{formatTime(approval.createdAt)}</dd>
                    </div>
                    <div className="meta-list__row">
                      <dt className="meta-list__term">Resolved</dt>
                      <dd className="meta-list__value">{formatTime(approval.resolvedAt)}</dd>
                    </div>
                    <div className="meta-list__row">
                      <dt className="meta-list__term">Consumed</dt>
                      <dd className="meta-list__value">{formatTime(approval.consumedAt)}</dd>
                    </div>
                  </dl>
                </div>
                {approval.status === "pending" && (
                  <div className="approval-card__actions">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy === approval.id}
                      onClick={() => resolve(approval.id, "approve")}
                    >
                      <IconCheck size={15} /> Approve
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={busy === approval.id}
                      onClick={() => resolve(approval.id, "reject")}
                    >
                      <IconX size={15} /> Reject
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
