import { useEffect, useMemo, useState } from 'react';
import { IconCheck, IconFileText, IconPlus, IconRefresh, IconSearch, IconShieldLock, IconSparkles, IconTrash } from '@tabler/icons-react';
import { toast } from 'sonner';
import api from '../api';

export default function SkillsPage() {
    const [skills, setSkills] = useState([]);
    const [selected, setSelected] = useState('');
    const [detail, setDetail] = useState(null);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [source, setSource] = useState('');
    const [agents, setAgents] = useState([]);
    const [proposals, setProposals] = useState([]);
    const [removeConfirm, setRemoveConfirm] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const [response, staff, reviews] = await Promise.all([api.get('/extensions'), api.get('/agents'), api.get('/skill-proposals')]);
            const next = response.data || [];
            setAgents(staff.data || []);
            setProposals(reviews.data || []);
            setSkills(next);
            setSelected(current => current && next.some(item => item.name === current) ? current : (next.find(item => !item.invalid)?.name || ''));
        } catch (error) {
            toast.error(error.response?.data?.error || 'Could not load the skill library.');
        } finally { setLoading(false); }
    };

    useEffect(() => { load(); }, []);
    useEffect(() => {
        if (!selected) { setDetail(null); return; }
        let active = true;
        api.get(`/extensions/${encodeURIComponent(selected)}`)
            .then(response => { if (active) setDetail(response.data); })
            .catch(error => toast.error(error.response?.data?.error || 'Could not activate this skill.'));
        return () => { active = false; };
    }, [selected]);

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return needle ? skills.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(needle)) : skills;
    }, [skills, query]);
    const provenance = detail?.manifest?.provenance || {};
    const manifestSource = detail?.manifest?.source || {};

    const install = async () => {
        try { await api.post('/extensions', { source }); toast.success('Extension installed and scanned.'); setSource(''); await load(); }
        catch (error) { toast.error(error.response?.data?.error || error.message); }
    };
    const remove = async () => {
        try { await api.delete(`/extensions/${encodeURIComponent(selected)}`, { params: { confirm: true } }); toast.success('Extension removed.'); setSelected(''); setRemoveConfirm(false); await load(); }
        catch (error) { toast.error(error.response?.data?.error || error.message); }
    };
    const resolveProposal = async (proposal, decision) => { try { await api.post(`/skill-proposals/${proposal.proposalId}/resolve`, { decision }); toast.success(decision === 'approved' ? 'Learned skill approved.' : 'Proposal rejected.'); await load(); } catch (error) { toast.error(error.response?.data?.error || error.message); } };

    return (
        <div className="standard-page skills-page">
            <div className="page-header">
                <div><div className="eyebrow">Reusable office expertise</div><h1>Skills</h1><p>One trusted descriptor tells every agent when and how to use a skill. Supporting files stay out of messages until an agent needs one.</p></div>
                <div className="security-note"><IconShieldLock size={17} /> Extensions never grant extra permissions</div>
            </div>
            <div className="skills-layout">
                <section className="skills-library">
                    <div className="skills-library__install"><input value={source} onChange={event => setSource(event.target.value)} placeholder="GitHub skill URL or approved local path" /><button type="button" className="primary-button" disabled={!source.trim()} onClick={install}><IconPlus size={15} /> Install</button></div>
                    <div className="skills-library__search"><IconSearch size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a skill" /><button type="button" onClick={load} aria-label="Refresh skill library"><IconRefresh size={16} /></button></div>
                    <div className="skills-library__list">
                        {loading && <div className="skills-empty">Loading skills…</div>}
                        {!loading && !filtered.length && <div className="skills-empty">No matching skills are installed.</div>}
                        {filtered.map(item => <button type="button" key={item.name} className={`skills-library__item ${selected === item.name ? 'active' : ''}`} onClick={() => setSelected(item.name)}><span><IconSparkles size={17} /></span><div><strong>{item.name}</strong><small>{item.invalid ? item.error : item.description}</small></div><em className={`is-${item.security?.risk || 'unknown'}`}>{item.security?.risk || 'unknown'}</em>{item.hashVerified && <IconCheck size={15} aria-label="Integrity verified" />}</button>)}
                    </div>
                </section>
                <section className="skill-detail">
                    {!detail && <div className="skills-empty">Choose a skill to inspect its universal descriptor.</div>}
                    {detail && <>
                        <div className="skill-detail__header"><span><IconSparkles size={21} /></span><div><div className="eyebrow">Available to all agents</div><h2>{detail.name}</h2><p>{detail.description}</p></div></div>
                        <div className="skill-detail__facts">
                            <div><small>Integrity</small><strong>{detail.descriptorHash ? 'Verified' : 'Legacy descriptor'}</strong></div>
                            <div><small>Supporting files</small><strong>{detail.resourceCount || 0}</strong></div>
                            <div><small>License</small><strong>{detail.license || 'Not declared'}</strong></div>
                            <div><small>Safety scan</small><strong>{detail.security?.risk || 'unknown'}</strong></div>
                        </div>
                        <div className="skill-detail__tools"><strong>Executable tool set</strong><p>A skill is strategy and practice. These named programmatic tools remain separately governed.</p><div>{(detail.requiredTools || []).map(tool => <b className={detail.missingTools?.includes(tool) ? 'is-missing' : ''} key={tool}>{tool}{detail.missingTools?.includes(tool) ? ' · missing' : ''}</b>)}</div>{!detail.requiredTools?.length && <small>This descriptor declares no specific tool functions.</small>}</div>
                        <div className="skill-detail__agents"><strong>Agent availability</strong><div>{agents.map(agent => <label key={agent.agentId}><input type="checkbox" checked={detail.enabledAgents?.includes(agent.agentId)} onChange={async event => { const enabledAgents = event.target.checked ? [...new Set([...(detail.enabledAgents || []), agent.agentId])] : (detail.enabledAgents || []).filter(item => item !== agent.agentId); try { await api.put(`/extensions/${encodeURIComponent(detail.name)}`, { enabledAgents }); setDetail({ ...detail, enabledAgents }); } catch (error) { toast.error(error.response?.data?.error || error.message); } }} />{agent.name}</label>)}</div></div>
                        {(manifestSource.repository || provenance.commitSha) && <div className="skill-detail__source"><IconFileText size={17} /><div><strong>{manifestSource.repository || 'Local skill'}</strong><span>{provenance.commitSha ? `Pinned at ${provenance.commitSha.slice(0, 12)}` : manifestSource.path}</span></div></div>}
                        <details className="skill-detail__descriptor"><summary>View complete descriptor</summary><pre>{detail.descriptor}</pre></details>
                        <button type="button" className="danger-button" onClick={() => setRemoveConfirm(true)}><IconTrash size={15} /> Remove extension</button>
                    </>}
                </section>
            </div>
            {!!proposals.filter(item => item.status === 'pending').length && <section className="skill-proposals"><header><div><span className="eyebrow">Nora proposals · Carlos approval required</span><h2>Skill improvements</h2></div></header>{proposals.filter(item => item.status === 'pending').map(proposal => <article key={proposal.proposalId}><div><strong>{proposal.name}</strong><p>{proposal.description}</p><small>Evidence: job {proposal.jobId}</small></div><details><summary>Review procedure</summary><ol>{proposal.procedure.map(step => <li key={step}>{step}</li>)}</ol><strong>Verification</strong><ul>{proposal.verification.map(item => <li key={item}>{item}</li>)}</ul></details><div><button className="primary-button" onClick={() => resolveProposal(proposal, 'approved')}>Approve skill</button><button className="secondary-button" onClick={() => resolveProposal(proposal, 'rejected')}>Reject</button></div></article>)}</section>}
            {removeConfirm && <div className="dialog" onMouseDown={event => event.target === event.currentTarget && setRemoveConfirm(false)}><section className="dialog__panel"><span className="eyebrow">Extension administration</span><h2>Remove {selected}?</h2><p>The playbook and its bundled resources will be removed. Registered executable tools remain separately governed and are not deleted implicitly.</p><div className="dialog__actions"><button className="secondary-button" onClick={() => setRemoveConfirm(false)}>Cancel</button><button className="danger-button" onClick={remove}><IconTrash size={15} /> Remove extension</button></div></section></div>}
        </div>
    );
}
