import { randomUUID } from 'node:crypto';
import { runAgent } from './agentRunner.mjs';
import { createPersistentMap } from './operationalStore.mjs';
import { getProcessRun } from './processEngine.mjs';
import { createOrUpdateLearnedSkill, listLearnedSkills, listSkills } from './skillRegistry.mjs';

const proposals = createPersistentMap('skill-evolution-proposals-v2');
const enabled = () => String(process.env.SKILL_EVOLUTION_ENABLED || 'true').toLowerCase() !== 'false';
const now = () => new Date().toISOString();
const clip = (value, limit = 8_000) => String(value || '').slice(0, limit);
const parseJson = content => { const text = String(content || ''); const start = text.indexOf('{'); const end = text.lastIndexOf('}'); if (start < 0 || end <= start) return null; try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; } };

export const reviewVerifiedJobForSkill = async jobId => {
    if (!enabled()) return { reviewed: false, reason: 'disabled' };
    if ([...proposals.values()].some(item => item.jobId === jobId)) return { reviewed: false, reason: 'already-reviewed' };
    const job = getProcessRun(jobId);
    if (!job || job.status !== 'completed' || !job.finalAssessment?.passed) return { reviewed: false, reason: 'job-not-verified' };
    const [installed, learned] = await Promise.all([listSkills(), listLearnedSkills()]);
    const prompt = `Review this completed, quality-gated process job for a reusable procedural improvement. Do not preserve project facts, secrets, task narrative, or one-off identifiers. Return JSON only with action propose|skip, name in lowercase-hyphen form, description, purpose, procedure array, verification array, pitfalls array, and reason. Carlos must approve any proposal before it becomes a learned skill.\n\nINSTALLED\n${JSON.stringify(installed.map(item => item.name))}\nLEARNED\n${JSON.stringify(learned.map(item => item.name))}\nJOB\n${JSON.stringify({ process: job.name, objective: clip(job.objective, 4_000), tasks: job.tasks.map(task => ({ name: task.name, agentId: task.agentId, result: clip(task.result, 4_000), quality: task.outputQuality?.score, attempts: task.attempts.length })), finalQuality: job.finalAssessment.score })}`;
    const result = await runAgent('nora', [{ role: 'user', content: prompt, createdAt: now() }], { requestId: `skill-review-${jobId}`, jobId, taskType: 'fast', allowTools: false, includeMemory: false, includeAutomaticProjectContext: false, maxToolRounds: 0, timeoutMs: Number(process.env.SKILL_EVOLUTION_TIMEOUT_MS || 300_000) });
    const value = parseJson(result.content);
    if (!value || value.action === 'skip') return { reviewed: true, proposed: false, reason: value?.reason || 'No reusable procedure found.' };
    const procedure = (Array.isArray(value.procedure) ? value.procedure : []).map(String).filter(Boolean).slice(0, 30);
    const verification = (Array.isArray(value.verification) ? value.verification : []).map(String).filter(Boolean).slice(0, 20);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.name || '') || !value.description || procedure.length < 2 || !verification.length) return { reviewed: true, proposed: false, reason: 'Invalid proposal contract.' };
    const proposal = { proposalId: randomUUID(), jobId, name: value.name, description: clip(value.description, 1_024), purpose: clip(value.purpose, 2_000), procedure, verification, pitfalls: (Array.isArray(value.pitfalls) ? value.pitfalls : []).map(String).slice(0, 20), reason: clip(value.reason, 1_000), status: 'pending', createdAt: now(), decidedAt: '' };
    proposals.set(proposal.proposalId, proposal); return { reviewed: true, proposed: true, proposal };
};

export const listSkillProposals = ({ status = '' } = {}) => [...proposals.values()].filter(item => !status || item.status === status).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(item => JSON.parse(JSON.stringify(item)));
export const purgeSkillProposalsForJob = jobId => {
    let deleted = 0;
    for (const [proposalId, proposal] of proposals.entries()) {
        if (proposal.jobId !== jobId) continue;
        proposals.delete(proposalId);
        deleted += 1;
    }
    return deleted;
};
export const resolveSkillProposal = async (proposalId, { decision, note = '' } = {}) => {
    const proposal = proposals.get(String(proposalId || '')); if (!proposal) throw Object.assign(new Error('Skill proposal not found.'), { statusCode: 404 });
    if (proposal.status !== 'pending') throw Object.assign(new Error('Skill proposal already resolved.'), { statusCode: 409 });
    if (!['approved', 'rejected'].includes(decision)) throw Object.assign(new Error('Decision must be approved or rejected.'), { statusCode: 400 });
    proposal.status = decision; proposal.note = clip(note, 2_000); proposal.decidedAt = now(); proposals.set(proposal.proposalId, proposal);
    if (decision === 'approved') {
        const body = [`# ${proposal.name.split('-').map(word => word[0]?.toUpperCase() + word.slice(1)).join(' ')}`, '', proposal.purpose || proposal.description, '', '## Procedure', '', ...proposal.procedure.map((step, index) => `${index + 1}. ${step}`), '', '## Verification', '', ...proposal.verification.map(item => `- ${item}`), ...(proposal.pitfalls.length ? ['', '## Pitfalls', '', ...proposal.pitfalls.map(item => `- ${item}`)] : [])].join('\n');
        proposal.skill = await createOrUpdateLearnedSkill({ name: proposal.name, description: proposal.description, body, sourceJobId: proposal.jobId, sourceWorkflowId: `job:${proposal.jobId}`, evidence: [`job://${proposal.jobId}`] }); proposals.set(proposal.proposalId, proposal);
    }
    return JSON.parse(JSON.stringify(proposal));
};

export const reviewVerifiedWorkflowForSkill = reviewVerifiedJobForSkill;
export const skillEvolutionStatus = () => ({ enabled: enabled(), proposals: proposals.size, pending: [...proposals.values()].filter(item => item.status === 'pending').length, learned: [...proposals.values()].filter(item => item.status === 'approved').length });
