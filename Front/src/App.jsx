import { useEffect, useMemo, useRef, useState } from "react";
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
import { Toaster } from "sonner";

import { useAppContext } from "./AppContext";
import ApprovalDrawer from "./components/ApprovalDrawer";
import CapabilitiesPage from "./pages/CapabilitiesPage";
import ChatPage from "./pages/ChatPage";
import OfficeMapPage from "./pages/OfficeMapPage";
import OperationsPage from "./pages/OperationsPage";
import ProcessesPage from "./pages/ProcessesPage";
import StorePage from "./pages/StorePage";

const ACTIVE_CONVERSATION_KEY = "office-active-conversation-v2";

const NAV_ITEMS = [
  { id: "office", label: "Office", icon: IconBuildingSkyscraper },
  { id: "chat", label: "Chat", icon: IconMessageCircle },
  { id: "processes", label: "Processes", icon: IconGitBranch },
  { id: "operations", label: "Operations", icon: IconActivity },
  { id: "capabilities", label: "Capabilities", icon: IconTool },
  { id: "store", label: "Store", icon: IconKey },
];

export default function App() {
  const {
    activePage: active,
    setActivePage: setActive,
    theme,
    effectiveTheme,
    cycleTheme,
    officeState,
    connected,
    loading,
    refresh,
    chatRequest,
    operationsRequest,
    openConversation,
    askNora,
    openOperations,
  } = useAppContext();
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [backgroundChatRequest, setBackgroundChatRequest] = useState(null);
  const conversationsRevision = officeState.conversationsRevision ?? "";
  const previousConversationsRevision = useRef(conversationsRevision);
  const nora = officeState.nora || { provider: "", model: "" };
  const approvals = officeState.approvals || [];
  const pendingApprovals = useMemo(
    () => approvals.filter(item => item.status === "pending"),
    [approvals],
  );

  useEffect(() => {
    if (previousConversationsRevision.current === conversationsRevision) return;
    previousConversationsRevision.current = conversationsRevision;
    if (active !== "chat" || !conversationsRevision) return;

    const conversationId = sessionStorage.getItem(ACTIVE_CONVERSATION_KEY);
    if (!conversationId) return;
    setBackgroundChatRequest({ conversationId, token: Date.now() });
  }, [active, conversationsRevision]);

  const effectiveChatRequest = (
    (backgroundChatRequest?.token ?? 0) > (chatRequest?.token ?? 0)
      ? backgroundChatRequest
      : chatRequest
  );

  const ThemeIcon = theme === "light" ? IconSun : theme === "dark" ? IconMoon : IconDeviceDesktop;

  let page = null;
  if (active === "office") {
    page = (
      <OfficeMapPage
        onOpenConversation={openConversation}
        onOpenOperations={openOperations}
      />
    );
  } else if (active === "chat") {
    page = (
      <ChatPage
        health={connected ? { ok: true } : null}
        nora={nora}
        openRequest={effectiveChatRequest}
        onOpenOperations={openOperations}
      />
    );
  } else if (active === "processes") {
    page = <ProcessesPage onAskNora={askNora} />;
  } else if (active === "operations") {
    page = <OperationsPage onAskNora={askNora} openRequest={operationsRequest} />;
  } else if (active === "capabilities") {
    page = <CapabilitiesPage onAskNora={askNora} />;
  } else if (active === "store") {
    page = <StorePage />;
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
        onChanged={refresh}
      />

      <Toaster richColors theme={effectiveTheme === "light" ? "light" : "dark"} position="bottom-right" />
    </div>
  );
}
