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

const toneForStatus = status => ({
    queued: 'info',
    running: 'warning',
    qc_review: 'warning',
    awaiting_approval: 'warning',
    completed: 'success',
    failed: 'danger',
    cancelled: 'neutral',
}[status] || 'neutral');

const statusLabel = status => String(status || 'unknown').replaceAll('_', ' ');
const modelLabel = model => model?.model
    ? `${model.provider || 'model'} · ${model.model}${model.fallbackUsed ? ' · fallback' : ''}`
    : '—';
const activeStatuses = new Set(['queued', 'running', 'qc_review']);
const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);

export default function JobsPage() {
    const [jobs, setJobs] = useState([]);
    const [runner, setRunner] = useState({ active: [], queue: [], queued: 0, concurrency: 1 });
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState('');

    const load = useCallback(async ({ quiet = false } = {}) => {
        if (!quiet) setLoading(true);
        try {
            const [jobsResponse, healthResponse] = await Promise.all([
                api.get('/jobs'),
                api.get('/health'),
            ]);
            setJobs(jobsResponse.data || []);
            setRunner(healthResponse.data?.jobs || { active: [], queue: [], queued: 0, concurrency: 1 });
        } catch (error) {
            if (!quiet) toast.error(error.response?.data?.error || error.message);
        } finally {
            if (!quiet) setLoading(false);
        }
    }, []);

    const hasActiveJobs = useMemo(
        () => jobs.some(job => activeStatuses.has(job.status)),
        [jobs],
    );
    const activeById = useMemo(
        () => new Map((runner.active || []).map(item => [item.jobId, item])),
        [runner],
    );
    const terminalCount = useMemo(
        () => jobs.filter(job => terminalStatuses.has(job.status)).length,
        [jobs],
    );

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (!hasActiveJobs) return undefined;
        const timer = setInterval(() => load({ quiet: true }), 1500);
        return () => clearInterval(timer);
    }, [hasActiveJobs, load]);

    const run = async job => {
        setBusy(`run:${job.jobId}`);
        try {
            await api.post(`/jobs/${encodeURIComponent(job.jobId)}/run`);
            toast.success(['failed', 'awaiting_approval', 'cancelled'].includes(job.status)
                ? 'Additional bounded iterations queued'
                : 'Job queued');
            await load({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.error || error.message);
        } finally {
            setBusy('');
        }
    };

    const stop = async job => {
        setBusy(`stop:${job.jobId}`);
        try {
            await api.post(`/jobs/${encodeURIComponent(job.jobId)}/stop`);
            toast.success('Job cancellation requested');
            await load({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.error || error.message);
        } finally {
            setBusy('');
        }
    };

    const stopAll = async () => {
        if (!window.confirm('Stop every queued and running job? Their Markdown records will remain available.')) return;
        setBusy('stop-all');
        try {
            const response = await api.post('/jobs/stop-all');
            toast.success(`Stopped ${response.data?.stopped || 0} job${response.data?.stopped === 1 ? '' : 's'}`);
            await load({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.error || error.message);
        } finally {
            setBusy('');
        }
    };

    const remove = async job => {
        if (!window.confirm(`Delete "${job.title}" from the Obsidian vault?`)) return;
        setBusy(`delete:${job.jobId}`);
        try {
            await api.delete(`/jobs/${encodeURIComponent(job.jobId)}`);
            toast.success('Job deleted');
            await load({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.error || error.message);
        } finally {
            setBusy('');
        }
    };

    const clear = async scope => {
        const label = scope === 'all' ? 'every job' : 'completed, failed, and cancelled jobs';
        if (!window.confirm(`Permanently clear ${label} from the Obsidian vault?`)) return;
        setBusy(`clear:${scope}`);
        try {
            const response = await api.delete(`/jobs?scope=${encodeURIComponent(scope)}`);
            toast.success(`Cleared ${response.data?.cleared || 0} job${response.data?.cleared === 1 ? '' : 's'}`);
            await load({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.error || error.message);
        } finally {
            setBusy('');
        }
    };

    return (
        <div className="standard-page">
            <div className="page-header">
                <div>
                    <div className="eyebrow">Bounded worker → Vera QC</div>
                    <h1>Jobs</h1>
                    <p>Jobs run with explicit progress, cooperative cancellation, and a configurable local concurrency limit. Normal jobs default to two iterations.</p>
                </div>
                <button type="button" className="secondary-button" onClick={() => load()} disabled={loading}>
                    <IconRefresh size={17} /> Refresh
                </button>
            </div>

            <div className="jobs-command-bar">
                <div className="jobs-runner-summary">
                    <span className="runner-chip"><strong>{runner.active?.length || 0}</strong> active</span>
                    <span className="runner-chip"><strong>{runner.queued || 0}</strong> queued</span>
                    <span className="runner-chip"><strong>{runner.concurrency || 1}</strong> worker slots</span>
                    <span className="runner-chip"><strong>{jobs.length}</strong> stored jobs</span>
                </div>
                <div className="jobs-command-actions">
                    <button
                        type="button"
                        className="secondary-button"
                        onClick={stopAll}
                        disabled={!hasActiveJobs || busy === 'stop-all'}
                    >
                        <IconPlayerStop size={16} /> Stop all
                    </button>
                    <button
                        type="button"
                        className="secondary-button"
                        onClick={() => clear('terminal')}
                        disabled={!terminalCount || busy === 'clear:terminal'}
                    >
                        <IconTrash size={16} /> Clear finished
                    </button>
                    <button
                        type="button"
                        className="icon-danger-button"
                        onClick={() => clear('all')}
                        disabled={!jobs.length || busy === 'clear:all'}
                    >
                        <IconTrash size={16} /> Clear all
                    </button>
                </div>
            </div>

            {!jobs.length ? (
                <div className="empty-state">
                    <div><IconBriefcase2 size={32} /></div>
                    <h3>No jobs yet</h3>
                    <p>Ask Nora to delegate a job to Marco, Luma, Dex, or Iris with an expected result and objective acceptance criteria.</p>
                </div>
            ) : (
                <div className="jobs-grid">
                    {jobs.map(job => {
                        const latest = job.attempts?.at(-1);
                        const activeState = activeById.get(job.jobId);
                        const isActive = activeStatuses.has(job.status);
                        const canRun = !['completed', 'running', 'qc_review', 'queued'].includes(job.status);
                        const canDelete = !isActive;
                        return (
                            <article key={job.jobId} className={`job-card ${isActive ? 'active' : ''}`}>
                                <header className="job-card-header">
                                    <div className="job-card-title">
                                        <h3>{job.title}</h3>
                                        <p>{job.instructions}</p>
                                    </div>
                                    <div className="job-card-meta">
                                        <StatusBadge tone={toneForStatus(job.status)}>{statusLabel(job.status)}</StatusBadge>
                                        <StatusBadge tone={job.qcVerdict === 'pass' ? 'success' : latest ? 'warning' : 'neutral'}>
                                            <IconShieldCheck size={13} /> {job.qcVerdict || 'QC pending'}
                                        </StatusBadge>
                                    </div>
                                </header>

                                <div className="job-progress">
                                    <div><span>Worker</span><strong>{job.assignedAgent}</strong></div>
                                    <div><span>Current stage</span><strong>{activeState?.stage || statusLabel(job.status)}</strong></div>
                                    <div><span>Iteration</span><strong>{job.currentIteration || 0}/{job.maxIterations || 2}</strong></div>
                                    <div><span>Latest score</span><strong>{latest ? `${latest.qcScore}/100` : 'Not reviewed'}</strong></div>
                                </div>

                                <details className="job-details">
                                    <summary>Expected result, communication, and iteration history</summary>
                                    <div className="job-details-content">
                                        <section>
                                            <h4>Expected result</h4>
                                            <p>{job.expectedResult || 'Not specified'}</p>
                                        </section>
                                        <section>
                                            <h4>Acceptance criteria</h4>
                                            <ul>
                                                {(job.acceptanceCriteria || []).map((item, index) => (
                                                    <li key={`${job.jobId}-criterion-${index}`}>{item}</li>
                                                ))}
                                            </ul>
                                        </section>
                                        {job.qcFeedback && (
                                            <section>
                                                <h4>Latest Vera feedback</h4>
                                                <p>{job.qcFeedback}</p>
                                            </section>
                                        )}
                                        {!!job.messages?.length && (
                                            <section>
                                                <h4>Agent messages</h4>
                                                {(job.messages || []).map(message => (
                                                    <details key={message.messageId}>
                                                        <summary>{message.from} → {message.to || 'office'} · {message.type}</summary>
                                                        <p>{message.content}</p>
                                                    </details>
                                                ))}
                                            </section>
                                        )}
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
                                    {isActive && (
                                        <button
                                            type="button"
                                            className="icon-danger-button"
                                            onClick={() => stop(job)}
                                            disabled={busy === `stop:${job.jobId}`}
                                        >
                                            <IconPlayerStop size={16} /> Stop
                                        </button>
                                    )}
                                    {canRun && (
                                        <button
                                            type="button"
                                            className="secondary-button"
                                            onClick={() => run(job)}
                                            disabled={busy === `run:${job.jobId}`}
                                        >
                                            <IconPlayerPlay size={16} />
                                            {['failed', 'awaiting_approval', 'cancelled'].includes(job.status) ? 'Continue' : 'Run'}
                                        </button>
                                    )}
                                    {canDelete && (
                                        <button
                                            type="button"
                                            className="secondary-button"
                                            onClick={() => remove(job)}
                                            disabled={busy === `delete:${job.jobId}`}
                                        >
                                            <IconTrash size={16} /> Delete
                                        </button>
                                    )}
                                </footer>
                            </article>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
