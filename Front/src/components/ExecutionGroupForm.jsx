import { IconTrash } from "@tabler/icons-react";

const number = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export default function ExecutionGroupForm({ group, onChange, onRemove, disabled = false }) {
  if (!group) return null;

  const update = changes => onChange?.({ ...group, ...changes });
  const isMap = group.type === "map";
  const isLoop = group.type === "loop";
  const throttle = group.throttle ?? null;

  return (
    <div className="execution-group-form">
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          maxLength={60}
          value={group.name || ""}
          onChange={event => update({ name: event.target.value })}
          disabled={disabled}
        />
      </label>

      {isMap && (
        <>
          <label className="field">
            <span>Collection source</span>
            <input
              type="text"
              value={group.source || ""}
              onChange={event => update({ source: event.target.value })}
              placeholder="upstream.list-assets"
              disabled={disabled}
            />
            <small>Use workflow.&lt;input&gt; or upstream.&lt;producer-task-id&gt;. Add a property suffix only when the producer data is actually an object containing that array.</small>
          </label>
          <label className="field">
            <span>Item variable</span>
            <input
              type="text"
              value={group.itemAs || "item"}
              onChange={event => update({ itemAs: event.target.value })}
              placeholder="item"
              disabled={disabled}
            />
          </label>
          <label className="field">
            <span>Concurrency</span>
            <input
              type="number"
              min="1"
              max="64"
              value={group.concurrency ?? 1}
              onChange={event => update({ concurrency: Math.max(1, Math.min(64, Math.round(number(event.target.value, 1)))) })}
              disabled={disabled}
            />
            <small>Shared execution budget for all Tasks inside this Map, including nested branches. Concurrency 1 is serial Map execution; there is no separate For Each runtime type.</small>
          </label>

          <div className="execution-group-form__section">
            <strong>Request throttling</strong>
            <span>Optional. Limits new Task executions started inside this Map.</span>
            <div className="execution-group-form__inline">
              <label className="field">
                <span>Requests</span>
                <input
                  type="number"
                  min="1"
                  value={throttle?.requests ?? ""}
                  placeholder="No limit"
                  onChange={event => {
                    const value = event.target.value;
                    if (!value) return update({ throttle: null });
                    update({ throttle: { requests: Math.max(1, Math.round(number(value, 1))), windowMs: throttle?.windowMs ?? 60_000 } });
                  }}
                  disabled={disabled}
                />
              </label>
              <label className="field">
                <span>Window (seconds)</span>
                <input
                  type="number"
                  min="1"
                  value={throttle ? Math.round(throttle.windowMs / 1000) : ""}
                  placeholder="60"
                  onChange={event => {
                    const value = event.target.value;
                    if (!value && !throttle?.requests) return update({ throttle: null });
                    update({ throttle: {
                      requests: throttle?.requests ?? 1,
                      windowMs: Math.max(100, Math.round(number(value, 60) * 1000)),
                    } });
                  }}
                  disabled={disabled || !throttle}
                />
              </label>
            </div>
          </div>
        </>
      )}

      {isLoop && (
        <>
          <div className="definition-list execution-group-form__reviewer">
            <div><span>Reviewer</span><strong>Nora</strong></div>
          </div>
          <label className="field">
            <span>Maximum iterations</span>
            <input
              type="number"
              min="2"
              max="10"
              value={group.maxIterations ?? 3}
              onChange={event => update({ maxIterations: Math.max(2, Math.min(10, Math.round(number(event.target.value, 3)))) })}
              disabled={disabled}
            />
          </label>
          <label className="field">
            <span>Minimum score</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={group.minimumScore ?? 0.8}
              onChange={event => update({ minimumScore: Math.max(0, Math.min(1, number(event.target.value, 0.8))) })}
              disabled={disabled}
            />
          </label>
          <label className="field">
            <span>QC criteria</span>
            <textarea
              rows={5}
              value={group.criteria || ""}
              onChange={event => update({ criteria: event.target.value })}
              placeholder="What Nora must verify before accepting the Task result"
              disabled={disabled}
            />
          </label>
          <p className="execution-group-form__note">
            Nora independently scores the contained Task. Rejected work is rerun with Nora&apos;s feedback until it passes or reaches the iteration limit.
          </p>
        </>
      )}

      <div className="execution-group-form__members">
        <span>Direct members</span>
        <strong>{(group.members || []).join(", ") || "Place a Task or nested Group inside this area"}</strong>
      </div>

      {onRemove && (
        <button type="button" className="button button--danger" onClick={() => onRemove(group.id)} disabled={disabled}>
          <IconTrash size={14} /> Remove {isMap ? "Map" : isLoop ? "Loop" : "Group"}
        </button>
      )}
    </div>
  );
}