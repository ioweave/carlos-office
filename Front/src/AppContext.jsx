import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import api, { endpoints } from "./api";

const PAGES = new Set(["office", "chat", "processes", "operations", "capabilities", "store", "providers"]);
const ACTIVE_PAGE_STORAGE_KEY = "office-active-page-v1";
const ACTIVE_CONVERSATION_STORAGE_KEY = "office-active-conversation-v2";
const THEME_STORAGE_KEY = "office-theme";
const WS_RECONNECT_MAX_MS = 15_000;
const COMMAND_TIMEOUT_MS = 120_000;

const EMPTY_OFFICE_STATE = {
  nora: { provider: "", model: "", activeRequests: [] },
  models: [],
  workflows: [],
  approvals: [],
  agents: [],
  skillsRevision: 0,
  conversations: [],
};

const systemPrefersDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
const storedActivePage = () => {
  try {
    const stored = sessionStorage.getItem(ACTIVE_PAGE_STORAGE_KEY);
    const value = stored === "credentials" ? "store" : stored;
    return PAGES.has(value) ? value : "office";
  } catch { return "office"; }
};
const storedActiveConversation = () => {
  try { return sessionStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY) || ""; } catch { return ""; }
};
const conversationRevision = conversations => new Map((conversations || []).map(conversation => [conversation.id, {
  count: conversation.messageCount ?? 0,
  lastMessageId: conversation.lastMessageId ?? "",
  lastMessageAt: conversation.lastMessageAt ?? "",
  lastActor: conversation.lastActor ?? "",
}]));
const websocketUrl = () => {
  const base = new URL(api.defaults.baseURL || window.location.origin, window.location.href);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/ws";
  base.search = "";
  base.hash = "";
  return base;
};
const commandId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const createMessageId = () => {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `message-${uuid}` : `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};
const filePayload = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const value = String(reader.result || "");
    const comma = value.indexOf(",");
    resolve({
      name: file.name,
      type: file.type || "application/octet-stream",
      content: comma >= 0 ? value.slice(comma + 1) : "",
      encoding: "base64",
    });
  };
  reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}.`));
  reader.readAsDataURL(file);
});
const mergeOptimisticConversation = (canonical, optimistic) => {
  if (!optimistic) return canonical;
  if (!canonical || canonical.id !== optimistic.id) return optimistic;
  const canonicalById = new Map((canonical.messages || []).map(message => [message.id, message]));
  const localMessages = (optimistic.messages || []).filter(message => {
    const persisted = canonicalById.get(message.id);
    return !persisted
      || persisted.content !== message.content
      || JSON.stringify(persisted.attachments ?? []) !== JSON.stringify(message.attachments ?? []);
  });
  if (!localMessages.length) return canonical;
  const localById = new Map(localMessages.map(message => [message.id, message]));
  const messages = (canonical.messages || []).map(message => localById.get(message.id) ?? message);
  for (const message of localMessages) if (!canonicalById.has(message.id)) messages.push(message);
  return { ...canonical, ...optimistic, messages };
};
const mergeResources = (current, incoming) => {
  const byId = new Map((current || []).map(item => [item.id, item]));
  for (const item of incoming || []) if (item?.id) byId.set(item.id, item);
  return [...byId.values()];
};

