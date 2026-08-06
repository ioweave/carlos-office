import { useEffect, useMemo, useRef, useState } from 'react';
import {
    IconArrowUp,
    IconCheck,
    IconDownload,
    IconFile,
    IconHistory,
    IconMicrophone,
    IconPaperclip,
    IconPencil,
    IconPlayerStop,
    IconPlus,
    IconRefresh,
    IconSearch,
    IconTrash,
    IconVolume,
    IconVolumeOff,
    IconX,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';
import StatusBadge from '../components/StatusBadge';

const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 8_388_608;
const MAX_ATTACHMENTS_TOTAL_BYTES = 20_971_520;

const speechLanguages = [
    { value: 'en-US', label: 'English · US' },
    { value: 'es-EC', label: 'Español · Ecuador' },
    { value: 'es-US', label: 'Español · US' },
];

const welcome = name => ({
    role: 'assistant',
    content: `I am ${name || 'Nora'}. What should we work on?`,
    model: { provider: 'local', model: 'not invoked yet' },
    createdAt: new Date().toISOString(),
});

const readableText = value => String(value || '')
    .replace(/```[\s\S]*?```/g, ' Code block omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)]\([^\)]+\)/g, '$1')
    .replace(/[#>*_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const dateLabel = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const formatBytes = value => {
    const size = Number(value || 0);
    if (size < 1024) return `${size} B`;
    if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 ** 2).toFixed(1)} MB`;
};

const fileToPayload = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        data: reader.result,
    });
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
});

const decodeBase64 = value => {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
};

export default function ChatPage({ agents, health, openRequest }) {
    const [agentId, setAgentId] = useState('nora');
    const [conversationId, setConversationId] = useState(null);
    const [conversationTitle, setConversationTitle] = useState('New conversation');
    const [conversations, setConversations] = useState([]);
    const [messages, setMessages] = useState([welcome('Nora')]);
    const [input, setInput] = useState('');
    const [pendingFiles, setPendingFiles] = useState([]);
    const [search, setSearch] = useState('');
    const [sending, setSending] = useState(false);
    const [loadingConversation, setLoadingConversation] = useState(false);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [listening, setListening] = useState(false);
    const [speakingIndex, setSpeakingIndex] = useState(null);
    const [autoSpeak, setAutoSpeak] = useState(localStorage.getItem('office-auto-speak') === 'true');
    const [speechLanguage, setSpeechLanguage] = useState(localStorage.getItem('office-speech-language') || 'en-US');
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState('');
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);
    const messagesRef = useRef(null);
    const recognitionRef = useRef(null);

    const agent = useMemo(() => agents.find(item => item.agentId === agentId), [agents, agentId]);
    const speechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    const speechSynthesisAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window;
    const filteredConversations = useMemo(() => {
        const query = search.trim().toLowerCase();
        return conversations.filter(item => !query
            || item.title.toLowerCase().includes(query)
            || item.agentId.toLowerCase().includes(query));
    }, [conversations, search]);

    const loadHistory = async ({ quiet = false } = {}) => {
        if (!quiet) setLoadingHistory(true);
        try {
            const response = await api.get('/conversations?limit=300');
            setConversations(response.data || []);
        } catch (error) {
            if (!quiet) toast.error(error.response?.data?.error || 'Could not load conversation history.');
        } finally {
            if (!quiet) setLoadingHistory(false);
        }
    };

    const stopSpeech = () => {
        window.speechSynthesis?.cancel?.();
        setSpeakingIndex(null);
    };

    const speak = (text, index = null) => {
        if (!speechSynthesisAvailable) {
            toast.error('Speech synthesis is not available in this browser.');
            return;
        }
        const content = readableText(text);
        if (!content) return;
        stopSpeech();
        const utterance = new SpeechSynthesisUtterance(content);
        utterance.lang = speechLanguage;
        const voices = window.speechSynthesis.getVoices();
        const prefix = speechLanguage.split('-')[0].toLowerCase();
        utterance.voice = voices.find(voice => voice.lang.toLowerCase() === speechLanguage.toLowerCase())
            || voices.find(voice => voice.lang.toLowerCase().startsWith(prefix))
            || null;
        utterance.onend = () => setSpeakingIndex(null);
        utterance.onerror = () => setSpeakingIndex(null);
        setSpeakingIndex(index);
        window.speechSynthesis.speak(utterance);
    };

    const scrollToBottom = () => {
        requestAnimationFrame(() => {
            const target = messagesRef.current;
            if (target) target.scrollTop = target.scrollHeight;
        });
    };

    const newConversation = (nextAgentId = agentId) => {
        recognitionRef.current?.abort?.();
        stopSpeech();
        const nextAgent = agents.find(item => item.agentId === nextAgentId);
        setAgentId(nextAgentId);
        setConversationId(null);
        setConversationTitle('New conversation');
        setMessages([welcome(nextAgent?.name || 'Nora')]);
        setInput('');
        setPendingFiles([]);
        setEditingTitle(false);
        setHistoryOpen(false);
        inputRef.current?.focus();
    };

    const openConversation = async id => {
        if (!id || loadingConversation) return;
        setLoadingConversation(true);
        stopSpeech();
        try {
            const response = await api.get(`/conversations/${encodeURIComponent(id)}`);
            const conversation = response.data;
            setConversationId(conversation.conversationId);
            setConversationTitle(conversation.title || 'Conversation');
            setAgentId(conversation.agentId || 'nora');
            setMessages(conversation.messages?.length ? conversation.messages : [welcome('Nora')]);
            setInput('');
            setPendingFiles([]);
            setEditingTitle(false);
            setHistoryOpen(false);
            scrollToBottom();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not open that conversation.');
        } finally {
            setLoadingConversation(false);
        }
    };

    useEffect(() => { loadHistory(); }, []);
    useEffect(() => () => {
        recognitionRef.current?.abort?.();
        window.speechSynthesis?.cancel?.();
    }, []);
    useEffect(() => { scrollToBottom(); }, [messages.length, sending]);
    useEffect(() => {
        if (openRequest?.conversationId) openConversation(openRequest.conversationId);
    }, [openRequest?.token]);

    const toggleListening = () => {
        if (!speechRecognition) {
            toast.error('Speech recognition is not available. Chrome or Edge is recommended.');
            return;
        }
        if (listening) {
            recognitionRef.current?.stop?.();
            return;
        }

        const Recognition = speechRecognition;
        const recognition = new Recognition();
        const startingInput = input.trim();
        recognition.lang = speechLanguage;
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.onstart = () => setListening(true);
        recognition.onresult = event => {
            let transcript = '';
            for (let index = 0; index < event.results.length; index++) {
                transcript += event.results[index][0]?.transcript || '';
            }
            setInput([startingInput, transcript.trim()].filter(Boolean).join(startingInput ? ' ' : ''));
        };
        recognition.onerror = event => {
            if (!['aborted', 'no-speech'].includes(event.error)) toast.error(`Microphone recognition failed: ${event.error}`);
        };
        recognition.onend = () => {
            setListening(false);
            recognitionRef.current = null;
            inputRef.current?.focus();
        };
        recognitionRef.current = recognition;
        recognition.start();
    };

    const chooseFiles = event => {
        const selected = [...(event.target.files || [])];
        event.target.value = '';
        if (!selected.length) return;
        const next = [];
        for (const file of selected) {
            if (file.size > MAX_ATTACHMENT_BYTES) {
                toast.error(`${file.name} is larger than 8 MB.`);
                continue;
            }
            next.push({ localId: crypto.randomUUID(), file, name: file.name, mimeType: file.type, size: file.size });
        }
        setPendingFiles(current => {
            const available = Math.max(0, MAX_ATTACHMENTS - current.length);
            if (next.length > available) toast.error(`A message can contain up to ${MAX_ATTACHMENTS} attachments.`);
            const accepted = [];
            let total = current.reduce((sum, item) => sum + item.size, 0);
            for (const item of next.slice(0, available)) {
                if (total + item.size > MAX_ATTACHMENTS_TOTAL_BYTES) {
                    toast.error('Attachments for one message cannot exceed 20 MB in total.');
                    break;
                }
                accepted.push(item);
                total += item.size;
            }
            return [...current, ...accepted];
        });
    };

    const removePendingFile = localId => setPendingFiles(current => current.filter(item => item.localId !== localId));

    const send = async event => {
        event?.preventDefault();
        const text = input.trim();
        if ((!text && !pendingFiles.length) || sending) return;

        recognitionRef.current?.stop?.();
        const localAttachments = pendingFiles.map(item => ({
            attachmentId: item.localId,
            name: item.name,
            mimeType: item.mimeType || 'application/octet-stream',
            size: item.size,
            local: true,
        }));
        const userMessage = {
            role: 'user',
            content: text || 'Review the attached files.',
            attachments: localAttachments,
            createdAt: new Date().toISOString(),
        };
        setMessages(current => [...current, userMessage]);
        setInput('');
        setPendingFiles([]);
        setSending(true);

        try {
            const attachments = await Promise.all(pendingFiles.map(item => fileToPayload(item.file)));
            const response = await api.post('/chat', {
                message: text,
                agentId,
                conversationId,
                attachments,
            });
            const nextId = response.data.conversationId;
            setConversationId(nextId);
            if (response.data.conversation?.title) setConversationTitle(response.data.conversation.title);
            const synced = await api.get(`/conversations/${encodeURIComponent(nextId)}`);
            setMessages(synced.data.messages || []);
            setConversationTitle(synced.data.title || response.data.conversation?.title || 'Conversation');
            await loadHistory({ quiet: true });
            if (autoSpeak) speak(response.data.message?.content, synced.data.messages?.length - 1);
        } catch (error) {
            const data = error.response?.data || {};
            const messageText = data.error || error.message;
            toast.error(messageText);
            if (data.conversationId) {
                setConversationId(data.conversationId);
                try {
                    const synced = await api.get(`/conversations/${encodeURIComponent(data.conversationId)}`);
                    setMessages(synced.data.messages || []);
                    setConversationTitle(synced.data.title || 'Conversation');
                    await loadHistory({ quiet: true });
                } catch {}
            } else {
                setMessages(current => [...current, {
                    role: 'assistant',
                    content: `I could not complete that request: ${messageText}`,
                    error: true,
                    createdAt: new Date().toISOString(),
                }]);
            }
        } finally {
            setSending(false);
        }
    };

    const beginRename = async conversation => {
        if (conversationId !== conversation.conversationId) await openConversation(conversation.conversationId);
        setTitleDraft(conversation.title);
        setEditingTitle(true);
    };

    const saveTitle = async () => {
        const title = titleDraft.trim();
        if (!conversationId || !title) return;
        try {
            const response = await api.put(`/conversations/${encodeURIComponent(conversationId)}`, { title });
            setConversationTitle(response.data.title);
            setEditingTitle(false);
            await loadHistory({ quiet: true });
            toast.success('Conversation renamed');
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not rename conversation.');
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        try {
            await api.delete(`/conversations/${encodeURIComponent(deleteTarget.conversationId)}`);
            if (conversationId === deleteTarget.conversationId) newConversation(agentId);
            setDeleteTarget(null);
            await loadHistory({ quiet: true });
            toast.success('Conversation and attachments deleted');
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not delete conversation.');
        }
    };

    const downloadAttachment = async file => {
        if (!conversationId || file.local) return;
        try {
            const response = await api.get(`/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(file.attachmentId)}`);
            const item = response.data;
            const blob = new Blob([decodeBase64(item.data)], { type: item.mimeType || 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = item.name || 'attachment';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not retrieve attachment.');
        }
    };

    const changeAutoSpeak = checked => {
        setAutoSpeak(checked);
        localStorage.setItem('office-auto-speak', String(checked));
        if (!checked) stopSpeech();
    };

    const changeSpeechLanguage = value => {
        setSpeechLanguage(value);
        localStorage.setItem('office-speech-language', value);
    };

    return (
        <div className="chat-workspace">
            <aside className={`conversation-rail ${historyOpen ? 'open' : ''}`}>
                <div className="conversation-rail-header">
                    <button className="new-chat-button" onClick={() => newConversation()}>
                        <IconPlus size={17} /> New conversation
                    </button>
                    <button className="rail-close" onClick={() => setHistoryOpen(false)} aria-label="Close conversation history">
                        <IconX size={18} />
                    </button>
                </div>
                <label className="conversation-search">
                    <IconSearch size={16} />
                    <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search conversations" />
                </label>
                <div className="rail-section-label">
                    <span>Recent</span>
                    <button onClick={() => loadHistory()} disabled={loadingHistory} aria-label="Refresh conversations">
                        <IconRefresh size={15} />
                    </button>
                </div>
                <div className="conversation-list">
                    {!filteredConversations.length && <p className="empty-rail-copy">No matching conversations.</p>}
                    {filteredConversations.map(conversation => (
                        <div
                            key={conversation.conversationId}
                            className={`conversation-row ${conversationId === conversation.conversationId ? 'active' : ''}`}
                        >
                            <button className="conversation-open" onClick={() => openConversation(conversation.conversationId)}>
                                <strong>{conversation.title}</strong>
                                <span>
                                    {agents.find(item => item.agentId === conversation.agentId)?.name || conversation.agentId}
                                    {' · '}{conversation.messageCount} messages
                                    {conversation.attachmentCount ? ` · ${conversation.attachmentCount} files` : ''}
                                </span>
                                <small>{dateLabel(conversation.updatedAt)}</small>
                            </button>
                            <div className="conversation-row-actions">
                                <button onClick={() => beginRename(conversation)} aria-label={`Rename ${conversation.title}`}>
                                    <IconPencil size={14} />
                                </button>
                                <button onClick={() => setDeleteTarget(conversation)} aria-label={`Delete ${conversation.title}`}>
                                    <IconTrash size={14} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </aside>

            <section className="conversation-stage">
                <header className="conversation-topbar">
                    <div className="conversation-identity">
                        <button className="history-toggle" onClick={() => setHistoryOpen(true)} aria-label="Open conversation history">
                            <IconHistory size={19} />
                        </button>
                        <div className="agent-avatar" style={{ '--agent-color': agent?.color || '#22d3ee' }}>
                            {(agent?.name || 'Nora').slice(0, 1)}
                        </div>
                        <div>
                            {editingTitle ? (
                                <div className="title-editor">
                                    <input
                                        value={titleDraft}
                                        onChange={event => setTitleDraft(event.target.value)}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter') saveTitle();
                                            if (event.key === 'Escape') setEditingTitle(false);
                                        }}
                                        autoFocus
                                    />
                                    <button onClick={saveTitle} aria-label="Save title"><IconCheck size={16} /></button>
                                    <button onClick={() => setEditingTitle(false)} aria-label="Cancel rename"><IconX size={16} /></button>
                                </div>
                            ) : (
                                <button
                                    className="conversation-title-button"
                                    onClick={() => {
                                        if (!conversationId) return;
                                        setTitleDraft(conversationTitle);
                                        setEditingTitle(true);
                                    }}
                                    title={conversationId ? 'Rename conversation' : 'Send a message to create this conversation'}
                                >
                                    <strong>{conversationTitle}</strong>
                                    {conversationId && <IconPencil size={14} />}
                                </button>
                            )}
                            <span>{agent?.name || 'Nora'} · {agent?.role || 'Chief of Staff'}</span>
                        </div>
                    </div>
                    <div className="conversation-top-actions">
                        <select value={agentId} onChange={event => newConversation(event.target.value)} aria-label="Select agent">
                            {agents.filter(item => item.enabled).map(item => (
                                <option key={item.agentId} value={item.agentId}>{item.name}</option>
                            ))}
                        </select>
                        <button className="compact-button" onClick={() => newConversation()}>
                            <IconPlus size={16} /> <span>New</span>
                        </button>
                    </div>
                </header>

                <div className="message-scroll" ref={messagesRef}>
                    <div className="message-column">
                        {loadingConversation && <div className="conversation-loading">Loading conversation…</div>}
                        {messages.map((item, index) => (
                            <article key={`${item.role}-${item.createdAt || index}`} className={`chat-message ${item.role} ${item.error ? 'error' : ''}`}>
                                <div className="message-author">
                                    <div className="message-author-avatar">{item.role === 'assistant' ? (agent?.name?.[0] || 'N') : 'C'}</div>
                                    <div>
                                        <strong>{item.role === 'assistant' ? (agent?.name || 'Nora') : 'Carlos'}</strong>
                                        <span>{dateLabel(item.createdAt)}</span>
                                    </div>
                                    {item.model && (
                                        <span className="message-model">
                                            {item.model.provider} · {item.model.model}
                                            {item.model.fallbackUsed ? ' · offline fallback' : ''}
                                        </span>
                                    )}
                                    {item.role === 'assistant' && speechSynthesisAvailable && (
                                        <button
                                            className="message-audio"
                                            onClick={() => speakingIndex === index ? stopSpeech() : speak(item.content, index)}
                                            aria-label={speakingIndex === index ? 'Stop reading response' : 'Read response aloud'}
                                        >
                                            {speakingIndex === index ? <IconVolumeOff size={16} /> : <IconVolume size={16} />}
                                        </button>
                                    )}
                                </div>
                                <div className="message-text">{item.content}</div>
                                {!!item.attachments?.length && (
                                    <div className="message-attachments">
                                        {item.attachments.map(file => (
                                            <button
                                                key={file.attachmentId || file.name}
                                                className="attachment-card"
                                                onClick={() => downloadAttachment(file)}
                                                disabled={file.local}
                                                title={file.local ? 'Saving with this message' : `Download ${file.name}`}
                                            >
                                                <IconFile size={18} />
                                                <span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>
                                                {!file.local && <IconDownload size={15} />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {!!item.toolEvents?.length && (
                                    <details className="tool-trace">
                                        <summary>{item.toolEvents.length} tool event{item.toolEvents.length === 1 ? '' : 's'}</summary>
                                        {item.toolEvents.map((tool, toolIndex) => (
                                            <div key={`${tool.name}-${toolIndex}`}>
                                                <strong>{tool.name}</strong>
                                                <pre>{JSON.stringify({ args: tool.args, result: tool.result }, null, 2)}</pre>
                                            </div>
                                        ))}
                                    </details>
                                )}
                            </article>
                        ))}
                        {sending && (
                            <article className="chat-message assistant thinking-message">
                                <div className="message-author-avatar">{agent?.name?.[0] || 'N'}</div>
                                <div className="thinking-dots"><span /><span /><span /></div>
                            </article>
                        )}
                    </div>
                </div>

                <div className="composer-zone">
                    {!!pendingFiles.length && (
                        <div className="pending-files">
                            {pendingFiles.map(file => (
                                <div className="pending-file" key={file.localId}>
                                    <IconFile size={16} />
                                    <span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>
                                    <button onClick={() => removePendingFile(file.localId)} aria-label={`Remove ${file.name}`}><IconX size={14} /></button>
                                </div>
                            ))}
                        </div>
                    )}
                    <form className="chat-composer" onSubmit={send}>
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={event => setInput(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault();
                                    send();
                                }
                            }}
                            placeholder={`Message ${agent?.name || 'Nora'}…`}
                            rows={2}
                        />
                        <div className="composer-toolbar">
                            <div>
                                <input ref={fileInputRef} type="file" multiple hidden onChange={chooseFiles} />
                                <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Attach files" title="Attach files">
                                    <IconPaperclip size={19} />
                                </button>
                                <button
                                    type="button"
                                    className={listening ? 'active listening' : ''}
                                    onClick={toggleListening}
                                    aria-label={listening ? 'Stop listening' : 'Dictate message'}
                                    title={listening ? 'Stop listening' : 'Dictate message'}
                                >
                                    {listening ? <IconPlayerStop size={19} /> : <IconMicrophone size={19} />}
                                </button>
                                <span className="composer-hint">{listening ? 'Listening…' : 'Enter to send · Shift+Enter for a new line'}</span>
                            </div>
                            <button className="composer-send" disabled={sending || (!input.trim() && !pendingFiles.length)} aria-label="Send message">
                                <IconArrowUp size={19} />
                            </button>
                        </div>
                    </form>
                </div>
            </section>

            <aside className="conversation-inspector">
                <section>
                    <div className="inspector-label">Active agent</div>
                    <div className="inspector-agent">
                        <div className="agent-avatar large" style={{ '--agent-color': agent?.color || '#22d3ee' }}>{agent?.name?.[0] || 'N'}</div>
                        <div><strong>{agent?.name || 'Nora'}</strong><span>{agent?.role}</span></div>
                        <StatusBadge tone={agent?.enabled ? 'success' : 'danger'}>{agent?.enabled ? 'Ready' : 'Disabled'}</StatusBadge>
                    </div>
                </section>
                <section>
                    <div className="inspector-label">Runtime</div>
                    <dl className="inspector-list">
                        <div><dt>Provider</dt><dd>{agent?.provider || '—'}</dd></div>
                        <div><dt>Primary</dt><dd>{agent?.model || '—'}</dd></div>
                        <div><dt>Fallback</dt><dd>{agent?.fallback?.enabled ? agent.fallback.model : 'Disabled'}</dd></div>
                        <div><dt>Vault file</dt><dd>{conversationId ? `Threads/${conversationId}.md` : 'Created after first message'}</dd></div>
                    </dl>
                </section>
                <section>
                    <div className="inspector-label">Voice</div>
                    <label className="inspector-field">
                        <span>Language</span>
                        <select value={speechLanguage} onChange={event => changeSpeechLanguage(event.target.value)}>
                            {speechLanguages.map(language => <option key={language.value} value={language.value}>{language.label}</option>)}
                        </select>
                    </label>
                    <label className="inspector-toggle">
                        <span>Read new replies aloud</span>
                        <input type="checkbox" checked={autoSpeak} onChange={event => changeAutoSpeak(event.target.checked)} />
                    </label>
                </section>
                <section>
                    <div className="inspector-label">Services</div>
                    <div className="service-status"><span>Office API</span><StatusBadge tone={health?.status === 'online' ? 'success' : 'danger'}>{health?.status || 'unknown'}</StatusBadge></div>
                    <div className="service-status"><span>Ollama</span><StatusBadge tone={health?.ollama?.online ? 'success' : 'warning'}>{health?.ollama?.online ? 'online' : 'offline'}</StatusBadge></div>
                </section>
            </aside>

            {deleteTarget && (
                <div className="modal-backdrop" role="presentation" onMouseDown={event => {
                    if (event.target === event.currentTarget) setDeleteTarget(null);
                }}>
                    <section className="office-modal danger-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
                        <div className="modal-icon danger"><IconTrash size={22} /></div>
                        <h2 id="delete-title">Delete conversation?</h2>
                        <p><strong>{deleteTarget.title}</strong> and every attachment stored for it will be permanently removed from the Obsidian vault.</p>
                        <div className="modal-actions">
                            <button className="secondary-button" onClick={() => setDeleteTarget(null)}>Cancel</button>
                            <button className="danger-button" onClick={confirmDelete}><IconTrash size={16} /> Delete permanently</button>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}
