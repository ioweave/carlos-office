import { useEffect, useMemo, useState } from "react";
import { IconAlertTriangle, IconClock, IconPlayerPlay, IconSparkles, IconTool, IconX } from "@tabler/icons-react";

const TABS = ["overview", "tools", "invocations", "raw"];

const formatTime = value => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};
const formatDuration = (startedAt, endedAt, durationMs = null) => {
  const milliseconds = Number.isFinite(Number(durationMs))
    ? Number(durationMs)
    : Date.parse(endedAt || "") - Date.parse(startedAt || "");
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1_000)}s`;
};
const jsonText = value => {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
};
const scopeText = scope => (scope || [])
  .map(item => item.type === "map" ? `${item.groupId}[${item.index}]` : `${item.groupId}#${item.iteration}`)
  .join(" · ") || "base";
const diagnosticsWithoutToolCalls = diagnostics => {
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return diagnostics;
  const { toolCalls: _toolCalls, toolFailures: _toolFailures, ...rest } = diagnostics;
  return rest;
};
const toolCallsFromAttempt = attempt => {
  const calls = [];
  for (const invocation of attempt?.invocations || []) {
    const traces = Array.isArray(invocation.toolCalls)
      ? invocation.toolCalls
      : Array.isArray(invocation.diagnostics?.toolCalls) ? invocation.diagnostics.toolCalls : [];
    for (const trace of traces) calls.push({ ...trace, invocationId: invocation.id, scope: invocation.scope || [] });
  }
  if (!calls.length && Array.isArray(attempt?.diagnostics?.toolCalls)) {
    for (const trace of attempt.diagnostics.toolCalls) calls.push({ ...trace, invocationId: null, scope: [] });
  }
  return calls.sort((left, right) => {
    const timeDelta = Date.parse(left.startedAt || "") - Date.parse(right.startedAt || "");
    if (Number.isFinite(timeDelta) && timeDelta) return timeDelta;
    return Number(left.sequence || 0) - Number(right.sequence || 0);
  });
};