const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  const initialConversationId = storedActiveConversation();
  const [activePage, setActivePageState] = useState(storedActivePage);
  const [activeConversationId, setActiveConversationIdState] = useState(initialConversationId);
  const [theme, setThemeState] = useState(() => localStorage.getItem(THEME_STORAGE_KEY) || "system");
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [officeState, setOfficeState] = useState(EMPTY_OFFICE_STATE);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chatRequest, setChatRequest] = useState(null);
  const [operationsRequest, setOperationsRequest] = useState(null);
  const [unreadConversationIds, setUnreadConversationIds] = useState(() => new Set());
  const [chatCanonicalConversation, setChatCanonicalConversation] = useState(null);
  const [chatOptimisticConversation, setChatOptimisticConversation] = useState(null);
  const [chatAttachments, setChatAttachments] = useState([]);
  const [chatArtifacts, setChatArtifacts] = useState([]);
  const [chatSending, setChatSending] = useState(false);
  const [chatLocalRequestJob, setChatLocalRequestJob] = useState(null);
  const stateRef = useRef(EMPTY_OFFICE_STATE);
  const websocketRef = useRef(null);
  const commandRequestsRef = useRef(new Map());
  const conversationRevisionRef = useRef(new Map());
  const conversationRevisionReadyRef = useRef(false);
  const activeConversationIdRef = useRef(initialConversationId);
  const chatUploadControllerRef = useRef(null);
  const chatSendInFlightRef = useRef(false);

  const effectiveTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const chatConversation = useMemo(
    () => mergeOptimisticConversation(chatCanonicalConversation, chatOptimisticConversation),
    [chatCanonicalConversation, chatOptimisticConversation],
  );
  const activeConversationSummary = useMemo(
    () => (officeState.conversations || []).find(item => item.id === activeConversationId) || null,
    [activeConversationId, officeState.conversations],
  );
  const chatActiveRequest = useMemo(
    () => (officeState.nora?.activeRequests || []).find(item => item.conversationId === activeConversationId) || null,
    [activeConversationId, officeState.nora?.activeRequests],
  );
  const chatRequestJob = chatActiveRequest
    || (chatLocalRequestJob?.conversationId === activeConversationId ? chatLocalRequestJob : null);
  const chatWorking = chatSending || Boolean(chatRequestJob);

  const applyStatePayload = useCallback(payload => {
    if (!payload || typeof payload.state !== "object" || Array.isArray(payload.state)) return false;
    const nextState = payload.reset
      ? { ...EMPTY_OFFICE_STATE, ...payload.state }
      : { ...stateRef.current, ...payload.state };
    stateRef.current = nextState;
    setOfficeState(nextState);
    setConnected(true);
    setLoading(false);
    return true;
  }, []);

  const sendCommand = useCallback((command, payload = {}) => new Promise((resolve, reject) => {
    const socket = websocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reject(new Error("Carlos Office is not connected."));
      return;
    }

    const id = commandId();
    const timer = window.setTimeout(() => {
      commandRequestsRef.current.delete(id);
      reject(new Error(`Command timed out: ${command}`));
    }, COMMAND_TIMEOUT_MS);
    commandRequestsRef.current.set(id, { resolve, reject, timer });

    try {
      socket.send(JSON.stringify({ type: "command", id, command, payload }));
    } catch (error) {
      window.clearTimeout(timer);
      commandRequestsRef.current.delete(id);
      reject(error);
    }
  }), []);

  const refresh = useCallback(async () => {
    try {
      await sendCommand("state.refresh");
      return true;
    } catch (error) {
      console.error("[app] Could not refresh Office state.", { message: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }, [sendCommand]);

  const setActivePage = useCallback(value => {
    if (!PAGES.has(value)) return;
    setActivePageState(value);
    try { sessionStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, value); } catch {
      // Session storage may be unavailable in restricted browser contexts.
    }
  }, []);
  const markConversationRead = useCallback(conversationId => {
    if (!conversationId) return;
    setUnreadConversationIds(current => {
      if (!current.has(conversationId)) return current;
      const next = new Set(current);
      next.delete(conversationId);
      return next;
    });
  }, []);
  const setActiveConversationId = useCallback(conversationId => {
    const id = typeof conversationId === "string" ? conversationId : "";
    activeConversationIdRef.current = id;
    setActiveConversationIdState(id);
    try {
      if (id) sessionStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, id);
      else sessionStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    } catch {
      // Session storage may be unavailable in restricted browser contexts.
    }
    if (id) markConversationRead(id);
  }, [markConversationRead]);
  const setTheme = value => {
    if (!["system", "light", "dark"].includes(value)) return;
    setThemeState(value);
    localStorage.setItem(THEME_STORAGE_KEY, value);
  };
  const cycleTheme = () => {
    const order = ["system", "light", "dark"];
    setTheme(order[(order.indexOf(theme) + 1) % order.length]);
  };

  const clearChatSession = useCallback(() => {
    chatUploadControllerRef.current?.abort();
    setChatCanonicalConversation(null);
    setChatOptimisticConversation(null);
    setChatAttachments([]);
    setChatArtifacts([]);
    setChatLocalRequestJob(null);
    setChatSending(false);
    chatSendInFlightRef.current = false;
  }, []);

  const loadChatConversation = useCallback(async conversationId => {
    if (!conversationId || !connected) return null;
    try {
      const bundle = await sendCommand("conversation.get", { conversationId });
      if (activeConversationIdRef.current !== conversationId) return null;
      setChatCanonicalConversation(bundle.conversation || null);
      setChatAttachments(bundle.attachments || []);
      setChatArtifacts(bundle.artifacts || []);
      return bundle.conversation || null;
    } catch (error) {
      if (error.statusCode !== 404) {
        console.error("[chat] Could not load Conversation.", {
          conversationId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    }
  }, [connected, sendCommand]);

  const openChatConversation = useCallback(conversationId => {
    if (!conversationId) return;
    if (activeConversationIdRef.current === conversationId) {
      markConversationRead(conversationId);
      return;
    }
    setActiveConversationId(conversationId);
    setChatCanonicalConversation(null);
    setChatOptimisticConversation(null);
    setChatAttachments([]);
    setChatArtifacts([]);
    setChatLocalRequestJob(null);
  }, [markConversationRead, setActiveConversationId]);

  const startNewChat = useCallback(() => {
    setActiveConversationId("");
    clearChatSession();
  }, [clearChatSession, setActiveConversationId]);

  const renameChatConversation = useCallback(async (conversationId, title) => {
    const updated = await sendCommand("conversation.rename", { conversationId, title });
    if (activeConversationIdRef.current === conversationId) setChatCanonicalConversation(updated);
    return updated;
  }, [sendCommand]);

  const deleteChatConversation = useCallback(async conversationId => {
    const result = await sendCommand("conversation.delete", { conversationId });
    if (activeConversationIdRef.current === conversationId) startNewChat();
    return result;
  }, [sendCommand, startNewChat]);

  const setChatConversationModel = useCallback(async ({ conversationId, provider, model }) => {
    const updated = await sendCommand("conversation.setModel", { conversationId, provider, model });
    if (activeConversationIdRef.current === conversationId) setChatCanonicalConversation(updated);
    return updated;
  }, [sendCommand]);

  const sendChatMessage = useCallback(async ({ content, files = [], provider = "", model = "" }) => {
    const text = String(content || "").trim() || "Review the attached files.";
    if (chatSendInFlightRef.current || chatWorking) throw new Error("A Nora request is already in progress.");

    chatSendInFlightRef.current = true;
    const previous = chatConversation;
    const optimistic = {
      id: createMessageId(),
      actor: "Carlos",
      at: new Date().toISOString(),
      content: text,
      attachments: [],
      artifacts: [],
      pending: true,
    };
    setChatOptimisticConversation(previous
      ? { ...previous, messages: [...(previous.messages || []), optimistic] }
      : { id: activeConversationId || "", messages: [optimistic], workflows: [], nora: { provider, model } });
    setChatSending(true);

    const controller = new AbortController();
    chatUploadControllerRef.current = controller;
    const uploaded = [];
    let conversationId = activeConversationId || "";
    let accepted = false;

    try {
      if (!conversationId) {
        const defaultProvider = provider || officeState.nora?.provider || officeState.models?.[0]?.provider || "";
        const defaultModel = model
          || officeState.nora?.model
          || officeState.models?.find(item => item.provider === defaultProvider)?.models?.[0]
          || "";
        if (!defaultProvider || !defaultModel) throw new Error("Select a provider and model before sending.");
        const created = await sendCommand("conversation.create", { provider: defaultProvider, model: defaultModel });
        conversationId = created.id;
        setActiveConversationId(created.id);
        setChatCanonicalConversation(created);
        setChatOptimisticConversation({ ...created, messages: [optimistic] });
      }

      const createdAttachments = await Promise.all(files.map(async file => {
        const payload = await filePayload(file);
        const created = (
          await api.post(endpoints.conversationAttachments(conversationId), {
            ...payload,
            createdBy: "Carlos",
          }, { signal: controller.signal })
        ).data;
        uploaded.push(created);
        return created;
      }));
      const attachmentIds = createdAttachments.map(item => item.id);
      setChatAttachments(current => mergeResources(current, createdAttachments));
      setChatOptimisticConversation(current => current ? {
        ...current,
        id: conversationId,
        messages: current.messages.map(message => (
          message.id === optimistic.id ? { ...message, attachments: attachmentIds } : message
        )),
      } : current);

      const result = await sendCommand("conversation.send", {
        conversationId,
        content: text,
        attachments: attachmentIds,
        messageId: optimistic.id,
      });
      accepted = true;
      setChatLocalRequestJob(result.job || null);
      setChatOptimisticConversation(current => current ? {
        ...current,
        id: conversationId,
        messages: current.messages.map(message => (
          message.id === optimistic.id ? { ...message, pending: false, attachments: attachmentIds } : message
        )),
      } : current);
      markConversationRead(conversationId);
      return { ...result, conversationId };
    } catch (error) {
      if (!accepted && uploaded.length && conversationId) {
        try {
          await sendCommand("conversation.deleteAttachments", {
            conversationId,
            attachmentIds: uploaded.map(item => item.id),
          });
        } catch (cleanupError) {
          console.error("[chat] Could not clean up failed message attachments.", {
            conversationId,
            message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
        const removed = new Set(uploaded.map(item => item.id));
        setChatAttachments(current => current.filter(item => !removed.has(item.id)));
      }
      if (!accepted) setChatOptimisticConversation(previous || null);
      throw error;
    } finally {
      chatUploadControllerRef.current = null;
      chatSendInFlightRef.current = false;
      setChatSending(false);
    }
  }, [activeConversationId, chatConversation, chatWorking, markConversationRead, officeState.models, officeState.nora, sendCommand, setActiveConversationId]);

  const editChatMessage = useCallback(async ({ messageId, content }) => {
    if (!chatConversation?.id || chatWorking) throw new Error("Conversation is busy.");
    const text = String(content || "").trim();
    if (!text) throw new Error("Message cannot be empty.");
    const messageIndex = chatConversation.messages.findIndex(message => message.id === messageId);
    if (messageIndex < 0) throw new Error("Message not found.");

    const previous = chatConversation;
    setChatOptimisticConversation({
      ...previous,
      messages: previous.messages.slice(0, messageIndex + 1).map(message => (
        message.id === messageId ? { ...message, content: text, pending: true } : message
      )),
      workflows: [],
    });
    setChatSending(true);

    try {
      const result = await sendCommand("conversation.editMessage", {
        conversationId: previous.id,
        messageId,
        content: text,
      });
      setChatCanonicalConversation(result.conversation);
      setChatOptimisticConversation(null);
      setChatLocalRequestJob(result.job || null);
      return result;
    } catch (error) {
      setChatOptimisticConversation(null);
      throw error;
    } finally {
      setChatSending(false);
    }
  }, [chatConversation, chatWorking, sendCommand]);

  const cancelChatRequest = useCallback(async () => {
    chatUploadControllerRef.current?.abort();
    if (!chatRequestJob || !activeConversationId) return false;
    await sendCommand("conversation.cancelRequest", {
      conversationId: activeConversationId,
      requestId: chatRequestJob.id,
    });
    setChatLocalRequestJob(null);
    return true;
  }, [activeConversationId, chatRequestJob, sendCommand]);

  const openConversation = useCallback(conversationId => {
    openChatConversation(conversationId);
    setChatRequest({ conversationId, token: Date.now() });
    setActivePage("chat");
  }, [openChatConversation, setActivePage]);
  const askNora = useCallback(prefill => {
    setChatRequest({ prefill, token: Date.now() });
    setActivePage("chat");
  }, [setActivePage]);
  const openOperations = useCallback(workflowId => {
    setOperationsRequest(workflowId ? { workflowId, token: Date.now() } : null);
    setActivePage("operations");
  }, [setActivePage]);

  useEffect(() => {
    const next = conversationRevision(officeState.conversations);
    if (!conversationRevisionReadyRef.current) {
      conversationRevisionRef.current = next;
      conversationRevisionReadyRef.current = true;
      return;
    }
    const previous = conversationRevisionRef.current;
    const visibleConversationId = activePage === "chat" ? activeConversationId : "";
    setUnreadConversationIds(current => {
      const unread = new Set(current);
      for (const id of previous.keys()) if (!next.has(id)) unread.delete(id);
      for (const [id, snapshot] of next) {
        const prior = previous.get(id);
        const changed = !prior
          || snapshot.lastMessageId !== prior.lastMessageId
          || snapshot.lastMessageAt !== prior.lastMessageAt;
        if (!changed || snapshot.lastActor !== "Nora") continue;
        if (id === visibleConversationId) unread.delete(id);
        else unread.add(id);
      }
      return unread;
    });
    if (activeConversationId && previous.has(activeConversationId) && !next.has(activeConversationId)) startNewChat();
    conversationRevisionRef.current = next;
  }, [activeConversationId, activePage, officeState.conversations, startNewChat]);

  useEffect(() => {
    if (!activeConversationId) {
      setChatCanonicalConversation(null);
      setChatAttachments([]);
      setChatArtifacts([]);
      return;
    }
    if (!connected) return;
    void loadChatConversation(activeConversationId);
  }, [
    activeConversationId,
    activeConversationSummary?.lastMessageId,
    activeConversationSummary?.lastMessageAt,
    activeConversationSummary?.title,
    activeConversationSummary?.nora?.provider,
    activeConversationSummary?.nora?.model,
    connected,
    loadChatConversation,
  ]);

  useEffect(() => {
    if (!chatCanonicalConversation || !chatOptimisticConversation) return;
    if (chatCanonicalConversation.id !== chatOptimisticConversation.id) return;
    const canonicalById = new Map(chatCanonicalConversation.messages.map(message => [message.id, message]));
    const synchronized = chatOptimisticConversation.messages.every(message => {
      const canonical = canonicalById.get(message.id);
      return canonical
        && canonical.content === message.content
        && JSON.stringify(canonical.attachments ?? []) === JSON.stringify(message.attachments ?? []);
    });
    if (synchronized) setChatOptimisticConversation(null);
  }, [chatCanonicalConversation, chatOptimisticConversation]);

  useEffect(() => {
    if (!chatLocalRequestJob) return;
    if ((officeState.nora?.activeRequests || []).some(job => job.id === chatLocalRequestJob.id)) {
      setChatLocalRequestJob(null);
      return;
    }
    const completedAt = Date.parse(activeConversationSummary?.lastMessageAt || "");
    const startedAt = Date.parse(chatLocalRequestJob.startedAt || "");
    if (activeConversationSummary?.lastActor === "Nora" && Number.isFinite(completedAt) && completedAt >= startedAt) {
      setChatLocalRequestJob(null);
    }
  }, [activeConversationSummary?.lastActor, activeConversationSummary?.lastMessageAt, chatLocalRequestJob, officeState.nora?.activeRequests]);

  useEffect(() => { document.documentElement.dataset.theme = effectiveTheme; }, [effectiveTheme]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = event => setSystemDark(event.matches);
    setSystemDark(query.matches);
    query.addEventListener?.("change", handleChange);
    return () => query.removeEventListener?.("change", handleChange);
  }, []);

  useEffect(() => {
    let stopped = false;
    let reconnectTimer = null;
    let reconnectDelay = 750;

    const rejectPendingCommands = message => {
      for (const request of commandRequestsRef.current.values()) {
        window.clearTimeout(request.timer);
        request.reject(new Error(message));
      }
      commandRequestsRef.current.clear();
    };
    const scheduleReconnect = () => {
      if (stopped || reconnectTimer !== null) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(Math.round(reconnectDelay * 1.7), WS_RECONNECT_MAX_MS);
    };
    const connect = () => {
      if (stopped) return;
      const current = websocketRef.current;
      if (current && [WebSocket.CONNECTING, WebSocket.OPEN].includes(current.readyState)) return;

      const socket = new WebSocket(websocketUrl());
      websocketRef.current = socket;
      socket.onopen = () => {
        if (stopped || websocketRef.current !== socket) return;
        reconnectDelay = 750;
        setConnected(true);
      };
      socket.onmessage = event => {
        if (stopped || websocketRef.current !== socket) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === "state") {
            applyStatePayload(payload);
            return;
          }
          if (payload?.type !== "command-result" || typeof payload.id !== "string") return;
          const request = commandRequestsRef.current.get(payload.id);
          if (!request) return;
          window.clearTimeout(request.timer);
          commandRequestsRef.current.delete(payload.id);
          if (payload.ok) request.resolve(payload.data);
          else {
            const error = new Error(payload.error || "App command failed.");
            error.statusCode = payload.statusCode;
            request.reject(error);
          }
        } catch (error) {
          console.error("[app] Invalid WebSocket message.", { message: error instanceof Error ? error.message : String(error) });
        }
      };
      socket.onclose = () => {
        if (websocketRef.current === socket) websocketRef.current = null;
        if (stopped) return;
        setConnected(false);
        rejectPendingCommands("Carlos Office connection closed before the command completed.");
        scheduleReconnect();
      };
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      rejectPendingCommands("Carlos Office connection closed.");
      websocketRef.current?.close(1000, "App unmounted");
      websocketRef.current = null;
    };
  }, [applyStatePayload]);

  useEffect(() => () => {
    chatUploadControllerRef.current?.abort();
  }, []);

  return (
    <AppContext.Provider value={{
      activePage,
      setActivePage,
      activeConversationId,
      setActiveConversationId,
      theme,
      effectiveTheme,
      setTheme,
      cycleTheme,
      officeState,
      connected,
      loading,
      refresh,
      sendCommand,
      chatRequest,
      operationsRequest,
      unreadConversationIds: [...unreadConversationIds],
      markConversationRead,
      openConversation,
      askNora,
      openOperations,
      chatConversation,
      chatAttachments,
      chatArtifacts,
      chatWorking,
      chatRequestJob,
      openChatConversation,
      startNewChat,
      renameChatConversation,
      deleteChatConversation,
      setChatConversationModel,
      sendChatMessage,
      editChatMessage,
      cancelChatRequest,
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
