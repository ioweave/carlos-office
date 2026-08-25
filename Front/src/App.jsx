import { useMemo, useState } from "react";
import {
  IconActivity,
  IconBuildingSkyscraper,
  IconCpu,
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
import { useAppContext } from "./AppContext";
import ApprovalDrawer from "./components/ApprovalDrawer";
import CapabilitiesPage from "./pages/CapabilitiesPage";
import ChatPage from "./pages/ChatPage";
import OfficeMapPage from "./pages/OfficeMapPage";
import OperationsPage from "./pages/OperationsPage";
import ProcessesPage from "./pages/ProcessesPage";
import ProvidersPage from "./pages/ProvidersPage";
import StorePage from "./pages/StorePage";

const NAV_ITEMS = [
  { id: "office", label: "Office", icon: IconBuildingSkyscraper },
  { id: "chat", label: "Chat", icon: IconMessageCircle },
  { id: "processes", label: "Processes", icon: IconGitBranch },
  { id: "operations", label: "Operations", icon: IconActivity },
  { id: "capabilities", label: "Capabilities", icon: IconTool },
  { id: "store", label: "Store", icon: IconKey },
  { id: "providers", label: "Providers", icon: IconCpu },
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
    unreadConversationIds,
    markConversationRead,
    openConversation,
    askNora,
    openOperations,
  } = useAppContext();
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [editingNoraModel, setEditingNoraModel] = useState(false);
  const [noraModelCatalog, setNoraModelCatalog] = useState([]);
  const [noraModelDraft, setNoraModelDraft] = useState({ provider: "", model: "" });
  const [savingNoraModel, setSavingNoraModel] = useState(false);
  const nora = officeState.nora || { provider: "", model: "" };
  const approvals = officeState.approvals || [];
  const pendingApprovals = useMemo(
    () => approvals.filter(item => item.status === "pending"),
    [approvals],
  );
  const noraProviders = useMemo(() => noraModelCatalog.map(item => item.provider), [noraModelCatalog]);
  const modelsForNoraProvider = provider => (
    noraModelCatalog.find(item => item.provider === provider)?.models || []
  );

  const beginNoraModelEdit = async () => {
    if (!connected || savingNoraModel) return;

    try {
      let catalog = noraModelCatalog;
      if (!catalog.length) {
        catalog = (await api.get(endpoints.models())).data || [];
        setNoraModelCatalog(catalog);
      }

      const provider = nora.provider || catalog[0]?.provider || "";
      const availableModels = catalog.find(item => item.provider === provider)?.models || [];
      const model = nora.model || availableModels[0] || "";
      setNoraModelDraft({ provider, model });
      setEditingNoraModel(true);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not load Nora models.");
    }
  };

  const cancelNoraModelEdit = () => {
    if (savingNoraModel) return;
    setEditingNoraModel(false);
    setNoraModelDraft({ provider: "", model: "" });
  };

  const saveNoraModelEdit = async () => {
    if (!editingNoraModel || savingNoraModel) return;
    if (!noraModelDraft.provider || !noraModelDraft.model) {
      toast.error("Select a provider and model.");
      return;
    }
    if (noraModelDraft.provider === nora.provider && noraModelDraft.model === nora.model) {
      cancelNoraModelEdit();
      return;
    }

    setSavingNoraModel(true);
    try {
      await api.patch(endpoints.nora(), noraModelDraft);
      setEditingNoraModel(false);
      setNoraModelDraft({ provider: "", model: "" });
      await refresh();
      toast.success("Nora default model updated.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not update Nora.");
    } finally {
      setSavingNoraModel(false);
    }
  };

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
        nora={nora}
        openRequest={chatRequest}
        unreadConversationIds={unreadConversationIds}
        onConversationRead={markConversationRead}
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
  } else if (active === "providers") {
    page = <ProvidersPage />;
  }

  return (
    <div className={`office-app office-app--${active}`}>
      <aside className="office-nav" aria-label="Carlos Office navigation">
        <button type="button" className="office-nav__brand" onClick={() => setActive("office")}>
          <span className="office-nav__brand-mark">CO</span>
          <span className="office-nav__brand-copy">
            <strong>Carlos Office</strong>
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
            {editingNoraModel ? (
              <div
                style={{ display: "flex", minWidth: 0, flexDirection: "column", gap: "4px", marginTop: "4px" }}
                onBlur={event => {
                  if (!event.currentTarget.contains(event.relatedTarget)) cancelNoraModelEdit();
                }}
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveNoraModelEdit();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelNoraModelEdit();
                  }
                }}
              >
                <select
                  autoFocus
                  aria-label="Nora default provider"
                  value={noraModelDraft.provider}
                  disabled={savingNoraModel}
                  onChange={event => {
                    const provider = event.target.value;
                    const model = modelsForNoraProvider(provider)[0] || "";
                    setNoraModelDraft({ provider, model });
                  }}
                  style={{ width: "100%", minWidth: 0, fontSize: "10px" }}
                >
                  {!noraProviders.includes(noraModelDraft.provider) && noraModelDraft.provider && (
                    <option value={noraModelDraft.provider}>{noraModelDraft.provider}</option>
                  )}
                  {noraProviders.map(provider => <option key={provider} value={provider}>{provider}</option>)}
                </select>
                <select
                  aria-label="Nora default model"
                  value={noraModelDraft.model}
                  disabled={savingNoraModel}
                  onChange={event => setNoraModelDraft(current => ({ ...current, model: event.target.value }))}
                  style={{ width: "100%", minWidth: 0, fontSize: "10px" }}
                >
                  <option value="">Select model</option>
                  {modelsForNoraProvider(noraModelDraft.provider).map(model => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                  {!modelsForNoraProvider(noraModelDraft.provider).includes(noraModelDraft.model)
                    && noraModelDraft.model && (
                      <option value={noraModelDraft.model}>{noraModelDraft.model}</option>
                    )}
                </select>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void beginNoraModelEdit()}
                disabled={!connected}
                title="Edit Nora default model"
                style={{
                  maxWidth: "100%",
                  padding: 0,
                  background: "transparent",
                  color: "inherit",
                  textAlign: "left",
                }}
              >
                <small>{nora.model ? `Nora · ${nora.model}` : "Nora unavailable"}</small>
              </button>
            )}
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
