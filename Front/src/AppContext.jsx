import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import api, { endpoints, setOfficeStateBridge } from "./api";

const PAGES = new Set(["office", "chat", "processes", "operations", "capabilities", "store", "providers"]);
const ACTIVE_PAGE_STORAGE_KEY = "office-active-page-v1";
const THEME_STORAGE_KEY = "office-theme";
const LONG_POLL_WAIT_MS = 240_000;
const PING_TIMEOUT_MS = 250_000;
const FALLBACK_RETRY_MS = 5_000;
const WS_RECONNECT_MAX_MS = 15_000;

const EMPTY_OFFICE_STATE = {
  nora: { provider: "", model: "" },
  models: [],
  workflows: [],
  approvals: [],
  agents: [],
  skillsRevision: 0,
  conversations: [],
  attachments: {},
  artifacts: {},
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

const conversationRevision = conversations => new Map((conversations || []).map(conversation => {
  const lastMessage = conversation.messages?.at(-1) ?? null;
  return [conversation.id, {
    count: conversation.messages?.length ?? 0,
    lastMessageId: lastMessage?.id ?? "",
    lastMessageAt: lastMessage?.at ?? "",
    lastActor: lastMessage?.actor ?? "",
  }];
}));

const websocketUrl = () => {
  const base = new URL(api.defaults.baseURL || window.location.origin, window.location.href);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/ws";
  base.search = "";
  base.hash = "";
  return base;
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
  const websocketRef = useRef(null);
  const websocketReadyRef = useRef(false);
  const revisionWaitersRef = useRef(new Set());
  const conversationRevisionRef = useRef(new Map());
  const conversationRevisionReadyRef = useRef(false);

  const effectiveTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  const resolveRevisionWaiters = useCallback(() => {
    for (const waiter of [...revisionWaitersRef.current]) {
      if (revisionRef.current <= waiter.baseline) continue;
      revisionWaitersRef.current.delete(waiter);
      window.clearTimeout(waiter.timer);
      waiter.resolve(revisionRef.current);
    }
  }, []);

  const applyStatePayload = useCallback(payload => {
    if (!payload || payload.ok !== true) return false;

    const nextRevision = Number.isSafeInteger(payload.revision) ? payload.revision : revisionRef.current;
    const nextInstance = typeof payload.instance === "string" ? payload.instance : instanceRef.current;
    const isNewInstance = Boolean(nextInstance && nextInstance !== instanceRef.current);
    const resetting = Boolean(payload.reset || isNewInstance);
    const shouldApply = resetting || nextRevision > revisionRef.current;

    if (shouldApply) {
      const base = resetting ? EMPTY_OFFICE_STATE : stateRef.current;
      const nextState = { ...base, ...(payload.state || {}) };
      stateRef.current = nextState;
      setOfficeState(nextState);
    }

    revisionRef.current = resetting ? nextRevision : Math.max(revisionRef.current, nextRevision);
    instanceRef.current = nextInstance;
    setConnected(true);
    setLoading(false);
    resolveRevisionWaiters();
    return shouldApply;
  }, [resolveRevisionWaiters]);

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
      applyStatePayload(response.data || {});
      return response.data || null;
    } catch (error) {
      const cancelled = error?.code === "ERR_CANCELED" || error?.name === "CanceledError";
      if (!cancelled) {
        console.error("[app] Office ping failed.", {
          message: error instanceof Error ? error.message : String(error),
        });
        if (!websocketReadyRef.current) setConnected(false);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [applyStatePayload]);

  const waitForRevision = useCallback((baseline, timeoutMs = 2_500) => {
    if (!Number.isSafeInteger(baseline) || revisionRef.current > baseline) {
      return Promise.resolve(revisionRef.current);
    }

    return new Promise(resolve => {
      const waiter = {
        baseline,
        resolve,
        timer: null,
      };
      waiter.timer = window.setTimeout(() => {
        revisionWaitersRef.current.delete(waiter);
        resolve(revisionRef.current);
      }, timeoutMs);
      revisionWaitersRef.current.add(waiter);
    });
  }, []);

  const refresh = useCallback(async () => {
    if (websocketReadyRef.current) return;
    await requestPing({ waitMs: 0 });
  }, [requestPing]);

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
    const next = conversationRevision(officeState.conversations);
    if (!conversationRevisionReadyRef.current) {
      conversationRevisionRef.current = next;
      conversationRevisionReadyRef.current = true;
      return;
    }

    const previous = conversationRevisionRef.current;
    setUnreadConversationIds(current => {
      const unread = new Set(current);

      for (const id of previous.keys()) {
        if (!next.has(id)) unread.delete(id);
      }

      for (const [id, snapshot] of next) {
        const prior = previous.get(id);
        if (!prior || snapshot.lastMessageId === prior.lastMessageId) continue;
        if (snapshot.lastActor === "Nora") unread.add(id);
      }

      return unread;
    });

    conversationRevisionRef.current = next;
  }, [officeState.conversations]);

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
    setOfficeStateBridge({
      read: () => ({ state: stateRef.current, revision: revisionRef.current }),
      waitForRevision,
    });
    return () => setOfficeStateBridge(null);
  }, [waitForRevision]);

  useEffect(() => {
    let stopped = false;
    let fallbackController = null;
    let fallbackTimer = null;
    let reconnectTimer = null;
    let reconnectDelay = 750;

    const stopFallback = () => {
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
      fallbackController?.abort();
      fallbackController = null;
    };

    const scheduleFallback = delay => {
      if (stopped || websocketReadyRef.current || document.hidden) return;
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = null;
        void fallbackPoll();
      }, delay);
    };

    const fallbackPoll = async () => {
      if (stopped || websocketReadyRef.current || document.hidden || fallbackController) return;
      fallbackController = new AbortController();
      const payload = await requestPing({
        waitMs: instanceRef.current ? LONG_POLL_WAIT_MS : 0,
        signal: fallbackController.signal,
      });
      fallbackController = null;
      if (stopped || websocketReadyRef.current || document.hidden) return;
      scheduleFallback(payload ? 0 : FALLBACK_RETRY_MS);
    };

    const scheduleReconnect = () => {
      if (stopped || document.hidden || reconnectTimer !== null) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
      }, reconnectDelay);
      reconnectDelay = Math.min(Math.round(reconnectDelay * 1.7), WS_RECONNECT_MAX_MS);
    };

    const connectWebSocket = () => {
      if (stopped || document.hidden) return;
      const current = websocketRef.current;
      if (current && [WebSocket.CONNECTING, WebSocket.OPEN].includes(current.readyState)) return;

      const url = websocketUrl();
      url.searchParams.set("since", String(revisionRef.current));
      if (instanceRef.current) url.searchParams.set("instance", instanceRef.current);

      const socket = new WebSocket(url);
      websocketRef.current = socket;

      socket.onopen = () => {
        if (stopped || websocketRef.current !== socket) return;
        websocketReadyRef.current = true;
        reconnectDelay = 750;
        setConnected(true);
        stopFallback();
      };

      socket.onmessage = event => {
        if (stopped || websocketRef.current !== socket) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === "state") applyStatePayload(payload);
        } catch (error) {
          console.error("[app] Invalid Office state WebSocket message.", {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      };

      socket.onerror = () => {
        // onclose owns reconnect/fallback behavior.
      };

      socket.onclose = () => {
        if (websocketRef.current === socket) websocketRef.current = null;
        websocketReadyRef.current = false;
        if (stopped) return;
        setConnected(false);
        scheduleFallback(0);
        scheduleReconnect();
      };
    };

    const bootstrap = async () => {
      await requestPing({ waitMs: 0 });
      if (stopped) return;
      connectWebSocket();
      if (!websocketReadyRef.current) scheduleFallback(FALLBACK_RETRY_MS);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stopFallback();
        if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
        websocketRef.current?.close(1000, "Page hidden");
        return;
      }
      void requestPing({ waitMs: 0 }).then(() => connectWebSocket());
    };

    void bootstrap();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopped = true;
      stopFallback();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      websocketRef.current?.close(1000, "App unmounted");
      websocketRef.current = null;
      websocketReadyRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibility);

      for (const waiter of revisionWaitersRef.current) {
        window.clearTimeout(waiter.timer);
        waiter.resolve(revisionRef.current);
      }
      revisionWaitersRef.current.clear();
    };
  }, [applyStatePayload, requestPing]);

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
