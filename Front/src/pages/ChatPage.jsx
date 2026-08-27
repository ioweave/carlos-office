import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowUp,
  IconCopy,
  IconFile,
  IconFolder,
  IconMessageCircle,
  IconMicrophone,
  IconPaperclip,
  IconPencil,
  IconPlus,
  IconShare,
  IconTrash,
  IconVolume,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import api, { endpoints } from "../api";
import { useAppContext } from "../AppContext";
import "../styles/chat-features.scss";
import ArtifactPanel from "../components/ArtifactPanel";
import MarkdownContent from "../components/MarkdownContent";
import WorkflowLink from "../components/WorkflowLink";

const formatTime = value => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
};

const conversationTitle = conversation => {
  const saved = conversation?.title?.trim();
  if (saved) return saved;
  const first = conversation?.messages?.find(message => message.actor === "Carlos");
  return first?.content?.replace(/\s+/g, " ").trim().slice(0, 56) || "New conversation";
};

const sortConversations = items => [...items].sort((left, right) => {
  const leftAt = left.messages?.at(-1)?.at || "";
  const rightAt = right.messages?.at(-1)?.at || "";
  return rightAt.localeCompare(leftAt);
});

const createMessageId = () => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `message-${uuid}`;
  return `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

const clipboardExtension = type => ({
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}[type] || "png");

const speechText = value => String(value || "")
  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  .replace(/```[\s\S]*?```/g, " code block ")
  .replace(/[`*_>#~|-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const mergeOptimisticConversation = (canonical, optimistic) => {
  if (!optimistic) return canonical;
  if (!canonical) return optimistic;
  if (canonical.id !== optimistic.id) return canonical;

  const canonicalIds = new Set((canonical.messages || []).map(message => message.id));
  const localMessages = (optimistic.messages || []).filter(message => !canonicalIds.has(message.id));
  if (!localMessages.length) return canonical;
  return { ...canonical, messages: [...(canonical.messages || []), ...localMessages] };
};

