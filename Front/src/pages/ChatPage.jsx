import { useEffect, useMemo, useRef, useState } from 'react';
import {
    IconArrowUp,
    IconArchive,
    IconCheck,
    IconCopy,
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
import ArtifactPreview from '../components/ArtifactPreview';
import MarkdownMessage from '../components/MarkdownMessage';
import StatusBadge from '../components/StatusBadge';
import { artifactsForConversation, artifactsForMessage } from '../lib/artifacts';
import useRuntimeEvents from '../hooks/useRuntimeEvents';

const MAX_FILES = 8;
const MAX_FILE_BYTES = 8_388_608;
const MAX_TOTAL_BYTES = 20_971_520;
const ARTIFACT_MIN_WIDTH = 320;
const ARTIFACT_DEFAULT_WIDTH = 460;
const ACTIVE_CONVERSATION_KEY = 'office-active-conversation';

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
const QUALITY_DIMENSIONS = ['completeness', 'relevance', 'correctness', 'evidence', 'contract'];
const initialArtifactWidth = () => {
    const saved = Number(localStorage.getItem('office-chat-artifact-width'));
    return Number.isFinite(saved) ? Math.max(ARTIFACT_MIN_WIDTH, Math.min(saved, 720)) : ARTIFACT_DEFAULT_WIDTH;
};

function JobActivityCard({ job, agents = [], onRefresh }) {
    const [open, setOpen] = useState(true);
    const [score, setScore] = useState(job?.carlosAssessment?.score ?? 95);
    const [comments, setComments] = useState(job?.carlosAssessment?.comments || '');
    const [dimensions, setDimensions] = useState(() => Object.fromEntries(QUALITY_DIMENSIONS.map(name => [name, job?.carlosAssessment?.dimensions?.[name] ?? job?.finalAssessment?.dimensions?.[name] ?? 95])));
    const [humanInput, setHumanInput] = useState('');
    if (!job) return null;
    const done = (job.tasks || []).filter(task => task.state === 'completed').length;
    const progress = job.tasks?.length ? Math.round(done / job.tasks.length * 100) : 0;
    const needsCarlos = ['paused', 'waiting_authorization', 'failed'].includes(job.status);
    const waitingTask = (job.tasks || []).find(task => task.state === 'waiting_human');
    const artifacts = (job.tasks || []).flatMap(task => task.artifacts || []);
    const act = async (action, details = {}) => {
        try {
            if (action === 'retry') await api.post(`/jobs/${job.jobId}/run`);
            else if (action === 'cancel') await api.post(`/jobs/${job.jobId}/stop`);
            else await api.post(`/jobs/${job.jobId}/action`, { action, ...details });
            await onRefresh();
        } catch (error) { toast.error(error.response?.data?.error || error.message); }
    };
    const assess = async decision => {
        try { await api.post(`/jobs/${job.jobId}/assessment`, { score: Number(score), dimensions, comments, decision }); toast.success(`Job ${decision === 'accept' ? 'accepted' : decision}.`); await onRefresh(); }
        catch (error) { toast.error(error.response?.data?.error || error.message); }
    };
    const provideInput = async approved => {
        try { await api.post(`/jobs/${job.jobId}/input`, { taskId: waitingTask?.taskId, value: humanInput, approved }); setHumanInput(''); await onRefresh(); }
        catch (error) { toast.error(error.response?.data?.error || error.message); }
    };
    return <section className={`chat-job is-${job.status}`}>
        <button className="chat-job__summary" onClick={() => setOpen(value => !value)}>
            <i className="chat-job__pulse" /><span><strong>{job.name}</strong><small>{job.status.replaceAll('_', ' ')} · {done}/{job.tasks?.length || 0} tasks · process v{job.processVersion}</small></span>
            <div className="chat-job__quality"><em>{job.finalAssessment?.score ?? progress}</em><small>{job.finalAssessment ? 'quality' : 'progress'}</small></div><b>{open ? '−' : '+'}</b>
        </button>
        {open && <div className="chat-job__body">
            <div className="chat-job__bar"><span style={{ width: `${progress}%` }} /></div>
            <div className="chat-job__controls"><span>Priority {job.priority || 0} · created {new Date(job.createdAt).toLocaleString()}</span><div>{['queued', 'running'].includes(job.status) && <button onClick={() => act('pause')}>Pause</button>}{['paused', 'failed', 'waiting_authorization'].includes(job.status) && <button onClick={() => act('retry')}>Retry</button>}<button onClick={() => act('restart')}>Restart v{job.processVersion}</button><button onClick={() => act('migrate')}>Migrate latest</button>{!['cancelled', 'completed'].includes(job.status) && <button className="is-danger" onClick={() => act('cancel')}>Cancel</button>}</div></div>
            {(job.tasks || []).map(task => <article key={task.taskId} className={`is-${task.state}`}>
                <i>{task.agentId ? task.agentId[0].toUpperCase() : '•'}</i><span><strong>{task.name}</strong><small>{task.agentId || 'system'} · {task.state.replaceAll('_', ' ')}{task.attempts?.length ? ` · attempt ${task.attempts.length}` : ''}{task.startedAt ? ` · ${new Date(task.startedAt).toLocaleTimeString()}` : ''}</small>{task.resultSummary && <p>{task.resultSummary}</p>}{task.error && <p className="error">{task.error}</p>}
                    {!!task.attempts?.length && <details className="chat-job__attempts"><summary>Attempts and tool activity</summary>{task.attempts.map(attempt => <section key={attempt.attemptId}><strong>Attempt {attempt.number} · {attempt.state}</strong>{attempt.model?.model && <small>{attempt.model.provider} · {attempt.model.model}</small>}{(attempt.toolActivity || []).map((tool, index) => <div key={`${tool.toolName}-${index}`}><b>{index + 1}. {tool.toolName}</b><em>{tool.state}</em>{tool.error && <p className="error">{tool.error}</p>}<details><summary>Redacted result</summary><pre>{tool.result || 'No result retained.'}</pre></details></div>)}</section>)}</details>}
                </span>
                <div className="task-quality">{task.inputQuality && <em title="Input quality">In {task.inputQuality.score}</em>}{task.outputQuality && <em title="Output quality">Out {task.outputQuality.score}</em>}</div>
                {task.type === 'agent-task' && ['failed', 'paused', 'blocked', 'waiting_human', 'interrupted'].includes(task.state) && <div className="chat-job__task-actions"><button onClick={() => act('skip', { taskId: task.taskId, reason: 'Skipped by Carlos from the conversation activity card.' })}>Skip task</button>{agents.filter(item => item.enabled && item.agentId !== task.agentId).map(item => <button key={item.agentId} onClick={() => act('reassign', { taskId: task.taskId, agentId: item.agentId })}>Reassign to {item.name}</button>)}</div>}
            </article>)}
            {!!artifacts.length && <div className="chat-job__artifacts"><strong>Artifacts</strong>{artifacts.map(item => <span key={item.artifactId}>{item.title || item.name}</span>)}</div>}
            {needsCarlos && <div className="chat-job__blocked"><strong>Nora needs you to unblock this job.</strong><span>{job.status === 'waiting_authorization' ? 'Review the exact requested scope in Authorizations. Approval resumes this job automatically.' : waitingTask ? waitingTask.error || 'Provide the requested input or decision.' : 'Review the failed quality gate, then retry or cancel.'}</span>{waitingTask && <input value={humanInput} onChange={event => setHumanInput(event.target.value)} placeholder="Your decision or missing input" />}<div>{waitingTask ? <><button className="primary-button" onClick={() => provideInput(true)}>Continue</button><button className="secondary-button" onClick={() => provideInput(false)}>Decline</button></> : job.status !== 'waiting_authorization' && <button className="primary-button" onClick={() => act('retry')}>Retry / resume</button>}<button className="secondary-button" onClick={() => act('cancel')}>Cancel job</button></div></div>}
            {job.status === 'completed' && <div className="chat-job__handover"><strong>Nora quality assessment: {job.finalAssessment?.score || '—'}/100</strong><span>{job.finalAssessment?.passed ? 'Ready for Carlos’s assessment.' : 'Below the final threshold; the work remains unfinished.'}</span>
                {!!job.finalAssessment?.dimensions && <div className="chat-job__dimensions">{Object.entries(job.finalAssessment.dimensions).map(([name, value]) => <span key={name}><small>{name}</small><b>{value}</b></span>)}</div>}
                <div className="carlos-assessment"><strong>Your assessment</strong><div className="carlos-assessment__dimensions">{QUALITY_DIMENSIONS.map(name => <label key={name}><span>{name}</span><input type="number" min="0" max="100" value={dimensions[name]} onChange={event => setDimensions(current => ({ ...current, [name]: Math.max(0, Math.min(Number(event.target.value) || 0, 100)) }))} /></label>)}</div><label><span>Overall score</span><input type="number" min="0" max="100" value={score} onChange={event => setScore(event.target.value)} /></label><label><span>Comments</span><input value={comments} onChange={event => setComments(event.target.value)} placeholder="Optional handover feedback" /></label><div><button className="primary-button" onClick={() => assess('accept')}>Accept</button><button className="secondary-button" onClick={() => assess('revise')}>Revise</button><button className="secondary-button" onClick={() => assess('reopen')}>Reopen</button></div></div>
            </div>}
        </div>}
    </section>;
}

export default function ChatPage({ agents, health, openRequest }) {
    const [agentId, setAgentId] = useState('nora');
    const [conversationId, setConversationId] = useState(null);
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
    const [ghostMessages, setGhostMessages] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [listening, setListening] = useState(false);
    const [speaking, setSpeaking] = useState(null);
    const [language, setLanguage] = useState(localStorage.getItem('office-speech-language') || 'en-US');
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [purgeTarget, setPurgeTarget] = useState(null);
    const [copiedResponse, setCopiedResponse] = useState(null);
    const [activeArtifactId, setActiveArtifactId] = useState('');
    const [artifactWidth, setArtifactWidth] = useState(initialArtifactWidth);
    const [jobs, setJobs] = useState([]);
    const [historyMode, setHistoryMode] = useState('active');
    const [editTarget, setEditTarget] = useState(null);

    const textareaRef = useRef(null);
    const fileRef = useRef(null);
    const messagesRef = useRef(null);
    const workspaceRef = useRef(null);
    const requestRef = useRef(null);
    const recognitionRef = useRef(null);
    const copyTimerRef = useRef(null);

    const agent = useMemo(() => agents.find(item => item.agentId === agentId), [agents, agentId]);
    const filtered = useMemo(() => {
        const query = search.trim().toLowerCase();
        return conversations.filter(item => !query || item.title.toLowerCase().includes(query) || item.agentId.toLowerCase().includes(query));
    }, [conversations, search]);
    const conversationArtifacts = useMemo(() => artifactsForConversation(messages, agentId), [messages, agentId]);
    const activeArtifact = useMemo(() => conversationArtifacts.find(item => item.artifactId === activeArtifactId) || null, [conversationArtifacts, activeArtifactId]);
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
        try { setConversations((await api.get('/conversations', { params: { limit: 300, lifecycle: historyMode } })).data || []); }
        catch (error) { if (!quiet) toast.error(error.response?.data?.error || 'Could not load conversations.'); }
        finally { if (!quiet) setLoadingHistory(false); }
    };
    useEffect(() => { loadHistory({ quiet: true }); }, [historyMode]);
    const loadJobs = async (id = conversationId) => {
        if (!id) return setJobs([]);
        try { setJobs((await api.get('/jobs', { params: { conversationId: id, limit: 100 } })).data || []); } catch {}
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
    const copyResponse = async (text, index) => {
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(String(text || ''));
            else {
                const helper = document.createElement('textarea');
                helper.value = String(text || '');
                helper.style.position = 'fixed';
                helper.style.opacity = '0';
                document.body.appendChild(helper);
                helper.select();
                document.execCommand('copy');
                helper.remove();
            }
            setCopiedResponse(index);
            clearTimeout(copyTimerRef.current);
            copyTimerRef.current = setTimeout(() => setCopiedResponse(null), 1600);
        } catch {
            toast.error('Could not copy the response.');
        }
    };
    const artifactMaxWidth = () => {
        const workspaceWidth = workspaceRef.current?.clientWidth || window.innerWidth;
        return Math.max(ARTIFACT_MIN_WIDTH, Math.min(720, workspaceWidth - 340));
    };
    const updateArtifactWidth = value => {
        const next = Math.max(ARTIFACT_MIN_WIDTH, Math.min(Number(value) || ARTIFACT_DEFAULT_WIDTH, artifactMaxWidth()));
        setArtifactWidth(next);
        return next;
    };
    const startArtifactResize = event => {
        if (window.innerWidth < 900) return;
        const startX = event.clientX;
        const startWidth = artifactWidth;
        const move = pointerEvent => updateArtifactWidth(startWidth - (pointerEvent.clientX - startX));
        const end = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            localStorage.setItem('office-chat-artifact-width', String(Math.round(artifactWidth)));
            document.body.classList.remove('is-resizing-chat-artifact');
        };
        document.body.classList.add('is-resizing-chat-artifact');
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end, { once: true });
        event.preventDefault();
    };
    const resizeArtifactByKeyboard = event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const direction = event.key === 'ArrowLeft' ? 32 : -32;
        const next = updateArtifactWidth(artifactWidth + direction);
        localStorage.setItem('office-chat-artifact-width', String(Math.round(next)));
    };

    useEffect(() => {
        loadHistory();
        const activeConversation = sessionStorage.getItem(ACTIVE_CONVERSATION_KEY);
        if (activeConversation) openConversation(activeConversation, { quiet: true });
    }, []);
    useEffect(() => {
        if (!historyOpen) return undefined;
        const timer = setInterval(() => { if (!document.hidden) loadHistory({ quiet: true }); }, 60_000);
        return () => clearInterval(timer);
    }, [historyOpen]);
    useEffect(() => { scrollBottom(); }, [messages.length, ghostMessages.length, sending]);
    useEffect(() => {
        if (activeArtifactId && !conversationArtifacts.some(item => item.artifactId === activeArtifactId)) setActiveArtifactId('');
    }, [conversationArtifacts, activeArtifactId]);
    useEffect(() => {
        if (openRequest?.conversationId) openConversation(openRequest.conversationId);
    }, [openRequest?.token]);
    useEffect(() => {
        const resize = () => activeArtifactId && updateArtifactWidth(artifactWidth);
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, [activeArtifactId, artifactWidth]);
    useEffect(() => () => {
        requestRef.current?.abort();
        recognitionRef.current?.abort?.();
        window.speechSynthesis?.cancel?.();
        clearTimeout(copyTimerRef.current);
        document.body.classList.remove('is-resizing-chat-artifact');
    }, []);

    const startNew = () => {
        if (sending) return toast.message('Stop the current response first.');
        sessionStorage.removeItem(ACTIVE_CONVERSATION_KEY);
        setAgentId('nora');
        setConversationId(null);
        setTitle('New conversation');
        setMessages([welcome('Nora')]);
        setGhostMessages([]);
        setInput('');
        setFiles([]);
        setEditingTitle(false);
        setHistoryOpen(false);
        setActiveArtifactId('');
        setJobs([]);
        textareaRef.current?.focus();
        resizeComposer();
    };

    const openConversation = async (id, { quiet = false } = {}) => {
        if (!id || sending) return;
        try {
            const record = (await api.get(`/conversations/${encodeURIComponent(id)}`)).data;
            setConversationId(record.conversationId);
            sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, record.conversationId);
            setTitle(record.title || 'Conversation');
            setAgentId('nora');
            setMessages(record.messages?.length ? record.messages : [welcome('Nora')]);
            setGhostMessages([]);
            setInput('');
            setFiles([]);
            setEditingTitle(false);
            setHistoryOpen(false);
            setActiveArtifactId('');
            await loadJobs(record.conversationId);
            scrollBottom();
        } catch (error) {
            sessionStorage.removeItem(ACTIVE_CONVERSATION_KEY);
            if (!quiet) toast.error(error.response?.data?.error || 'Could not open conversation.');
        }
    };

    useRuntimeEvents(async () => {
        if (!conversationId || document.hidden) return;
        try {
            await loadJobs(conversationId);
        } catch {}
    }, { conversationId, fallbackMs: 5_000 });
    useEffect(() => {
        if (!conversationId) return undefined;
        const timer = window.setInterval(() => { if (!document.hidden) loadJobs(conversationId); }, 3_000);
        return () => window.clearInterval(timer);
    }, [conversationId]);

    const rename = async () => {
        const next = titleDraft.trim();
        if (!conversationId || !next) return;
        try {
            const record = (await api.put(`/conversations/${encodeURIComponent(conversationId)}`, { title: next })).data;
            setTitle(record.title);
            setEditingTitle(false);
            await loadHistory({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not rename conversation.');
        }
    };

    const removeConversation = async () => {
        if (!deleteTarget) return;
        try {
            await api.delete(`/conversations/${encodeURIComponent(deleteTarget.conversationId)}`);
            if (deleteTarget.conversationId === conversationId) startNew();
            setDeleteTarget(null);
            await loadHistory({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not delete conversation.');
        }
    };
    const restoreConversation = async item => {
        try { await api.post(`/conversations/${encodeURIComponent(item.conversationId)}/restore`); toast.success('Conversation restored.'); await loadHistory({ quiet: true }); }
        catch (error) { toast.error(error.response?.data?.error || 'Could not restore conversation.'); }
    };
    const purgeConversation = async () => {
        if (!purgeTarget) return;
        try { await api.delete(`/conversations/${encodeURIComponent(purgeTarget.conversationId)}/purge`); if (purgeTarget.conversationId === conversationId) startNew(); toast.success('Conversation permanently purged.'); setPurgeTarget(null); await loadHistory({ quiet: true }); }
        catch (error) { toast.error(error.response?.data?.error || 'Could not purge conversation.'); }
    };
    const editMessage = async item => {
        setEditTarget({ message: item, draft: item.content, impact: null, loading: true });
        try { const impact = (await api.get(`/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(item.messageId)}/edit-impact`)).data; setEditTarget(current => current ? { ...current, impact, loading: false } : null); }
        catch (error) { toast.error(error.response?.data?.error || 'Could not calculate edit impact.'); setEditTarget(null); }
    };
    const confirmEdit = async () => {
        if (!editTarget?.draft?.trim() || editTarget.draft.trim() === editTarget.message.content) return setEditTarget(null);
        try { const record = (await api.patch(`/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(editTarget.message.messageId)}`, { content: editTarget.draft.trim() })).data; setMessages(record.messages || []); setEditTarget(null); await loadJobs(conversationId); await loadHistory({ quiet: true }); }
        catch (error) { toast.error(error.response?.data?.error || 'Could not edit message.'); }
    };
    const archiveConversation = async item => {
        try { await api.post(`/conversations/${encodeURIComponent(item.conversationId)}/archive`); if (item.conversationId === conversationId) startNew(); toast.success('Conversation archived.'); await loadHistory({ quiet: true }); }
        catch (error) { toast.error(error.response?.data?.error || 'Could not archive conversation.'); }
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
        const requestId = crypto.randomUUID();
        const pendingAttachments = files.map(file => ({ name: file.name, size: file.size, local: true }));
        const optimistic = { requestId, role: 'user', content: message || 'Review the attached files.', attachments: pendingAttachments, createdAt: new Date().toISOString() };

        setConversationId(id);
        sessionStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
        setMessages(current => [...current.filter(item => item.model?.model !== 'not invoked yet'), optimistic]);
        setInput('');
        setFiles([]);
        setSending(true);
        setGhostMessages([]);
        resizeComposer();

        const controller = new AbortController();
        requestRef.current = controller;
        try {
            const attachments = await Promise.all(files.map(item => filePayload(item.file)));
            const response = await api.post('/chat', { requestId, conversationId: id, agentId, message, attachments }, { signal: controller.signal, timeout: 0 });
            const responseMessage = response.data.message;
            setTitle(response.data.conversation?.title || title);
            setMessages(current => [...current.map(item => item.requestId === requestId && item.role === 'user' ? response.data.userMessage || item : item), ...(responseMessage ? [responseMessage] : [])]);
            if (response.data.jobs?.length) setJobs(current => [...response.data.jobs, ...current.filter(job => !response.data.jobs.some(item => item.jobId === job.jobId))]);
            else if (response.data.job) setJobs(current => [response.data.job, ...current.filter(job => job.jobId !== response.data.job.jobId)]);
            setGhostMessages([]);
            // Generated artifacts open only when Carlos selects their inline link or artifact card.
            await loadHistory({ quiet: true });
        } catch (error) {
            if (cancelled(error)) {
                toast.message('Response stopped. The message remains in the saved conversation.');
                await loadHistory({ quiet: true });
            } else {
                toast.error(error.response?.data?.error || error.message);
                if (error.response?.data?.message) setMessages(current => [...current, error.response.data.message]);
            }
        } finally {
            requestRef.current = null;
            setSending(false);
            setGhostMessages([]);
        }
    };

    return (
        <div className={`chat ${historyOpen ? 'chat--history-open' : ''} ${activeArtifact ? 'chat--artifact-open' : ''}`}>
            <aside className="chat__history" aria-label="Conversation history">
                <div className="chat__history-header">
                    <div><strong>Chats</strong><small>Chats save automatically</small></div>
                    <div className="chat__history-actions">
                        <button type="button" onClick={() => loadHistory()} aria-label="Refresh conversations" title="Refresh"><IconRefresh size={17} /></button>
                        <button type="button" onClick={() => startNew()} aria-label="New conversation" title="New conversation"><IconPlus size={18} /></button>
                        <button type="button" className="chat__history-close" onClick={() => setHistoryOpen(false)} aria-label="Close conversation history"><IconX size={18} /></button>
                    </div>
                </div>

                <label className="chat__search">
                    <IconSearch size={16} />
                    <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search chats" />
                </label>
                <div className="chat__history-tabs"><button className={historyMode === 'active' ? 'is-active' : ''} onClick={() => setHistoryMode('active')}>Active</button><button className={historyMode === 'archived' ? 'is-active' : ''} onClick={() => setHistoryMode('archived')}>Archived</button><button className={historyMode === 'trash' ? 'is-active' : ''} onClick={() => setHistoryMode('trash')}>Trash</button></div>

                <div className="chat__conversation-list">
                    {loadingHistory && <p className="chat__empty-copy">Loading…</p>}
                    {!loadingHistory && !filtered.length && <p className="chat__empty-copy">No conversations yet.</p>}
                    {filtered.map(item => (
                        <div key={item.conversationId} className={`chat__conversation ${item.conversationId === conversationId ? 'chat__conversation--active' : ''}`}>
                            <button type="button" className="chat__conversation-open" onClick={() => openConversation(item.conversationId)} disabled={sending}>
                                <strong>{item.title}</strong>
                                <span>{new Date(item.updatedAt).toLocaleDateString()} · {item.messageCount} messages · {item.channel || 'chat'}</span>
                            </button>
                            {historyMode === 'active' ? <div className="chat__conversation-row-actions"><button type="button" onClick={() => archiveConversation(item)} aria-label={`Archive ${item.title}`}><IconArchive size={14} /></button><button type="button" onClick={() => setDeleteTarget(item)} aria-label={`Move ${item.title} to Trash`}><IconTrash size={14} /></button></div> : historyMode === 'archived' ? <div className="chat__conversation-trash-actions"><button type="button" onClick={() => restoreConversation(item)}>Restore</button><button type="button" onClick={() => setDeleteTarget(item)}>Trash</button></div> : <div className="chat__conversation-trash-actions"><button type="button" onClick={() => restoreConversation(item)}>Restore</button><button type="button" onClick={() => setPurgeTarget(item)}>Purge</button></div>}
                        </div>
                    ))}
                </div>
            </aside>

            <section className="chat__main">
                <header className="chat__header">
                    <div className="chat__header-leading">
                        <button type="button" className="chat__history-toggle" onClick={() => setHistoryOpen(current => !current)} aria-label="Open conversation history"><IconHistory size={19} /></button>
                        <div className="chat__identity">
                            <span className="chat__agent-label">{agent?.name || 'Nora'} · {agent?.role || 'Chief of Staff'}</span>
                            {editingTitle ? (
                                <div className="chat__title-editor">
                                    <input value={titleDraft} onChange={event => setTitleDraft(event.target.value)} onKeyDown={event => event.key === 'Enter' && rename()} autoFocus />
                                    <button type="button" onClick={rename}>Save</button>
                                    <button type="button" onClick={() => setEditingTitle(false)} aria-label="Cancel rename"><IconX size={16} /></button>
                                </div>
                            ) : (
                                <div className="chat__title">
                                    <h1>{title}</h1>
                                    <span className="chat__retention chat__retention--saved">Auto-saved</span>
                                    {conversationId && (
                                        <button type="button" onClick={() => { setTitleDraft(title); setEditingTitle(true); }} aria-label="Rename conversation"><IconPencil size={14} /></button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="chat__header-actions">
                        <StatusBadge tone={health?.ollama?.online ? 'success' : 'warning'}>{health?.ollama?.online ? 'Ollama online' : 'Ollama offline'}</StatusBadge>
                        <select className="chat__language" value={language} onChange={event => { setLanguage(event.target.value); localStorage.setItem('office-speech-language', event.target.value); }} aria-label="Voice language">
                            {languages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <button type="button" className="chat__new" onClick={() => startNew()} disabled={sending}><IconPlus size={16} /><span>New</span></button>
                    </div>
                </header>

                <div className="chat__workspace" ref={workspaceRef} style={{ '--chat-artifact-width': `${artifactWidth}px` }}>
                    <div className="chat__scroll" ref={messagesRef}>
                        <div className="chat__thread">
                            {messages.map((item, index) => {
                                const previous = messages[index - 1];
                                const showDay = !previous || dayKey(previous.createdAt) !== dayKey(item.createdAt);
                                const isUser = item.role === 'user';
                                const messageArtifacts = isUser ? [] : artifactsForMessage(item, agentId);
                                const attachedJobs = jobs.filter(job => (
                                    job.originatingMessageId === item.messageId
                                    || (!job.originatingMessageId && isUser && job.requestId === item.requestId)
                                ));
                                return (
                                    <div className="chat__turn-group" key={`${item.createdAt}-${index}`}>
                                        {showDay && <div className="chat__day"><span>{dayLabel(item.createdAt)}</span></div>}
                                        <article className={`chat__turn chat__turn--${isUser ? 'user' : 'assistant'} ${item.error ? 'chat__turn--error' : ''}`}>
                                            <div className="chat__turn-meta">
                                                <strong>{isUser ? 'Carlos' : agent?.name || 'Nora'}</strong>
                                                <span>{formatTime(item.createdAt)}</span>
                                                {item.model?.model && item.model.model !== 'not invoked yet' && <span>{item.model.provider} · {item.model.model}</span>}
                                                {isUser && item.messageId && <button type="button" onClick={() => editMessage(item)} aria-label="Edit message" title="Edit message and delete later history"><IconPencil size={14} /></button>}
                                                {!isUser && (
                                                    <div className="chat__turn-actions">
                                                        <button type="button" onClick={() => copyResponse(item.content, index)} aria-label="Copy response" title="Copy response">
                                                            {copiedResponse === index ? <IconCheck size={15} /> : <IconCopy size={15} />}
                                                        </button>
                                                        <button type="button" onClick={() => speaking === index ? stopSpeech() : speak(item.content, index)} aria-label="Read response aloud" title="Read response aloud">
                                                            {speaking === index ? <IconPlayerStop size={15} /> : <IconVolume size={15} />}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="chat__turn-body">{isUser ? <div className="chat__user-bubble">{item.content}</div> : <MarkdownMessage content={item.content} artifacts={messageArtifacts} onArtifactSelect={setActiveArtifactId} />}</div>

                                            {!!messageArtifacts.length && (
                                                <div className="chat__artifacts" aria-label="Generated artifacts">
                                                    {messageArtifacts.map(artifact => (
                                                        <button type="button" key={artifact.artifactId} className={activeArtifactId === artifact.artifactId ? 'chat__artifact-link chat__artifact-link--active' : 'chat__artifact-link'} onClick={() => setActiveArtifactId(artifact.artifactId)}>
                                                            <IconFile size={16} />
                                                            <span><strong>{artifact.title || artifact.name}</strong><small>{artifact.previewKind} · {artifact.source}</small></span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}

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
                                            {attachedJobs.map(job => <JobActivityCard key={job.jobId} job={job} agents={agents} onRefresh={() => loadJobs(conversationId)} />)}
                                        </article>
                                    </div>
                                );
                            })}

                            {sending && ghostMessages.map(item => (
                                <article className="chat__ghost" key={item.eventId} aria-live="polite">
                                    <span className={`chat__ghost-dot chat__ghost-dot--${item.tone || 'info'}`} />
                                    <div><strong>{item.from === 'carlos' ? 'Carlos' : String(item.from || 'office').replace(/^./, value => value.toUpperCase())}</strong><p>{item.summary}</p></div>
                                </article>
                            ))}

                            {sending && (
                                <article className="chat__turn chat__turn--assistant chat__turn--thinking">
                                    <div className="chat__thinking" aria-label={`${agent?.name || 'Nora'} is responding`}><span /><span /><span /></div>
                                </article>
                            )}
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
                                    aria-label={`Message ${agent?.name || 'Nora'}`}
                                    placeholder="Message Nora…"
                                />
                                <div className="chat__composer-toolbar">
                                    <div className="chat__composer-tools">
                                        <input ref={fileRef} type="file" multiple hidden onChange={chooseFiles} />
                                        <button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach files"><IconPaperclip size={19} /></button>
                                        <button type="button" className={listening ? 'chat__composer-tool--active' : ''} onClick={toggleListening} aria-label="Dictate message">{listening ? <IconPlayerStop size={19} /> : <IconMicrophone size={19} />}</button>
                                        <span className="chat__composer-context">Nora · saved chat</span>
                                    </div>
                                    {sending ? (
                                        <button type="button" className="chat__stop" onClick={stopResponse} aria-label="Stop response"><IconPlayerStop size={18} /></button>
                                    ) : (
                                        <button type="submit" className="chat__send" disabled={!input.trim() && !files.length} aria-label="Send message"><IconArrowUp size={19} /></button>
                                    )}
                                </div>
                            </form>
                            <p className="chat__composer-hint">Saved to Obsidian · Enter to send · Shift+Enter for a new line</p>
                        </div>
                    </div>

                    {activeArtifact && (
                        <>
                            <div
                                className="chat__artifact-splitter"
                                role="separator"
                                aria-label="Resize artifact preview"
                                aria-orientation="vertical"
                                tabIndex={0}
                                onPointerDown={startArtifactResize}
                                onKeyDown={resizeArtifactByKeyboard}
                            ><span /></div>
                            <ArtifactPreview
                                artifact={activeArtifact}
                                artifacts={conversationArtifacts}
                                onSelect={setActiveArtifactId}
                                onClose={() => setActiveArtifactId('')}
                            />
                        </>
                    )}
                </div>

            </section>

            {historyOpen && <button type="button" className="chat__history-backdrop" onClick={() => setHistoryOpen(false)} aria-label="Close conversation history" />}

            {deleteTarget && (
                <div className="dialog" onMouseDown={event => event.target === event.currentTarget && setDeleteTarget(null)}>
                    <section className="dialog__panel dialog__panel--danger" role="dialog" aria-modal="true">
                        <h2>Move conversation to Trash?</h2>
                        <p><strong>{deleteTarget.title}</strong> will be hidden from Active chats. You can restore it or permanently purge all linked records later.</p>
                        <div className="dialog__actions">
                            <button type="button" className="button button--secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
                            <button type="button" className="button button--danger" onClick={removeConversation}><IconTrash size={16} /> Move to Trash</button>
                        </div>
                    </section>
                </div>
            )}
            {purgeTarget && (
                <div className="dialog" onMouseDown={event => event.target === event.currentTarget && setPurgeTarget(null)}>
                    <section className="dialog__panel dialog__panel--danger" role="dialog" aria-modal="true">
                        <span className="eyebrow">Permanent deletion</span><h2>Purge this conversation?</h2>
                        <p><strong>{purgeTarget.title}</strong>, its messages, internal context, linked jobs, tasks, attempts, assessments, identifiable events, private artifacts, and attachments will be deleted. Every reference will return 404. Anonymous aggregate counters remain.</p>
                        <div className="dialog__actions"><button className="button button--secondary" onClick={() => setPurgeTarget(null)}>Cancel</button><button className="button button--danger" onClick={purgeConversation}><IconTrash size={16} /> Permanently purge</button></div>
                    </section>
                </div>
            )}
            {editTarget && (
                <div className="dialog" onMouseDown={event => event.target === event.currentTarget && setEditTarget(null)}>
                    <section className="dialog__panel chat-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-message-title">
                        <span className="eyebrow">Destructive history edit</span><h2 id="edit-message-title">Edit this request?</h2>
                        <p>The original message is replaced. Everything downstream is deleted rather than branched, while completed external side effects may still exist.</p>
                        <textarea rows="6" value={editTarget.draft} onChange={event => setEditTarget(current => ({ ...current, draft: event.target.value }))} autoFocus />
                        {editTarget.loading ? <p>Calculating exact impact…</p> : <div className="chat-edit-dialog__impact">{[['Later messages', editTarget.impact?.laterMessages], ['Jobs', editTarget.impact?.jobs], ['Tasks', editTarget.impact?.tasks], ['Attempts', editTarget.impact?.attempts], ['Assessments', editTarget.impact?.assessments], ['Artifacts', editTarget.impact?.artifacts]].map(([name, value]) => <span key={name}><strong>{value || 0}</strong><small>{name}</small></span>)}</div>}
                        {!!editTarget.impact?.externalActionWarning && <div className="chat-edit-dialog__warning">{editTarget.impact.externalActionWarning}</div>}
                        <div className="dialog__actions"><button className="button button--secondary" onClick={() => setEditTarget(null)}>Cancel</button><button className="button button--danger" disabled={editTarget.loading || !editTarget.draft.trim()} onClick={confirmEdit}>Edit and delete downstream work</button></div>
                    </section>
                </div>
            )}
        </div>
    );
}
