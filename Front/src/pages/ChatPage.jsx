import { useEffect, useMemo, useRef, useState } from 'react';
import {
    IconArrowUp, IconDownload, IconFile, IconMicrophone, IconPaperclip, IconPencil,
    IconPlayerStop, IconPlus, IconRefresh, IconSearch, IconTrash, IconVolume, IconX,
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
const formatDate = value => new Date(value).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});
const formatBytes = value => value < 1024
    ? `${value} B`
    : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
const filePayload = file => new Promise((resolve, reject) => {
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
const readable = value => String(value || '')
    .replace(/```[\s\S]*?```/g, ' Code block omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[#>*_~|]/g, ' ').replace(/\s+/g, ' ').trim();
const cancelled = error => error?.code === 'ERR_CANCELED'
    || error?.name === 'CanceledError'
    || error?.response?.status === 499
    || error?.response?.data?.cancelled;

export default function ChatPage({ agents, health, openRequest }) {
    const [agentId, setAgentId] = useState('nora');
    const [conversationId, setConversationId] = useState(null);
    const [title, setTitle] = useState('New conversation');
    const [titleDraft, setTitleDraft] = useState('');
    const [editingTitle, setEditingTitle] = useState(false);
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
        return conversations.filter(item => !query
            || item.title.toLowerCase().includes(query)
            || item.agentId.toLowerCase().includes(query));
    }, [conversations, search]);

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
        catch (error) { if (!quiet) toast.error(error.response?.data?.error || 'Could not load conversations.'); }
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

    const startNew = (nextAgent = agentId) => {
        if (sending) return toast.message('Stop the current response first.');
        const selected = agents.find(item => item.agentId === nextAgent);
        setAgentId(nextAgent);
        setConversationId(null);
        setTitle('New conversation');
        setMessages([welcome(selected?.name || 'Nora')]);
        setInput('');
        setFiles([]);
        setEditingTitle(false);
        textareaRef.current?.focus();
        resizeComposer();
    };

    const openConversation = async id => {
        if (!id || sending) return;
        try {
            const record = (await api.get(`/conversations/${encodeURIComponent(id)}`)).data;
            setConversationId(record.conversationId);
            setTitle(record.title || 'Conversation');
            setAgentId(record.agentId || 'nora');
            setMessages(record.messages?.length ? record.messages : [welcome('Nora')]);
            setInput('');
            setFiles([]);
            setEditingTitle(false);
            scrollBottom();
        } catch (error) { toast.error(error.response?.data?.error || 'Could not open conversation.'); }
    };

    const rename = async () => {
        const next = titleDraft.trim();
        if (!conversationId || !next) return;
        try {
            const record = (await api.put(`/conversations/${encodeURIComponent(conversationId)}`, { title: next })).data;
            setTitle(record.title);
            setEditingTitle(false);
            await loadHistory({ quiet: true });
        } catch (error) { toast.error(error.response?.data?.error || 'Could not rename conversation.'); }
    };

    const removeConversation = async () => {
        try {
            await api.delete(`/conversations/${encodeURIComponent(deleteTarget.conversationId)}`);
            if (deleteTarget.conversationId === conversationId) startNew(agentId);
            setDeleteTarget(null);
            await loadHistory({ quiet: true });
        } catch (error) { toast.error(error.response?.data?.error || 'Could not delete conversation.'); }
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
            const record = (await api.get(
                `/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(file.attachmentId)}`,
            )).data;
            const binary = atob(record.data);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            const url = URL.createObjectURL(new Blob([bytes], { type: record.mimeType }));
            const link = document.createElement('a');
            link.href = url;
            link.download = record.name;
            link.click();
            URL.revokeObjectURL(url);
        } catch (error) { toast.error(error.response?.data?.error || 'Could not retrieve attachment.'); }
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
            const response = await api.post('/chat', {
                conversationId: id,
                agentId,
                message,
                attachments,
            }, { signal: controller.signal });
            setTitle(response.data.conversation?.title || title);
            setMessages(current => [...current, response.data.message]);
            await loadHistory({ quiet: true });
        } catch (error) {
            if (cancelled(error)) {
                toast.message('Response stopped. Your message remains saved.');
                await loadHistory({ quiet: true });
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
        <div className="chat-workspace">
            <aside className="conversation-panel">
                <div className="conversation-panel-header">
                    <strong>Conversations</strong>
                    <div>
                        <button type="button" onClick={() => loadHistory()} title="Refresh"><IconRefresh size={17} /></button>
                        <button type="button" onClick={() => startNew()} title="New conversation"><IconPlus size={18} /></button>
                    </div>
                </div>
                <label className="conversation-search"><IconSearch size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search chats" /></label>
                <div className="conversation-list">
                    {loadingHistory && <p className="muted-copy">Loading…</p>}
                    {filtered.map(item => (
                        <div key={item.conversationId} className={`conversation-row ${item.conversationId === conversationId ? 'active' : ''}`}>
                            <button type="button" onClick={() => openConversation(item.conversationId)} disabled={sending}>
                                <strong>{item.title}</strong><span>{item.agentId} · {item.messageCount} messages</span>
                            </button>
                            <button type="button" className="row-delete" onClick={() => setDeleteTarget(item)} aria-label={`Delete ${item.title}`}><IconTrash size={14} /></button>
                        </div>
                    ))}
                </div>
            </aside>

            <section className="chat-main-panel">
                <header className="chat-topbar">
                    <div>
                        <select value={agentId} onChange={event => startNew(event.target.value)} disabled={sending || Boolean(conversationId)} aria-label="Active agent">
                            {agents.filter(item => item.enabled).map(item => <option key={item.agentId} value={item.agentId}>{item.name} · {item.role}</option>)}
                        </select>
                        {editingTitle ? (
                            <div className="title-editor">
                                <input value={titleDraft} onChange={event => setTitleDraft(event.target.value)} onKeyDown={event => event.key === 'Enter' && rename()} autoFocus />
                                <button type="button" onClick={rename}>Save</button>
                                <button type="button" onClick={() => setEditingTitle(false)}><IconX size={16} /></button>
                            </div>
                        ) : (
                            <div className="conversation-title"><h1>{title}</h1>{conversationId && <button type="button" onClick={() => { setTitleDraft(title); setEditingTitle(true); }}><IconPencil size={15} /></button>}</div>
                        )}
                    </div>
                    <div className="chat-runtime">
                        <StatusBadge tone={health?.ollama?.online ? 'success' : 'warning'}>{health?.ollama?.online ? 'Ollama online' : 'Ollama offline'}</StatusBadge>
                        <select value={language} onChange={event => { setLanguage(event.target.value); localStorage.setItem('office-speech-language', event.target.value); }} aria-label="Voice language">
                            {languages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <button type="button" className="secondary-button" onClick={() => startNew()} disabled={sending}><IconPlus size={16} /> New</button>
                    </div>
                </header>

                <div className="messages-scroll" ref={messagesRef}>
                    <div className="message-column">
                        {messages.map((item, index) => (
                            <article key={`${item.createdAt}-${index}`} className={`chat-message ${item.role === 'user' ? 'user' : 'assistant'} ${item.error ? 'error' : ''}`}>
                                <div className="message-content-wrap">
                                    <div className="message-meta">
                                        <strong className="meta-message-name">
                                            {item.role === 'user' 
                                                ? 'Carlos' 
                                                : agent?.name || 'Nora'
                                            }
                                            {item.role === 'assistant' && <button type="button" onClick={() => speaking === index ? stopSpeech() : speak(item.content, index)} aria-label="Read response aloud">{speaking === index ? <IconPlayerStop size={15} /> : <IconVolume size={15} />}</button>}
                                        </strong>
                                        <span>{formatDate(item.createdAt)}</span>
                                        {item.model?.model && <span>{item.model.provider} · {item.model.model}</span>}
                                    </div>
                                    {item.role === 'assistant' ? <MarkdownMessage content={item.content} /> : <div className="user-message-text">{item.content}</div>}
                                    {!!item.attachments?.length && <div className="message-attachments">{item.attachments.map(file => <button type="button" key={file.attachmentId || file.name} onClick={() => downloadAttachment(file)} disabled={file.local}><IconFile size={17} /><span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span>{!file.local && <IconDownload size={14} />}</button>)}</div>}
                                    {!!item.toolEvents?.length && <details className="tool-trace"><summary>{item.toolEvents.length} tool event{item.toolEvents.length === 1 ? '' : 's'}</summary>{item.toolEvents.map((tool, toolIndex) => <div key={`${tool.name}-${toolIndex}`}><strong>{tool.name}</strong><pre>{JSON.stringify({ args: tool.args, result: tool.result }, null, 2)}</pre></div>)}</details>}
                                </div>
                            </article>
                        ))}
                        {sending && <article className="chat-message assistant"><div className="message-author-avatar">{agent?.name?.[0] || 'N'}</div><div className="thinking-dots"><span /><span /><span /></div></article>}
                    </div>
                </div>

                <div className="composer-zone">
                    {!!files.length && <div className="pending-files">{files.map(file => <div key={file.localId}><IconFile size={15} /><span><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></span><button type="button" onClick={() => setFiles(current => current.filter(item => item.localId !== file.localId))}><IconX size={14} /></button></div>)}</div>}
                    <form className="chat-composer" onSubmit={send}>
                        <textarea id="message-input" ref={textareaRef} value={input} onChange={event => { setInput(event.target.value); resizeComposer(); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} rows={1} placeholder={`Message ${agent?.name || 'Nora'}…`} />
                        <div className="composer-toolbar">
                            <div><input ref={fileRef} type="file" multiple hidden onChange={chooseFiles} /><button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach files"><IconPaperclip size={19} /></button><button type="button" className={listening ? 'active' : ''} onClick={toggleListening} aria-label="Dictate message">{listening ? <IconPlayerStop size={19} /> : <IconMicrophone size={19} />}</button><span>{sending ? 'Generating response…' : 'Enter to send · Shift+Enter for a new line'}</span></div>
                            {sending ? <button type="button" className="composer-stop" onClick={stopResponse} aria-label="Stop response"><IconPlayerStop size={18} /></button> : <button className="composer-send" disabled={!input.trim() && !files.length} aria-label="Send message"><IconArrowUp size={19} /></button>}
                        </div>
                    </form>
                </div>
            </section>

            {deleteTarget && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setDeleteTarget(null)}><section className="office-modal danger-modal" role="dialog" aria-modal="true"><h2>Delete conversation?</h2><p><strong>{deleteTarget.title}</strong> and its attachments will be removed from the Obsidian vault.</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setDeleteTarget(null)}>Cancel</button><button type="button" className="danger-button" onClick={removeConversation}><IconTrash size={16} /> Delete permanently</button></div></section></div>}
        </div>
    );
}
