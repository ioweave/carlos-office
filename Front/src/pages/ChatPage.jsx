import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconFolder } from "@tabler/icons-react";
import { toast } from "sonner";

import api, { endpoints } from "../api";
import { useAppContext } from "../AppContext";
import ArtifactPanel from "../components/ArtifactPanel";
import ChatComposer from "../components/ChatComposer";
import ChatThread from "../components/ChatThread";
import ConversationSidebar from "../components/ConversationSidebar";
import { conversationTitle, sortConversationSummaries } from "../lib/chatPresentation";
import "../styles/chat-features.scss";

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
const summaryFromConversation = conversation => {
  const messages = conversation?.messages || [];
  const lastMessage = messages.at(-1) || null;
  const firstCarlos = messages.find(message => message.actor === "Carlos");
  return {
    id: conversation.id,
    title: conversation.title ?? null,
    nora: conversation.nora ?? null,
    messageCount: messages.length,
    lastMessageId: lastMessage?.id || "",
    lastMessageAt: lastMessage?.at || "",
    lastActor: lastMessage?.actor || "",
    firstCarlosPreview: firstCarlos?.content?.replace(/\s+/g, " ").trim().slice(0, 56) || "",
  };
};

export default function ChatPage({ openRequest, onOpenOperations }) {
  const {
    officeState,
    activeConversationId,
    unreadConversationIds,
    markConversationRead,
    chatConversation: conversation,
    chatAttachments: attachments,
    chatArtifacts: artifacts,
    chatWorking: working,
    openChatConversation,
    startNewChat,
    renameChatConversation,
    deleteChatConversation,
    setChatConversationModel,
    sendChatMessage,
    editChatMessage,
    cancelChatRequest,
  } = useAppContext();
  const [selectedArtifact, setSelectedArtifact] = useState(null);
  const [modelDraft, setModelDraft] = useState({ provider: "", model: "" });
  const [input, setInput] = useState("");
  const [files, setFiles] = useState([]);
  const [listening, setListening] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState("");
  const [editingConversationId, setEditingConversationId] = useState("");
  const [editingTitleSurface, setEditingTitleSurface] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const textareaRef = useRef(null);
  const chatThreadRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const speechBaseRef = useRef("");

  const nora = useMemo(() => officeState.nora || { provider: "", model: "" }, [officeState.nora]);
  const models = useMemo(() => officeState.models || [], [officeState.models]);
  const providers = useMemo(() => models.map(item => item.provider), [models]);
  const modelsFor = provider => models.find(item => item.provider === provider)?.models || [];
  const activeSummary = useMemo(
    () => (officeState.conversations || []).find(item => item.id === activeConversationId) || null,
    [activeConversationId, officeState.conversations],
  );
  const conversations = useMemo(() => {
    const summaries = [...(officeState.conversations || [])];
    if (conversation?.id && !summaries.some(item => item.id === conversation.id)) summaries.push(summaryFromConversation(conversation));
    return sortConversationSummaries(summaries);
  }, [conversation, officeState.conversations]);
  const conversationMessageCount = conversation?.messages?.length || 0;
  const conversationLastMessageAt = conversation?.messages?.at(-1)?.at || "";

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
    setSelectedArtifact(null);
    resetEditing();
    openChatConversation(id);
  }, [openChatConversation, resetEditing]);

  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.conversationId) openConversation(openRequest.conversationId);
    if (openRequest.prefill) {
      setInput(openRequest.prefill);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [openRequest, openConversation]);

  useEffect(() => {
    const selection = conversation?.nora || activeSummary?.nora || nora;
    setModelDraft({ provider: selection?.provider || "", model: selection?.model || "" });
  }, [activeSummary?.nora, conversation?.nora, nora]);

  useEffect(() => {
    if (!conversation?.id) {
      setSelectedArtifact(null);
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      const thread = chatThreadRef.current;
      if (thread) thread.scrollTop = thread.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [conversation?.id, conversationLastMessageAt, conversationMessageCount]);

  useEffect(() => {
    if (activeConversationId) markConversationRead(activeConversationId);
  }, [activeConversationId, conversationLastMessageAt, conversationMessageCount, markConversationRead]);

  const stopListening = useCallback(() => {
    const recognition = speechRecognitionRef.current;
    if (!recognition) return;
    try { recognition.stop(); } catch {
      // Recognition may already have stopped asynchronously.
    }
  }, []);

  useEffect(() => () => {
    try { speechRecognitionRef.current?.stop(); } catch {
      // Recognition may already have stopped asynchronously.
    }
    window.speechSynthesis?.cancel();
  }, []);

  const startNew = () => {
    if (working) return;
    stopListening();
    window.speechSynthesis?.cancel();
    setSpeakingMessageId("");
    setSelectedArtifact(null);
    setInput("");
    setFiles([]);
    resetEditing();
    startNewChat();
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
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      toast.error("Conversation title cannot be empty.");
      return;
    }
    if (nextTitle === conversationTitle(item)) {
      cancelRename();
      return;
    }

    try {
      await renameChatConversation(item.id, nextTitle);
    } catch (error) {
      toast.error(error.message || "Could not rename conversation.");
    } finally {
      cancelRename();
    }
  };

  const deleteConversation = async item => {
    if (working && activeConversationId === item.id) return;
    if (!window.confirm(`Delete "${conversationTitle(item)}"? This cannot be undone.`)) return;

    try {
      await deleteChatConversation(item.id);
      if (editingConversationId === item.id) cancelRename();
      toast.success("Conversation deleted.");
    } catch (error) {
      toast.error(error.message || "Could not delete conversation.");
    }
  };

  const beginMessageEdit = message => {
    if (working || message.pending || message.actor !== "Carlos") return;
    setEditingMessageId(message.id);
    setMessageDraft(message.content);
  };

  const cancelMessageEdit = () => {
    setEditingMessageId("");
    setMessageDraft("");
  };

  const finishMessageEdit = async message => {
    if (!conversation?.id || editingMessageId !== message.id) return;
    const content = messageDraft.trim();
    if (!content) {
      toast.error("Message cannot be empty.");
      return;
    }
    if (content === message.content) {
      cancelMessageEdit();
      return;
    }

    cancelMessageEdit();
    try {
      await editChatMessage({ messageId: message.id, content });
      toast.success("Message committed. Later conversation history was replaced.");
    } catch (error) {
      toast.error(error.message || "Could not edit message.");
    }
  };

  const saveModel = async () => {
    if (!conversation?.id || !modelDraft.provider || !modelDraft.model) return;
    try {
      await setChatConversationModel({
        conversationId: conversation.id,
        provider: modelDraft.provider,
        model: modelDraft.model,
      });
      toast.success("Conversation model updated.");
    } catch (error) {
      toast.error(error.message || "Could not update model.");
    }
  };

  const send = async event => {
    event.preventDefault();
    const message = input.trim();
    if (working || editingMessageId || (!message && files.length === 0)) return;

    stopListening();
    const content = message || "Review the attached files.";
    const pendingFiles = [...files];
    setInput("");
    setFiles([]);

    try {
      await sendChatMessage({
        content,
        files: pendingFiles,
        provider: modelDraft.provider,
        model: modelDraft.model,
      });
    } catch (error) {
      if (error?.code !== "ERR_CANCELED" && error?.name !== "CanceledError" && error?.name !== "AbortError") {
        setInput(content);
        setFiles(pendingFiles);
        toast.error(error.message || "Request failed.");
      }
    }
  };

  const stop = async () => {
    try {
      const cancelled = await cancelChatRequest();
      if (cancelled) toast.message("Nora request cancelled.");
    } catch (error) {
      toast.error(error.message || "Could not cancel Nora request.");
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
      if (!["aborted", "no-speech"].includes(event.error)) toast.error(`Could not transcribe speech: ${event.error}`);
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
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        unreadConversationIds={unreadConversationIds}
        editingConversationId={editingTitleSurface === "history" ? editingConversationId : ""}
        titleDraft={titleDraft}
        onTitleDraftChange={setTitleDraft}
        onBeginRename={item => beginRename(item, "history")}
        onCancelRename={cancelRename}
        onFinishRename={finishRename}
        onOpen={openConversation}
        onDelete={deleteConversation}
        onNew={startNew}
        workingConversationId={working ? activeConversationId : ""}
      />

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
                onClick={() => conversation && beginRename(conversation, "header")}
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
            {modelChanged && <button type="button" className="button button--quiet" onClick={saveModel}>Save</button>}
          </div>
        </header>

        <ChatThread
          threadRef={chatThreadRef}
          conversation={conversation}
          attachments={attachments}
          artifacts={artifacts}
          working={working}
          editingMessageId={editingMessageId}
          messageDraft={messageDraft}
          speakingMessageId={speakingMessageId}
          onMessageDraftChange={setMessageDraft}
          onBeginMessageEdit={beginMessageEdit}
          onCommitMessageEdit={finishMessageEdit}
          onCancelMessageEdit={cancelMessageEdit}
          onOpenAttachment={openAttachment}
          onOpenArtifact={openArtifact}
          onCopyMessage={copyMessage}
          onShareMessage={shareMessage}
          onToggleReadAloud={toggleReadAloud}
          onOpenOperations={onOpenOperations}
        />

        <div className="chat-bottom">
          {artifacts.length > 0 && (
            <div className="artifact-strip" aria-label="Conversation artifacts">
              <span><IconFolder size={15} /> Artifacts</span>
              {artifacts.map(artifact => (
                <button key={artifact.id} type="button" onClick={() => openArtifact(artifact)}>{artifact.name}</button>
              ))}
            </div>
          )}

          <ChatComposer
            textareaRef={textareaRef}
            input={input}
            files={files}
            working={working}
            listening={listening}
            editingMessageId={editingMessageId}
            onInputChange={setInput}
            onPaste={addClipboardImages}
            onFilesSelected={addFiles}
            onRemoveFile={removeFile}
            onToggleSpeech={toggleSpeech}
            onStop={stop}
            onSubmit={send}
            onEnter={event => {
              if (event.repeat || working) return;
              event.currentTarget.form?.requestSubmit();
            }}
          />
        </div>
      </section>

      <ArtifactPanel conversationId={conversation?.id || ""} artifact={selectedArtifact} onClose={() => setSelectedArtifact(null)} />
    </div>
  );
}
