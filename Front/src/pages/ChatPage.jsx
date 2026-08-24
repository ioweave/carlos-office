import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowUp,
  IconFile,
  IconFolder,
  IconMessageCircle,
  IconPaperclip,
  IconPencil,
  IconPlus,
  IconRoute,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import api, { endpoints } from "../api";
import MarkdownContent from "../components/MarkdownContent";

const ACTIVE_CONVERSATION_KEY = "office-active-conversation-v2";

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

const sortConversations = items => items.sort((left, right) => {
  const leftAt = left.messages?.at(-1)?.at || "";
  const rightAt = right.messages?.at(-1)?.at || "";
  return rightAt.localeCompare(leftAt);
});

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

export default function ChatPage({ nora, openRequest, onOpenOperations }) {
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [artifacts, setArtifacts] = useState([]);
  const [models, setModels] = useState([]);
  const [modelDraft, setModelDraft] = useState({ provider: "", model: "" });
  const [input, setInput] = useState("");
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [workflowId, setWorkflowId] = useState("");
  const [editingConversationId, setEditingConversationId] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const chatThreadRef = useRef(null);
  const requestRef = useRef(null);
  const sendInFlightRef = useRef(false);
  const messageEditCancelledRef = useRef(false);

  const providers = useMemo(() => models.map(item => item.provider), [models]);
  const modelsFor = provider => models.find(item => item.provider === provider)?.models || [];
  const artifactById = useMemo(
    () => Object.fromEntries(artifacts.map(item => [item.id, item])),
    [artifacts],
  );

  const upsertConversation = useCallback(record => {
    if (!record?.id) return;
    setConversations(current => sortConversations([
      record,
      ...current.filter(item => item.id !== record.id),
    ]));
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      setModels((await api.get(endpoints.models())).data || []);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not load models.");
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      setConversations(sortConversations((await api.get(endpoints.conversations())).data || []));
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not load conversations.");
    }
  }, []);

  const openConversation = useCallback(async id => {
    if (!id) return;
    setLoadingConversation(true);
    try {
      const record = (await api.get(endpoints.conversation(id))).data;
      const filesResponse = await api.get(endpoints.conversationArtifacts(id));
      setConversation(record);
      setArtifacts(filesResponse.data || []);
      setModelDraft(record.nora || { provider: "", model: "" });
      setWorkflowId(record.workflows?.at(-1) || "");
      setEditingConversationId("");
      setTitleDraft("");
      setEditingMessageId("");
      setMessageDraft("");
      sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
    } catch (error) {
      sessionStorage.removeItem(ACTIVE_CONVERSATION_KEY);
      toast.error(error.response?.data?.error || "Could not open conversation.");
    } finally {
      setLoadingConversation(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
    loadHistory();
  }, [loadCatalog, loadHistory]);

  useEffect(() => {
    const stored = sessionStorage.getItem(ACTIVE_CONVERSATION_KEY);
    if (stored) openConversation(stored);
  }, [openConversation]);

  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.conversationId) openConversation(openRequest.conversationId);
    if (openRequest.prefill) {
      setInput(openRequest.prefill);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [openRequest, openConversation]);

  useEffect(() => {
    if (conversation || modelDraft.provider || !nora?.provider) return;
    setModelDraft(nora);
  }, [conversation, modelDraft.provider, nora]);

  useEffect(() => {
    if (loadingConversation || !conversation?.id) return undefined;

    const frame = requestAnimationFrame(() => {
      const thread = chatThreadRef.current;
      if (thread) thread.scrollTop = thread.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [conversation?.id, loadingConversation]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const startNew = () => {
    if (sending || sendInFlightRef.current) return;
    sessionStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    setConversation(null);
    setArtifacts([]);
    setWorkflowId("");
    setInput("");
    setFiles([]);
    setEditingConversationId("");
    setTitleDraft("");
    setEditingMessageId("");
    setMessageDraft("");
    setModelDraft(nora || { provider: "", model: "" });
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const beginRename = item => {
    if (!item?.id) return;
    setEditingConversationId(item.id);
    setTitleDraft(conversationTitle(item));
  };

  const cancelRename = () => {
    setEditingConversationId("");
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
      const updated = (await api.patch(endpoints.conversation(item.id), { title: nextTitle })).data;
      upsertConversation(updated);
      if (conversation?.id === item.id) setConversation(updated);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not rename conversation.");
    } finally {
      cancelRename();
    }
  };

  const deleteConversation = async item => {
    if (sending && conversation?.id === item.id) return;
    const confirmed = window.confirm(`Delete "${conversationTitle(item)}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await api.delete(endpoints.conversation(item.id));
      setConversations(current => current.filter(entry => entry.id !== item.id));

      if (conversation?.id === item.id) {
        sessionStorage.removeItem(ACTIVE_CONVERSATION_KEY);
        setConversation(null);
        setArtifacts([]);
        setWorkflowId("");
        setInput("");
        setFiles([]);
        setEditingMessageId("");
        setMessageDraft("");
        setModelDraft(nora || { provider: "", model: "" });
      }

      if (editingConversationId === item.id) cancelRename();

      toast.success("Conversation deleted.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not delete conversation.");
    }
  };

  const beginMessageEdit = message => {
    if (sending || message.pending || message.actor !== "Carlos") return;
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

    const optimistic = {
      ...previous,
      messages: previous.messages.slice(0, messageIndex + 1).map(item => (
        item.id === message.id ? { ...item, content, pending: true } : item
      )),
      workflows: [],
    };

    setConversation(optimistic);
    upsertConversation(optimistic);
    setWorkflowId("");
    setEditingMessageId("");
    setMessageDraft("");
    setSending(true);

    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const updated = (
        await api.patch(
          endpoints.conversationMessage(previous.id, message.id),
          { content },
          { signal: controller.signal },
        )
      ).data;

      setConversation(updated);
      upsertConversation(updated);
      setWorkflowId(updated.workflows?.at(-1) || "");

      api.get(endpoints.conversationArtifacts(previous.id))
        .then(response => setArtifacts(response.data || []))
        .catch(() => {});

      toast.success("Message committed. Later conversation history was replaced.");
    } catch (error) {
      let restored = previous;
      try {
        restored = (await api.get(endpoints.conversation(previous.id))).data;
      } catch {}

      setConversation(restored);
      upsertConversation(restored);
      setWorkflowId(restored.workflows?.at(-1) || "");

      if (error?.code !== "ERR_CANCELED" && error?.name !== "CanceledError") {
        toast.error(error.response?.data?.error || "Could not edit message.");
      }
    } finally {
      requestRef.current = null;
      setSending(false);
    }
  };

  const ensureConversation = async optimisticMessage => {
    if (conversation?.id) return conversation.id;
    const provider = modelDraft.provider || nora?.provider || providers[0] || "";
    const model = modelDraft.model || nora?.model || modelsFor(provider)[0] || "";
    if (!provider || !model) throw new Error("Select a provider and model before sending.");

    const created = (await api.post(endpoints.conversations(), { provider, model })).data;
    const local = { ...created, messages: [optimisticMessage] };
    setConversation(local);
    upsertConversation(local);
    setModelDraft(created.nora || { provider, model });
    sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, created.id);
    return created.id;
  };

  const saveModel = async () => {
    if (!conversation?.id || !modelDraft.provider || !modelDraft.model) return;
    try {
      const updated = (
        await api.patch(endpoints.conversationModel(conversation.id), modelDraft)
      ).data;
      setConversation(updated);
      setModelDraft(updated.nora || modelDraft);
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
      || sending
      || editingMessageId
      || (!message && files.length === 0)
    ) return;

    sendInFlightRef.current = true;
    const previous = conversation;
    const content = message || "Review the attached files.";
    const pendingFiles = [...files];
    const optimistic = {
      id: `pending-${Date.now()}`,
      actor: "Carlos",
      at: new Date().toISOString(),
      content,
      artifacts: [],
      pending: true,
    };
    const local = previous
      ? { ...previous, messages: [...(previous.messages || []), optimistic] }
      : { id: "", messages: [optimistic], workflows: [], nora: modelDraft };

    setConversation(local);
    if (local.id) upsertConversation(local);
    setInput("");
    setFiles([]);
    setSending(true);

    const controller = new AbortController();
    requestRef.current = controller;
    let id = previous?.id || "";

    try {
      id = await ensureConversation(optimistic);
      const artifactIds = [];

      for (const item of pendingFiles) {
        const payload = await filePayload(item);
        const created = (
          await api.post(endpoints.conversationArtifacts(id), {
            ...payload,
            createdBy: "Carlos",
          })
        ).data;
        artifactIds.push(created.id);
        setArtifacts(current => [...current.filter(artifact => artifact.id !== created.id), created]);
        setConversation(current => current ? {
          ...current,
          messages: current.messages.map(entry => (
            entry.id === optimistic.id ? { ...entry, artifacts: [...artifactIds] } : entry
          )),
        } : current);
      }

      const result = (
        await api.post(
          endpoints.conversationRequest(id),
          { content, artifacts: artifactIds },
          { signal: controller.signal },
        )
      ).data;

      if (result.workflow?.id) setWorkflowId(result.workflow.id);

      const committed = (await api.get(endpoints.conversation(id))).data;
      setConversation(committed);
      upsertConversation(committed);
      setWorkflowId(committed.workflows?.at(-1) || result.workflow?.id || "");
    } catch (error) {
      let restored = previous;

      if (id) {
        try {
          restored = (await api.get(endpoints.conversation(id))).data;
        } catch {}
      }

      setConversation(restored);
      if (restored?.id) upsertConversation(restored);
      setWorkflowId(restored?.workflows?.at(-1) || "");

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
    if (!workflowId) return;
    try {
      await api.post(endpoints.workflowCancel(workflowId));
      toast.message("Workflow cancelled.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not cancel workflow.");
    }
  };

  const addFiles = event => {
    const selected = [...(event.target.files || [])];
    if (!selected.length) return;
    setFiles(current => [...current, ...selected]);
    event.target.value = "";
  };

  const removeFile = index => setFiles(current => current.filter((_, itemIndex) => itemIndex !== index));

  const openArtifact = artifact => {
    if (!conversation?.id || !artifact?.id) return;
    const url = `${api.defaults.baseURL}${endpoints.conversationArtifact(conversation.id, artifact.id)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const modelChanged = conversation?.id
    && (conversation.nora?.provider !== modelDraft.provider || conversation.nora?.model !== modelDraft.model);

  return (
    <div className="workspace-page chat-page">
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
            <div
              key={item.id}
              className={`conversation-row ${conversation?.id === item.id ? "conversation-row--active" : ""}`}
            >
              {editingConversationId === item.id ? (
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
                    style={{
                      width: "100%",
                      minWidth: 0,
                      padding: 0,
                      border: 0,
                      borderRadius: "2px",
                      outline: "1px solid var(--color-accent)",
                      outlineOffset: "1px",
                      background: "transparent",
                      color: "var(--color-text)",
                      font: "inherit",
                      fontSize: "11px",
                      fontWeight: 700,
                      lineHeight: 1.2,
                    }}
                  />
                  <small>{formatTime(item.messages?.at(-1)?.at)}</small>
                </div>
              ) : (
                <button
                  type="button"
                  className="conversation-row__open"
                  onClick={event => {
                    if (event.target.closest("[data-edit-conversation-title]")) {
                      beginRename(item);
                      return;
                    }
                    openConversation(item.id);
                  }}
                  aria-label={`Open ${conversationTitle(item)}`}
                  title="Click the title to rename; click elsewhere to open"
                >
                  <strong data-edit-conversation-title>{conversationTitle(item)}</strong>
                  <small>{item.messages?.at(-1)?.pending ? "Sending…" : formatTime(item.messages?.at(-1)?.at)}</small>
                </button>
              )}
              <div className="conversation-row__actions">
                <button
                  type="button"
                  className="conversation-row__action conversation-row__action--danger"
                  onClick={() => deleteConversation(item)}
                  disabled={sending && conversation?.id === item.id}
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
            {conversation && editingConversationId === conversation.id ? (
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
                style={{
                  width: "min(720px, 100%)",
                  minWidth: 0,
                  padding: 0,
                  border: 0,
                  borderRadius: "2px",
                  outline: "1px solid var(--color-accent)",
                  outlineOffset: "3px",
                  background: "transparent",
                  color: "var(--color-text)",
                  fontFamily: "var(--font-headline)",
                  fontSize: "25px",
                  fontWeight: 700,
                  lineHeight: 1.15,
                  letterSpacing: "-0.025em",
                }}
              />
            ) : (
              <h1
                onClick={() => conversation && beginRename(conversation)}
                title={conversation ? "Click to rename conversation" : undefined}
                style={conversation ? { cursor: "text" } : undefined}
              >
                {conversation ? conversationTitle(conversation) : "New conversation"}
              </h1>
            )}
          </div>
          <div className="model-control">
            <select
              aria-label="Provider"
              value={modelDraft.provider}
              onChange={event => setModelDraft({ provider: event.target.value, model: "" })}
            >
              {!providers.includes(modelDraft.provider) && modelDraft.provider && (
                <option value={modelDraft.provider}>{modelDraft.provider}</option>
              )}
              {providers.map(provider => <option key={provider} value={provider}>{provider}</option>)}
            </select>
            <select
              aria-label="Model"
              value={modelDraft.model}
              onChange={event => setModelDraft(current => ({ ...current, model: event.target.value }))}
            >
              <option value="">Select model</option>
              {modelsFor(modelDraft.provider).map(model => <option key={model} value={model}>{model}</option>)}
              {!modelsFor(modelDraft.provider).includes(modelDraft.model) && modelDraft.model && (
                <option value={modelDraft.model}>{modelDraft.model}</option>
              )}
            </select>
            {modelChanged && (
              <button type="button" className="button button--quiet" onClick={saveModel}>Save</button>
            )}
          </div>
        </header>

        <div ref={chatThreadRef} className="chat-thread">
          {loadingConversation ? (
            <div className="page-state"><span className="spinner" /> Loading conversation</div>
          ) : !conversation?.messages?.length ? (
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
                return (
                  <article key={message.id} className={`message ${isCarlos ? "message--carlos" : "message--nora"}`}>
                    <header className="message__header">
                      <strong>{isCarlos ? "Carlos" : "Nora"}</strong>
                      <small>{message.pending ? "Sending…" : formatTime(message.at)}</small>
                      {isCarlos && !editing && !message.pending && (
                        <button
                          type="button"
                          className="message__edit"
                          onClick={() => beginMessageEdit(message)}
                          disabled={sending}
                          aria-label="Edit message"
                          title="Edit message"
                        >
                          <IconPencil size={13} />
                        </button>
                      )}
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
                      <div className="message__content"><MarkdownContent>{message.content}</MarkdownContent></div>
                    )}
                    {message.workflowId && (
                      <button
                        type="button"
                        className="workflow-link workflow-link--inline"
                        onClick={() => onOpenOperations?.(message.workflowId)}
                      >
                        <IconRoute size={16} />
                        <span>Workflow {message.workflowId}</span>
                        <strong>Open Operations</strong>
                      </button>
                    )}
                    {!!message.artifacts?.length && (
                      <div className="message__artifacts">
                        {message.artifacts.map(id => {
                          const artifact = artifactById[id];
                          return artifact ? (
                            <button key={id} type="button" onClick={() => openArtifact(artifact)}>
                              <IconFile size={14} /> {artifact.name}
                            </button>
                          ) : null;
                        })}
                      </div>
                    )}
                  </article>
                );
              })}
              {sending && (
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
              {artifacts.map(artifact => (
                <button key={artifact.id} type="button" onClick={() => openArtifact(artifact)}>{artifact.name}</button>
              ))}
            </div>
          )}

          <form className="chat-composer" onSubmit={send}>
            {files.length > 0 && (
              <div className="chat-composer__files">
                {files.map((file, index) => (
                  <span key={`${file.name}-${file.size}-${index}`}>
                    <IconFile size={13} /> {file.name}
                    <button type="button" onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`}>
                      <IconX size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (event.repeat || sendInFlightRef.current || requestRef.current) return;
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Message Nora…"
              rows={1}
            />
            <div className="chat-composer__actions">
              <input ref={fileInputRef} type="file" multiple hidden onChange={addFiles} />
              <button type="button" className="icon-button" onClick={() => fileInputRef.current?.click()} aria-label="Attach files">
                <IconPaperclip size={18} />
              </button>
              {sending ? (
                <button type="button" className="button button--danger" onClick={stop}>Stop</button>
              ) : (
                <button
                  type="submit"
                  className="composer-send"
                  disabled={Boolean(editingMessageId) || (!input.trim() && files.length === 0)}
                  aria-label="Send message"
                >
                  <IconArrowUp size={18} />
                </button>
              )}
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
