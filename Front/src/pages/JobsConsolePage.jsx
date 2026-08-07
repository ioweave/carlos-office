import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconAlertTriangle, IconBriefcase2, IconPlayerPlay, IconPlayerStop, IconRefresh, IconSearch, IconTrash } from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';

const ACTIVE = new Set(['queued', 'running', 'qc_review', 'nora_review']);
const ATTENTION = new Set(['needs_attention', 'awaiting_approval', 'failed']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'needs_attention', 'awaiting_approval']);
const label = value => String(value || 'unknown').replaceAll('_', ' ').replaceAll('-', ' ');
const date = value => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};
const model = value => value?.model ? `${value.provider || 'model'} · ${value.model}${value.fallbackUsed ? ' · fallback' : ''}` : 'Not recorded';

const fallbackEvents = job => {
    const events = [];
    (job.messages || []).forEach(item => events.push({ eventId: item.messageId, createdAt: item.createdAt, from: item.from, to: item.to || 'office', stage: item.type, summary: item.content, tone: item.type.includes('revision') ? 'warning' : 'info' }));
    return events;
};

export default function JobsConsolePage() {
    const [data, setData] = useState({ jobs: [], workflows: [], events: [], runner: {} });
    const [selectedId, setSelectedId] = useState('');
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');
    const [tab, setTab] = useState('story');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');

    const load = useCallback(async ({ quiet = false } = {}) => {
        try {
            setData((await api.get('/office-map')).data || { jobs: [], workflows: [], events: [], runner: {} });
            setError('');
        } catch (requestError) {
            const message = requestError.response?.data?.error || requestError.message || 'Could not load jobs.';
            setError(message);
            if (!quiet) toast.error(message);
        }
    }, []);

    useEffect(() => {
        load();
        const timer = setInterval(() => { if (!document.hidden) load({ quiet: true }); }, 1250);
        return () => clearInterval(timer);
    }, [load]);

    const jobs = useMemo(() => [...(data.jobs || [])].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)), [data.jobs]);
    const counts = useMemo(() => ({
        all: jobs.length,
        active: jobs.filter(job => ACTIVE.has(job.status)).length,
        attention: jobs.filter(job => ATTENTION.has(job.status)).length,
        finished: jobs.filter(job => job.status === 'completed' || job.status === 'cancelled').length,
    }), [jobs]);
    const visible = useMemo(() => jobs.filter(job => {
        if (filter === 'active' && !ACTIVE.has(job.status)) return false;
        if (filter === 'attention' && !ATTENTION.has(job.status)) return false;
        if (filter === 'finished' && !['completed', 'cancelled'].includes(job.status)) return false;
        const text = query.trim().toLowerCase();
        return !text || [job.title, job.assignedAgent, job.instructions, job.expectedResult, job.status].some(value => String(value || '').toLowerCase().includes(text));
    }), [jobs, filter, query]);

    useEffect(() => {
        if (selectedId && jobs.some(job => job.jobId === selectedId)) return;
        setSelectedId((jobs.find(job => ATTENTION.has(job.status)) || jobs.find(job => ACTIVE.has(job.status)) || jobs[0])?.jobId || '');
    }, [jobs, selectedId]);

    const selected = jobs.find(job => job.jobId === selectedId) || null;
    const workflow = selected ? (data.workflows || []).find(item => item.jobIds?.includes(selected.jobId) || item.jobs?.some(job => job.jobId === selected.jobId)) : null;
    const story = selected ? (data.events || []).filter(event => event.jobId === selected.jobId) : [];
    const events = story.length ? story : selected ? fallbackEvents(selected) : [];
    const waitingOn = selected?.waitingOn || (ATTENTION.has(selected?.status) ? 'carlos' : selected?.status === 'qc_review' ? 'vera' : selected?.status === 'nora_review' ? 'nora' : selected?.assignedAgent);

    const act = async (key, request, success) => {
        setBusy(key);
        try { await request(); toast.success(success); await load({ quiet: true }); }
        catch (actionError) { toast.error(actionError.response?.data?.error || actionError.message); }
        finally { setBusy(''); }
    };
    const continueJob = () => act('continue', () => api.post(`/jobs/${encodeURIComponent(selected.jobId)}/run`), 'Two more bounded iterations authorized.');
    const stopJob = () => act('stop', () => api.post(`/jobs/${encodeURIComponent(selected.jobId)}/stop`), 'Job cancellation requested.');
    const deleteJob = () => window.confirm(`Delete "${selected.title}"?`) && act('delete', () => api.delete(`/jobs/${encodeURIComponent(selected.jobId)}`), 'Job deleted.');
    const clearFinished = () => window.confirm('Clear completed, failed, cancelled, and attention job receipts?') && act('clear', () => api.delete('/jobs?scope=terminal'), 'Finished receipts cleared.');

    const workflows = data.workflows || [];
    const workflowFor = job => workflows.find(item => item.jobIds?.includes(job.jobId) || item.jobs?.some(entry => entry.jobId === job.jobId));
    const grouped = [];
    workflows.forEach(item => {
        const members = visible.filter(job => item.jobIds?.includes(job.jobId) || item.jobs?.some(entry => entry.jobId === job.jobId));
        if (members.length) grouped.push({ workflow: item, jobs: members });
    });
    const groupedIds = new Set(grouped.flatMap(group => group.jobs.map(job => job.jobId)));
    const ungrouped = visible.filter(job => !groupedIds.has(job.jobId));

    return (
        <div className="jobs-console">
            <header className="jobs-console__header">
                <div><div className="eyebrow">Nora → worker → Vera → Nora</div><h1>Jobs</h1><p>Delegated work grouped by the plan that created it, with an explicit owner for every waiting state.</p></div>
                <div className="jobs-console__header-actions"><button onClick={() => load()}><IconRefresh size={16} /> Refresh</button><button onClick={clearFinished} disabled={!counts.all || busy === 'clear'}><IconTrash size={16} /> Clear finished</button></div>
            </header>

            <section className="jobs-console__summary">
                {[['Active', counts.active], ['Needs Carlos', counts.attention], ['Workflows', workflows.length], ['Worker slots', data.runner?.concurrency || 1], ['Stored receipts', counts.all]].map(([name, value]) => <div key={name}><strong>{value}</strong><span>{name}</span></div>)}
            </section>
            {error && <div className="jobs-console__error"><strong>Synchronization failed</strong><span>{error}</span></div>}

            <div className="jobs-console__workspace">
                <aside className="jobs-console__list-panel">
                    <label className="jobs-console__search"><IconSearch size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search jobs" /></label>
                    <div className="jobs-console__filters">{['all', 'active', 'attention', 'finished'].map(value => <button key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{value}<span>{counts[value]}</span></button>)}</div>
                    <div className="jobs-console__groups">
                        {grouped.map(group => <section className="jobs-console__group" key={group.workflow.workflowId}>
                            <header><div><strong>{group.workflow.title}</strong><small>{label(group.workflow.stage)} · waiting on {group.workflow.waitingOn || '—'}</small></div><span>{group.jobs.filter(job => job.status === 'completed').length}/{group.jobs.length}</span></header>
                            {group.jobs.map(job => <button key={job.jobId} className={`jobs-console__row ${selectedId === job.jobId ? 'is-selected' : ''}`} onClick={() => { setSelectedId(job.jobId); setTab('story'); }}><i className={`jobs-console__dot jobs-console__dot--${job.status}`} /><span><strong>{job.title}</strong><small>{job.assignedAgent} · {label(job.status)}</small></span><em>{job.currentIteration || 0}/{job.maxIterations || 2}</em></button>)}
                        </section>)}
                        {!!ungrouped.length && <section className="jobs-console__group"><header><div><strong>Standalone / older receipts</strong><small>Jobs without a retained live workflow</small></div><span>{ungrouped.length}</span></header>{ungrouped.map(job => <button key={job.jobId} className={`jobs-console__row ${selectedId === job.jobId ? 'is-selected' : ''}`} onClick={() => { setSelectedId(job.jobId); setTab('story'); }}><i className={`jobs-console__dot jobs-console__dot--${job.status}`} /><span><strong>{job.title}</strong><small>{job.assignedAgent} · {label(job.status)}</small></span><em>{job.currentIteration || 0}/{job.maxIterations || 2}</em></button>)}</section>}
                        {!visible.length && <div className="jobs-console__empty"><IconBriefcase2 size={28} /><strong>No matching jobs</strong><span>Ask Nora to delegate work or change the filter.</span></div>}
                    </div>
                </aside>

                <main className="jobs-console__detail">
                    {!selected ? <div className="jobs-console__empty"><IconBriefcase2 size={34} /><strong>Select a job</strong></div> : <>
                        <header className="jobs-console__detail-header"><div><div className="jobs-console__identity"><span className={`jobs-console__status jobs-console__status--${selected.status}`}>{label(selected.status)}</span><span>{selected.assignedAgent} worker</span>{workflow && <span>{workflow.title}</span>}</div><h2>{selected.title}</h2><p>{selected.instructions}</p></div><div className="jobs-console__selected-actions">{ACTIVE.has(selected.status) && <button onClick={stopJob} disabled={busy === 'stop'}><IconPlayerStop size={16} /> Stop</button>}{ATTENTION.has(selected.status) && <button onClick={continueJob} disabled={busy === 'continue'}><IconPlayerPlay size={16} /> Give 2 more iterations</button>}{!ACTIVE.has(selected.status) && <button onClick={deleteJob}><IconTrash size={16} /> Delete</button>}</div></header>

                        <section className="jobs-console__state-grid"><div><span>Current stage</span><strong>{label(selected.status)}</strong></div><div><span>Waiting on</span><strong>{waitingOn || 'Nobody'}</strong></div><div><span>Iteration</span><strong>{selected.currentIteration || 0}/{selected.maxIterations || 2}</strong></div><div><span>Vera</span><strong>{selected.qcVerdict ? `${selected.qcVerdict}${selected.qcScore ? ` · ${selected.qcScore}/100` : ''}` : 'not reviewed'}</strong></div></section>

                        {ATTENTION.has(selected.status) && <section className="jobs-console__attention"><IconAlertTriangle size={22} /><div><strong>Waiting on Carlos</strong><p>{selected.attentionMessage || selected.lastError || selected.qcFeedback || (selected.qcVerdict === 'revise' ? 'Vera requested another revision after the iteration budget was exhausted.' : 'This job needs a decision before work can continue.')}</p><small>{selected.attentionReason ? label(selected.attentionReason) : selected.status === 'failed' ? 'job failed' : 'revision budget exhausted'}</small></div></section>}

                        <nav className="jobs-console__tabs">{[['story', `Workflow story (${events.length})`], ['deliverable', 'Deliverable'], ['requirements', 'Requirements'], ['technical', 'Technical trace']].map(([value, text]) => <button key={value} className={tab === value ? 'is-active' : ''} onClick={() => setTab(value)}>{text}</button>)}</nav>
                        <div className="jobs-console__detail-body">
                            {tab === 'story' && <div className="jobs-story">{events.map(event => <article key={event.eventId}><i className={`jobs-story__marker jobs-story__marker--${event.tone || 'info'}`} /><div><header><strong>{event.from || 'system'} → {event.to || 'office'}</strong><time>{date(event.createdAt)}</time></header><small>{label(event.stage || event.type)}</small><p>{event.summary}</p></div></article>)}{!events.length && <div className="jobs-console__empty"><strong>No live story retained</strong><span>This is an older receipt or no runtime transition has been emitted yet.</span></div>}</div>}
                            {tab === 'deliverable' && <div className="jobs-console__document"><section><h3>Current result</h3><pre>{selected.result || 'No deliverable recorded yet.'}</pre></section>{selected.qcFeedback && <section><h3>Verification / approval record</h3><p>{selected.qcFeedback}</p></section>}</div>}
                            {tab === 'requirements' && <div className="jobs-console__document"><section><h3>Expected result</h3><p>{selected.expectedResult || 'Not specified.'}</p></section><section><h3>Acceptance criteria</h3>{selected.acceptanceCriteria?.length ? <ol>{selected.acceptanceCriteria.map(item => <li key={item}>{item}</li>)}</ol> : <p>No explicit criteria.</p>}</section></div>}
                            {tab === 'technical' && <div className="jobs-console__document"><section><h3>Models</h3><p>Worker: {model(selected.attempts?.at(-1)?.workerModel)}</p><p>Vera: {model(selected.attempts?.at(-1)?.qcModel)}</p></section><section><h3>Volatile attempt trace</h3>{selected.attempts?.length ? selected.attempts.map(attempt => <details key={attempt.iteration}><summary>Iteration {attempt.iteration} · {attempt.qcVerdict} · {attempt.qcScore}/100</summary><pre>{attempt.workerOutput}</pre><p>{attempt.qcSummary || attempt.qcFeedback}</p></details>) : <p>Detailed attempt telemetry has expired or has not been produced yet.</p>}</section><section><h3>Receipt</h3><p>{selected.path || 'Runtime-only record'}</p><p>Trace retention: {selected.traceRetention || 'unknown'}</p></section></div>}
                        </div>
                    </>}
                </main>
            </div>
        </div>
    );
}
