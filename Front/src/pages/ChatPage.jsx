import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconHistory, IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import api, { endpoints } from "../api";
import ArtifactPreview from "../components/ArtifactPreview";
import ChatComposer from "../components/ChatComposer";
import ChatThread from "../components/ChatThread";
import ConversationList from "../components/ConversationList";
import StatusBadge from "../components/StatusBadge";

const ACTIVE_CONVERSATION_KEY = "office-active-conversation";

const mapMessage = message => ({
  id: message.id,
  role: message.actor === "Carlos" ? "user" : "assistant",
  at: message.at,
  content: message.content,
  artifacts: message.artifacts || [],
});

const readable = value => String(value || "")
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/`([^`]+)`/g, "$1")
  .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
  .replace(/[#>*_~|]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const filePayload = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || "");
    const comma = dataUrl.indexOf(",");
    resolve({ name: file.name, type: file.type || "application/octet-stream", content: comma >= 0 ? dataUrl.slice(comma + 1) : "", encoding: "base64" });
  };
  reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}.`));
  reader.readAsDataURL(file);
});

const deriveTitle = conversation => {
  const firstUser = conversation?.messages?.find(message => message.actor === "Carlos");
  return firstUser?.content?.slice(0, 60).trim() || conversation?.id || "Conversation";
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export default function ChatPage({ agents, health, nora, onNoraChange, openRequest, onOpenOperations }) {
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [conversationModel, setConversationModel] = useState({ provider: "", model: "" });
  const [modelDraft, setModelDraft] = useState({ provider: "", model: "" });
  const [messages, setMessages] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [models, setModels] = useState([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState([]);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeWorkflowId, setActiveWorkflowId] = useState(null);
  const [activeArtifactId, setActiveArtifactId] = useState("");
  const [copied, setCopied] = useState(null);
  const [speaking, setSpeaking] = useState(null);
  const [listening, setListening] = useState(false);
  const [savingModel, setSavingModel] = useState(false);

  const textareaRef = useRef(null);
  const requestRef = useRef(null);
  const recognitionRef = useRef(null);
  const copyTimerRef = useRef(null);
  const language = useRef("en-US");

  const agentName = useMemo(() => agents.find(item => item.isNora)?.name || "Nora", [agents]);
  const providerNames = useMemo(() => models.map(entry => entry.provider), [models]);
  const modelsFor = provider => (models.find(entry => entry.provider === provider)?.models) || [];
  const modelDirty = conversationModel.provider !== modelDraft.provider || conversationModel.model !== modelDraft.model;

  const loadCatalog = useCallback(async () => {
    try {
      const modelsResponse = await api.get(endpoints.models());
      setModels(modelsResponse.data || []);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not load model catalog.");
    }
  }, []);

  const loadHistory = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoadingHistory(true);
    try {
      setConversations((await api.get(endpoints.conversations())).data || []);
    } catch (error) {
      if (!quiet) toast.error(error.response?.data?.error || "Could not load conversations.");
    } finally {
      if (!quiet) setLoadingHistory(false);
    }
  }, []);

  const loadConversation = useCallback(async (id, { quiet = false } = {}) => {
    if (!id) return;
    try {
      const record = (await api.get(endpoints.conversation(id))).data;
      setConversationId(record.id);
      sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, record.id);
      setMessages(record.messages?.length ? record.messages.map(mapMessage) : []);
      setActiveWorkflowId(record.workflows?.length ? record.workflows[record.workflows.length - 1] : null);
      const nora = record.nora || { provider: "", model: "" };
      setConversationModel(nora);
      setModelDraft(nora);
      const artifactList = (await api.get(endpoints.conversationArtifacts(record.id))).data || [];
      setArtifacts(artifactList);
      setActiveArtifactId("");
      setHistoryOpen(false);
    } catch (error) {
      sessionStorage.removeItem(ACTIVE_CONVERSATION_KEY);
      if (!quiet) toast.error(error.response?.data?.error || "Could not open conversation.");
    }
  }, []);

  useEffect(() => {
    loadCatalog();
    loadHistory();
    const stored = sessionStorage.getItem(ACTIVE_CONVERSATION_KEY);
    if (stored) loadConversation(stored, { quiet: true });
  }, [loadCatalog, loadHistory, loadConversation]);

  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.conversationId) loadConversation(openRequest.conversationId);
    if (openRequest.prefill) {
      setInput(openRequest.prefill);
      setHistoryOpen(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [openRequest?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    requestRef.current?.abort();
    recognitionRef.current?.abort?.();
    window.speechSynthesis?.cancel?.();
    clearTimeout(copyTimerRef.current);
  }, []);

  // When starting a new conversation with no selection yet, default the draft to the App-owned Nora selection.
  useEffect(() => {
    if (conversationId || !nora?.provider) return;
    if (!modelDraft.provider) setModelDraft(nora);
  }, [nora, conversationId, modelDraft.provider]);

  const startNew = () => {
    if (sending) return;
    sessionStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    setConversationId(null);
    setMessages([]);
    setArtifacts([]);
    setInput("");
    setFiles([]);
    setActiveWorkflowId(null);
    setActiveArtifactId("");
    setHistoryOpen(false);
    const defaults = nora?.provider ? nora : (providerNames.length ? { provider: providerNames[0], model: "" } : { provider: "", model: "" });
    setConversationModel(defaults);
    setModelDraft(defaults);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const stopSpeech = () => { window.speechSynthesis?.cancel?.(); setSpeaking(null); };
  const speak = (text, index) => {
    if (!window.speechSynthesis) return toast.error("Speech output is unavailable in this browser.");
    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(readable(text));
    utterance.lang = language.current;
    utterance.onend = () => setSpeaking(null);
    utterance.onerror = () => setSpeaking(null);
    setSpeaking(index);
    window.speechSynthesis.speak(utterance);
  };

  const copyResponse = async (text, index) => {
    try {
      await navigator.clipboard?.writeText(String(text || ""));
      setCopied(index);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.error("Could not copy the response.");
    }
  };

  const toggleListening = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return toast.error("Speech recognition is unavailable. Chrome or Edge is recommended.");
    if (listening) return recognitionRef.current?.stop?.();
    const recognition = new Recognition();
    const existing = input.trim();
    recognition.lang = language.current;
    recognition.interimResults = true;
    recognition.onstart = () => setListening(true);
    recognition.onresult = event => {
      const transcript = [...event.results].map(result => result[0]?.transcript || "").join("");
      setInput([existing, transcript.trim()].filter(Boolean).join(" "));
    };
    recognition.onerror = event => { if (!["aborted", "no-speech"].includes(event.error)) toast.error(`Speech recognition failed: ${event.error}`); };
    recognition.onend = () => { setListening(false); recognitionRef.current = null; };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const changeProvider = provider => setModelDraft({ provider, model: "" });
  const changeModel = model => setModelDraft({ provider: modelDraft.provider, model });

  const saveModel = async () => {
    if (!conversationId) return;
    if (!modelDraft.provider || !modelDraft.model) return toast.error("Select a provider and model.");
    setSavingModel(true);
    try {
      const record = (await api.patch(endpoints.conversationModel(conversationId), { provider: modelDraft.provider, model: modelDraft.model })).data;
      const next = record.nora || modelDraft;
      setConversationModel(next);
      setModelDraft(next);
      onNoraChange?.(next);
      toast.success("Conversation model updated.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not update conversation model.");
      setModelDraft(conversationModel);
    } finally {
      setSavingModel(false);
    }
  };

  const ensureConversation = async () => {
    if (conversationId) return conversationId;
    const provider = modelDraft.provider || nora?.provider || providerNames[0];
    const model = modelDraft.model || modelsFor(provider)[0] || "";
    if (!provider || !model) throw new Error("Select a provider and model before sending.");
    const created = (await api.post(endpoints.conversations(), { provider, model })).data;
    setConversationId(created.id);
    sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, created.id);
    const next = created.nora || { provider, model };
    setConversationModel(next);
    setModelDraft(next);
    onNoraChange?.(next);
    await loadCatalog();
    return created.id;
  };

  const send = async event => {
    event?.preventDefault?.();
    const message = input.trim();
    if (sending || (!message && !files.length)) return;

    const requestContent = message || "Review the attached files.";
    setActiveWorkflowId(null);
    setSending(true);
    setHistoryOpen(false);
    const controller = new AbortController();
    requestRef.current = controller;

    const optimistic = { id: `pending-${Date.now()}`, role: "user", at: new Date().toISOString(), content: requestContent };
    setMessages(current => [...current, optimistic]);
    setInput("");
    setFiles([]);

    let watchingWorkflow = false;
    let workflowWatcher = null;

    try {
      const id = await ensureConversation();
      const artifactIds = [];
      for (const item of files) {
        const payload = await filePayload(item.file);
        const created = (await api.post(endpoints.conversationArtifacts(id), { name: payload.name, type: payload.type, createdBy: "Carlos", content: payload.content, encoding: "base64" })).data;
        artifactIds.push(created.id);
      }

      // Establish the Workflow IDs that already existed before this request so the
      // watcher only surfaces the Workflow Nora creates for this request.
      const beforeRequest = (await api.get(endpoints.conversation(id))).data;
      const knownWorkflowIds = new Set(beforeRequest.workflows || []);

      // Best-effort: discover the in-flight Workflow by polling the Conversation
      // while POST /requests is still awaiting runWorkflow. POST /requests resolves
      // only after execution returns, so the Workflow is observable mid-run.
      watchingWorkflow = true;
      workflowWatcher = (async () => {
        while (watchingWorkflow) {
          try {
            const record = (await api.get(endpoints.conversation(id))).data;
            const workflowIds = record.workflows || [];
            const discovered = workflowIds.find(workflowId => !knownWorkflowIds.has(workflowId));
            if (discovered) {
              workflowIds.forEach(workflowId => knownWorkflowIds.add(workflowId));
              setActiveWorkflowId(discovered);
            }
          } catch {
            // Workflow discovery is best-effort; the main request owns user-visible errors.
          }
          if (watchingWorkflow) await wait(750);
        }
      })();

      const result = (await api.post(endpoints.conversationRequest(id), { content: requestContent, artifacts: artifactIds }, { signal: controller.signal })).data;
      if (result.workflow?.id) setActiveWorkflowId(result.workflow.id);

      const record = (await api.get(endpoints.conversation(id))).data;
      setMessages(record.messages?.map(mapMessage) || []);
      const artifactList = (await api.get(endpoints.conversationArtifacts(id))).data || [];
      setArtifacts(artifactList);

      if (result.action === "tool") toast.success(`Tool ${result.tool?.name} saved.`);
      if (result.action === "skill") toast.success(`Skill ${result.skill?.name} saved.`);
      await loadHistory({ quiet: true });
    } catch (error) {
      if (error?.code === "ERR_CANCELED" || error?.name === "CanceledError") {
        toast.message("Response connection stopped.");
      } else {
        toast.error(error.response?.data?.error || error.message || "Request failed.");
      }
      if (conversationId) loadConversation(conversationId, { quiet: true });
    } finally {
      watchingWorkflow = false;
      if (workflowWatcher) await workflowWatcher;
      requestRef.current = null;
      setSending(false);
    }
  };

  const stopResponse = async () => {
    requestRef.current?.abort();

    if (!activeWorkflowId) return;

    try {
      await api.post(endpoints.workflowCancel(activeWorkflowId));
    } catch (error) {
      toast.error(
        error.response?.data?.error
        || "The response was disconnected, but the Workflow could not be cancelled.",
      );
    }
  };

  const activeArtifact = artifacts.find(item => item.id === activeArtifactId) || null;
  const title = conversationId ? deriveTitle({ id: conversationId, messages: messages.map(m => ({ actor: m.role === "user" ? "Carlos" : "Nora", content: m.content, at: m.at })) }) : "New conversation";
  const connected = health?.ok === true;

  return (
    <div className={`chat ${historyOpen ? "chat--history-open" : ""} ${activeArtifact ? "chat--artifact-open" : ""}`}>
      <section className="chat__main">
        <header className="chat__header">
          <div className="chat__header-leading">
            <button type="button" className="icon-button chat__history-toggle" onClick={() => setHistoryOpen(current => !current)} aria-label="Open conversation history"><IconHistory size={19} /></button>
            <div className="chat__identity">
              <span className="chat__agent-label">{agentName} · Chief of Staff</span>
              <div className="chat__title"><h1 className="chat__title-text">{title}</h1></div>
            </div>
          </div>
          <div className="chat__header-actions">
            <StatusBadge tone={connected ? "success" : "warning"}>{connected ? "Backend online" : "Backend offline"}</StatusBadge>
            <button type="button" className="secondary-button" onClick={startNew} disabled={sending}><IconPlus size={16} /><span>New</span></button>
          </div>
        </header>

        <div className="chat__model-bar">
          <div className="chat__model-selectors">
            <label className="chat__model-field">
              <span className="chat__model-field-label">Provider</span>
              <select className="chat__model-select" value={modelDraft.provider} onChange={event => changeProvider(event.target.value)}>
                {!providerNames.includes(modelDraft.provider) && modelDraft.provider && <option value={modelDraft.provider}>{modelDraft.provider} · current</option>}
                {providerNames.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="chat__model-field">
              <span className="chat__model-field-label">Model</span>
              <select className="chat__model-select" value={modelDraft.model} onChange={event => changeModel(event.target.value)}>
                <option value="">Select model</option>
                {modelsFor(modelDraft.provider).map(model => <option key={model} value={model}>{model}</option>)}
                {!modelsFor(modelDraft.provider).includes(modelDraft.model) && modelDraft.model && <option value={modelDraft.model}>{modelDraft.model} · current</option>}
              </select>
            </label>
          </div>
          {conversationId && modelDirty && (
            <button type="button" className="secondary-button" onClick={saveModel} disabled={savingModel || !modelDraft.provider || !modelDraft.model}>
              {savingModel ? "Saving…" : "Save model"}
            </button>
          )}
          {!conversationId && <span className="chat__model-hint">Used when creating this conversation.</span>}
        </div>

        <div className="chat__workspace">
          <ChatThread
            messages={messages}
            agentName={agentName}
            artifacts={artifacts}
            activeArtifactId={activeArtifactId}
            onArtifactSelect={setActiveArtifactId}
            sending={sending}
            copied={copied}
            onCopy={copyResponse}
            speaking={speaking}
            onSpeak={speak}
            onStopSpeak={stopSpeech}
            onOpenOperations={onOpenOperations}
            workflowId={activeWorkflowId}
          />
          <ChatComposer
            input={input}
            setInput={setInput}
            onSend={send}
            sending={sending}
            onStop={stopResponse}
            files={files}
            setFiles={setFiles}
            agentName={agentName}
            textareaRef={textareaRef}
            listening={listening}
            toggleListening={toggleListening}
          />
        </div>
      </section>

      <aside className={`chat__history ${historyOpen ? "chat__history--open" : ""}`} aria-label="Conversation history">
        <ConversationList
          conversations={conversations}
          conversationId={conversationId}
          onOpen={id => loadConversation(id)}
          onRefresh={() => loadHistory()}
          onNew={startNew}
          search={search}
          setSearch={setSearch}
          loading={loadingHistory}
          onClose={() => setHistoryOpen(false)}
        />
      </aside>

      {historyOpen && <button type="button" className="chat__history-backdrop" onClick={() => setHistoryOpen(false)} aria-label="Close conversation history" />}

      {activeArtifact && (
        <>
          <div className="chat__artifact-splitter" aria-hidden="true" />
          <ArtifactPreview
            conversationId={conversationId}
            artifact={activeArtifact}
            artifacts={artifacts}
            onSelect={setActiveArtifactId}
            onClose={() => setActiveArtifactId("")}
          />
        </>
      )}
    </div>
  );
}