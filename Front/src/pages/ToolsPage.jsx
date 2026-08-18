import { useCallback, useEffect, useMemo, useState } from "react";
import { IconBraces, IconRefresh, IconSearch, IconShieldCheck, IconTool } from "@tabler/icons-react";
import api, { endpoints } from "../api";
import MarkdownMessage from "../components/MarkdownMessage";
import StateView from "../components/StateView";
import StatusBadge from "../components/StatusBadge";

export default function ToolsPage({ tools, onAskNora }) {
  const [catalog, setCatalog] = useState(tools || []);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const list = (await api.get(endpoints.tools())).data || [];
      setCatalog(list);
      setError("");
      setSelected(current => (current && list.some(item => item.name === current) ? current : (list[0]?.name || "")));
    } catch (fetchError) {
      setError(fetchError.response?.data?.error || "Could not load tools.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (!catalog.length) load(); else setLoading(false); }, [load, catalog.length]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? catalog.filter(item => `${item.name} ${item.description} ${item.provider || ""}`.toLowerCase().includes(needle)) : catalog;
  }, [catalog, query]);

  const tool = useMemo(() => catalog.find(item => item.name === selected) || null, [catalog, selected]);

  return (
    <div className="tools-page redesign-page">
      <header className="redesign-header">
        <div className="redesign-header__leading">
          <span className="eyebrow">Programmatic capability registry</span>
          <h1 className="redesign-header__title">Tools</h1>
          <p className="redesign-header__subtitle">Executable functions available to Agents during Workflow execution. Ask Nora to create or update a Tool.</p>
        </div>
        <div className="tools-page__header-actions">
          <button type="button" className="secondary-button" onClick={load}><IconRefresh size={15} /> Refresh</button>
          <button type="button" className="primary-button" onClick={() => onAskNora?.("Create or update a Tool for: ")}><IconTool size={15} /> Ask Nora</button>
        </div>
      </header>

      <div className="tools-page__body">
        <aside className="tools-page__catalog">
          <label className="tools-page__search">
            <IconSearch size={16} />
            <input className="tools-page__search-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tools" aria-label="Search tools" />
          </label>
          {loading ? (
            <StateView variant="loading" />
          ) : error ? (
            <StateView variant="error" message={error} />
          ) : !filtered.length ? (
            <StateView variant="empty" icon={IconTool} title="No tools" message="Ask Nora to create a Tool from Chat." />
          ) : (
            <ul className="tools-page__list">
              {filtered.map(item => (
                <li key={item.name}>
                  <button type="button" className={`tools-page__item ${selected === item.name ? "tools-page__item--active" : ""}`} onClick={() => setSelected(item.name)}>
                    <IconTool size={16} />
                    <span className="tools-page__item-body">
                      <strong className="tools-page__item-name">{item.name}</strong>
                      <small className="tools-page__item-meta">{item.provider || "native"}{item.requiresApproval ? " · approval" : ""}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="tools-page__detail">
          {!tool ? (
            <StateView variant="empty" icon={IconTool} title="Select a tool" />
          ) : (
            <>
              <header className="tools-page__detail-header">
                <div>
                  <span className="eyebrow">{tool.provider || "native"}{tool.model ? ` · ${tool.model}` : ""}</span>
                  <h2 className="tools-page__detail-title">{tool.name}</h2>
                  <p className="muted-copy">{tool.description || "No description."}</p>
                </div>
                <div className="tools-page__detail-meta">
                  <StatusBadge tone={tool.requiresApproval ? "warning" : "success"}>
                    {tool.requiresApproval ? "Approval required" : "No approval"}
                  </StatusBadge>
                  <button type="button" className="secondary-button" onClick={() => onAskNora?.(`Create or update the Tool ${tool.name}.`)}><IconTool size={15} /> Ask Nora to update</button>
                </div>
              </header>

              <section className="tools-page__contract">
                <h3 className="tools-page__contract-title"><IconBraces size={15} /> Input contract</h3>
                <pre className="tools-page__code">{JSON.stringify(tool.input || {}, null, 2)}</pre>
              </section>

              {tool.output != null && (
                <section className="tools-page__contract">
                  <h3 className="tools-page__contract-title"><IconBraces size={15} /> Output contract</h3>
                  <pre className="tools-page__code">{JSON.stringify(tool.output, null, 2)}</pre>
                </section>
              )}

              {tool.description && (
                <section className="tools-page__contract">
                  <h3 className="tools-page__contract-title"><IconShieldCheck size={15} /> Description</h3>
                  <div className="tools-page__content"><MarkdownMessage content={tool.description} /></div>
                </section>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}