export default function ChatPage({ openRequest, onOpenOperations }) {
  const {
    officeState,
    activeConversationId,
    setActiveConversationId,
    unreadConversationIds,
    markConversationRead,
  } = useAppContext();
  const [optimisticConversation, setOptimisticConversation] = useState(null);
  const [localAttachments, setLocalAttachments] = useState([]);
  const [selectedArtifact, setSelectedArtifact] = useState(null);
  const [modelDraft, setModelDraft] = useState({ provider: "", model: "" });
  const [input, setInput] = useState("");
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState("");
  const [editingConversationId, setEditingConversationId] = useState("");
  const [editingTitleSurface, setEditingTitleSurface] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const chatThreadRef = useRef(null);
  const requestRef = useRef(null);
  const sendInFlightRef = useRef(false);
  const messageEditCancelledRef = useRef(false);
  const speechRecognitionRef = useRef(null);
  const speechBaseRef = useRef("");

  const nora = officeState.nora || { provider: "", model: "", activeRequests: [] };
  const models = officeState.models || [];
  const canonicalConversation = useMemo(
    () => (officeState.conversations || []).find(item => item.id === activeConversationId) || null,
    [activeConversationId, officeState.conversations],
  );
  const conversation = useMemo(() => {
    if (activeConversationId) return mergeOptimisticConversation(canonicalConversation, optimisticConversation);
    return optimisticConversation?.id === "" ? optimisticConversation : null;
  }, [activeConversationId, canonicalConversation, optimisticConversation]);
  const conversations = useMemo(() => {
    const records = officeState.conversations || [];
    if (!optimisticConversation?.id || records.some(item => item.id === optimisticConversation.id)) {
      return sortConversations(records);
    }
    return sortConversations([optimisticConversation, ...records]);
  }, [officeState.conversations, optimisticConversation]);
  const canonicalAttachments = officeState.attachments?.[activeConversationId] || [];
  const attachments = useMemo(() => {
    const byId = new Map(canonicalAttachments.map(item => [item.id, item]));
    for (const item of localAttachments) byId.set(item.id, item);
    return [...byId.values()];
  }, [canonicalAttachments, localAttachments]);
  const artifacts = officeState.artifacts?.[activeConversationId] || [];
  const providers = useMemo(() => models.map(item => item.provider), [models]);
  const unreadConversationSet = useMemo(() => new Set(unreadConversationIds), [unreadConversationIds]);
  const modelsFor = provider => models.find(item => item.provider === provider)?.models || [];
  const attachmentById = useMemo(
    () => Object.fromEntries(attachments.map(item => [item.id, item])),
    [attachments],
  );
  const artifactById = useMemo(
    () => Object.fromEntries(artifacts.map(item => [item.id, item])),
    [artifacts],
  );
  const activeRequest = useMemo(
    () => (nora.activeRequests || []).find(item => item.conversationId === activeConversationId) || null,
    [activeConversationId, nora.activeRequests],
  );
  const working = sending || Boolean(activeRequest);
  const workflowId = conversation?.workflows?.at(-1) || "";

  const resetEditing = useCallback(() => {
    setEditingConversationId("");
    setEditingTitleSurface("");
    setTitleDraft("");
    setEditingMessageId("");
    setMessageDraft("");
  }, []);

  const openConversation = useCallback(id => {
    if (!id) return;
    window.speechSynthesis?.cancel();
    setSpeakingMessageId("");
    setActiveConversationId(id);
    setOptimisticConversation(null);
    setLocalAttachments([]);
    setSelectedArtifact(null);
    resetEditing();
    markConversationRead(id);
  }, [markConversationRead, resetEditing, setActiveConversationId]);

  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.conversationId) openConversation(openRequest.conversationId);
    if (openRequest.prefill) {
      setInput(openRequest.prefill);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [openRequest, openConversation]);

  useEffect(() => {
    const selection = canonicalConversation?.nora || nora;
    setModelDraft({ provider: selection?.provider || "", model: selection?.model || "" });
  }, [activeConversationId, canonicalConversation?.nora?.model, canonicalConversation?.nora?.provider, nora.model, nora.provider]);

  useEffect(() => {
    if (!activeConversationId || !canonicalConversation || optimisticConversation?.id !== activeConversationId) return;
    const pendingIds = (optimisticConversation.messages || [])
      .filter(message => message.pending)
      .map(message => message.id);
    if (pendingIds.every(id => canonicalConversation.messages?.some(message => message.id === id))) {
      setOptimisticConversation(null);
      setLocalAttachments([]);
    }
  }, [activeConversationId, canonicalConversation, optimisticConversation]);

  useEffect(() => {
    if (!conversation?.id) return undefined;
    const frame = requestAnimationFrame(() => {
      const thread = chatThreadRef.current;
      if (thread) thread.scrollTop = thread.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [conversation?.id, conversation?.messages?.length, conversation?.messages?.at(-1)?.at]);

  useEffect(() => {
    if (activeConversationId) markConversationRead(activeConversationId);
  }, [activeConversationId, conversation?.messages?.length, conversation?.messages?.at(-1)?.at, markConversationRead]);

  const stopListening = useCallback(() => {
    const recognition = speechRecognitionRef.current;
    if (!recognition) return;
    try { recognition.stop(); } catch {}
  }, []);

  useEffect(() => () => {
    requestRef.current?.abort();
    try { speechRecognitionRef.current?.stop(); } catch {}
    window.speechSynthesis?.cancel();
  }, []);

  const startNew = () => {
    if (sending || sendInFlightRef.current) return;
    stopListening();
    window.speechSynthesis?.cancel();
    setSpeakingMessageId("");
    setActiveConversationId("");
    setOptimisticConversation(null);
    setLocalAttachments([]);
    setSelectedArtifact(null);
    setInput("");
    setFiles([]);
    resetEditing();
    setModelDraft({ provider: nora.provider || "", model: nora.model || "" });
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const beginRename = (item, surface) => {
    if (!item?.id) return;
    setEditingConversationId(item.id);
    setEditingTitleSurface(surface);
    setTitleDraft(conversationTitle(item));
  };

  const cancelRename = () => {
    setEditingConversationId("");
    setEditingTitleSurface("");
    setTitleDraft("");
  };

  const finishRename = async item => {
    const currentTitle = conversationTitle(item);
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      toast.error("Conversation title cannot be empty.");
      return;
    }
    if (nextTitle === currentTitle) {
      cancelRename();
      return;
    }

    try {
      await api.patch(endpoints.conversation(item.id), { title: nextTitle });
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not rename conversation.");
    } finally {
      cancelRename();
    }
  };

  const deleteConversation = async item => {
    if (working && conversation?.id === item.id) return;
    const confirmed = window.confirm(`Delete "${conversationTitle(item)}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await api.delete(endpoints.conversation(item.id));
      if (activeConversationId === item.id) startNew();
      if (editingConversationId === item.id) cancelRename();
      toast.success("Conversation deleted.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not delete conversation.");
    }
  };

  const beginMessageEdit = message => {
    if (working || message.pending || message.actor !== "Carlos") return;
    messageEditCancelledRef.current = false;
    setEditingMessageId(message.id);
    setMessageDraft(message.content);
  };

  const finishMessageEdit = async message => {
    if (!conversation?.id || editingMessageId !== message.id) return;

    if (messageEditCancelledRef.current) {
      messageEditCancelledRef.current = false;
      setEditingMessageId("");
      setMessageDraft("");
      return;
    }

    const content = messageDraft.trim();
    if (!content) {
      toast.error("Message cannot be empty.");
      return;
    }
    if (content === message.content) {
      setEditingMessageId("");
      setMessageDraft("");
      return;
    }

    const previous = conversation;
    const messageIndex = previous.messages.findIndex(item => item.id === message.id);
    if (messageIndex < 0) return;
    setOptimisticConversation({
      ...previous,
      messages: previous.messages.slice(0, messageIndex + 1).map(item => (
        item.id === message.id ? { ...item, content, pending: true } : item
      )),
      workflows: [],
    });
    setEditingMessageId("");
    setMessageDraft("");
    setSending(true);

    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await api.patch(
        endpoints.conversationMessage(previous.id, message.id),
        { content },
        { signal: controller.signal },
      );
      if (response.data?.id === previous.id) setOptimisticConversation(response.data);
      toast.success("Message committed. Later conversation history was replaced.");
    } catch (error) {
      setOptimisticConversation(null);
      if (error?.code !== "ERR_CANCELED" && error?.name !== "CanceledError") {
        toast.error(error.response?.data?.error || "Could not edit message.");
      }
    } finally {
      requestRef.current = null;
      setSending(false);
    }
  };

  const ensureConversation = async optimisticMessage => {
    if (activeConversationId) return activeConversationId;
    const provider = modelDraft.provider || nora.provider || providers[0] || "";
    const model = modelDraft.model || nora.model || modelsFor(provider)[0] || "";
    if (!provider || !model) throw new Error("Select a provider and model before sending.");

    const created = (await api.post(endpoints.conversations(), { provider, model })).data;
    const local = { ...created, messages: [optimisticMessage] };
    setActiveConversationId(created.id);
    setOptimisticConversation(local);
    setModelDraft(created.nora || { provider, model });
    return created.id;
  };

  const saveModel = async () => {
    if (!conversation?.id || !modelDraft.provider || !modelDraft.model) return;
    try {
      await api.patch(endpoints.conversationModel(conversation.id), modelDraft);
      toast.success("Conversation model updated.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not update model.");
    }
  };

  const send = async event => {
    event.preventDefault();
    const message = input.trim();
    if (
      sendInFlightRef.current
      || requestRef.current
      || working
      || editingMessageId
      || (!message && files.length === 0)
    ) return;

    stopListening();
    sendInFlightRef.current = true;
    const previous = conversation;
    const content = message || "Review the attached files.";
    const pendingFiles = [...files];
    const optimistic = {
      id: createMessageId(),
      actor: "Carlos",
      at: new Date().toISOString(),
      content,
      attachments: [],
      artifacts: [],
      pending: true,
    };
    const local = previous
      ? { ...previous, messages: [...(previous.messages || []), optimistic] }
      : { id: "", messages: [optimistic], workflows: [], nora: modelDraft };

    setOptimisticConversation(local);
    setInput("");
    setFiles([]);
    setSending(true);

    const controller = new AbortController();
    requestRef.current = controller;
    let id = activeConversationId || "";
    let accepted = false;

    try {
      id = await ensureConversation(optimistic);
      const attachmentIds = [];

      for (const item of pendingFiles) {
        const payload = await filePayload(item);
        const created = (
          await api.post(endpoints.conversationAttachments(id), {
            ...payload,
            createdBy: "Carlos",
          }, { signal: controller.signal })
        ).data;
        attachmentIds.push(created.id);
        setLocalAttachments(current => [...current.filter(attachment => attachment.id !== created.id), created]);
        setOptimisticConversation(current => current ? {
          ...current,
          id,
          messages: current.messages.map(entry => (
            entry.id === optimistic.id ? { ...entry, attachments: [...attachmentIds] } : entry
          )),
        } : current);
      }

      await api.post(
        endpoints.conversationRequest(id),
        { content, attachments: attachmentIds, messageId: optimistic.id },
        { signal: controller.signal },
      );
      accepted = true;
      setOptimisticConversation(current => current ? {
        ...current,
        id,
        messages: current.messages.map(entry => (
          entry.id === optimistic.id ? { ...entry, pending: false, attachments: [...attachmentIds] } : entry
        )),
      } : current);
      markConversationRead(id);
    } catch (error) {
      if (!accepted) setOptimisticConversation(previous || null);
      if (error?.code !== "ERR_CANCELED" && error?.name !== "CanceledError") {
        setInput(content);
        setFiles(pendingFiles);
        toast.error(error.response?.data?.error || error.message || "Request failed.");
      }
    } finally {
      requestRef.current = null;
      sendInFlightRef.current = false;
      setSending(false);
    }
  };

  const stop = async () => {
    requestRef.current?.abort();
    if (!activeRequest || !activeConversationId) return;
    try {
      await api.delete(endpoints.conversationRequestJob(activeConversationId, activeRequest.id));
      toast.message("Nora request cancelled.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not cancel Nora request.");
    }
  };

  const addFiles = event => {
    const selected = [...(event.target.files || [])];
    if (!selected.length) return;
    setFiles(current => [...current, ...selected]);
    event.target.value = "";
  };

  const addClipboardImages = event => {
    const clipboardItems = [...(event.clipboardData?.items || [])];
    const images = clipboardItems
      .filter(item => item.kind === "file" && item.type.startsWith("image/"))
      .map(item => item.getAsFile())
      .filter(Boolean);
    if (!images.length) return;

    event.preventDefault();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const pasted = images.map((file, index) => new File(
      [file],
      `clipboard-${stamp}${images.length > 1 ? `-${index + 1}` : ""}.${clipboardExtension(file.type)}`,
      { type: file.type, lastModified: Date.now() },
    ));
    setFiles(current => [...current, ...pasted]);
    toast.message(`${pasted.length} clipboard image${pasted.length === 1 ? "" : "s"} attached.`);
  };

  const removeFile = index => setFiles(current => current.filter((_, itemIndex) => itemIndex !== index));
  const openArtifact = artifact => artifact?.id && setSelectedArtifact(artifact);

  const openAttachment = attachment => {
    if (!conversation?.id || !attachment?.id) return;
    const url = `${api.defaults.baseURL}${endpoints.conversationAttachment(conversation.id, attachment.id)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const copyMessage = async message => {
    try {
      await navigator.clipboard.writeText(message.content || "");
      toast.success("Message copied.");
    } catch {
      toast.error("Could not copy message.");
    }
  };

  const shareMessage = async message => {
    const text = message.content || "";
    if (navigator.share) {
      try {
        await navigator.share({ title: "Nora response", text });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    await copyMessage(message);
  };

  const toggleReadAloud = message => {
    const synthesis = window.speechSynthesis;
    if (!synthesis || typeof window.SpeechSynthesisUtterance !== "function") {
      toast.error("Read aloud is not supported by this browser.");
      return;
    }
    if (speakingMessageId === message.id && synthesis.speaking) {
      synthesis.cancel();
      setSpeakingMessageId("");
      return;
    }

    synthesis.cancel();
    const text = speechText(message.content);
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || "en-US";
    utterance.onend = () => setSpeakingMessageId(current => current === message.id ? "" : current);
    utterance.onerror = () => setSpeakingMessageId(current => current === message.id ? "" : current);
    setSpeakingMessageId(message.id);
    synthesis.speak(utterance);
  };

  const toggleSpeech = () => {
    if (listening) {
      stopListening();
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition is not supported by this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    speechBaseRef.current = input.trimEnd();
    let finalTranscript = "";

    recognition.onresult = event => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript || "";
        if (event.results[index].isFinal) finalTranscript += `${transcript} `;
        else interim += transcript;
      }
      const spoken = `${finalTranscript}${interim}`.trim();
      setInput(`${speechBaseRef.current}${speechBaseRef.current && spoken ? " " : ""}${spoken}`);
    };
    recognition.onerror = event => {
      if (!["aborted", "no-speech"].includes(event.error)) {
        toast.error(`Could not transcribe speech: ${event.error}`);
      }
    };
    recognition.onend = () => {
      if (speechRecognitionRef.current === recognition) speechRecognitionRef.current = null;
      setListening(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    };

    speechRecognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch (error) {
      speechRecognitionRef.current = null;
      setListening(false);
      toast.error(error instanceof Error ? error.message : "Could not start speech recognition.");
    }
  };

  const modelChanged = conversation?.id
    && (conversation.nora?.provider !== modelDraft.provider || conversation.nora?.model !== modelDraft.model);

  return (
    <div className={`workspace-page chat-page ${selectedArtifact ? "chat-page--artifact-open" : ""}`}>
      <aside className="chat-history">
        <header className="chat-history__header">
          <h1>Conversations</h1>
          <button type="button" className="icon-button" onClick={startNew} aria-label="New conversation">
            <IconPlus size={18} />
          </button>
        </header>

        <div className="chat-history__list">
          {!conversations.length ? (
            <div className="empty-state empty-state--compact">
              <IconMessageCircle size={22} stroke={1.5} />
              <strong>No conversations yet</strong>
              <span>Start with Nora.</span>
            </div>
          ) : conversations.map(item => (
            <div key={item.id} className={`conversation-row ${conversation?.id === item.id ? "conversation-row--active" : ""}`}>
              {editingConversationId === item.id && editingTitleSurface === "history" ? (
                <div className="conversation-row__open">
                  <input
                    autoFocus
                    value={titleDraft}
                    onChange={event => setTitleDraft(event.target.value)}
                    onFocus={event => event.currentTarget.select()}
                    onBlur={cancelRename}
                    onKeyDown={event => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void finishRename(item);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRename();
                      }
                    }}
                    aria-label={`Rename ${conversationTitle(item)}`}
                    style={{ width: "100%", minWidth: 0, padding: 0, border: 0, borderRadius: "2px", outline: "1px solid var(--color-accent)", outlineOffset: "1px", background: "transparent", color: "var(--color-text)", font: "inherit", fontSize: "11px", fontWeight: 700, lineHeight: 1.2 }}
                  />
                  <small>{formatTime(item.messages?.at(-1)?.at)}</small>
                </div>
              ) : (
                <button
                  type="button"
                  className="conversation-row__open"
                  onClick={event => {
                    if (event.target.closest("[data-edit-conversation-title]")) {
                      beginRename(item, "history");
                      return;
                    }
                    openConversation(item.id);
                  }}
                  aria-label={`Open ${conversationTitle(item)}`}
                  title="Click the title to rename; click elsewhere to open"
                >
                  <span className="conversation-row__title">
                    <strong data-edit-conversation-title>{conversationTitle(item)}</strong>
                    {unreadConversationSet.has(item.id) && (
                      <span className="conversation-row__unread" aria-label="Unread Nora response" title="Unread Nora response" />
                    )}
                  </span>
                  <small>{item.messages?.at(-1)?.pending ? "Sending…" : formatTime(item.messages?.at(-1)?.at)}</small>
                </button>
              )}
              <div className="conversation-row__actions">
                <button
                  type="button"
                  className="conversation-row__action conversation-row__action--danger"
                  onClick={() => deleteConversation(item)}
                  disabled={working && conversation?.id === item.id}
                  aria-label={`Delete ${conversationTitle(item)}`}
                  title="Delete"
                >
                  <IconTrash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section className="chat-workspace">
        <header className="page-header chat-workspace__header">
          <div className="page-header__copy">
            {conversation && editingConversationId === conversation.id && editingTitleSurface === "header" ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={event => setTitleDraft(event.target.value)}
                onFocus={event => event.currentTarget.select()}
                onBlur={cancelRename}
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void finishRename(conversation);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRename();
                  }
                }}
                aria-label={`Rename ${conversationTitle(conversation)}`}
                style={{ width: "min(720px, 100%)", minWidth: 0, padding: 0, border: 0, borderRadius: "2px", outline: "1px solid var(--color-accent)", outlineOffset: "3px", background: "transparent", color: "var(--color-text)", fontFamily: "var(--font-headline)", fontSize: "25px", fontWeight: 700, lineHeight: 1.15, letterSpacing: "-0.025em" }}
              />
            ) : (
              <h1
                onClick={() => conversation && beginRename(conversation, "header")}
                title={conversation ? "Click to rename conversation" : undefined}
                style={conversation ? { cursor: "text" } : undefined}
              >
                {conversation ? conversationTitle(conversation) : "New conversation"}
              </h1>
            )}
          </div>
          <div className="model-control">
            <select aria-label="Provider" value={modelDraft.provider} onChange={event => setModelDraft({ provider: event.target.value, model: "" })}>
              {!providers.includes(modelDraft.provider) && modelDraft.provider && <option value={modelDraft.provider}>{modelDraft.provider}</option>}
              {providers.map(provider => <option key={provider} value={provider}>{provider}</option>)}
            </select>
            <select aria-label="Model" value={modelDraft.model} onChange={event => setModelDraft(current => ({ ...current, model: event.target.value }))}>
              <option value="">Select model</option>
              {modelsFor(modelDraft.provider).map(model => <option key={model} value={model}>{model}</option>)}
              {!modelsFor(modelDraft.provider).includes(modelDraft.model) && modelDraft.model && <option value={modelDraft.model}>{modelDraft.model}</option>}
            </select>
            {modelChanged && <button type="button" className="button button--quiet" onClick={saveModel}>Save</button>}
          </div>
        </header>

        <div ref={chatThreadRef} className="chat-thread">
          {!conversation?.messages?.length ? (
            <div className="chat-welcome">
              <div className="chat-welcome__mark">N</div>
              <h2>What do you need?</h2>
              <p>Ask Nora directly. She decides whether to answer, use a capability, or start a Workflow.</p>
            </div>
          ) : (
            <div className="chat-thread__messages">
              {conversation.messages.map(message => {
                const isCarlos = message.actor === "Carlos";
                const editing = isCarlos && editingMessageId === message.id;
                const messageArtifacts = (message.artifacts || []).map(id => artifactById[id]).filter(Boolean);
                return (
                  <article key={message.id} className={`message ${isCarlos ? "message--carlos" : "message--nora"}`}>
                    <header className="message__header">
                      <strong>{isCarlos ? "Carlos" : "Nora"}</strong>
                      <small>{message.pending ? "Sending…" : formatTime(message.at)}</small>
                    </header>
                    {editing ? (
                      <textarea
                        autoFocus
                        className="message__editor"
                        value={messageDraft}
                        onChange={event => setMessageDraft(event.target.value)}
                        onBlur={() => finishMessageEdit(message)}
                        onKeyDown={event => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            messageEditCancelledRef.current = true;
                            event.currentTarget.blur();
                          }
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                        aria-label="Edit Carlos message"
                      />
                    ) : (
                      <div className="message__content">
                        <MarkdownContent artifacts={messageArtifacts} onArtifact={openArtifact}>{message.content}</MarkdownContent>
                      </div>
                    )}
                    {message.workflowId && <WorkflowLink workflowId={message.workflowId} onOpen={onOpenOperations} />}
                    {!!message.attachments?.length && (
                      <div className="message__attachments" aria-label="Message attachments">
                        {message.attachments.map(id => {
                          const attachment = attachmentById[id];
                          return attachment ? (
                            <button key={id} type="button" onClick={() => openAttachment(attachment)}>
                              <IconPaperclip size={14} /> {attachment.name}
                            </button>
                          ) : null;
                        })}
                      </div>
                    )}
                    {!!messageArtifacts.length && (
                      <div className="message__artifacts" aria-label="Message artifacts">
                        {messageArtifacts.map(artifact => (
                          <button key={artifact.id} type="button" onClick={() => openArtifact(artifact)}>
                            <IconFile size={14} /> {artifact.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {!editing && !message.pending && (
                      <div className={`message__actions ${isCarlos ? "message__actions--carlos" : "message__actions--nora"}`}>
                        <button type="button" onClick={() => void copyMessage(message)} aria-label="Copy message" title="Copy"><IconCopy size={14} /></button>
                        {isCarlos ? (
                          <button type="button" onClick={() => beginMessageEdit(message)} disabled={working} aria-label="Edit message" title="Edit"><IconPencil size={14} /></button>
                        ) : (
                          <>
                            <button type="button" onClick={() => void shareMessage(message)} aria-label="Share Nora response" title="Share"><IconShare size={14} /></button>
                            <button type="button" className={speakingMessageId === message.id ? "message__action--active" : ""} onClick={() => toggleReadAloud(message)} aria-label={speakingMessageId === message.id ? "Stop read aloud" : "Read aloud"} title={speakingMessageId === message.id ? "Stop read aloud" : "Read aloud"}><IconVolume size={14} /></button>
                          </>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
              {working && (
                <article className="message message--nora message--thinking">
                  <header className="message__header"><strong>Nora</strong></header>
                  <div className="message__content"><span className="spinner" /> Working…</div>
                </article>
              )}
            </div>
          )}
        </div>

        <div className="chat-bottom">
          {artifacts.length > 0 && (
            <div className="artifact-strip" aria-label="Conversation artifacts">
              <span><IconFolder size={15} /> Artifacts</span>
              {artifacts.map(artifact => <button key={artifact.id} type="button" onClick={() => openArtifact(artifact)}>{artifact.name}</button>)}
            </div>
          )}

          <form className="chat-composer" onSubmit={send}>
            {files.length > 0 && (
              <div className="chat-composer__files">
                {files.map((file, index) => (
                  <span key={`${file.name}-${file.size}-${index}`}>
                    <IconPaperclip size={13} /> {file.name}
                    <button type="button" onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`}><IconX size={12} /></button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={event => setInput(event.target.value)}
              onPaste={addClipboardImages}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (event.repeat || sendInFlightRef.current || requestRef.current || activeRequest) return;
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={listening ? "Listening…" : "Message Nora…"}
              rows={1}
            />
            <div className="chat-composer__actions">
              <div className="chat-composer__actions-left">
                <input ref={fileInputRef} type="file" multiple hidden onChange={addFiles} />
                <button type="button" className="composer-attach" onClick={() => fileInputRef.current?.click()} aria-label="Attach files" title="Attach files">
                  <IconPlus size={20} />
                </button>
              </div>
              <div className="chat-composer__actions-right">
                {!working && (
                  <button type="button" className={`composer-mic ${listening ? "composer-mic--active" : ""}`} onClick={toggleSpeech} disabled={Boolean(editingMessageId)} aria-label={listening ? "Stop dictation" : "Speak to Nora"} title={listening ? "Stop dictation" : "Speak to Nora"}>
                    <IconMicrophone size={18} />
                  </button>
                )}
                {working ? (
                  <button type="button" className="button button--danger" onClick={stop}>Stop</button>
                ) : (
                  <button type="submit" className="composer-send" disabled={Boolean(editingMessageId) || (!input.trim() && files.length === 0)} aria-label="Send message">
                    <IconArrowUp size={18} />
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </section>

      <ArtifactPanel conversationId={conversation?.id || ""} artifact={selectedArtifact} onClose={() => setSelectedArtifact(null)} />
    </div>
  );
}
