import { useCallback, useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import api, { endpoints } from "./api";
import Sidebar from "./components/Sidebar";
import ChatPage from "./pages/ChatPage";
import OfficeMapPage from "./pages/OfficeMapPage";
import ToolsPage from "./pages/ToolsPage";
import SkillsPage from "./pages/SkillsPage";
import SettingsPage from "./pages/SettingsPage";
import AuthorizationsPage from "./pages/AuthorizationsPage";
import ProcessesPage from "./pages/ProcessesPage";
import OperationsPage from "./pages/OperationsPage";

const PAGES = ["chat", "map", "processes", "tools", "skills", "authorizations", "operations", "settings"];

const prefersDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

export default function App() {
  const [active, setActiveState] = useState(() => {
    const stored = localStorage.getItem("office-active-page") || "chat";
    if (stored === "agents") return "map";
    return PAGES.includes(stored) ? stored : "chat";
  });
  const [theme, setThemeState] = useState(localStorage.getItem("office-theme") || "system");
  const [systemDark, setSystemDark] = useState(prefersDark);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => localStorage.getItem("office-sidebar-collapsed") === "true");
  const [health, setHealth] = useState(null);
  const [nora, setNora] = useState({ provider: "", model: "" });
  const [agents, setAgents] = useState([]);
  const [activeAgents, setActiveAgents] = useState([]);
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chatRequest, setChatRequest] = useState(null);
  const [operationsRequest, setOperationsRequest] = useState(null);

  const effective = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  const setActive = value => {
    setActiveState(value);
    localStorage.setItem("office-active-page", value);
  };

  const setTheme = value => {
    setThemeState(value);
    localStorage.setItem("office-theme", value);
  };

  const setSidebarCollapsed = value => {
    setSidebarCollapsedState(value);
    localStorage.setItem("office-sidebar-collapsed", String(value));
  };

  const load = useCallback(async () => {
    try {
      const [healthResponse, agentsResponse, toolsResponse, activeResponse, noraResponse] = await Promise.all([
        api.get(endpoints.health()),
        api.get(endpoints.agents()),
        api.get(endpoints.tools()),
        api.get(endpoints.agentsActive()),
        api.get(endpoints.nora()),
      ]);
      setHealth(healthResponse.data);
      setAgents(agentsResponse.data || []);
      setTools(toolsResponse.data || []);
      setActiveAgents(activeResponse.data || []);
      const noraState = noraResponse.data || {};
      setNora({ provider: noraState.provider || "", model: noraState.model || "" });
    } catch (error) {
      setHealth(null);
      toast.error(error.response?.data?.error || "Carlos Office backend is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = effective;
  }, [effective]);

  useEffect(() => {
    load();
    const timer = setInterval(async () => {
      try {
        const [healthResponse, activeResponse, noraResponse] = await Promise.all([
          api.get(endpoints.health()),
          api.get(endpoints.agentsActive()),
          api.get(endpoints.nora()),
        ]);
        setHealth(healthResponse.data);
        setActiveAgents(activeResponse.data || []);
        const noraState = noraResponse.data || {};
        setNora({ provider: noraState.provider || "", model: noraState.model || "" });
      } catch {
        setHealth(null);
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);

  // React to OS theme changes. systemDark drives `effective` through React state
  // so every consumer (root data-theme, Sidebar, Toaster) re-renders on switch.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = event => {
      setSystemDark(event.matches);
    };
    setSystemDark(query.matches);
    query.addEventListener?.("change", onChange);
    return () => {
      query.removeEventListener?.("change", onChange);
    };
  }, []);

  const openConversationFromMap = conversationId => {
    setChatRequest({ conversationId, token: Date.now() });
    setActive("chat");
  };

  const askNora = prefill => {
    setChatRequest({ prefill, token: Date.now() });
    setActive("chat");
  };

  const openOperations = workflowId => {
    if (!workflowId) {
      setActive("operations");
      return;
    }
    setOperationsRequest({ workflowId, token: Date.now() });
    setActive("operations");
  };

  const updateAgentState = updated => {
    setAgents(current => current.some(agent => agent.name === updated.name)
      ? current.map(agent => agent.name === updated.name ? updated : agent)
      : [...current, updated]);
    if (updated?.isNora) setNora({ provider: updated.provider || "", model: updated.model || "" });
  };

  const workingCount = activeAgents.length;
  const connected = health?.ok === true;

  const secondaryPage = {
    map: <OfficeMapPage agents={agents} activeAgents={activeAgents} onOpenConversation={openConversationFromMap} onOpenOperations={openOperations} onAgentSaved={updateAgentState} />,
    tools: <ToolsPage tools={tools} onAskNora={askNora} />,
    skills: <SkillsPage onAskNora={askNora} />,
    settings: <SettingsPage health={health} theme={theme} setTheme={setTheme} />,
    authorizations: <AuthorizationsPage />,
    processes: <ProcessesPage onAskNora={askNora} />,
    operations: <OperationsPage onAskNora={askNora} openRequest={operationsRequest} />,
  }[active] || null;

  return (
    <div className={`office-shell office-shell--${active} ${sidebarCollapsed ? "office-shell--sidebar-collapsed" : ""}`}>
      <Sidebar
        active={active}
        setActive={setActive}
        connected={connected}
        nora={nora}
        effectiveTheme={effective}
        theme={theme}
        setTheme={setTheme}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        workingCount={workingCount}
      />
      <main className="office-shell__main">
        {loading ? (
          <div className="office-shell__loading">
            <div className="loader" />
            <span>Starting Carlos Office…</span>
          </div>
        ) : (
          <>
            <div className="office-shell__page" hidden={active !== "chat"}>
              <ChatPage agents={agents} health={health} nora={nora} onNoraChange={setNora} openRequest={chatRequest} onOpenOperations={openOperations} />
            </div>
            {active !== "chat" && secondaryPage}
          </>
        )}
      </main>
      <Toaster richColors theme={effective === "light" ? "light" : "dark"} position="bottom-right" />
    </div>
  );
}