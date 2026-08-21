import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconBook2,
  IconLock,
  IconRefresh,
  IconSparkles,
  IconTool,
} from "@tabler/icons-react";
import { toast } from "sonner";

import api, { endpoints } from "../api";

export default function CapabilitiesPage({ onAskNora }) {
  const [tools, setTools] = useState([]);
  const [skills, setSkills] = useState([]);
  const [view, setView] = useState("tools");
  const [selectedName, setSelectedName] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [toolResponse, skillResponse] = await Promise.all([
        api.get(endpoints.tools()),
        api.get(endpoints.skills()),
      ]);
      setTools(toolResponse.data || []);
      setSkills(skillResponse.data || []);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not load Capabilities.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const source = view === "tools" ? tools : skills;
  const selected = useMemo(
    () => source.find(item => item.name === selectedName) || null,
    [source, selectedName],
  );

  useEffect(() => {
    if (selectedName && !source.some(item => item.name === selectedName)) setSelectedName("");
  }, [selectedName, source]);

  if (loading) {
    return <div className="workspace-page"><div className="page-state"><span className="spinner" /> Loading Capabilities</div></div>;
  }

  return (
    <div className="workspace-page capabilities-page">
      <header className="page-header">
        <div className="page-header__copy">
          <span className="eyebrow">What Agents can know and do</span>
          <h1>Capabilities</h1>
          <p>Tools execute actions. Skills provide methodology and context. Nora manages both as the office evolves.</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="icon-button" onClick={load} aria-label="Refresh Capabilities">
            <IconRefresh size={18} />
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => onAskNora?.(`Create a new ${view === "tools" ? "Tool" : "Skill"} that: `)}
          >
            <IconSparkles size={15} /> Ask Nora to create
          </button>
        </div>
      </header>

      <div className="segmented-control page-tabs" role="tablist" aria-label="Capability type">
        <button
          type="button"
          className={view === "tools" ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"}
          onClick={() => {
            setView("tools");
            setSelectedName("");
          }}
        >
          Tools · {tools.length}
        </button>
        <button
          type="button"
          className={view === "skills" ? "segmented-control__item segmented-control__item--active" : "segmented-control__item"}
          onClick={() => {
            setView("skills");
            setSelectedName("");
          }}
        >
          Skills · {skills.length}
        </button>
      </div>

      <div className="capability-layout">
        <section className="capability-list">
          {!source.length ? (
            <div className="empty-state">
              {view === "tools" ? <IconTool size={28} stroke={1.4} /> : <IconBook2 size={28} stroke={1.4} />}
              <strong>No {view}</strong>
              <span>Ask Nora to create one when the office needs a new capability.</span>
            </div>
          ) : source.map(item => (
            <button
              key={item.name}
              type="button"
              className={`capability-row ${selectedName === item.name ? "capability-row--active" : ""}`}
              onClick={() => setSelectedName(item.name)}
            >
              <span className="capability-row__icon">
                {view === "tools" ? <IconTool size={17} /> : <IconBook2 size={17} />}
              </span>
              <span className="capability-row__copy">
                <strong>{item.name}</strong>
                <span>{view === "tools" ? (item.description || "Tool") : ((item.content || "Skill").split("\n")[0] || "Skill")}</span>
              </span>
              {view === "tools" && item.requiresApproval && (
                <span className="capability-row__approval"><IconLock size={13} /> approval</span>
              )}
            </button>
          ))}
        </section>

        <aside className="capability-inspector panel">
          {!selected ? (
            <div className="empty-state empty-state--compact">
              {view === "tools" ? <IconTool size={24} stroke={1.4} /> : <IconBook2 size={24} stroke={1.4} />}
              <strong>Select a {view === "tools" ? "Tool" : "Skill"}</strong>
              <span>Its definition will appear here.</span>
            </div>
          ) : view === "tools" ? (
            <>
              <div className="panel__header">
                <div>
                  <span className="eyebrow">Tool</span>
                  <h2>{selected.name}</h2>
                </div>
                {selected.requiresApproval && <span className="status-pill status-pill--blocked"><IconLock size={12} /> Carlos approval</span>}
              </div>
              <p className="capability-inspector__description">{selected.description || "No description."}</p>
              <div className="definition-list">
                <div><span>Provider</span><strong>{selected.provider || "—"}</strong></div>
                <div><span>Model</span><strong>{selected.model || "—"}</strong></div>
                <div><span>Authority</span><strong>{selected.requiresApproval ? "Carlos must approve" : "Agent may execute"}</strong></div>
              </div>
              <div className="capability-contract">
                <h3>Input</h3>
                <pre className="data-block">{JSON.stringify(selected.input || {}, null, 2)}</pre>
                <h3>Output</h3>
                <pre className="data-block">{JSON.stringify(selected.output ?? null, null, 2)}</pre>
              </div>
              <button
                type="button"
                className="button button--quiet capability-inspector__action"
                onClick={() => onAskNora?.(`Review and update Tool ${selected.name}: `)}
              >
                <IconSparkles size={15} /> Ask Nora to modify
              </button>
            </>
          ) : (
            <>
              <div className="panel__header">
                <div>
                  <span className="eyebrow">Skill</span>
                  <h2>{selected.name}</h2>
                </div>
              </div>
              <div className="skill-content">{selected.content || "No Skill content."}</div>
              <button
                type="button"
                className="button button--quiet capability-inspector__action"
                onClick={() => onAskNora?.(`Review and update Skill ${selected.name}: `)}
              >
                <IconSparkles size={15} /> Ask Nora to modify
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
