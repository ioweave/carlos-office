import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconBriefcase2, IconPlayerPlay, IconPlayerStop, IconRefresh, IconSearch, IconTrash } from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';
import StatusBadge from '../components/StatusBadge';

const ACTIVE = new Set(['queued', 'running', 'qc_review']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const label = value => String(value || 'unknown').replaceAll('_', ' ');
const tone = value => ({ queued: 'info', running: 'warning', qc_review: 'warning', awaiting_approval: 'warning', completed: 'success', failed: 'danger', cancelled: 'neutral' }[value] || 'neutral');
const date = value => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};
const model = value => value?.model ? `${value.provider || 'model'} · ${value.model}${value.fallbackUsed ? ' · fallback' : ''}` : 'Not recorded';

const runtimeStatus = (job, active, queue) => active.has(job.jobId)
    ? active.get(job.jobId)?.stage === 'reviewing' ? 'qc_review' : 'running'
    : queue.has(job.jobId) ? 'queued' : job.status || 'unknown';

const runtimeJob = (item, status) => ({
    jobId: item.jobId,
    title: item.title || 'Runtime job',
    assignedAgent: item.agentId || item.assignedAgent || 'unknown',
    status,
    priority: item.priority || 'normal',
    instructions: 'The runner has this job, but its Markdown record has not been loaded yet.',
    attempts: [], messages: [], acceptanceCriteria: [],
    currentIteration: item.iteration || item.currentIteration || 0,
    maxIterations: item.maxIterations || 2,
    createdAt: item.queuedAt || item.startedAt || new Date().toISOString(),
    updatedAt: item.updatedAt || new Date().toISOString(),
    runtimeOnly: true,
});

const timeline = job => {
    const events = [];
    (job.messages || []).forEach(item => events.push({ id: item.messageId, at: item.createdAt, title: `${item.from} → ${item.to || 'office'}`, meta: label(item.type), body: item.content }));
    (job.attempts || []).forEach(item => {
        events.push({ id: `worker-${item.iteration}`, at: item.createdAt, title: `${job.assignedAgent} delivered iteration ${item.iteration}`, meta: model(item.workerModel), body: item.workerOutput });
        events.push({ id: `vera-${item.iteration}`, at: item.createdAt, title: `Vera reviewed iteration ${item.iteration}`, meta: `${item.qcVerdict || 'review'} · ${item.qcScore || 0}/100 · ${model(item.qcModel)}`, body: [item.qcSummary, item.qcFeedback, item.missing?.length ? `Missing: ${item.missing.join('; ')}` : ''].filter(Boolean).join('\n\n') });
    });
    return events.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
};

