import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconCheck, IconClock, IconRefresh, IconShieldCheck, IconShieldLock, IconX } from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';

const decisions = ['allow', 'ask', 'deny'];
const tabs = ['Pending', 'Active grants', 'Policies', 'History'];
const label = value => String(value || '').replaceAll('-', ' ').replaceAll('_', ' ');
const time = value => value ? new Date(value).toLocaleString() : 'Inherited default';
const futureLocal = () => {
    const date = new Date(Date.now() + 3_600_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function AuthorizationsPage() {
    const [data, setData] = useState({ requests: [], policies: [], audit: [] });
    const [config, setConfig] = useState(null);
    const [busy, setBusy] = useState('');
    const [agents, setAgents] = useState(['*']);
    const [activeTab, setActiveTab] = useState('Pending');
    const [untilDialog, setUntilDialog] = useState(null);
    const load = useCallback(async () => {
        try {
            const [authorizations, platform, staff] = await Promise.all([api.get('/authorizations'), api.get('/platform-config'), api.get('/agents')]);
            setData(authorizations.data || {});
            setConfig(platform.data);
            setAgents(['*', ...(staff.data || []).map(item => item.agentId)]);
        } catch (error) { toast.error(error.response?.data?.error || 'Could not load authorization governance.'); }
    }, []);
    useEffect(() => { load(); const timer = setInterval(load, 8_000); return () => clearInterval(timer); }, [load]);
    const pending = (data.requests || []).filter(item => item.status === 'pending');
    const activeGrants = (data.requests || []).filter(item => item.status === 'approved' && (!item.validUntil || new Date(item.validUntil) > new Date()));
    const scopeMap = useMemo(() => new Map((config?.authorization?.scopes || []).map(item => [item.id, item])), [config]);

    const resolve = async (request, decision, persistPolicy = false, grant = 'once', validUntil = '') => {
        setBusy(request.requestId);
        try {
            await api.post(`/authorizations/${request.requestId}/resolve`, { decision, persistPolicy, grant, validUntil });
            toast.success(decision === 'approved' ? (persistPolicy ? 'Standing policy created.' : `Authorized for ${label(grant)}.`) : 'Request rejected.');
            setUntilDialog(null);
            await load();
        } catch (error) { toast.error(error.response?.data?.error || error.message); }
        finally { setBusy(''); }
    };
    const updatePolicy = async (agentId, scope, decision) => {
        const key = `${agentId}:${scope}`;
        setBusy(key);
        try { await api.put('/authorization-policies', { agentId, scope, decision }); toast.success('Authorization policy updated.'); await load(); }
        catch (error) { toast.error(error.response?.data?.error || error.message); }
        finally { setBusy(''); }
    };
    const currentPolicy = (agentId, scope) => (data.policies || []).find(item => item.agentId === agentId && item.scope === scope)?.decision
        || (data.policies || []).find(item => item.agentId === '*' && item.scope === scope)?.decision
        || scopeMap.get(scope)?.defaultPolicy || 'ask';

    return <div className="control-page authorization-page">
        <header className="control-page__header"><div><span className="eyebrow">Human authority plane</span><h1>Authorizations</h1><p>Carlos remains the authority boundary. Business approvals stay inside processes; technical grants govern the exact tools, resources, agents, jobs, and time windows shown here.</p></div><button className="secondary-button" onClick={load}><IconRefresh size={16} /> Refresh</button></header>
        <section className="control-summary"><article><strong>{pending.length}</strong><span>Pending decisions</span></article><article><strong>{activeGrants.length}</strong><span>Active scoped grants</span></article><article><strong>{config?.authorization?.scopes?.length || 0}</strong><span>Governed scopes</span></article><article><strong>{data.audit?.length || 0}</strong><span>Recent audit events</span></article></section>
        <nav className="authorization-tabs">{tabs.map(tab => <button key={tab} className={activeTab === tab ? 'is-active' : ''} onClick={() => setActiveTab(tab)}>{tab}{tab === 'Pending' && pending.length > 0 && <b>{pending.length}</b>}</button>)}</nav>

        {activeTab === 'Pending' && <section className="control-section"><header><div><h2>Decision inbox</h2><p>Every approval is tied to the requesting agent, action, scope, and execution context.</p></div></header><div className="authorization-inbox">{pending.map(request => <article className="authorization-request" key={request.requestId}><div className="authorization-request__icon"><IconClock size={20} /></div><div><header><strong>{request.action}</strong><span>{scopeMap.get(request.scope)?.label || label(request.scope)}</span></header><p><b>{request.agentId}</b> requested this at {time(request.requestedAt)}.</p><dl><dt>Job</dt><dd>{request.context?.jobId || 'No job'}</dd><dt>Conversation</dt><dd>{request.context?.conversationId || 'No conversation'}</dd><dt>Expires</dt><dd>{time(request.expiresAt)}</dd></dl><details><summary>Technical context</summary><pre>{JSON.stringify({ details: request.details, context: request.context }, null, 2)}</pre></details></div><div className="authorization-request__actions"><button className="primary-button" disabled={busy === request.requestId} onClick={() => resolve(request, 'approved')}><IconCheck size={15} /> Allow once</button>{request.context?.jobId && <button className="secondary-button" disabled={busy === request.requestId} onClick={() => resolve(request, 'approved', false, 'job')}>This job</button>}{request.context?.definitionId && <button className="secondary-button" disabled={busy === request.requestId} onClick={() => resolve(request, 'approved', false, 'process')}>Process version</button>}<button className="secondary-button" disabled={busy === request.requestId} onClick={() => setUntilDialog({ request, value: futureLocal() })}><IconClock size={15} /> Until…</button><button className="secondary-button" disabled={busy === request.requestId} onClick={() => resolve(request, 'approved', true)}>Standing</button><button className="secondary-button" disabled={busy === request.requestId} onClick={() => resolve(request, 'rejected')}><IconX size={15} /> Reject</button></div></article>)}{!pending.length && <div className="control-empty"><IconShieldLock size={28} /><strong>No actions are waiting</strong><span>The office can continue within its standing policies.</span></div>}</div></section>}

        {activeTab === 'Active grants' && <section className="control-section"><header><div><h2>Active grants</h2><p>Explicit technical authority currently available to a matching execution context.</p></div></header><div className="authorization-grants">{activeGrants.map(grant => <article key={grant.requestId}><IconShieldCheck size={20} /><span><strong>{scopeMap.get(grant.scope)?.label || label(grant.scope)}</strong><small>{grant.agentId} · {label(grant.grant)} · approved {time(grant.decidedAt)}</small><p>{grant.action}</p></span><em>{grant.validUntil ? `Until ${time(grant.validUntil)}` : grant.grant === 'standing' ? 'Standing policy' : grant.context?.jobId || grant.context?.definitionId || 'Single action'}</em></article>)}{!activeGrants.length && <div className="control-empty"><IconShieldCheck size={28} /><strong>No active scoped grants</strong><span>Standing defaults remain visible under Policies.</span></div>}</div></section>}

        {activeTab === 'Policies' && <section className="control-section"><header><div><h2>Standing policies</h2><p>Defaults by agent and scope. Explicit authority on the current Request remains higher priority.</p></div></header><div className="authorization-matrix" style={{ '--authorization-agent-count': agents.length }}><div className="authorization-matrix__head"><span>Scope</span>{agents.map(agent => <strong key={agent}>{agent === '*' ? 'Office' : agent}</strong>)}</div>{(config?.authorization?.scopes || []).map(scope => <div className="authorization-matrix__row" key={scope.id}><span><strong>{scope.label}</strong><small>{label(scope.id)}</small></span>{agents.map(agent => <select key={agent} value={currentPolicy(agent, scope.id)} disabled={busy === `${agent}:${scope.id}`} onChange={event => updatePolicy(agent, scope.id, event.target.value)}>{decisions.map(value => <option value={value} key={value}>{value}</option>)}</select>)}</div>)}</div></section>}

        {activeTab === 'History' && <section className="control-section"><header><div><h2>Authorization history</h2><p>Decisions and policy changes are append-only unless their identifiable conversation or job is permanently purged.</p></div></header><div className="audit-list">{(data.audit || []).slice(0, 120).map(event => <article key={event.auditId}><i className={`is-${event.type?.includes('denied') || event.type?.includes('rejected') ? 'danger' : event.type?.includes('allowed') || event.type?.includes('approved') ? 'success' : 'info'}`} /><span><strong>{label(event.type)}</strong><small>{event.actor} · {label(event.scope)} · {time(event.createdAt)}</small></span></article>)}</div></section>}

        {untilDialog && <div className="dialog" onMouseDown={event => event.target === event.currentTarget && setUntilDialog(null)}><section className="dialog__panel authorization-until"><header><div><span className="eyebrow">Time-bounded authority</span><h2>Authorize until</h2></div><button onClick={() => setUntilDialog(null)}><IconX size={17} /></button></header><p>{untilDialog.request.action} · {scopeMap.get(untilDialog.request.scope)?.label || label(untilDialog.request.scope)}</p><label><span>Valid until</span><input type="datetime-local" value={untilDialog.value} onChange={event => setUntilDialog({ ...untilDialog, value: event.target.value })} /></label><footer><button className="secondary-button" onClick={() => setUntilDialog(null)}>Cancel</button><button className="primary-button" onClick={() => resolve(untilDialog.request, 'approved', false, 'until', new Date(untilDialog.value).toISOString())}>Authorize</button></footer></section></div>}
    </div>;
}
