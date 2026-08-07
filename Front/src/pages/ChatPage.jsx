import { useEffect, useMemo, useRef, useState } from 'react';
import {
    IconArrowUp,
    IconDeviceFloppy,
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
    IconX,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';
import MarkdownMessage from '../components/MarkdownMessage';
import StatusBadge from '../components/StatusBadge';

const MAX_FILES = 8;
const MAX_FILE_BYTES = 8_388_608;
const MAX_TOTAL_BYTES = 20_971_520;

const languages = [
    ['en-US', 'English · US'],
    ['es-EC', 'Español · Ecuador'],
    ['es-US', 'Español · US'],
];

const welcome = name => ({
    role: 'assistant',
    content: `I am ${name || 'Nora'}. What should we work on?`,
    model: { provider: 'local', model: 'not invoked yet' },
    createdAt: new Date().toISOString(),
});

const formatTime = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
const dayKey = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toDateString();
};
const dayLabel = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
};
const formatBytes = value => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
const filePayload = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, data: reader.result });
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
});
const readable = value => String(value || '')
    .replace(/```[\s\S]*?```/g, ' Code block omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[#>*_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const cancelled = error => error?.code === 'ERR_CANCELED'
    || error?.name === 'CanceledError'
    || error?.response?.status === 499
    || error?.response?.data?.cancelled;

export default function ChatPage({ agents, health, openRequest }) {
    const [agentId, setAgentId] = useState('nora');
    const [conversationId, setConversationId] = useState(null);
    const [persisted, setPersisted] = useState(false);
    const [savingConversation, setSavingConversation] = useState(false);
    const [title, setTitle] = useState('New conversation');
    const [titleDraft, setTitleDraft] = useState('');
    const [editingTitle, setEditingTitle] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [conversations, setConversations] = useState([]);
    const [messages, setMessages] = useState([welcome('Nora')]);
    const [input, setInput] = useState('');
    const [files, setFiles] = useState([]);
    const [search, setSearch] = useState('');
    const [sending, setSending] = useState(false);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [listening, setListening] = useState(false);
    const [speaking, setSpeaking] = useState(null);
    const [language, setLanguage] = useState(localStorage.getItem('office-speech-language') || 'en-US');
    const [deleteTarget, setDeleteTarget] = useState(null);

    const textareaRef = useRef(null);
    const fileRef = useRef(null);
    const messagesRef = useRef(null);
    const requestRef = useRef(null);
    const recognitionRef = useRef(null);

    const agent = useMemo(() => agents.find(item => item.agentId === agentId), [agents, agentId]);
    const filtered = useMemo(() => {
        const query = search.trim().toLowerCase();
        return conversations.filter(item => !query || item.title.toLowerCase().includes(query) || item.agentId.toLowerCase().includes(query));
    }, [conversations, search]);
    const hasRealMessages = messages.some(item => item.model?.model !== 'not invoked yet');

    const resizeComposer = () => requestAnimationFrame(() => {
        const target = textareaRef.current;
        if (!target) return;
        target.style.height = 'auto';
        target.style.height = `${Math.min(target.scrollHeight, 220)}px`;
    });
    const scrollBottom = () => requestAnimationFrame(() => {
        if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    });
    const loadHistory = async ({ quiet = false } = {}) => {
        if (!quiet) setLoadingHistory(true);
        try { setConversations((await api.get('/conversations?limit=300')).data || []); }
        catch (error) { if (!quiet) toast.error(error.response?.data?.error || 'Could not load saved conversations.'); }
        finally { if (!quiet) setLoadingHistory(false); }
    };

    const stopSpeech = () => {
        window.speechSynthesis?.cancel?.();
        setSpeaking(null);
    };
    const speak = (text, index) => {
        if (!window.speechSynthesis) return toast.error('Speech output is unavailable in this browser.');
        stopSpeech();
        const utterance = new SpeechSynthesisUtterance(readable(text));
        utterance.lang = language;
        utterance.onend = () => setSpeaking(null);
        utterance.onerror = () => setSpeaking(null);
        setSpeaking(index);
        window.speechSynthesis.speak(utterance);
    };

    useEffect(() => { loadHistory(); }, []);
    useEffect(() => { scrollBottom(); }, [messages.length, sending]);
    useEffect(() => {
        if (openRequest?.conversationId) openConversation(openRequest.conversationId);
    }, [openRequest?.token]);
    useEffect(() => () => {
        requestRef.current?.abort();
        recognitionRef.current?.abort?.();
        window.speechSynthesis?.cancel?.();
    }, []);

    const discardTemporary = id => {
        if (!id) return;
        api.delete(`/conversations/${encodeURIComponent(id)}`).catch(() => {});
    };

    const startNew = (nextAgent = agentId) => {
        if (sending) return toast.message('Stop the current response first.');
        if (conversationId && !persisted) discardTemporary(conversationId);
        const selected = agents.find(item => item.agentId === nextAgent);
        setAgentId(nextAgent);
        setConversationId(null);
        setPersisted(false);
        setTitle('New conversation');
        setMessages([welcome(selected?.name || 'Nora')]);
        setInput('');
        setFiles([]);
        setEditingTitle(false);
        setHistoryOpen(false);
        textareaRef.current?.focus();
        resizeComposer();
    };

    const openConversation = async id => {
        if (!id || sending) return;
        if (conversationId && !persisted && conversationId !== id) discardTemporary(conversationId);
        try {
            const record = (await api.get(`/conversations/${encodeURIComponent(id)}`)).data;
            setConversationId(record.conversationId);
            setPersisted(Boolean(record.persisted ?? true));
            setTitle(record.title || 'Conversation');
            setAgentId(record.agentId || 'nora');
            setMessages(record.messages?.length ? record.messages : [welcome('Nora')]);
            setInput('');
            setFiles([]);
            setEditingTitle(false);
            setHistoryOpen(false);
            scrollBottom();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not open conversation.');
        }
    };

    const rename = async () => {
        const next = titleDraft.trim();
        if (!conversationId || !next) return;
        try {
            const record = (await api.put(`/conversations/${encodeURIComponent(conversationId)}`, { title: next })).data;
            setTitle(record.title);
            setEditingTitle(false);
            if (persisted) await loadHistory({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not rename conversation.');
        }
    };

    const saveCurrentConversation = async () => {
        if (!conversationId || persisted || savingConversation) return;
        setSavingConversation(true);
        try {
            const record = (await api.post(`/conversations/${encodeURIComponent(conversationId)}/save`)).data;
            setPersisted(true);
            setTitle(record.title || title);
            if (record.messages?.length) setMessages(record.messages);
            await loadHistory({ quiet: true });
            toast.success('Conversation saved to Obsidian.');
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not save conversation.');
        } finally {
            setSavingConversation(false);
        }
    };

    const removeConversation = async () => {
        if (!deleteTarget) return;
        try {
            await api.delete(`/conversations/${encodeURIComponent(deleteTarget.conversationId)}`);
            if (deleteTarget.conversationId === conversationId) startNew(agentId);
            setDeleteTarget(null);
            await loadHistory({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not delete conversation.');
        }
    };

    const chooseFiles = event => {
        const chosen = [...(event.target.files || [])];
        event.target.value = '';
        const next = [...files];
        for (const file of chosen) {
            if (next.length >= MAX_FILES) break;
            if (file.size > MAX_FILE_BYTES) {
                toast.error(`${file.name} exceeds 8 MB.`);
                continue;
            }
            if (next.reduce((sum, item) => sum + item.size, 0) + file.size > MAX_TOTAL_BYTES) {
                toast.error('Attachments exceed the 20 MB message limit.');
                break;
            }
            next.push({ file, name: file.name, size: file.size, localId: crypto.randomUUID() });
        }
        setFiles(next);
    };

    const downloadAttachment = async file => {
        if (!conversationId || !file.attachmentId) return;
        try {
            const record = (await api.get(`/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(file.attachmentId)}`)).data;
            const binary = atob(record.data);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            const url = URL.createObjectURL(new Blob([bytes], { type: record.mimeType }));
            const link = document.createElement('a');
            link.href = url;
            link.download = record.name;
            link.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not retrieve attachment.');
        }
    };

    const toggleListening = () => {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) return toast.error('Speech recognition is unavailable. Chrome or Edge is recommended.');
        if (listening) return recognitionRef.current?.stop?.();
        const recognition = new Recognition();
        const existing = input.trim();
        recognition.lang = language;
        recognition.interimResults = true;
        recognition.onstart = () => setListening(true);
        recognition.onresult = event => {
            const transcript = [...event.results].map(result => result[0]?.transcript || '').join('');
            setInput([existing, transcript.trim()].filter(Boolean).join(existing ? ' ' : ''));
            resizeComposer();
        };
        recognition.onerror = event => {
            if (!['aborted', 'no-speech'].includes(event.error)) toast.error(`Speech recognition failed: ${event.error}`);
        };
        recognition.onend = () => {
            setListening(false);
            recognitionRef.current = null;
        };
        recognitionRef.current = recognition;
        recognition.start();
    };

    const stopResponse = () => requestRef.current?.abort();

    const send = async event => {
        event?.preventDefault?.();
        const message = input.trim();
        if (sending || (!message && !files.length)) return;
        const id = conversationId || crypto.randomUUID();
        const pendingAttachments = files.map(file => ({ name: file.name, size: file.size, local: true }));
        const optimistic = { role: 'user', content: message || 'Review the attached files.', attachments: pendingAttachments, createdAt: new Date().toISOString() };

        setConversationId(id);
        setMessages(current => [...current.filter(item => item.model?.model !== 'not invoked yet'), optimistic]);
        setInput('');
        setFiles([]);
        setSending(true);
        resizeComposer();

        const controller = new AbortController();
        requestRef.current = controller;
        try {
            const attachments = await Promise.all(files.map(item => filePayload(item.file)));
            const response = await api.post('/chat', { conversationId: id, agentId, message, attachments }, { signal: controller.signal });
            const isSaved = Boolean(response.data.persisted || response.data.conversation?.persisted);
            setPersisted(isSaved);
            setTitle(response.data.conversation?.title || title);
            setMessages(current => [...current, response.data.message]);
            if (isSaved) await loadHistory({ quiet: true });
        } catch (error) {
            if (cancelled(error)) {
                toast.message(persisted ? 'Response stopped. The message remains in the saved conversation.' : 'Response stopped. The message remains only in this temporary chat.');
                if (persisted) await loadHistory({ quiet: true });
            } else {
                toast.error(error.response?.data?.error || error.message);
                if (error.response?.data?.message) setMessages(current => [...current, error.response.data.message]);
            }
        } finally {
            requestRef.current = null;
            setSending(false);
        }
    };

    return (
        <div className={`chat ${historyOpen ? 'chat--history-open' : ''}`}>
            <aside className="chat__history" aria-label="Saved conversation history">
                <div className="chat__history-header">
                    <strong>Saved chats</strong>
                    <div className="chat__history-actions">
                        <button type="button" onClick={() => loadHistory()} aria-label="Refresh saved conversations" title="Refresh"><IconRefresh size={17} /></button>
                        <button type="button" onClick={() => startNew()} aria-label="New temporary conversation" title="New temporary conversation"><IconPlus size={18} /></button>
                        <button type="button" className="chat__history-close" onClick={() => setHistoryOpen(false)} aria-label="Close conversation history"><IconX size={18} /></button>
                    </div>
                </div>

                <label className="chat__search">
                    <IconSearch size={16} />
                    <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search saved chats" />
                </label>

                <div className="chat__conversation-list">
                    {loadingHistory && <p className="chat__empty-copy">Loading…</p>}
                    {!loadingHistory && !filtered.length && <p className="chat__empty-copy">No saved conversations yet.</p>}
                    {filtered.map(item => (
                        <div key={item.conversationId} className={`chat__conversation ${item.conversationId === conversationId ? 'chat__conversation--active' : ''}`}>
                            <button type="button" className="chat__conversation-open" onClick={() => openConversation(item.conversationId)} disabled={sending}>
                                <strong>{item.title}</strong>
                                <span>{item.agentId} · {item.messageCount} messages</span>
                            </button>
                            <button type="button" className="chat__conversation-delete" onClick={() => setDeleteTarget(item)} aria-label={`Delete ${item.title}`}><IconTrash size={14} /></button>
                        </div>
                    ))}
                </div>
            </aside>

            <section className="chat__main">
                <header className="chat__header">
                    <div className="chat__header-leading">
                        <button type="button" className="chat__history-toggle" onClick={() => setHistoryOpen(current => !current)} aria-label="Open saved conversation history"><IconHistory size={19} /></button>
                        <div className="chat__identity">
                            <select value={agentId} onChange={event => startNew(event.target.value)} disabled={sending || Boolean(conversationId)} aria-label="Active agent">
                                {agents.filter(item => item.enabled).map(item => <option key={item.agentId} value={item.agentId}>{item.name} · {item.role}</option>)}
                            </select>
                            {editingTitle ? (
                                <div className="chat__title-editor">
                                    <input value={titleDraft} onChange={event => setTitleDraft(event.target.value)} onKeyDown={event => event.key === 'Enter' && rename()} autoFocus />
                                    <button type="button" onClick={rename}>Save</button>
                                    <button type="button" onClick={() => setEditingTitle(false)} aria-label="Cancel rename"><IconX size={16} /></button>
                                </div>
                            ) : (
                                <div className="chat__title">
                                    <h1>{title}</h1>
                                    <span className={`chat__retention ${persisted ? 'chat__retention--saved' : 'chat__retention--temporary'}`}>{persisted ? 'Saved' : 'Temporary'}</span>
                                    {conversationId && (
                                        <button type="button" onClick={() => { setTitleDraft(title); setEditingTitle(true); }} aria-label="Rename conversation"><IconPencil size={14} /></button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="chat__header-actions">
                        <StatusBadge tone={health?.ollama?.online ? 'success' : 'warning'}>{health?.ollama?.online ? 'Ollama online' : 'Ollama offline'}</StatusBadge>
                        {!persisted && conversationId && hasRealMessages && (
                            <button type="button" className="chat__save" onClick={saveCurrentConversation} disabled={sending || savingConversation} title="Persist this conversation and its attachments">
                                <IconDeviceFloppy size={16} />
                                <span>{savingConversation ? 'Saving…' : 'Save'}</span>
                            </button>
                        )}
                        <select className="chat__language" value={language} onChange={event => { setLanguage(event.target.value); localStorage.setItem('office-speech-language', event.target.value); }} aria-label="Voice language">
                            {languages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <button type="button" className="chat__new" onClick={() => startNew()} disabled={sending}><IconPlus size={16} /><span>New</span></button>
                    </div>
                </header>

                <div className="chat__scroll" ref={messagesRef}>
                    <div className="chat__thread">
                        {messages.map((item, index) => {
                            const previous = messages[index - 1];
                            const showDay = !previous || dayKey(previous.createdAt) !== dayKey(item.createdAt);
                            const isUser = item.role === 'user';
                            return (
                                <div className="chat__turn-group" key={`${item.createdAt}-${index}`}>
                                    {showDay && <div className="chat__day"><span>{dayLabel(item.createdAt)}</span></div>}
                                    <article className={`chat__turn chat__turn--${isUser ? 'user' : 'assistant'} ${item.error ? 'chat__turn--error' : ''}`}>
                                        <div className="chat__turn-meta">
                                            <strong>{isUser ? 'Carlos' : agent?.name || 'Nora'}</strong>
                                            <span>{formatTime(item.createdAt)}</span>
                                            {item.model?.model && item.model.model !== 'not invoked yet' && <span>{item.model.provider} · {item.model.model}</span>}
                                            {!isUser && (
                                                <button type="button" onClick={() => speaking === index ? stopSpeech() : speak(item.content, index)} aria-label="Read response aloud">
                                                    {speaking === index ? <IconPlayerStop size={15} /> : <IconVolume size={15} />}
                                                </button>
                                            )}
                                        </div>
                                        <div className="chat__turn-body">{isUser ? <div className="chat__user-bubble">{item.content}</div> : <MarkdownMessage content={item.content} />}</div>

                                        {!!item.attachments?.length && (
                                            <div className={`chat__attachments ${isUser ? 'chat__attachments--user' : ''}`}>
                                                {item.attachments.map(file => (
                                                    <button type="button" key={file.attachmentId || file.name} onClick={() => downloadAttachment(file)} disabled={file.local}>
                                                        <IconFile size={17} />
                                                        <span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>
                                                        {!file.local && <IconDownload size={14} />}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        {!!item.toolEvents?.length && (
                                            <details className="chat__tool-trace">
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
                                </div>
                            );
                        })}

                        {sending && (
                            <article className="chat__turn chat__turn--assistant chat__turn--thinking">
                                <div className="chat__thinking" aria-label={`${agent?.name || 'Nora'} is responding`}><span /><span /><span /></div>
                            </article>
                        )}
                    </div>
                </div>

                <div className="chat__composer-zone">
                    {!!files.length && (
                        <div className="chat__pending-files">
                            {files.map(file => (
                                <div key={file.localId}>
                                    <IconFile size={15} />
                                    <span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>
                                    <button type="button" onClick={() => setFiles(current => current.filter(item => item.localId !== file.localId))} aria-label={`Remove ${file.name}`}><IconX size={14} /></button>
                                </div>
                            ))}
                        </div>
                    )}

                    <form className="chat__composer" onSubmit={send}>
                        <textarea
                            id="message-input"
                            ref={textareaRef}
                            value={input}
                            onChange={event => { setInput(event.target.value); resizeComposer(); }}
                            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }}
                            rows={1}
                            placeholder={`Message ${agent?.name || 'Nora'}…`}
                        />
                        <div className="chat__composer-toolbar">
                            <div className="chat__composer-tools">
                                <input ref={fileRef} type="file" multiple hidden onChange={chooseFiles} />
                                <button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach temporary files"><IconPaperclip size={19} /></button>
                                <button type="button" className={listening ? 'chat__composer-tool--active' : ''} onClick={toggleListening} aria-label="Dictate message">{listening ? <IconPlayerStop size={19} /> : <IconMicrophone size={19} />}</button>
                                <span className="chat__composer-context">{agent?.name || 'Nora'} · {persisted ? 'saved chat' : 'temporary chat'}</span>
                            </div>
                            {sending ? (
                                <button type="button" className="chat__stop" onClick={stopResponse} aria-label="Stop response"><IconPlayerStop size={18} /></button>
                            ) : (
                                <button type="submit" className="chat__send" disabled={!input.trim() && !files.length} aria-label="Send message"><IconArrowUp size={19} /></button>
                            )}
                        </div>
                    </form>
                    <p className="chat__composer-hint">Temporary until saved · Enter to send · Shift+Enter for a new line</p>
                </div>
            </section>

            {historyOpen && <button type="button" className="chat__history-backdrop" onClick={() => setHistoryOpen(false)} aria-label="Close conversation history" />}

            {deleteTarget && (
                <div className="dialog" onMouseDown={event => event.target === event.currentTarget && setDeleteTarget(null)}>
                    <section className="dialog__panel dialog__panel--danger" role="dialog" aria-modal="true">
                        <h2>Delete saved conversation?</h2>
                        <p><strong>{deleteTarget.title}</strong> and its persisted attachments will be removed from the Obsidian vault.</p>
                        <div className="dialog__actions">
                            <button type="button" className="button button--secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
                            <button type="button" className="button button--danger" onClick={removeConversation}><IconTrash size={16} /> Delete permanently</button>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}
