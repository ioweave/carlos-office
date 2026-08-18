import { useCallback, useEffect, useState } from "react";
import { IconCloud, IconDeviceDesktop, IconMoon, IconRefresh, IconServer, IconShieldLock, IconSun } from "@tabler/icons-react";
import api, { endpoints } from "../api";
import StateView from "../components/StateView";
import StatusBadge from "../components/StatusBadge";

const LOCAL_DATA_CATEGORIES = [
  { name: "Conversations", note: "Durable message threads with Nora." },
  { name: "Artifacts", note: "Files attached to or produced within a Conversation." },
  { name: "Processes", note: "Reusable Process definitions stored as Markdown with an embedded graph definition." },
  { name: "Workflows", note: "Runtime instances of a Process with task state." },
  { name: "Agents", note: "Agent blueprints and active instances." },
  { name: "Skills", note: "Reusable markdown playbooks." },
  { name: "Tools", note: "Executable capability contracts." },
  { name: "Events", note: "Workflow and task runtime event history." },
  { name: "Schedules", note: "Timed Process triggers." },
];

export default function SettingsPage({ health, theme, setTheme }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const modelsResponse = await api.get(endpoints.models());
      setModels(modelsResponse.data || []);
      setError("");
    } catch (fetchError) {
      setError(fetchError.response?.data?.error || "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const connected = health?.ok === true;

  return (
    <div className="settings-page redesign-page">
      <header className="redesign-header">
        <div className="redesign-header__leading">
          <span className="eyebrow">Office configuration</span>
          <h1 className="redesign-header__title">Settings</h1>
          <p className="redesign-header__subtitle">Appearance, model providers, backend status and local data categories.</p>
        </div>
        <button type="button" className="secondary-button" onClick={load}><IconRefresh size={15} /> Refresh</button>
      </header>

      <div className="settings-page__body">
        <section className="settings-page__section">
          <header className="settings-page__section-head">
            <span className="eyebrow">Appearance</span>
            <h2 className="settings-page__section-title">Theme</h2>
            <p className="muted-copy">Switch the office interface between light and dark surfaces. System follows your OS preference.</p>
          </header>
          <div className="settings-page__theme">
            <button type="button" className={`secondary-button ${theme === "light" ? "secondary-button--active" : ""}`} onClick={() => setTheme("light")}><IconSun size={15} /> Light</button>
            <button type="button" className={`secondary-button ${theme === "dark" ? "secondary-button--active" : ""}`} onClick={() => setTheme("dark")}><IconMoon size={15} /> Dark</button>
            <button type="button" className={`secondary-button ${theme === "system" ? "secondary-button--active" : ""}`} onClick={() => setTheme("system")}><IconDeviceDesktop size={15} /> System</button>
          </div>
        </section>

        <section className="settings-page__section">
          <header className="settings-page__section-head">
            <span className="eyebrow">Backend</span>
            <h2 className="settings-page__section-title">Backend status</h2>
            <p className="muted-copy">Live connectivity snapshot from the Carlos Office backend.</p>
          </header>
          <ul className="settings-page__meta-list">
            <li className="settings-page__meta-item"><IconServer size={16} /><span className="settings-page__meta-text">Connectivity</span><StatusBadge tone={connected ? "success" : "warning"}>{connected ? "Connected" : "Disconnected"}</StatusBadge></li>
          </ul>
        </section>

        <section className="settings-page__section">
          <header className="settings-page__section-head">
            <span className="eyebrow">Model providers</span>
            <h2 className="settings-page__section-title">Model catalog</h2>
            <p className="muted-copy">Providers and models exposed by the backend. Edit backend configuration to change the catalog. No API keys or secrets are exposed here.</p>
          </header>
          {loading ? (
            <StateView variant="loading" />
          ) : error ? (
            <StateView variant="error" message={error} />
          ) : !models.length ? (
            <StateView variant="empty" icon={IconCloud} title="No providers" message="The backend exposes no model providers." />
          ) : (
            <ul className="settings-page__provider-list">
              {models.map(entry => (
                <li key={entry.provider} className="settings-page__provider">
                  <header className="settings-page__provider-head"><IconCloud size={16} /><strong className="settings-page__provider-name">{entry.provider}</strong><small className="settings-page__provider-meta">{entry.models.length} model{entry.models.length === 1 ? "" : "s"}</small></header>
                  <ul className="settings-page__model-chips">
                    {entry.models.map(model => <li key={model} className="settings-page__model-chip">{model}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="settings-page__section">
          <header className="settings-page__section-head">
            <span className="eyebrow">Local data</span>
            <h2 className="settings-page__section-title">Persisted categories</h2>
            <p className="muted-copy">Categories of data persisted by the Carlos Office backend. Exact storage paths and statistics are not exposed.</p>
          </header>
          <ul className="settings-page__category-list">
            {LOCAL_DATA_CATEGORIES.map(category => (
              <li key={category.name} className="settings-page__category">
                <strong className="settings-page__category-title">{category.name}</strong>
                <small className="settings-page__category-meta">{category.note}</small>
              </li>
            ))}
          </ul>
          <div className="settings-page__note">
            <IconShieldLock size={16} />
            <span>Storage location and runtime statistics are not exposed by any backend endpoint. Paths shown here would be fabricated and are omitted by design.</span>
          </div>
        </section>
      </div>
    </div>
  );
}