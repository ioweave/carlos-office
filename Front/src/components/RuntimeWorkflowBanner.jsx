import { useEffect, useMemo, useState } from 'react';
import { IconArrowRight, IconBriefcase2, IconTopologyStar3 } from '@tabler/icons-react';
import api from '../api';

const activeStatuses = new Set(['planning', 'running']);
const ageMs = value => Date.now() - new Date(value || 0).getTime();
const readable = value => String(value || '').replaceAll('_', ' ').replaceAll('-', ' ');

export default function RuntimeWorkflowBanner({ activePage, setActive }) {
    const [snapshot, setSnapshot] = useState({ workflows: [] });

    useEffect(() => {
        let mounted = true;
        const load = async () => {
            try {
                const response = await api.get('/office-map');
                if (mounted) setSnapshot(response.data || { workflows: [] });
            } catch {}
        };
        load();
        const timer = setInterval(() => { if (!document.hidden) load(); }, 1500);
        return () => { mounted = false; clearInterval(timer); };
    }, []);

    const workflow = useMemo(() => {
        const items = snapshot.workflows || [];
        return items.find(item => item.status === 'needs_attention')
            || items.find(item => activeStatuses.has(item.status))
            || items.find(item => item.status === 'completed' && ageMs(item.updatedAt || item.completedAt) < 60_000)
            || null;
    }, [snapshot]);

    if (!workflow || !['chat', 'map', 'jobs'].includes(activePage)) return null;
    const complete = workflow.jobs?.filter(job => job.status === 'completed').length || 0;
    const total = workflow.jobs?.length || workflow.jobIds?.length || 0;
    const attention = workflow.status === 'needs_attention';

    return (
        <aside className={`workflow-banner workflow-banner--${attention ? 'attention' : workflow.status}`} aria-live="polite">
            <div className="workflow-banner__header">
                <span className="workflow-banner__pulse" />
                <div className="workflow-banner__identity">
                    <small>{attention ? 'Needs your decision' : workflow.status === 'completed' ? 'Workflow completed' : 'Nora is coordinating work'}</small>
                    <strong>{workflow.title}</strong>
                </div>
            </div>
            <div className="workflow-banner__meta">
                <span>{readable(workflow.stage)}</span>
                <span>Waiting on <strong>{workflow.waitingOn || '—'}</strong></span>
                {total > 0 && <span>{complete}/{total} approved</span>}
            </div>
            {attention && <p className="workflow-banner__attention">{workflow.attentionMessage || 'A delegated job exhausted its revision budget and needs your decision.'}</p>}
            <div className="workflow-banner__jobs">
                {(workflow.jobs || []).slice(0, 4).map(job => (
                    <div key={job.jobId} className="workflow-banner__job">
                        <span className={`workflow-banner__job-dot workflow-banner__job-dot--${job.status}`} />
                        <span>{job.assignedAgent}</span>
                        <small>{readable(job.status)}</small>
                    </div>
                ))}
            </div>
            <div className="workflow-banner__actions">
                <button type="button" onClick={() => setActive('map')} disabled={activePage === 'map'}><IconTopologyStar3 size={15} /> Office Map</button>
                <button type="button" onClick={() => setActive('jobs')} disabled={activePage === 'jobs'}><IconBriefcase2 size={15} /> Jobs <IconArrowRight size={14} /></button>
            </div>
        </aside>
    );
}