export default function JobsConsolePage() {
    const [jobs, setJobs] = useState([]);
    const [runner, setRunner] = useState({ active: [], queue: [], concurrency: 1 });
    const [selectedId, setSelectedId] = useState('');
    const [filter, setFilter] = useState('all');
    const [query, setQuery] = useState('');
    const [tab, setTab] = useState('activity');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [updatedAt, setUpdatedAt] = useState(null);

    const load = useCallback(async ({ quiet = false } = {}) => {
        try {
            const response = await api.get('/office-map');
            setJobs(Array.isArray(response.data?.jobs) ? response.data.jobs : []);
            setRunner(response.data?.runner || { active: [], queue: [], concurrency: 1 });
            setUpdatedAt(new Date(response.data?.generatedAt || Date.now()));
            setError('');
        } catch (requestError) {
            const message = requestError.response?.data?.error || requestError.message || 'Could not load jobs.';
            setError(message);
            if (!quiet) toast.error(message);
        }
    }, []);

    useEffect(() => {
        load();
        const tick = () => { if (!document.hidden) load({ quiet: true }); };
        const timer = setInterval(tick, 1500);
        window.addEventListener('focus', tick);
        document.addEventListener('visibilitychange', tick);
        return () => { clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
    }, [load]);

    const active = useMemo(() => new Map((runner.active || []).map(item => [item.jobId, item])), [runner.active]);
    const queue = useMemo(() => new Map((runner.queue || []).map(item => [item.jobId, item])), [runner.queue]);
    const merged = useMemo(() => {
        const map = new Map((jobs || []).filter(item => item?.jobId).map(item => [item.jobId, item]));
        (runner.active || []).forEach(item => { if (item?.jobId && !map.has(item.jobId)) map.set(item.jobId, runtimeJob(item, 'running')); });
        (runner.queue || []).forEach(item => { if (item?.jobId && !map.has(item.jobId)) map.set(item.jobId, runtimeJob(item, 'queued')); });
        return [...map.values()].sort((a, b) => {
            const activeDifference = Number(ACTIVE.has(runtimeStatus(b, active, queue))) - Number(ACTIVE.has(runtimeStatus(a, active, queue)));
            return activeDifference || new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
        });
    }, [jobs, runner.active, runner.queue, active, queue]);

    const counts = useMemo(() => ({
        all: merged.length,
        active: merged.filter(item => ACTIVE.has(runtimeStatus(item, active, queue))).length,
        attention: merged.filter(item => ['failed', 'awaiting_approval'].includes(runtimeStatus(item, active, queue))).length,
        finished: merged.filter(item => TERMINAL.has(runtimeStatus(item, active, queue))).length,
    }), [merged, active, queue]);

    const visible = useMemo(() => merged.filter(item => {
        const status = runtimeStatus(item, active, queue);
        if (filter === 'active' && !ACTIVE.has(status)) return false;
        if (filter === 'attention' && !['failed', 'awaiting_approval'].includes(status)) return false;
        if (filter === 'finished' && !TERMINAL.has(status)) return false;
        const text = query.trim().toLowerCase();
        return !text || [item.title, item.assignedAgent, item.instructions, item.expectedResult, status].some(value => String(value || '').toLowerCase().includes(text));
    }), [merged, active, queue, filter, query]);

    useEffect(() => {
        if (selectedId && merged.some(item => item.jobId === selectedId)) return;
        setSelectedId((merged.find(item => ACTIVE.has(runtimeStatus(item, active, queue))) || merged[0])?.jobId || '');
    }, [merged, selectedId, active, queue]);

    const selected = merged.find(item => item.jobId === selectedId) || null;
    const status = selected ? runtimeStatus(selected, active, queue) : '';
    const runtime = selected ? active.get(selected.jobId) || queue.get(selected.jobId) : null;
    const events = useMemo(() => selected ? timeline(selected) : [], [selected]);

    const act = async (key, request, message) => {
        setBusy(key);
        try { const response = await request(); toast.success(typeof message === 'function' ? message(response.data) : message); await load({ quiet: true }); }
        catch (actionError) { toast.error(actionError.response?.data?.error || actionError.message); }
        finally { setBusy(''); }
    };

    const stopAll = () => window.confirm('Stop every queued and running job?') && act('stop-all', () => api.post('/jobs/stop-all'), data => `Stopped ${data?.stopped || 0} jobs`);
    const clear = scope => window.confirm(`Permanently clear ${scope === 'all' ? 'all jobs' : 'finished jobs'} from Obsidian?`) && act(`clear-${scope}`, () => api.delete(`/jobs?scope=${scope}`), data => `Cleared ${data?.cleared || 0} jobs`);
    const stop = () => act(`stop-${selected.jobId}`, () => api.post(`/jobs/${encodeURIComponent(selected.jobId)}/stop`), 'Job cancellation requested');
    const run = () => act(`run-${selected.jobId}`, () => api.post(`/jobs/${encodeURIComponent(selected.jobId)}/run`), 'Job queued');
    const remove = () => window.confirm(`Delete "${selected.title}"?`) && act(`delete-${selected.jobId}`, () => api.delete(`/jobs/${encodeURIComponent(selected.jobId)}`), 'Job deleted');

    return (
        <div className="jobs-console">
            <header className="jobs-console__header">
                <div><div className="eyebrow">Live worker → Vera operations</div><h1>Jobs</h1><p>One synchronized view of stored jobs, the runner queue, agent messages, deliverables, and Vera reviews.</p></div>
                <div className="jobs-console__header-actions">
                    <button className="secondary-button" onClick={() => load()}><IconRefresh size={16} /> Refresh</button>
                    <button className="secondary-button" onClick={stopAll} disabled={!counts.active || busy === 'stop-all'}><IconPlayerStop size={16} /> Stop all</button>
                    <button className="secondary-button" onClick={() => clear('terminal')} disabled={!counts.finished}><IconTrash size={16} /> Clear finished</button>
                    <button className="icon-danger-button" onClick={() => clear('all')} disabled={!counts.all}><IconTrash size={16} /> Clear all</button>
                </div>
            </header>

            <section className="jobs-console__summary">
                {[['Active', counts.active], ['Queued', runner.queue?.length || 0], ['Attention', counts.attention], ['Worker slots', runner.concurrency || 1], ['Stored', counts.all]].map(([name, value]) => <div key={name}><strong>{value}</strong><span>{name}</span></div>)}
                <small>{updatedAt ? `Synced ${date(updatedAt)}` : 'Waiting for first sync'}</small>
            </section>

            {error && <div className="jobs-console__error"><strong>Synchronization failed</strong><span>{error}</span><button onClick={() => load()}>Retry</button></div>}

            <div className="jobs-console__workspace">
                <aside className="jobs-console__list-panel">
                    <label className="jobs-console__search"><IconSearch size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search jobs" /></label>
                    <div className="jobs-console__filters">{['all', 'active', 'attention', 'finished'].map(value => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value}<span>{counts[value]}</span></button>)}</div>
                    <div className="jobs-console__list">
                        {!visible.length && <div className="jobs-console__empty"><IconBriefcase2 size={26} /><strong>No matching jobs</strong><span>Ask Nora to delegate work or change the filter.</span></div>}
                        {visible.map(item => {
                            const itemStatus = runtimeStatus(item, active, queue);
                            const itemRuntime = active.get(item.jobId) || queue.get(item.jobId);
                            return <button key={item.jobId} className={`jobs-console__row ${selectedId === item.jobId ? 'selected' : ''}`} onClick={() => { setSelectedId(item.jobId); setTab('activity'); }}>
                                <span className={`jobs-console__status-dot status-${itemStatus}`} />
                                <span className="jobs-console__row-copy"><strong>{item.title || 'Untitled job'}</strong><small>{item.assignedAgent || 'unassigned'} · {itemRuntime?.stage || label(itemStatus)}</small></span>
                                <span className="jobs-console__row-meta"><small>{item.currentIteration || itemRuntime?.iteration || 0}/{item.maxIterations || 2}</small><small>{date(item.updatedAt || item.createdAt)}</small></span>
                            </button>;
                        })}
                    </div>
                </aside>

                <main className="jobs-console__detail">
                    {!selected ? <div className="jobs-console__empty jobs-console__empty--detail"><IconBriefcase2 size={34} /><strong>Select a job</strong><span>Execution details will appear here.</span></div> : <>
                        <header className="jobs-console__detail-header">
                            <div><div className="jobs-console__identity"><StatusBadge tone={tone(status)}>{label(status)}</StatusBadge><span>{selected.priority || 'normal'} priority</span><span>{selected.assignedAgent || 'unassigned'} → Vera</span></div><h2>{selected.title}</h2><p>{selected.instructions || 'No instructions stored.'}</p></div>
                            <div className="jobs-console__selected-actions">
                                {ACTIVE.has(status) && <button className="icon-danger-button" onClick={stop}><IconPlayerStop size={16} /> Stop</button>}
                                {!selected.runtimeOnly && !['completed', 'queued', 'running', 'qc_review'].includes(status) && <button className="secondary-button" onClick={run}><IconPlayerPlay size={16} /> Continue</button>}
                                {!selected.runtimeOnly && !ACTIVE.has(status) && <button className="secondary-button" onClick={remove}><IconTrash size={16} /> Delete</button>}
                            </div>
                        </header>
                        <section className="jobs-console__progress">
                            <div><span>Live stage</span><strong>{runtime?.stage || label(status)}</strong></div><div><span>Iteration</span><strong>{selected.currentIteration || runtime?.iteration || 0}/{selected.maxIterations || 2}</strong></div><div><span>QC verdict</span><strong>{selected.qcVerdict || 'pending'}</strong></div><div><span>QC score</span><strong>{selected.qcScore ? `${selected.qcScore}/100` : 'not reviewed'}</strong></div>
                        </section>
                        <nav className="jobs-console__tabs">{[['activity', `Activity (${events.length})`], ['deliverable', 'Deliverable'], ['requirements', 'Requirements']].map(([value, text]) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{text}</button>)}</nav>
                        <div className="jobs-console__detail-body">
                            {tab === 'activity' && <div className="jobs-timeline">{!events.length && <div className="jobs-timeline__empty"><strong>No agent messages yet</strong><span>{ACTIVE.has(status) ? `Runner stage: ${runtime?.stage || label(status)}` : 'No execution events recorded.'}</span></div>}{events.map(event => <article key={event.id} className="jobs-timeline__event"><div className="jobs-timeline__marker" /><div className="jobs-timeline__card"><header><div><strong>{event.title}</strong><span>{event.meta}</span></div><time>{date(event.at)}</time></header>{event.body && <pre>{event.body}</pre>}</div></article>)}</div>}
                            {tab === 'deliverable' && <div className="jobs-console__document"><section><h3>Current result</h3><pre>{selected.result || 'No deliverable recorded yet.'}</pre></section><section className="jobs-console__model-grid"><div><span>Worker model</span><strong>{model(selected.attempts?.at(-1)?.workerModel)}</strong></div><div><span>Vera model</span><strong>{model(selected.attempts?.at(-1)?.qcModel)}</strong></div><div><span>Updated</span><strong>{date(selected.updatedAt)}</strong></div><div><span>Markdown</span><strong>{selected.path || 'Runtime record pending'}</strong></div></section>{selected.qcFeedback && <section><h3>Latest Vera feedback</h3><p>{selected.qcFeedback}</p></section>}{selected.lastError && <section className="jobs-console__failure"><h3>Last error</h3><p>{selected.lastError}</p></section>}</div>}
                            {tab === 'requirements' && <div className="jobs-console__document"><section><h3>Expected result</h3><p>{selected.expectedResult || 'No expected result stored.'}</p></section><section><h3>Acceptance criteria</h3>{selected.acceptanceCriteria?.length ? <ol>{selected.acceptanceCriteria.map((item, index) => <li key={index}>{item}</li>)}</ol> : <p>No criteria stored.</p>}</section></div>}
                        </div>
                    </>}
                </main>
            </div>
        </div>
    );
}
