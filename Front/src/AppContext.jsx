import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import api, { endpoints, setOfficeMutationListener } from "./api";

const PAGES = new Set(["office", "chat", "processes", "operations", "capabilities", "store", "providers"]);
const ACTIVE_PAGE_STORAGE_KEY = "office-active-page-v1";
const ACTIVE_CONVERSATION_KEY = "office-active-conversation-v2";
const THEME_STORAGE_KEY = "office-theme";
const LONG_POLL_WAIT_MS = 240_000;
const PING_TIMEOUT_MS = 250_000;
const RETRY_DELAY_MS = 10_000;

const EMPTY_OFFICE_STATE = {
  nora: { provider: "", model: "" },
  workflows: [],
  approvals: [],
  agents: [],
};

const systemPrefersDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

const storedActivePage = () => {
  try {
    const stored = sessionStorage.getItem(ACTIVE_PAGE_STORAGE_KEY);
    const value = stored === "credentials" ? "store" : stored;
    return PAGES.has(value) ? value : "office";
  } catch {
    return "office";
  }
};

const parseConversationRevision = value => {
  if (!value || typeof value !== "string") return new Map();
  try {
    const entries = JSON.parse(value);
    if (!Array.isArray(entries)) return new Map();
    return new Map(entries
      .filter(entry => Array.isArray(entry) && typeof entry[0] === "string")
      .map(([id, count, lastMessageId, lastMessageAt, lastActor]) => [id, {
        count: Number.isFinite(count) ? count : 0,
        lastMessageId: typeof lastMessageId === "string" ? lastMessageId : "",
        lastMessageAt: typeof lastMessageAt === "string" ? lastMessageAt : "",
        lastActor: typeof lastActor === "string" ? lastActor : "",
      }]));
  } catch {
    return new Map();
  }
};

