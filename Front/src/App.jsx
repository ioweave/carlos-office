import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconActivity,
  IconBuildingSkyscraper,
  IconDeviceDesktop,
  IconGitBranch,
  IconKey,
  IconMessageCircle,
  IconMoon,
  IconSun,
  IconTool,
} from "@tabler/icons-react";
import { Toaster, toast } from "sonner";

import api, { endpoints } from "./api";
import ApprovalDrawer from "./components/ApprovalDrawer";
import CapabilitiesPage from "./pages/CapabilitiesPage";
import ChatPage from "./pages/ChatPage";
import OfficeMapPage from "./pages/OfficeMapPage";
import OperationsPage from "./pages/OperationsPage";
import ProcessesPage from "./pages/ProcessesPage";

const PAGES = new Set(["office", "chat", "processes", "operations", "capabilities"]);
const THEME_STORAGE_KEY = "office-theme";

const NAV_ITEMS = [
  { id: "office", label: "Office", icon: IconBuildingSkyscraper },
  { id: "chat", label: "Chat", icon: IconMessageCircle },
  { id: "processes", label: "Processes", icon: IconGitBranch },
  { id: "operations", label: "Operations", icon: IconActivity },
  { id: "capabilities", label: "Capabilities", icon: IconTool },
];

const systemPrefersDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

export default function App() {
  const [active, setActiveState] = useState("office");
  const [theme, setThemeState] = useState(localStorage.getItem(THEME_STORAGE_KEY) || "system");
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [health, setHealth] = useState(null);
  const [nora, setNora] = useState({ provider: "", model: "" });
  const [agents, setAgents] = useState([]);
  const [activeAgents, setActiveAgents] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chatRequest, setChatRequest] = useState(null);
  const [operationsRequest, setOperationsRequest] = useState(null);

  const effectiveTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const connected = health?.ok === true;
  const pendingApprovals = useMemo(
    () => approvals.filter(item => item.status === "pending"),
    [approvals],
  );

  const setActive = value => {
    if (!PAGES.has(value)) return;
    setActiveState(value);
  };

  const setTheme = value => {
    setThemeState(value);
    localStorage.setItem(THEME_STORAGE_KEY, value);
  };

  const cycleTheme = () => {
    const order = ["system", "light", "dark"];
    setTheme(order[(order.indexOf(theme) + 1) % order.length]);
  };

  const loadShell = useCallback(async ({ quiet = false } = {}) => {
    try {
      const [healthResponse, agentsResponse, activeResponse, noraResponse, approvalsResponse] = await Promise.all([
        api.get(endpoints.health()),
        api.get(endpoints.agents()),
        api.get(endpoints.agentsActive()),
        api.get(endpoints.nora()),
        api.get(endpoints.approvals()),
      ]);

      setHealth(healthResponse.data);
      setAgents(agentsResponse.data || []);
      setActiveAgents(activeResponse.data || []);
      setApprovals(approvalsResponse.data || []);
      const noraState = noraResponse.data || {};
      setNora({ provider: noraState.provider || "", model: noraState.model || "" });
    } catch (error) {
      setHealth(null);
      if (!quiet) toast.error(error.response?.data?.error || "Carlos Office backend is unavailable.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
  }, [effectiveTheme]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = event => setSystemDark(event.matches);
    setSystemDark(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    loadShell();
    const timer = setInterval(() => loadShell({ quiet: true }), 6000);
    return () => clearInterval(timer);
  }, [loadShell]);

  const openConversation = conversationId => {
    setChatRequest({ conversationId, token: Date.now() });
    setActive("chat");
  };

  const askNora = prefill => {
    setChatRequest({ prefill, token: Date.now() });
    setActive("chat");
  };

  const openOperations = workflowId => {
    setOperationsRequest(workflowId ? { workflowId, token: Date.now() } : null);
    setActive("operations");
  };

  const updateAgentState = updated => {
    setAgents(current => current.some(agent => agent.name === updated.name)
      ? current.map(agent => agent.name === updated.name ? updated : agent)
      : [...current, updated]);
    if (updated?.isNora) {
      setNora({ provider: updated.provider || "", model: updated.model || "" });
    }
  };

  const ThemeIcon = theme === "light" ? IconSun : theme === "dark" ? IconMoon : IconDeviceDesktop;

  let page = null;
  if (active === "office") {
    page = (
      <OfficeMapPage
        agents={agents}
        activeAgents={activeAgents}
        onOpenConversation={openConversation}
        onOpenOperations={openOperations}
        onAgentSaved={updateAgentState}
      />
    );
  } else if (active === "chat") {
    page = (
      <ChatPage
        health={health}
        nora={nora}
        openRequest={chatRequest}
        onOpenOperations={openOperations}
      />
    );
  } else if (active === "processes") {
    page = <ProcessesPage onAskNora={askNora} />;
  } else if (active === "operations") {
    page = <OperationsPage onAskNora={askNora} openRequest={operationsRequest} />;
  } else if (active === "capabilities") {
    page = <CapabilitiesPage onAskNora={askNora} />;
  }

  return (
    <div className={`office-app office-app--${active}`}>
      <aside className="office-nav" aria-label="Carlos Office navigation">
        <button type="button" className="office-nav__brand" onClick={() => setActive("office")}>
          <span className="office-nav__brand-mark">CO</span>
          <span className="office-nav__brand-copy">
            <strong>Carlos Office</strong>
            <small>Private AI office</small>
          </span>
        </button>

        <nav className="office-nav__pages">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`office-nav__item ${active === item.id ? "office-nav__item--active" : ""}`}
                onClick={() => setActive(item.id)}
              >
                <Icon size={18} stroke={1.7} />
                <span>{item.label}</span>
                {item.id === "operations" && activeAgents.length > 0 && (
                  <span className="office-nav__count">{activeAgents.length}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="office-nav__utility">
          <button
            type="button"
            className={`office-nav__item ${pendingApprovals.length ? "office-nav__item--attention" : ""}`}
            onClick={() => setApprovalOpen(true)}
          >
            <IconKey size={18} stroke={1.7} />
            <span>Approvals</span>
            {pendingApprovals.length > 0 && <span className="office-nav__count">{pendingApprovals.length}</span>}
          </button>

          <button type="button" className="office-nav__item" onClick={cycleTheme} title={`Theme: ${theme}`}>
            <ThemeIcon size={18} stroke={1.7} />
            <span>{theme === "system" ? "System theme" : `${theme[0].toUpperCase()}${theme.slice(1)} theme`}</span>
          </button>
        </div>

        <footer className="office-nav__status">
          <span className={`status-dot ${connected ? "status-dot--online" : "status-dot--offline"}`} />
          <div>
            <strong>{connected ? "Platform online" : "Platform offline"}</strong>
            <small>{nora.model ? `Nora · ${nora.model}` : "Nora unavailable"}</small>
          </div>
        </footer>
      </aside>

      <main className="office-app__main">
        {loading ? (
          <div className="page-state page-state--loading">
            <span className="spinner" />
            <strong>Starting Carlos Office</strong>
          </div>
        ) : page}
      </main>

      <ApprovalDrawer
        open={approvalOpen}
        approvals={approvals}
        onClose={() => setApprovalOpen(false)}
        onChanged={() => loadShell({ quiet: true })}
      />

      <Toaster richColors theme={effectiveTheme === "light" ? "light" : "dark"} position="bottom-right" />
    </div>
  );
}