export default function TaskFailureModal({
  workflowId,
  taskId,
  task,
  attempt,
  busy,
  canResume,
  onClose,
  onReview,
  onResume,
}) {
  const [tab, setTab] = useState("overview");
  const toolCalls = useMemo(() => toolCallsFromAttempt(attempt), [attempt]);
  const diagnostics = attempt?.diagnostics || {};
  const headline = diagnostics.message || String(attempt?.error || "Task failed").split(/\r?\n/)[0];
  const failedTools = toolCalls.filter(call => call.status === "failed").length;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = event => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="task-failure-modal__backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="task-failure-modal" role="dialog" aria-modal="true" aria-labelledby="task-failure-title">
        <header className="task-failure-modal__header">
          <div className="task-failure-modal__heading">
            <span className="task-failure-modal__icon"><IconAlertTriangle size={18} /></span>
            <div>
              <span className="eyebrow">Task failure · Attempt #{attempt?.attempt ?? "—"}</span>
              <h2 id="task-failure-title">{task?.name || taskId}</h2>
              <div className="task-failure-modal__identity"><code>{workflowId}</code><span>›</span><code>{taskId}</code></div>
            </div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close failure details"><IconX size={17} /></button>
        </header>

        <nav className="task-failure-modal__tabs" aria-label="Failure details">
          {TABS.map(value => (
            <button key={value} type="button" aria-selected={tab === value} onClick={() => setTab(value)}>
              {value === "tools" ? `Tool calls · ${toolCalls.length}` : value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </nav>

        <div className="task-failure-modal__body">
          {tab === "overview" && (
            <div className="task-failure-modal__overview">
              <section className="task-failure-modal__summary">
                <div className="task-failure-modal__summary-title"><IconAlertTriangle size={15} /><strong>{headline}</strong></div>
                <p>{attempt?.error || headline}</p>
              </section>

              <div className="task-failure-modal__facts">
                <div><span>Phase</span><strong>{diagnostics.phase || attempt?.phase || "—"}</strong></div>
                <div><span>Code</span><strong>{diagnostics.code || "—"}</strong></div>
                <div><span>Model</span><strong>{attempt?.provider && attempt?.model ? `${attempt.provider} · ${attempt.model}` : "—"}</strong></div>
                <div><span>Agent</span><strong>{attempt?.agentId || "—"}{attempt?.pid ? ` · PID ${attempt.pid}` : ""}</strong></div>
                <div><span>Started</span><strong>{formatTime(attempt?.startedAt)}</strong></div>
                <div><span>Duration</span><strong>{formatDuration(attempt?.startedAt, attempt?.endedAt)}</strong></div>
                <div><span>Tool calls</span><strong>{toolCalls.length}</strong></div>
                <div><span>Tool failures</span><strong>{failedTools || diagnostics.toolFailureCount || 0}</strong></div>
              </div>

              {task?.objective && (
                <section className="task-failure-modal__section">
                  <span className="task-failure-modal__label">Objective</span>
                  <p>{task.objective}</p>
                </section>
              )}

              {attempt?.executionGroups?.length > 0 && (
                <section className="task-failure-modal__section">
                  <span className="task-failure-modal__label">Execution scope</span>
                  <p>{attempt.executionGroups.map(group => `${group.type === "map" ? "Map" : "Loop"} ${group.name || group.id}`).join(" → ")}</p>
                </section>
              )}

              {Object.keys(diagnosticsWithoutToolCalls(diagnostics) || {}).length > 0 && (
                <details className="task-failure-modal__details">
                  <summary>Structured diagnostics</summary>
                  <pre>{jsonText(diagnosticsWithoutToolCalls(diagnostics))}</pre>
                </details>
              )}
            </div>
          )}

          {tab === "tools" && (
            <div className="task-failure-modal__trace-list">
              {!toolCalls.length ? (
                <div className="empty-state empty-state--compact"><IconTool size={22} /><strong>No Tool trace recorded</strong><span>This failure happened before a Tool call, or it predates detailed Tool tracing.</span></div>
              ) : toolCalls.map((call, index) => (
                <article key={`${call.invocationId || "attempt"}:${call.sequence || index}`} className={`task-failure-modal__trace task-failure-modal__trace--${call.status || "unknown"}`}>
                  <div className="task-failure-modal__trace-header">
                    <div><span>#{call.sequence || index + 1}</span><strong>{call.tool || "Unknown Tool"}</strong></div>
                    <span className={`task-failure-modal__trace-status task-failure-modal__trace-status--${call.status || "unknown"}`}>{call.status || "unknown"}</span>
                  </div>
                  <div className="task-failure-modal__trace-meta">
                    <span><IconClock size={11} /> {formatTime(call.startedAt)} · {formatDuration(call.startedAt, call.endedAt, call.durationMs)}</span>
                    <span>{call.invocationId || "Task-level trace"}</span>
                    <span>{scopeText(call.scope)}</span>
                  </div>
                  {call.code && <div className="task-failure-modal__trace-code"><span>Code</span><code>{call.code}</code><span>{call.retryable ? "Retryable" : "Not retryable"}</span></div>}
                  {call.hint && <p className="task-failure-modal__hint">{call.hint}</p>}
                  <details className="task-failure-modal__details">
                    <summary>Input</summary>
                    <pre>{jsonText(call.input)}</pre>
                  </details>
                  {call.output != null && (
                    <details className="task-failure-modal__details">
                      <summary>Output</summary>
                      <pre>{jsonText(call.output)}</pre>
                    </details>
                  )}
                  {call.error && (
                    <details className="task-failure-modal__details" open={call.status === "failed"}>
                      <summary>Error</summary>
                      <pre className="task-failure-modal__error">{jsonText(call.error)}</pre>
                    </details>
                  )}
                </article>
              ))}
            </div>
          )}

          {tab === "invocations" && (
            <div className="task-failure-modal__trace-list">
              {!(attempt?.invocations || []).length ? (
                <div className="empty-state empty-state--compact"><strong>No invocation history recorded</strong></div>
              ) : (attempt.invocations || []).map(invocation => (
                <article key={invocation.id} className={`task-failure-modal__invocation task-failure-modal__invocation--${invocation.status || "unknown"}`}>
                  <div className="task-failure-modal__trace-header">
                    <div><span>{invocation.kind || "invocation"}</span><strong>{invocation.id}</strong></div>
                    <span className={`task-failure-modal__trace-status task-failure-modal__trace-status--${invocation.status || "unknown"}`}>{invocation.status || "unknown"}</span>
                  </div>
                  <div className="task-failure-modal__trace-meta">
                    <span>{scopeText(invocation.scope)}</span>
                    <span>{formatTime(invocation.startedAt)} → {formatTime(invocation.endedAt)}</span>
                    {invocation.agentId && <span>{invocation.agentId}{invocation.pid ? ` · PID ${invocation.pid}` : ""}</span>}
                  </div>
                  {invocation.score != null && <p>Validation score: {Math.round(invocation.score * 100)}%</p>}
                  {invocation.feedback && <p>{invocation.feedback}</p>}
                  {invocation.error && <pre className="task-failure-modal__error">{jsonText(invocation.error)}</pre>}
                  {invocation.output != null && <details className="task-failure-modal__details"><summary>Output</summary><pre>{jsonText(invocation.output)}</pre></details>}
                  {invocation.data != null && <details className="task-failure-modal__details"><summary>Structured data</summary><pre>{jsonText(invocation.data)}</pre></details>}
                  {Object.keys(diagnosticsWithoutToolCalls(invocation.diagnostics) || {}).length > 0 && (
                    <details className="task-failure-modal__details"><summary>Diagnostics</summary><pre>{jsonText(diagnosticsWithoutToolCalls(invocation.diagnostics))}</pre></details>
                  )}
                </article>
              ))}
            </div>
          )}

          {tab === "raw" && <pre className="task-failure-modal__raw">{jsonText(attempt)}</pre>}
        </div>

        <footer className="task-failure-modal__footer">
          <div><span>Diagnostic values are capped and credential-like fields are redacted by the backend.</span></div>
          <div className="task-failure-modal__actions">
            {onReview && <button type="button" className="button button--quiet" onClick={onReview} disabled={!!busy}><IconSparkles size={14} /> Nora review</button>}
            {canResume && onResume && <button type="button" className="button button--primary" onClick={onResume} disabled={!!busy}><IconPlayerPlay size={14} /> Resume from Task</button>}
          </div>
        </footer>
      </section>
    </div>
  );
}