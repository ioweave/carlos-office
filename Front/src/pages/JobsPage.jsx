import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconBriefcase2, IconPlayerPlay, IconRefresh, IconShieldCheck } from '@tabler/icons-react';
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

export default function JobsPage() {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [runningId, setRunningId] = useState('');

    const load = useCallback(async ({ quiet = false } = {}) => {
        if (!quiet) setLoading(true);
        try {
            const response = await api.get('/jobs');
            setJobs(response.data || []);
        } catch (error) {
            if (!quiet) toast.error(error.response?.data?.error || error.message);
        } finally {
            if (!quiet) setLoading(false);
        }
    }, []);

    const hasActiveJobs = useMemo(
        () => jobs.some(job => ['queued', 'running', 'qc_review'].includes(job.status)),
        [jobs],
    );

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (!hasActiveJobs) return undefined;
        const timer = setInterval(() => load({ quiet: true }), 3000);
        return () => clearInterval(timer);
    }, [hasActiveJobs, load]);

    const run = async job => {
        setRunningId(job.jobId);
        try {
            await api.post(`/jobs/${job.jobId}/run`);
            toast.success(['failed', 'awaiting_approval'].includes(job.status)
                ? 'Additional Vera QC iterations queued'
                : 'Job queued');
            await load({ quiet: true });
        } catch (error) {
            toast.error(error.response?.data?.error || error.message);
        } finally {
            setRunningId('');
        }
    };

    return (
        <div className="standard-page">
            <div className="page-header">
                <div>
                    <div className="eyebrow">Worker → Vera → revision loop</div>
                    <h1>Jobs</h1>
                    <p>Nora delegates to Marco, Luma, or Dex. Vera reviews every iteration until the result passes or reaches the bounded limit.</p>
                </div>
                <button className="secondary-button" onClick={() => load()} disabled={loading}>
                    <IconRefresh size={17} /> Refresh
                </button>
            </div>

            {!jobs.length ? (
                <div className="empty-state">
                    <div><IconBriefcase2 size={32} /></div>
                    <h3>No jobs yet</h3>
                    <p>Ask Nora to delegate a job with an expected result and objective acceptance criteria.</p>
                </div>
            ) : (
                <div className="jobs-table-wrap">
                    <table className="jobs-table">
                        <thead>
                            <tr>
                                <th>Job</th>
                                <th>Worker</th>
                                <th>Vera QC</th>
                                <th>Iteration</th>
                                <th>Status</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {jobs.map(job => {
                                const latest = job.attempts?.at(-1);
                                const canRun = !['completed', 'running', 'qc_review'].includes(job.status);
                                return (
                                    <tr key={job.jobId}>
                                        <td>
                                            <strong>{job.title}</strong>
                                            <span>{job.instructions}</span>
                                            <details>
                                                <summary>Expected result and QC history</summary>
                                                <p><strong>Expected result:</strong> {job.expectedResult || 'Not specified'}</p>
                                                <p><strong>Acceptance criteria:</strong></p>
                                                <ul>
                                                    {(job.acceptanceCriteria || []).map((item, index) => <li key={`${job.jobId}-criterion-${index}`}>{item}</li>)}
                                                </ul>
                                                {job.qcFeedback && <p><strong>Latest Vera feedback:</strong> {job.qcFeedback}</p>}
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
                                            </details>
                                        </td>
                                        <td className="capitalize">{job.assignedAgent}</td>
                                        <td>
                                            <div><IconShieldCheck size={16} /> {job.qcVerdict || 'pending'}</div>
                                            <span>{latest ? `${latest.qcScore}/100` : 'Not reviewed'}</span>
                                        </td>
                                        <td>{job.currentIteration || 0}/{job.maxIterations || 4}</td>
                                        <td><StatusBadge tone={toneForStatus(job.status)}>{statusLabel(job.status)}</StatusBadge></td>
                                        <td>
                                            <button
                                                className="secondary-button"
                                                onClick={() => run(job)}
                                                disabled={!canRun || runningId === job.jobId}
                                            >
                                                <IconPlayerPlay size={16} />
                                                {['failed', 'awaiting_approval'].includes(job.status) ? 'Continue' : 'Run'}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
