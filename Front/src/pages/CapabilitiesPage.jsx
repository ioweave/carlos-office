import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconBraces,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconSparkles,
  IconTool,
} from "@tabler/icons-react";
import api, { endpoints } from "../api";
import MarkdownMessage from "../components/MarkdownMessage";
import StateView from "../components/StateView";
import StatusBadge from "../components/StatusBadge";

export default function CapabilitiesPage({ onAskNora }) {
  const [tab, setTab] = useState("tools");
  const [tools, setTools] = useState([]);
  const [skills, setSkills] = useState([]);
  const [selectedTool, setSelectedTool] = useState("");
  const [selectedSkill, setSelectedSkill] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [toolsResponse, skillsResponse] = await Promise.all([
        api.get(endpoints.tools()),
        api.get(endpoints.skills()),
      ]);
      const nextTools = toolsResponse.data || [];
      const nextSkills = skillsResponse.data || [];
      setTools(nextTools);
      setSkills(nextSkills);
      setSelectedTool(current => (
        current && nextTools.some(item => item.name === current) ? current : (nextTools[0]?.name || "")
      ));
      setSelectedSkill(current => (
        current && nextSkills.some(item => item.name === current) ? current : (nextSkills[0]?.name || "")
      ));
      setError("");
    } catch (fetchError) {
      setError(fetchError.response?.data?.error || "Could not load capabilities.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const needle = query.trim().toLowerCase();
  const filteredTools = useMemo(() => (
    needle
      ? tools.filter(item => `${item.name} ${item.description || ""}`.toLowerCase().includes(needle))
      : tools
  ), [tools, needle]);
  const filteredSkills = useMemo(() => (
    needle ? skills.filter(item => item.name.toLowerCase().includes(needle)) : skills
  ), [skills, needle]);
  const tool = useMemo(
    () => tools.find(item => item.name === selectedTool) || null,
    [tools, selectedTool],
  );
  const skill = useMemo(
    () => skills.find(item => item.name === selectedSkill) || null,
    [skills, selectedSkill],
  );

  const askNora = () => onAskNora?.(
    tab === "tools" ? "Create or update a Tool for: " : "Create or update a Skill for: ",
  );

  return (
    <div className="capabilities-page redesign-page">
      <header className="redesign-header">
        <div className="redesign-header__leading">
          <span className="eyebrow">Office capabilities</span>
          <h1 className="redesign-header__title">Capabilities</h1>
          <p className="redesign-header__subtitle">
            Executable Tools and reusable Skill playbooks available to specialist Agents.
          </p>
        </div>
        <div className="capabilities-page__header-actions">
          <button type="button" className="secondary-button" onClick={load}>
            <IconRefresh size={15} /> Refresh
          </button>
          <button type="button" className="primary-button" onClick={askNora}>
            {tab === "tools" ? <IconTool size={15} /> : <IconSparkles size={15} />}
            Ask Nora
          </button>
        </div>
      </header>

      <nav className="redesign-tabs" aria-label="Capability type">
        <button
          type="button"
          className={tab === "tools" ? "redesign-tabs__tab redesign-tabs__tab--active" : "redesign-tabs__tab"}
          onClick={() => {
            setTab("tools");
            setQuery("");
          }}
        >
          Tools
        </button>
        <button
          type="button"
          className={tab === "skills" ? "redesign-tabs__tab redesign-tabs__tab--active" : "redesign-tabs__tab"}
          onClick={() => {
            setTab("skills");
            setQuery("");
          }}
        >
          Skills
        </button>
      </nav>

      <div className="capabilities-page__body">
        <aside className="capabilities-page__catalog">
          <label className="capabilities-page__search">
            <IconSearch size={16} />
            <input
              className="capabilities-page__search-input"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={tab === "tools" ? "Search tools" : "Find a skill"}
              aria-label={tab === "tools" ? "Search tools" : "Search skills"}
            />
          </label>

          {loading ? (
            <StateView variant="loading" />
          ) : error ? (
            <StateView variant="error" message={error} />
          ) : tab === "tools" && !filteredTools.length ? (
            <StateView variant="empty" icon={IconTool} title="No tools" />
          ) : tab === "skills" && !filteredSkills.length ? (
            <StateView variant="empty" icon={IconSparkles} title="No skills" />
          ) : (
            <ul className="capabilities-page__list">
              {(tab === "tools" ? filteredTools : filteredSkills).map(item => {
                const selected = tab === "tools" ? selectedTool === item.name : selectedSkill === item.name;
                const Icon = tab === "tools" ? IconTool : IconSparkles;

                return (
                  <li key={item.name}>
                    <button
                      type="button"
                      className={
                        `capabilities-page__item ${selected ? "capabilities-page__item--active" : ""}`
                      }
                      onClick={() => (
                        tab === "tools" ? setSelectedTool(item.name) : setSelectedSkill(item.name)
                      )}
                    >
                      <Icon size={16} />
                      <span className="capabilities-page__item-body">
                        <strong className="capabilities-page__item-name">{item.name}</strong>
                        {tab === "tools" && (
                          <small className="capabilities-page__item-meta">
                            {item.provider || "native"}{item.requiresApproval ? " · approval" : ""}
                          </small>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="capabilities-page__detail">
          {tab === "tools" && !tool && (
            <StateView variant="empty" icon={IconTool} title="Select a tool" />
          )}
          {tab === "skills" && !skill && (
            <StateView variant="empty" icon={IconSparkles} title="Select a skill" />
          )}

          {tab === "tools" && tool && (
            <>
              <header className="capabilities-page__detail-header">
                <div>
                  <span className="eyebrow">{tool.provider || "native"}</span>
                  <h2 className="capabilities-page__detail-title">{tool.name}</h2>
                  <p className="muted-copy">{tool.description || "No description."}</p>
                </div>
                <div className="capabilities-page__detail-meta">
                  <StatusBadge tone={tool.requiresApproval ? "warning" : "success"}>
                    {tool.requiresApproval ? "Approval required" : "No approval"}
                  </StatusBadge>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onAskNora?.(`Create or update the Tool ${tool.name}.`)}
                  >
                    <IconTool size={15} /> Ask Nora to update
                  </button>
                </div>
              </header>

              <section className="capabilities-page__contract">
                <h3 className="capabilities-page__contract-title">
                  <IconBraces size={15} /> Input contract
                </h3>
                <pre className="capabilities-page__code">{JSON.stringify(tool.input || {}, null, 2)}</pre>
              </section>

              {tool.output != null && (
                <section className="capabilities-page__contract">
                  <h3 className="capabilities-page__contract-title">
                    <IconBraces size={15} /> Output contract
                  </h3>
                  <pre className="capabilities-page__code">{JSON.stringify(tool.output, null, 2)}</pre>
                </section>
              )}

              {tool.description && (
                <section className="capabilities-page__contract">
                  <h3 className="capabilities-page__contract-title">
                    <IconShieldCheck size={15} /> Description
                  </h3>
                  <div className="capabilities-page__content">
                    <MarkdownMessage content={tool.description} />
                  </div>
                </section>
              )}
            </>
          )}

          {tab === "skills" && skill && (
            <>
              <header className="capabilities-page__detail-header">
                <div>
                  <span className="eyebrow">Skill</span>
                  <h2 className="capabilities-page__detail-title">{skill.name}</h2>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onAskNora?.(`Create or update the Skill ${skill.name}.`)}
                >
                  <IconSparkles size={15} /> Ask Nora to update
                </button>
              </header>
              <div className="capabilities-page__content">
                <MarkdownMessage content={skill.content} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
