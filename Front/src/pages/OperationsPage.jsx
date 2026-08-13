import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    IconAlertTriangle,
    IconChartLine,
    IconClock,
    IconRefresh,
    IconShieldLock,
    IconTrendingUp,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';

const duration = value => value ? value < 60000 ? `${Math.round(value / 1000)}s` : `${Math.round(value / 60000)}m` : '—';
const label = value => String(value || '').replaceAll('_', ' ').replaceAll('-', ' ');
const breakdowns = [['Process', 'byProcess'], ['Job', 'byJob'], ['Task', 'byTask'], ['Agent', 'byAgent'], ['Tool', 'byTool'], ['Provider', 'byProvider'], ['Model', 'byModel']];

export default function OperationsPage() {
    const [data, setData] = useState(null);
    const [breakdown, setBreakdown] = useState('Process');
    const [incidentFilter, setIncidentFilter] = useState('all');
    const load = useCallback(async () => {
        try { setData((await api.get('/operations')).data); }
        catch (error) { toast.error(error.response?.data?.error || 'Could not load operations.'); }
    }, []);
    useEffect(() => { load(); const timer = setInterval(load, 10000); return () => clearInterval(timer); }, [load]);
    const selectedKey = breakdowns.find(([name]) => name === breakdown)?.[1];
    const rows = data?.[selectedKey] || [];
    const incidents = useMemo(() => (data?.incidents || []).filter(item => incidentFilter === 'all' || item.status === incidentFilter), [data?.incidents, incidentFilter]);

    return <div className="redesign-page operations-page">
        <header className="redesign-header"><div><span className="eyebrow">Operating health</span><h1>Operations</h1><p>Failures, recovery, queue pressure, execution time, authorization blocks, provider health, rework, and quality across every office layer.</p></div><button className="secondary-button" onClick={load}><IconRefresh size={16} /> Refresh</button></header>
        <section className="metric-grid">
            <article><IconChartLine /><span>Active jobs</span><strong>{data?.totals?.active || 0}</strong><small>{data?.totals?.jobs || 0} total · {data?.totals?.paused || 0} paused</small></article>
            <article><IconAlertTriangle /><span>Terminal failures</span><strong>{data?.failureRate || 0}%</strong><small>{data?.failedAttempts || 0} failed attempts</small></article>
            <article><IconClock /><span>Queue / execution</span><strong>{duration(data?.averageQueueMs)}</strong><small>{duration(data?.averageExecutionMs)} average execution</small></article>
            <article><IconShieldLock /><span>Authorization blocks</span><strong>{data?.authorizationBlocks || 0}</strong><small>Waiting on Carlos</small></article>
            <article><IconTrendingUp /><span>Final quality</span><strong>{data?.averageQuality || 0}</strong><small>Rework {data?.reworkRate || 0}% · override {data?.carlosOverrideRate || 0}%</small></article>
            <article><IconRefresh /><span>Recovery success</span><strong>{data?.recovery?.successRate || 0}%</strong><small>{data?.recovery?.succeeded || 0}/{data?.recovery?.attempted || 0} recovered</small></article>
        </section>

        <div className="operations-grid">
            <section className="panel operations-incidents"><header><div><h2>Incidents requiring attention</h2><span>Failed, paused, and authorization-blocked work</span></div><nav>{['all', 'failed', 'paused', 'waiting_authorization'].map(value => <button className={incidentFilter === value ? 'is-active' : ''} key={value} onClick={() => setIncidentFilter(value)}>{label(value)}</button>)}</nav></header><div className="incident-list">{incidents.map(item => <article key={item.jobId}><i className={`is-${item.status}`} /><span><strong>{item.task || item.processDefinitionId}</strong><small>{item.agentId || 'system'} · job {item.jobId.slice(0, 8)} · {new Date(item.updatedAt).toLocaleString()}</small><p>{item.error}</p></span><em>{label(item.status)}</em></article>)}{!incidents.length && <p className="muted">No incidents match this filter.</p>}</div></section>
            <section className="panel"><header><div><h2>Provider health</h2><span>Configured model providers</span></div></header><div className="provider-list">{(data?.providers || []).map(provider => <article key={provider.providerId}><i className={provider.health} /><span><strong>{provider.label}</strong><small>{provider.health}</small></span><em>{provider.enabled ? 'Enabled' : 'Disabled'}</em></article>)}</div></section>
            <section className="panel"><header><div><h2>Agent capacity</h2><span>One task per instance</span></div></header><div className="ops-table"><div className="ops-row ops-head"><span>Agent</span><span>Tasks</span><span>Failure</span><span>Capacity</span></div>{(data?.byAgent || []).map(agent => <div className="ops-row" key={agent.agentId}><strong>{agent.agentId}</strong><span>{agent.tasks}</span><span>{agent.failureRate}%</span><span>{agent.active}/{agent.maxInstances}</span></div>)}</div></section>
            <section className="panel"><header><div><h2>Quality dimensions</h2><span>Traceable 0–100 assessments</span></div></header><div className="quality-dimensions">{(data?.qualityByDimension || []).map(item => <article key={item.dimension}><header><strong>{label(item.dimension)}</strong><span>{item.average}</span></header><i><b style={{ width: `${item.average}%` }} /></i><small>{item.samples} assessed jobs</small></article>)}{!data?.qualityByDimension?.length && <p className="muted">No final assessments yet.</p>}</div></section>
        </div>

        <section className="panel operations-breakdown"><header><div><h2>Failure analysis</h2><span>Failed attempts versus terminal failures ({data?.terminalFailures || 0})</span></div><nav>{breakdowns.map(([name]) => <button key={name} className={breakdown === name ? 'is-active' : ''} onClick={() => setBreakdown(name)}>{name}</button>)}</nav></header><div className="ops-table operations-breakdown__table"><div className="ops-row ops-head"><span>ID</span><span>Attempts</span><span>Failures</span><span>Rate</span></div>{rows.map(row => <div className="ops-row" key={row.id || row.agentId}><strong title={row.id || row.agentId}>{row.id || row.agentId}</strong><span>{row.attempts ?? row.tasks ?? 0}</span><span>{row.failures || 0}</span><span>{row.failureRate || 0}%</span></div>)}{!rows.length && <p className="muted">No attempts recorded for this layer.</p>}</div></section>

        <section className="panel quality-trend"><header><div><h2>Quality trend</h2><span>Nora’s final handover assessments</span></div></header><div className="quality-bars">{(data?.qualityTrend || []).map(item => <article key={item.jobId} title={`${item.name}: ${item.score}`}><span style={{ height: `${item.score}%` }} /><small>{item.score}</small></article>)}{!data?.qualityTrend?.length && <p className="muted">Completed jobs will appear here.</p>}</div></section>
    </div>;
}
