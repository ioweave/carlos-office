import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    IconBriefcase2,
    IconPlayerPlay,
    IconPlayerStop,
    IconRefresh,
    IconShieldCheck,
    IconTrash,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';
import StatusBadge from '../components/StatusBadge';

const activeStatuses = new Set(['queued', 'running', 'qc_review']);
const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);

const toneForStatus = status => ({
    queued: 'info', running: 'warning', qc_review: 'warning', awaiting_approval: 'warning',
    completed: 'success', failed: 'danger', cancelled: 'neutral',
}[status] || 'neutral');
const statusLabel = status => String(status || 'unknown').replaceAll('_', ' ');
const modelLabel = model => model?.model
    ? `${model.provider || 'model'} · ${model.model}${model.fallbackUsed ? ' · fallback' : ''}`
    : '—';

export default function JobsPage() {
    const [jobs, setJobs] = useState([]);
    const [runner, setRunner] = useState({ active: [], queue: [], queued: 0, concurrency: 1 });
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState('');
    const [filter, setFilter] = useState('all');
    const [lastUpdated, setLastUpdated] = useState(null);

    const load = useCallback(async ({ quiet = false } = {}) => {
        if (!quiet) setLoading(true);
        const [jobsResult, healthResult] = await Promise.allSettled([
            api.get('/jobs?limit=500'),
            api.get('/health'),
        ]);

        if (jobsResult.status === 'fulfilled') {
            setJobs(Array.isArray(jobsResult.value.data) ? jobsResult.value.data : []);
            setLastUpdated(new Date());
        } else if (!quiet) {
            toast.error(jobsResult.reason?.response?.data?.error || jobsResult.reason?.message || 'Could not load jobs.');
        }

        if (healthResult.status === 'fulfilled') {
            setRunner(healthResult.value.data?.jobs || { active: [], queue: [], queued: 0, concurrency: 1 });
        }
        if (!quiet) setLoading(false);
    }, []);

    useEffect(() => {
        load();
        const tick = () => { if (!document.hidden) load({ quiet: true }); };
        const timer = setInterval(tick, 2000);
        window.addEventListener('focus', tick);
        document.addEventListener('visibilitychange', tick);
        return () => {
            clearInterval(timer);
            window.removeEventListener('focus', tick);
            document.removeEventListener('visibilitychange', tick);
        };
    }, [load]);

    const activeById = useMemo(() => new Map((runner.active || []).map(item => [item.jobId, item])), [runner.active]);
    const queueById = useMemo(() => new Map((runner.queue || []).map(item => [item.jobId, item])), [runner.queue]);
    const displayedJobs = useMemo(() => {
        const merged = new Map(jobs.map(job => [job.jobId, job]));
        [...(runner.active || []), ...(runner.queue || [])].forEach(runtime => {
            if (!runtime?.jobId || merged.has(runtime.jobId)) return;
            merged.set(runtime.jobId, {
                jobId: runtime.jobId,
                title: runtime.title || 'Runtime job',
                assignedAgent: runtime.agentId || runtime.assignedAgent || 'unknown',
                instructions: 'This job exists in the active runner and is waiting for its Markdown record to be refreshed.',
                status: activeById.has(runtime.jobId) ? 'running' : 'queued',
                priority: runtime.priority || 'normal',
                attempts: [],
                messages: [],
                currentIteration: runtime.iteration || runtime.currentIteration || 0,
                maxIterations: runtime.maxIterations || 2,
                runtimeOnly: true,
                createdAt: runtime.queuedAt || runtime.startedAt || new Date().toISOString(),
                updatedAt: runtime.updatedAt || new Date().toISOString(),
            });
        });
        return [...merged.values()].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    }, [jobs, runner.active, runner.queue, activeById]);

    const filteredJobs = useMemo(() => displayedJobs.filter(job => {
        if (filter === 'current') return !terminalStatuses.has(job.status);
        if (filter === 'finished') return terminalStatuses.has(job.status);
        return true;
    }), [displayedJobs, filter]);

    const activeCount = displayedJobs.filter(job => activeStatuses.has(job.status)).length;
    const terminalCount = displayedJobs.filter(job => terminalStatuses.has(job.status)).length;

    const run = async job => {
        setBusy(`run:${job.jobId}`);
        try {
            await api.post(`/jobs/${encodeURIComponent(job.jobId)}/run`);
            toast.success(['failed', 'awaiting_approval', 'cancelled'].includes(job.status) ? 'Additional bounded iterations queued' : 'Job queued');
            await load({ quiet: true });
        } catch (error) { toast.error(error.response?.data?.error || error.message); }
        finally { setBusy(''); }
    };

    const stop = async job => {
        setBusy(`stop:${job.jobId}`);
        try {
            await api.post(`/jobs/${encodeURIComponent(job.jobId)}/stop`);
            toast.success('Job cancellation requested');
            await load({ quiet: true });
        } catch (error) { toast.error(error.response?.data?.error || error.message); }
        finally { setBusy(''); }
    };

    const stopAll = async () => {
        if (!window.confirm('Stop every queued and running job? Their Markdown records will remain available.')) return;
        setBusy('stop-all');
        try {
            const response = await api.post('/jobs/stop-all');
            toast.success(`Stopped ${response.data?.stopped || 0} job${response.data?.stopped === 1 ? '' : 's'}`);
            await load({ quiet: true });
        } catch (error) { toast.error(error.response?.data?.error || error.message); }
        finally { setBusy(''); }
    };

    const remove = async job => {
        if (job.runtimeOnly) return toast.error('Wait for the Markdown record to appear before deleting this job.');
        if (!window.confirm(`Delete "${job.title}" from the Obsidian vault?`)) return;
        setBusy(`delete:${job.jobId}`);
        try {
            await api.delete(`/jobs/${encodeURIComponent(job.jobId)}`);
            toast.success('Job deleted');
            await load({ quiet: true });
        } catch (error) { toast.error(error.response?.data?.error || error.message); }
        finally { setBusy(''); }
    };

    const clear = async scope => {
        const label = scope === 'all' ? 'every job' : 'completed, failed, and cancelled jobs';
        if (!window.confirm(`Permanently clear ${label} from the Obsidian vault?`)) return;
        setBusy(`clear:${scope}`);
        try {
            const response = await api.delete(`/jobs?scope=${encodeURIComponent(scope)}`);
            toast.success(`Cleared ${response.data?.cleared || 0} job${response.data?.cleared === 1 ? '' : 's'}`);
            await load({ quiet: true });
        } catch (error) { toast.error(error.response?.data?.error || error.message); }
        finally { setBusy(''); }
    };

    return (
        <div className="standard-page jobs-page-live">
            <div className="page-header">
                <div>
                    <div className="eyebrow">Live worker → Vera QC operations</div>
                    <h1>Jobs</h1>
                    <p>The list now refreshes continuously, including jobs created while this page is already open.</p>
                </div>
                <button type="button" className="secondary-button" onClick={() => load()} disabled={loading}><IconRefresh size={17} /> Refresh</button>
            </div>

            <div className="jobs-command-bar">
                <div className="jobs-runner-summary">
                    <span className="runner-chip"><strong>{runner.active?.length || 0}</strong> active</span>
                    <span className="runner-chip"><strong>{runner.queued || runner.queue?.length || 0}</strong> queued</span>
                    <span className="runner-chip"><strong>{runner.concurrency || 1}</strong> worker slots</span>
                    <span className="runner-chip"><strong>{displayedJobs.length}</strong> visible jobs</span>
                    {lastUpdated && <span className="runner-updated">Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
                </div>
                <div className="jobs-command-actions">
                    <button type="button" className="secondary-button" onClick={stopAll} disabled={!activeCount || busy === 'stop-all'}><IconPlayerStop size={16} /> Stop all</button>
                    <button type="button" className="secondary-button" onClick={() => clear('terminal')} disabled={!terminalCount || busy === 'clear:terminal'}><IconTrash size={16} /> Clear finished</button>
                    <button type="button" className="icon-danger-button" onClick={() => clear('all')} disabled={!displayedJobs.length || busy === 'clear:all'}><IconTrash size={16} /> Clear all</button>
                </div>
            </div>

            <div className="jobs-filter-bar" role="tablist" aria-label="Job filter">
                {[
                    ['all', `All (${displayedJobs.length})`],
                    ['current', `Current (${displayedJobs.length - terminalCount})`],
                    ['finished', `Finished (${terminalCount})`],
                ].map(([value, label]) => <button type="button" key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}
            </div>

            {!filteredJobs.length ? (
                <div className="empty-state">
                    <div><IconBriefcase2 size={32} /></div>
                    <h3>{filter === 'all' ? 'No jobs stored' : `No ${filter} jobs`}</h3>
                    <p>Jobs created by Nora will appear here automatically without requiring a page reload.</p>
                </div>
            ) : (
                <div className="jobs-grid">
                    {filteredJobs.map(job => {
                        const latest = job.attempts?.at(-1);
                        const activeState = activeById.get(job.jobId);
                        const queuedState = queueById.get(job.jobId);
                        const isActive = activeStatuses.has(job.status) || Boolean(activeState || queuedState);
                        const canRun = !['completed', 'running', 'qc_review', 'queued'].includes(job.status) && !job.runtimeOnly;
                        const canDelete = !isActive && !job.runtimeOnly;
                        return (
                            <article key={job.jobId} className={`job-card ${isActive ? 'active' : ''}`}>
                                <header className="job-card-header">
                                    <div className="job-card-title"><h3>{job.title}</h3><p>{job.instructions}</p></div>
                                    <div className="job-card-meta">
                                        <StatusBadge tone={toneForStatus(activeState ? 'running' : queuedState ? 'queued' : job.status)}>{statusLabel(activeState ? 'running' : queuedState ? 'queued' : job.status)}</StatusBadge>
                                        <StatusBadge tone={job.qcVerdict === 'pass' ? 'success' : latest ? 'warning' : 'neutral'}><IconShieldCheck size={13} /> {job.qcVerdict || 'QC pending'}</StatusBadge>
                                    </div>
                                </header>

                                <div className="job-progress">
                                    <div><span>Worker</span><strong>{job.assignedAgent}</strong></div>
                                    <div><span>Current stage</span><strong>{activeState?.stage || (queuedState ? 'queued' : statusLabel(job.status))}</strong></div>
                                    <div><span>Iteration</span><strong>{job.currentIteration || 0}/{job.maxIterations || 2}</strong></div>
                                    <div><span>Latest score</span><strong>{latest ? `${latest.qcScore}/100` : 'Not reviewed'}</strong></div>
                                </div>

                                <details className="job-details">
                                    <summary>Expected result, messages, and model execution</summary>
                                    <div className="job-details-content">
                                        <section><h4>Expected result</h4><p>{job.expectedResult || 'Not specified'}</p></section>
                                        <section><h4>Acceptance criteria</h4><ul>{(job.acceptanceCriteria || []).map((item, index) => <li key={`${job.jobId}-criterion-${index}`}>{item}</li>)}</ul></section>
                                        {job.qcFeedback && <section><h4>Latest Vera feedback</h4><p>{job.qcFeedback}</p></section>}
                                        {!!job.messages?.length && <section><h4>Agent messages</h4>{job.messages.map(message => <details key={message.messageId}><summary>{message.from} → {message.to || 'office'} · {statusLabel(message.type)}</summary><p>{message.content}</p></details>)}</section>}
                                        {(job.attempts || []).map(item => (
                                            <details key={`${job.jobId}-attempt-${item.iteration}`}>
                                                <summary>Iteration {item.iteration} · {item.qcVerdict} · {item.qcScore}/100</summary>
                                                <p><strong>Worker model:</strong> {modelLabel(item.workerModel)}</p>
                                                <p><strong>Vera model:</strong> {modelLabel(item.qcModel)}</p>
                                                <p><strong>Vera assessment:</strong> {item.qcSummary || '—'}</p>
                                                {item.missing?.length > 0 && <p><strong>Missing:</strong> {item.missing.join('; ')}</p>}
                                                <p><strong>Feedback:</strong> {item.qcFeedback || '—'}</p>
                                                <pre>{item.workerOutput}</pre>
                                            </details>
                                        ))}
                                    </div>
                                </details>

                                <footer className="job-card-actions">
                                    {isActive && <button type="button" className="icon-danger-button" onClick={() => stop(job)} disabled={busy === `stop:${job.jobId}`}><IconPlayerStop size={16} /> Stop</button>}
                                    {canRun && <button type="button" className="secondary-button" onClick={() => run(job)} disabled={busy === `run:${job.jobId}`}><IconPlayerPlay size={16} /> {['failed', 'awaiting_approval', 'cancelled'].includes(job.status) ? 'Continue' : 'Run'}</button>}
                                    {canDelete && <button type="button" className="secondary-button" onClick={() => remove(job)} disabled={busy === `delete:${job.jobId}`}><IconTrash size={16} /> Delete</button>}
                                </footer>
                            </article>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
