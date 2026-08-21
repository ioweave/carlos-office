import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowUp,
  IconFile,
  IconFolder,
  IconMessageCircle,
  IconPaperclip,
  IconPlus,
  IconRoute,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import api, { endpoints } from "../api";

const ACTIVE_CONVERSATION_KEY = "office-active-conversation-v2";

const formatTime = value => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
};

const conversationTitle = conversation => {
  const first = conversation?.messages?.find(message => message.actor === "Carlos");
  return first?.content?.replace(/\s+/g, " ").trim().slice(0, 56) || "New conversation";
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

export default function ChatPage({ health, nora, openRequest, onOpenOperations }) {
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
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const requestRef = useRef(null);

  const providers = useMemo(() => models.map(item => item.provider), [models]);
  const modelsFor = provider => models.find(item => item.provider === provider)?.models || [];
  const connected = health?.ok === true;
  const artifactById = useMemo(
    () => Object.fromEntries(artifacts.map(item => [item.id, item])),
    [artifacts],
  );

  const loadCatalog = useCallback(async () => {
    try {
      setModels((await api.get(endpoints.models())).data || []);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not load models.");
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const items = (await api.get(endpoints.conversations())).data || [];
      items.sort((left, right) => {
        const leftAt = left.messages?.at(-1)?.at || "";
        const rightAt = right.messages?.at(-1)?.at || "";
        return rightAt.localeCompare(leftAt);
      });
      setConversations(items);
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
      setModelDraft(record.nora || nora || { provider: "", model: "" });
      setWorkflowId(record.workflows?.at(-1) || "");
      sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
    } catch (error) {
      sessionStorage.removeItem(ACTIVE_CONVERSATION_KEY);
      toast.error(error.response?.data?.error || "Could not open conversation.");
    } finally {
      setLoadingConversation(false);
    }
  }, [nora]);

  useEffect(() => {
    loadCatalog();
    loadHistory();
    const stored = sessionStorage.getItem(ACTIVE_CONVERSATION_KEY);
    if (stored) openConversation(stored);
  }, [loadCatalog, loadHistory, openConversation]);

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

  useEffect(() => () => requestRef.current?.abort(), []);

  const startNew = () => {
    if (sending) return;
    sessionStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    setConversation(null);
    setArtifacts([]);
    setWorkflowId("");
    setInput("");
    setFiles([]);
    setModelDraft(nora || { provider: "", model: "" });
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const ensureConversation = async () => {
    if (conversation?.id) return conversation.id;
    const provider = modelDraft.provider || nora?.provider || providers[0] || "";
    const model = modelDraft.model || nora?.model || modelsFor(provider)[0] || "";
    if (!provider || !model) throw new Error("Select a provider and model before sending.");

    const created = (await api.post(endpoints.conversations(), { provider, model })).data;
    setConversation(created);
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
    if (sending || (!message && files.length === 0)) return;

    const content = message || "Review the attached files.";
    const pendingFiles = [...files];
    const optimistic = {
      id: `pending-${Date.now()}`,
      actor: "Carlos",
      at: new Date().toISOString(),
      content,
      artifacts: [],
    };
    setConversation(current => current
      ? { ...current, messages: [...(current.messages || []), optimistic] }
      : { id: "", messages: [optimistic], workflows: [], nora: modelDraft });
    setInput("");
    setFiles([]);
    setSending(true);

    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const id = await ensureConversation();
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
      }

      const result = (
        await api.post(
          endpoints.conversationRequest(id),
          { content, artifacts: artifactIds },
          { signal: controller.signal },
        )
      ).data;

      if (result.workflow?.id) setWorkflowId(result.workflow.id);
      await openConversation(id);
      await loadHistory();
    } catch (error) {
      if (error?.code !== "ERR_CANCELED" && error?.name !== "CanceledError") {
        toast.error(error.response?.data?.error || error.message || "Request failed.");
      }
      if (conversation?.id) await openConversation(conversation.id);
    } finally {
      requestRef.current = null;
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
          <div>
            <span className="eyebrow">Carlos ↔ Nora</span>
            <h1>Chat</h1>
          </div>
          <button type="button" className="icon-button" onClick={startNew} aria-label="New conversation">
            <IconPlus size={18} />
          </button>
        </header>

        <button type="button" className="button button--primary chat-history__new" onClick={startNew}>
          <IconPlus size={15} /> New conversation
        </button>

        <div className="chat-history__list">
          {!conversations.length ? (
            <div className="empty-state empty-state--compact">
              <IconMessageCircle size={22} stroke={1.5} />
              <strong>No conversations yet</strong>
              <span>Start with Nora.</span>
            </div>
          ) : conversations.map(item => (
            <button
              key={item.id}
              type="button"
              className={`conversation-row ${conversation?.id === item.id ? "conversation-row--active" : ""}`}
              onClick={() => openConversation(item.id)}
            >
              <strong>{conversationTitle(item)}</strong>
              <small>{formatTime(item.messages?.at(-1)?.at)}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="chat-workspace">
        <header className="page-header chat-workspace__header">
          <div className="page-header__copy">
            <span className="eyebrow">Nora · Chief of Staff</span>
            <h1>{conversation ? conversationTitle(conversation) : "New conversation"}</h1>
            <p>{connected ? "Platform online" : "Platform offline"}</p>
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

        <div className="chat-thread">
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
                return (
                  <article key={message.id} className={`message ${isCarlos ? "message--carlos" : "message--nora"}`}>
                    <header className="message__header">
                      <strong>{isCarlos ? "Carlos" : "Nora"}</strong>
                      <small>{formatTime(message.at)}</small>
                    </header>
                    <div className="message__content">{message.content}</div>
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
          {workflowId && (
            <button type="button" className="workflow-link" onClick={() => onOpenOperations?.(workflowId)}>
              <IconRoute size={16} />
              <span>Workflow {workflowId}</span>
              <strong>Open Operations</strong>
            </button>
          )}

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
                  disabled={!input.trim() && files.length === 0}
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
