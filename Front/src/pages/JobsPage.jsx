import { useEffect, useState } from 'react';
import { IconBriefcase2, IconRefresh } from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';
import StatusBadge from '../components/StatusBadge';

const toneForStatus = status => ({
    queued: 'info',
    running: 'warning',
    awaiting_approval: 'warning',
    completed: 'success',
    failed: 'danger',
    cancelled: 'neutral',
}[status] || 'neutral');

export default function JobsPage() {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const response = await api.get('/jobs');
            setJobs(response.data || []);
        } catch (error) {
            toast.error(error.response?.data?.error || error.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    return (
        <div className="standard-page">
            <div className="page-header">
                <div><div className="eyebrow">Durable delegation</div><h1>Jobs</h1><p>Nora can queue scoped work for Marco, Luma, and Dex.</p></div>
                <button className="secondary-button" onClick={load} disabled={loading}><IconRefresh size={17} /> Refresh</button>
            </div>

            {!jobs.length ? (
                <div className="empty-state"><div><IconBriefcase2 size={32} /></div><h3>No jobs yet</h3><p>Ask Nora to delegate a task and it will appear here.</p></div>
            ) : (
                <div className="jobs-table-wrap">
                    <table className="jobs-table">
                        <thead><tr><th>Job</th><th>Agent</th><th>Priority</th><th>Status</th><th>Created</th></tr></thead>
                        <tbody>
                            {jobs.map(job => (
                                <tr key={job.jobId}>
                                    <td><strong>{job.title}</strong><span>{job.instructions}</span></td>
                                    <td className="capitalize">{job.assignedAgent}</td>
                                    <td className="capitalize">{job.priority}</td>
                                    <td><StatusBadge tone={toneForStatus(job.status)}>{job.status.replace('_', ' ')}</StatusBadge></td>
                                    <td>{new Date(job.createdAt).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
