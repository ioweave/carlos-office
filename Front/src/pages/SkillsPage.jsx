import { useCallback, useEffect, useMemo, useState } from "react";
import { IconRefresh, IconSearch, IconSparkles } from "@tabler/icons-react";
import api, { endpoints } from "../api";
import MarkdownMessage from "../components/MarkdownMessage";
import StateView from "../components/StateView";

export default function SkillsPage({ onAskNora }) {
  const [skills, setSkills] = useState([]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const list = (await api.get(endpoints.skills())).data || [];
      setSkills(list);
      setError("");
      setSelected(current => (current && list.some(item => item.name === current) ? current : (list[0]?.name || "")));
    } catch (fetchError) {
      setError(fetchError.response?.data?.error || "Could not load skills.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? skills.filter(item => item.name.toLowerCase().includes(needle)) : skills;
  }, [skills, query]);

  const detail = useMemo(() => skills.find(item => item.name === selected) || null, [skills, selected]);

  return (
    <div className="skills-page redesign-page">
      <header className="redesign-header">
        <div className="redesign-header__leading">
          <span className="eyebrow">Reusable office expertise</span>
          <h1 className="redesign-header__title">Skills</h1>
          <p className="redesign-header__subtitle">Markdown playbooks available to every Agent. Ask Nora to create or update a Skill.</p>
        </div>
        <div className="skills-page__header-actions">
          <button type="button" className="secondary-button" onClick={load}><IconRefresh size={15} /> Refresh</button>
          <button type="button" className="primary-button" onClick={() => onAskNora?.("Create or update a Skill for: ")}><IconSparkles size={15} /> Ask Nora</button>
        </div>
      </header>

      <div className="skills-page__body">
        <aside className="skills-page__library">
          <label className="skills-page__search">
            <IconSearch size={16} />
            <input className="skills-page__search-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a skill" aria-label="Search skills" />
          </label>
          {loading ? (
            <StateView variant="loading" />
          ) : error ? (
            <StateView variant="error" message={error} />
          ) : !filtered.length ? (
            <StateView variant="empty" icon={IconSparkles} title="No skills" message="Ask Nora to create a Skill from Chat." />
          ) : (
            <ul className="skills-page__list">
              {filtered.map(item => (
                <li key={item.name}>
                  <button type="button" className={`skills-page__item ${selected === item.name ? "skills-page__item--active" : ""}`} onClick={() => setSelected(item.name)}>
                    <IconSparkles size={16} />
                    <span className="skills-page__item-label">{item.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="skills-page__detail">
          {!detail ? (
            <StateView variant="empty" icon={IconSparkles} title="Select a skill" />
          ) : (
            <>
              <header className="skills-page__detail-header">
                <div>
                  <span className="eyebrow">Skill</span>
                  <h2 className="skills-page__detail-title">{detail.name}</h2>
                </div>
                <button type="button" className="secondary-button" onClick={() => onAskNora?.(`Create or update the Skill ${detail.name}.`)}><IconSparkles size={15} /> Ask Nora to update</button>
              </header>
              <div className="skills-page__content">
                <MarkdownMessage content={detail.content} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}