const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  const [activePage, setActivePageState] = useState(storedActivePage);
  const [theme, setThemeState] = useState(() => localStorage.getItem(THEME_STORAGE_KEY) || "system");
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [officeState, setOfficeState] = useState(EMPTY_OFFICE_STATE);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chatRequest, setChatRequest] = useState(null);
  const [operationsRequest, setOperationsRequest] = useState(null);
  const [unreadConversationIds, setUnreadConversationIds] = useState(() => new Set());
  const stateRef = useRef(EMPTY_OFFICE_STATE);
  const revisionRef = useRef(0);
  const instanceRef = useRef(null);
  const wakePollRef = useRef(null);
  const conversationRevisionRef = useRef(new Map());
  const conversationRevisionReadyRef = useRef(false);

  const effectiveTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  const requestPing = useCallback(async ({ waitMs = 0, signal = null } = {}) => {
    try {
      const response = await api.get(endpoints.ping(), {
        params: {
          since: revisionRef.current,
          wait: waitMs,
          ...(instanceRef.current ? { instance: instanceRef.current } : {}),
        },
        signal,
        timeout: PING_TIMEOUT_MS,
      });
      const payload = response.data || {};
      const nextRevision = Number.isSafeInteger(payload.revision) ? payload.revision : revisionRef.current;
      const nextInstance = typeof payload.instance === "string" ? payload.instance : instanceRef.current;
      const isNewInstance = Boolean(nextInstance && nextInstance !== instanceRef.current);
      const shouldApply = payload.reset || isNewInstance || nextRevision > revisionRef.current;

      if (shouldApply) {
        const base = payload.reset || isNewInstance ? EMPTY_OFFICE_STATE : stateRef.current;
        const nextState = { ...base, ...(payload.state || {}) };
        stateRef.current = nextState;
        setOfficeState(nextState);
      }

      revisionRef.current = nextRevision;
      instanceRef.current = nextInstance;
      setConnected(payload.ok === true);
      return payload;
    } catch (error) {
      const cancelled = error?.code === "ERR_CANCELED" || error?.name === "CanceledError";
      if (!cancelled) {
        console.error("[app] Office ping failed.", {
          message: error instanceof Error ? error.message : String(error),
        });
        setConnected(false);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    wakePollRef.current?.();
  }, []);

  const setActivePage = value => {
    if (!PAGES.has(value)) return;
    setActivePageState(value);
    try {
      sessionStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, value);
    } catch {
      // Session persistence is optional; React context remains authoritative while the app is open.
    }
  };

  const setTheme = value => {
    if (!["system", "light", "dark"].includes(value)) return;
    setThemeState(value);
    localStorage.setItem(THEME_STORAGE_KEY, value);
  };

  const cycleTheme = () => {
    const order = ["system", "light", "dark"];
    setTheme(order[(order.indexOf(theme) + 1) % order.length]);
  };

  const markConversationRead = useCallback(conversationId => {
    if (!conversationId) return;
    setUnreadConversationIds(current => {
      if (!current.has(conversationId)) return current;
      const next = new Set(current);
      next.delete(conversationId);
      return next;
    });
  }, []);

  const openConversation = conversationId => {
    setChatRequest({ conversationId, token: Date.now() });
    setActivePage("chat");
  };

  const askNora = prefill => {
    setChatRequest({ prefill, token: Date.now() });
    setActivePage("chat");
  };

  const openOperations = workflowId => {
    setOperationsRequest(workflowId ? { workflowId, token: Date.now() } : null);
    setActivePage("operations");
  };

  useEffect(() => {
    const next = parseConversationRevision(officeState.conversationsRevision);
    if (!conversationRevisionReadyRef.current) {
      conversationRevisionRef.current = next;
      conversationRevisionReadyRef.current = true;
      return;
    }

    const previous = conversationRevisionRef.current;
    const activeConversationId = (() => {
      try {
        return sessionStorage.getItem(ACTIVE_CONVERSATION_KEY) || "";
      } catch {
        return "";
      }
    })();

    setUnreadConversationIds(current => {
      const unread = new Set(current);

      for (const id of previous.keys()) {
        if (!next.has(id)) unread.delete(id);
      }

      for (const [id, snapshot] of next) {
        const prior = previous.get(id);
        if (!prior || snapshot.lastMessageId === prior.lastMessageId) continue;

        const currentlyReading = activePage === "chat" && activeConversationId === id;
        if (currentlyReading) {
          unread.delete(id);
          continue;
        }

        if (snapshot.lastActor === "Nora") unread.add(id);
      }

      return unread;
    });

    conversationRevisionRef.current = next;
  }, [activePage, officeState.conversationsRevision]);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
  }, [effectiveTheme]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = event => setSystemDark(event.matches);
    setSystemDark(query.matches);
    query.addEventListener?.("change", handleChange);
    return () => query.removeEventListener?.("change", handleChange);
  }, []);

  useEffect(() => {
    let stopped = false;
    let controller = null;
    let timer = null;
    let restartRequested = false;

    const schedule = delay => {
      if (stopped || document.hidden) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void poll();
      }, delay);
    };

    const restart = () => {
      if (stopped || document.hidden) return;
      restartRequested = true;
      if (controller) controller.abort();
      else schedule(0);
    };

    const poll = async () => {
      if (stopped || document.hidden || controller) return;
      controller = new AbortController();
      const waitMs = instanceRef.current ? LONG_POLL_WAIT_MS : 0;
      const payload = await requestPing({ waitMs, signal: controller.signal });
      controller = null;
      if (stopped || document.hidden) return;

      if (restartRequested) {
        restartRequested = false;
        schedule(0);
        return;
      }
      schedule(payload ? 0 : RETRY_DELAY_MS);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        controller?.abort();
        return;
      }
      restartRequested = false;
      schedule(0);
    };

    wakePollRef.current = restart;
    setOfficeMutationListener(restart);
    schedule(0);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopped = true;
      wakePollRef.current = null;
      setOfficeMutationListener(null);
      if (timer !== null) window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [requestPing]);

  return (
    <AppContext.Provider value={{
      activePage,
      setActivePage,
      theme,
      effectiveTheme,
      setTheme,
      cycleTheme,
      officeState,
      connected,
      loading,
      refresh,
      chatRequest,
      operationsRequest,
      unreadConversationIds: [...unreadConversationIds],
      markConversationRead,
      openConversation,
      askNora,
      openOperations,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppContext must be used inside AppProvider");
  return context;
};
