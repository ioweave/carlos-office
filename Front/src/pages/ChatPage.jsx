import { useMemo, useRef, useState } from 'react';
import {
    IconArrowUp,
    IconBolt,
    IconBrain,
    IconPlus,
    IconRefresh,
    IconTool,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';
import StatusBadge from '../components/StatusBadge';

const welcomeMessage = {
    role: 'assistant',
    content: 'I am Nora. Give me an objective, ask for research, or have me queue work for Marco, Luma, or Dex.',
    model: { provider: 'local', model: 'not invoked yet' },
};

export default function ChatPage({ agents, health }) {
    const [agentId, setAgentId] = useState('nora');
    const [conversationId, setConversationId] = useState(null);
    const [messages, setMessages] = useState([welcomeMessage]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const inputRef = useRef(null);

    const agent = useMemo(() => agents.find(item => item.agentId === agentId), [agents, agentId]);

    const newConversation = () => {
        setConversationId(null);
        setMessages([welcomeMessage]);
        setInput('');
        inputRef.current?.focus();
    };

    const send = async event => {
        event?.preventDefault();
        const text = input.trim();
        if (!text || sending) return;

        const userMessage = { role: 'user', content: text };
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
                        <select value={agentId} onChange={event => setAgentId(event.target.value)}>
                            {agents.filter(item => item.enabled).map(item => (
                                <option key={item.agentId} value={item.agentId}>{item.name}</option>
                            ))}
                        </select>
                        <button className="secondary-button" onClick={newConversation}>
                            <IconPlus size={17} /> New chat
                        </button>
                    </div>
                </div>

                <div className="messages">
                    {messages.map((message, index) => (
                        <article key={`${message.role}-${index}`} className={`message message-${message.role} ${message.error ? 'message-error' : ''}`}>
                            <div className="message-avatar">
                                {message.role === 'assistant' ? (agent?.name?.[0] || 'N') : 'C'}
                            </div>
                            <div className="message-body">
                                <div className="message-meta">
                                    <strong>{message.role === 'assistant' ? (agent?.name || 'Nora') : 'Carlos'}</strong>
                                    {message.model && <span>{message.model.provider} · {message.model.model}</span>}
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
                        <span>Enter to send · Shift+Enter for a new line</span>
                        <button className="send-button" disabled={sending || !input.trim()}>
                            <IconArrowUp size={18} />
                        </button>
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

                <div className="context-card">
                    <div className="card-title"><IconBolt size={18} /> Runtime</div>
                    <dl className="definition-list">
                        <div><dt>Provider</dt><dd>{agent?.provider || '—'}</dd></div>
                        <div><dt>Model</dt><dd>{agent?.model || '—'}</dd></div>
                        <div><dt>Tool rounds</dt><dd>{agent?.maxToolRounds ?? '—'}</dd></div>
                        <div><dt>Fallback</dt><dd>{agent?.fallback?.enabled ? 'Enabled' : 'Disabled'}</dd></div>
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
