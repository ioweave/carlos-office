import { useEffect, useMemo, useRef, useState } from 'react';
import {
    IconArrowUp,
    IconBolt,
    IconBrain,
    IconHistory,
    IconMicrophone,
    IconPlayerStop,
    IconPlus,
    IconRefresh,
    IconTool,
    IconVolume,
    IconVolumeOff,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';
import StatusBadge from '../components/StatusBadge';

const welcomeMessage = {
    role: 'assistant',
    content: 'I am Nora. Give me an objective, ask for research, or have me queue work for Marco, Luma, or Dex.',
    model: { provider: 'local', model: 'not invoked yet' },
};

const speechLanguages = [
    { value: 'en-US', label: 'English · US' },
    { value: 'es-EC', label: 'Español · Ecuador' },
    { value: 'es-US', label: 'Español · US' },
];

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
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
};

export default function ChatPage({ agents, health }) {
    const [agentId, setAgentId] = useState('nora');
    const [conversationId, setConversationId] = useState(null);
    const [conversations, setConversations] = useState([]);
    const [messages, setMessages] = useState([welcomeMessage]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [loadingConversation, setLoadingConversation] = useState(false);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [listening, setListening] = useState(false);
    const [speakingIndex, setSpeakingIndex] = useState(null);
    const [autoSpeak, setAutoSpeak] = useState(localStorage.getItem('office-auto-speak') === 'true');
    const [speechLanguage, setSpeechLanguage] = useState(localStorage.getItem('office-speech-language') || 'en-US');
    const inputRef = useRef(null);
    const recognitionRef = useRef(null);

    const agent = useMemo(() => agents.find(item => item.agentId === agentId), [agents, agentId]);
    const speechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    const speechSynthesisAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window;

    const loadHistory = async () => {
        setLoadingHistory(true);
        try {
            const response = await api.get('/conversations');
            setConversations(response.data || []);
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not load conversation history.');
        } finally {
            setLoadingHistory(false);
        }
    };

    useEffect(() => { loadHistory(); }, []);
    useEffect(() => () => {
        recognitionRef.current?.abort?.();
        window.speechSynthesis?.cancel?.();
    }, []);

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
        const languagePrefix = speechLanguage.split('-')[0].toLowerCase();
        utterance.voice = voices.find(voice => voice.lang.toLowerCase() === speechLanguage.toLowerCase())
            || voices.find(voice => voice.lang.toLowerCase().startsWith(languagePrefix))
            || null;
        utterance.onend = () => setSpeakingIndex(null);
        utterance.onerror = () => setSpeakingIndex(null);
        setSpeakingIndex(index);
        window.speechSynthesis.speak(utterance);
    };

    const newConversation = (nextAgentId = agentId) => {
        recognitionRef.current?.abort?.();
        stopSpeech();
        setAgentId(nextAgentId);
        setConversationId(null);
        setMessages([{ ...welcomeMessage, content: `I am ${agents.find(item => item.agentId === nextAgentId)?.name || 'Nora'}. What should we work on?` }]);
        setInput('');
        inputRef.current?.focus();
    };

    const openConversation = async id => {
        if (loadingConversation || id === conversationId) return;
        setLoadingConversation(true);
        stopSpeech();
        try {
            const response = await api.get(`/conversations/${id}`);
            const conversation = response.data;
            setConversationId(conversation.conversationId);
            setAgentId(conversation.agentId || 'nora');
            setMessages(conversation.messages?.length ? conversation.messages : [welcomeMessage]);
            setInput('');
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not open that conversation.');
        } finally {
            setLoadingConversation(false);
        }
    };

    const toggleListening = () => {
        if (!speechRecognition) {
            toast.error('Speech recognition is not available in this browser. Chrome or Edge is recommended.');
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

    const send = async event => {
        event?.preventDefault();
        const text = input.trim();
        if (!text || sending) return;

        recognitionRef.current?.stop?.();
        const userMessage = { role: 'user', content: text, createdAt: new Date().toISOString() };
        setMessages(current => [...current, userMessage]);
        setInput('');
        setSending(true);

        try {
            const response = await api.post('/chat', {
                message: text,
                agentId,
                conversationId,
            });
            setConversationId(response.data.conversationId);
            setMessages(current => [...current, response.data.message]);
            await loadHistory();
            if (autoSpeak) speak(response.data.message.content, messages.length + 1);
        } catch (error) {
            const message = error.response?.data?.error || error.message;
            toast.error(message);
            setMessages(current => [...current, {
                role: 'assistant',
                content: `I could not complete that request: ${message}`,
                error: true,
            }]);
        } finally {
            setSending(false);
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
        <div className="chat-layout">
            <section className="chat-panel">
                <div className="page-header chat-header">
                    <div>
                        <div className="eyebrow">Primary interface</div>
                        <h1>{agent?.name || 'Nora'}</h1>
                        <p>{agent?.role || 'Chief of Staff'}</p>
                    </div>
                    <div className="header-actions">
                        <select value={agentId} onChange={event => newConversation(event.target.value)}>
                            {agents.filter(item => item.enabled).map(item => (
                                <option key={item.agentId} value={item.agentId}>{item.name}</option>
                            ))}
                        </select>
                        <button className="secondary-button" onClick={() => newConversation()}>
                            <IconPlus size={17} /> New chat
                        </button>
                    </div>
                </div>

                <div className="messages">
                    {loadingConversation && <div className="conversation-loading">Loading conversation…</div>}
                    {messages.map((message, index) => (
                        <article key={`${message.role}-${message.createdAt || index}`} className={`message message-${message.role} ${message.error ? 'message-error' : ''}`}>
                            <div className="message-avatar">
                                {message.role === 'assistant' ? (agent?.name?.[0] || 'N') : 'C'}
                            </div>
                            <div className="message-body">
                                <div className="message-meta">
                                    <strong>{message.role === 'assistant' ? (agent?.name || 'Nora') : 'Carlos'}</strong>
                                    {message.model && (
                                        <span>
                                            {message.model.provider} · {message.model.model}
                                            {message.model.fallbackUsed ? ' · offline fallback' : ''}
                                        </span>
                                    )}
                                    {message.role === 'assistant' && speechSynthesisAvailable && (
                                        <button
                                            className="message-audio-button"
                                            title={speakingIndex === index ? 'Stop reading' : 'Read response aloud'}
                                            onClick={() => speakingIndex === index ? stopSpeech() : speak(message.content, index)}
                                        >
                                            {speakingIndex === index ? <IconVolumeOff size={15} /> : <IconVolume size={15} />}
                                        </button>
                                    )}
                                </div>
                                <div className="message-content">{message.content}</div>
                                {!!message.toolEvents?.length && (
                                    <div className="tool-events">
                                        {message.toolEvents.map((tool, toolIndex) => (
                                            <details key={`${tool.name}-${toolIndex}`}>
                                                <summary><IconTool size={15} /> {tool.name} {tool.failed ? 'failed' : 'used'}</summary>
                                                <pre>{JSON.stringify({ args: tool.args, result: tool.result }, null, 2)}</pre>
                                            </details>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </article>
                    ))}
                    {sending && (
                        <article className="message message-assistant">
                            <div className="message-avatar">{agent?.name?.[0] || 'N'}</div>
                            <div className="message-body thinking"><span /><span /><span /></div>
                        </article>
                    )}
                </div>

                <form className="composer" onSubmit={send}>
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
                        rows={3}
                    />
                    <div className="composer-footer">
                        <span>{listening ? 'Listening… speak now' : 'Enter to send · Shift+Enter for a new line'}</span>
                        <div className="composer-actions">
                            <button type="button" className={`voice-button ${listening ? 'listening' : ''}`} onClick={toggleListening} title="Speak your message">
                                {listening ? <IconPlayerStop size={18} /> : <IconMicrophone size={18} />}
                            </button>
                            <button className="send-button" disabled={sending || !input.trim()}>
                                <IconArrowUp size={18} />
                            </button>
                        </div>
                    </div>
                </form>
            </section>

            <aside className="context-panel">
                <div className="context-card agent-focus">
                    <div className="agent-orb"><IconBrain size={28} /></div>
                    <div>
                        <div className="eyebrow">Active agent</div>
                        <h3>{agent?.name || 'Nora'}</h3>
                        <p>{agent?.role}</p>
                    </div>
                    <StatusBadge tone={agent?.enabled ? 'success' : 'danger'}>{agent?.enabled ? 'Enabled' : 'Disabled'}</StatusBadge>
                </div>

                <div className="context-card history-card">
                    <div className="card-title history-heading">
                        <span><IconHistory size={18} /> Conversations</span>
                        <button className="icon-button" onClick={loadHistory} disabled={loadingHistory} title="Refresh history"><IconRefresh size={15} /></button>
                    </div>
                    <div className="conversation-history">
                        {!conversations.length && <p className="muted-copy">No saved conversations yet.</p>}
                        {conversations.map(conversation => (
                            <button
                                key={conversation.conversationId}
                                className={`conversation-item ${conversationId === conversation.conversationId ? 'active' : ''}`}
                                onClick={() => openConversation(conversation.conversationId)}
                            >
                                <strong>{conversation.title}</strong>
                                <span>{agents.find(item => item.agentId === conversation.agentId)?.name || conversation.agentId} · {conversation.messageCount} messages</span>
                                <small>{dateLabel(conversation.updatedAt)}</small>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="context-card voice-card">
                    <div className="card-title"><IconVolume size={18} /> Voice</div>
                    <label className="voice-language">
                        <span>Recognition and reading language</span>
                        <select value={speechLanguage} onChange={event => changeSpeechLanguage(event.target.value)}>
                            {speechLanguages.map(language => <option key={language.value} value={language.value}>{language.label}</option>)}
                        </select>
                    </label>
                    <label className="voice-toggle">
                        <span>Read new replies aloud</span>
                        <input type="checkbox" checked={autoSpeak} onChange={event => changeAutoSpeak(event.target.checked)} />
                    </label>
                    <p className="voice-note">Speech output uses installed browser or operating-system voices. Microphone recognition may use the browser vendor's speech service.</p>
                </div>

                <div className="context-card">
                    <div className="card-title"><IconBolt size={18} /> Runtime</div>
                    <dl className="definition-list">
                        <div><dt>Provider</dt><dd>{agent?.provider || '—'}</dd></div>
                        <div><dt>Primary</dt><dd>{agent?.model || '—'}</dd></div>
                        <div><dt>Tool rounds</dt><dd>{agent?.maxToolRounds ?? '—'}</dd></div>
                        <div><dt>Offline fallback</dt><dd>{agent?.fallback?.enabled ? agent.fallback.model : 'Disabled'}</dd></div>
                    </dl>
                </div>

                <div className="context-card">
                    <div className="card-title"><IconRefresh size={18} /> Local services</div>
                    <div className="service-line">
                        <span>Office API</span>
                        <StatusBadge tone={health?.status === 'online' ? 'success' : 'danger'}>{health?.status || 'unknown'}</StatusBadge>
                    </div>
                    <div className="service-line">
                        <span>Ollama</span>
                        <StatusBadge tone={health?.ollama?.online ? 'success' : 'warning'}>{health?.ollama?.online ? 'online' : 'offline'}</StatusBadge>
                    </div>
                </div>
            </aside>
        </div>
    );
}
