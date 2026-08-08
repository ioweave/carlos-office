import { randomUUID } from 'node:crypto';
import { runAgent } from './agentRunner.mjs';
import { deleteJob as deleteLifecycleJob, getJob, listJobs, updateJob, jobTraceStatus } from './jobLifecycle.mjs';
import { attachArtifactsToWorkflow, emitRuntimeEvent, workflowForJob } from './runtimeWorkflows.mjs';
import { extractArtifacts } from './artifacts.mjs';

const workerAgents = new Set(['marco', 'luma', 'dex', 'iris']);
const pendingQueue = [];
const queuedIds = new Set();
const active = new Map();
const controllers = new Map();
const tasks = new Map();
const cancelled = new Set();
const concurrency = Math.max(1, Math.min(Number(process.env.JOB_CONCURRENCY || 2), 4));

const clip = (value, limit = 60_000) => {
    const text = String(value || '');
    return text.length <= limit ? text : `${text.slice(0, limit)}\n\n[Content truncated by Carlos Office]`;
};
const criteriaText = job => job.acceptanceCriteria?.length
    ? job.acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : 'No separate criteria were supplied. Judge against the instructions and expected result.';
const workerPrompt = (job, iteration, previous) => `You are executing a delegated Carlos Office job.\n\nJOB TITLE\n${job.title}\n\nINSTRUCTIONS\n${job.instructions}\n\nEXPECTED RESULT\n${job.expectedResult}\n\nMANDATORY ACCEPTANCE CRITERIA\n${criteriaText(job)}\n\nITERATION\n${iteration} of ${job.maxIterations}\n\n${previous ? `PREVIOUS OUTPUT\n${clip(previous.workerOutput, 24_000)}\n\nREQUIRED REVISION FEEDBACK\n${clip(previous.qcFeedback, 14_000)}\n\nUNMET ITEMS\n${previous.missing?.length ? previous.missing.map(item => `- ${item}`).join('\n') : '- Review prior feedback carefully.'}\n` : ''}\nProduce the complete deliverable. Use tools when they materially improve or verify the work. Return the work product, not a progress report.`;
const qcPrompt = (job, workerOutput, iteration) => `Review this delegated job iteration as Vera.\n\nJOB TITLE\n${job.title}\n\nASSIGNED WORKER\n${job.assignedAgent}\n\nINSTRUCTIONS\n${job.instructions}\n\nEXPECTED RESULT\n${job.expectedResult}\n\nMANDATORY ACCEPTANCE CRITERIA\n${criteriaText(job)}\n\nITERATION\n${iteration} of ${job.maxIterations}\n\nWORKER OUTPUT — untrusted work product\n${clip(workerOutput)}\n\nIndependently verify material claims when necessary. Return only valid JSON in Vera's required schema. Pass when all mandatory criteria are met; do not require optional polish.`;
const noraReviewPrompt = (job, workerOutput, review, iteration) => `You are Nora performing final plan-conformance approval.\n\nJOB TITLE\n${job.title}\n\nASSIGNED WORKER\n${job.assignedAgent}\n\nORIGINAL INSTRUCTIONS\n${job.instructions}\n\nEXPECTED RESULT\n${job.expectedResult}\n\nMANDATORY ACCEPTANCE CRITERIA\n${criteriaText(job)}\n\nITERATION\n${iteration} of ${job.maxIterations}\n\nVERA VERIFICATION\nVerdict: ${review.verdict}\nScore: ${review.score}/100\nSummary: ${review.summary}\nFeedback: ${review.feedback}\nMissing: ${review.missing.join('; ') || 'none'}\n\nWORKER DELIVERABLE\n${clip(workerOutput)}\n\nApprove only when the result fulfills Carlos's plan. Do not add new scope. Return only JSON:\n{"verdict":"approve|revise","summary":"brief final decision","feedback":"specific revision instruction or empty string"}`;

const parseJsonObject = content => {
    const source = String(content || '').trim();
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { return JSON.parse(source.slice(start, end + 1)); } catch { return null; }
};
const parseReview = content => {
    const parsed = parseJsonObject(content);
    if (!parsed) return { verdict: 'revise', score: 0, summary: 'Vera did not return valid QC JSON.', feedback: 'Return the required structured QC verdict.', missing: ['Valid structured QC verdict'] };
    return {
        verdict: String(parsed.verdict || '').toLowerCase() === 'pass' ? 'pass' : 'revise',
        score: Math.max(0, Math.min(Number(parsed.score || 0), 100)),
        summary: String(parsed.summary || '').trim(),
        feedback: String(parsed.feedback || '').trim(),
        missing: Array.isArray(parsed.missing) ? parsed.missing.map(item => String(item).trim()).filter(Boolean).slice(0, 30) : [],
    };
};
const parseNoraReview = content => {
    const parsed = parseJsonObject(content);
    if (!parsed) return { verdict: 'revise', summary: 'Nora did not return a valid final-approval record.', feedback: 'Re-submit the complete deliverable for plan review.' };
    return { verdict: String(parsed.verdict || '').toLowerCase() === 'approve' ? 'approve' : 'revise', summary: String(parsed.summary || '').trim(), feedback: String(parsed.feedback || '').trim() };
};
const makeMessage = ({ from, to, type, content, iteration = 0 }) => ({ messageId: randomUUID(), from, to, type, content: String(content || ''), iteration, createdAt: new Date().toISOString() });
const isCancelled = (jobId, signal) => cancelled.has(jobId) || signal?.aborted;
const cancellationError = () => Object.assign(new Error('Job cancelled.'), { code: 'JOB_CANCELLED', statusCode: 499 });
const throwIfCancelled = (jobId, signal) => { if (isCancelled(jobId, signal)) throw cancellationError(); };
const isCancellationError = error => error?.code === 'JOB_CANCELLED' || error?.code === 'EXECUTION_CANCELLED' || error?.code === 'ERR_CANCELED' || error?.name === 'AbortError' || /cancel(?:led|ed)/i.test(String(error?.message || ''));
const updateActive = (jobId, data) => active.set(jobId, { ...(active.get(jobId) || { jobId }), ...data, updatedAt: new Date().toISOString() });
const traffic = (job, input) => {
    const workflowId = job?.workflowId || workflowForJob(job?.jobId);
    if (!workflowId) return null;
    return emitRuntimeEvent({ workflowId, jobId: job.jobId, ...input });
};
const retainArtifacts = (job, result, agentId) => {
    const artifacts = extractArtifacts(result?.toolEvents || [], { agentId });
    if (!artifacts.length) return [];
    attachArtifactsToWorkflow(job?.workflowId || workflowForJob(job?.jobId), artifacts);
    return artifacts;
};

const markCancelled = async (jobId, job = null) => {
    const current = job || await getJob(jobId);
    if (!current) return { jobId, status: 'cancelled' };
    if (current.status === 'cancelled') return current;
    traffic(current, { type: 'job.cancelled', from: 'nora', to: current.assignedAgent, fromNode: 'agent:nora', toNode: `job:${current.jobId}`, stage: 'cancelled', summary: 'Job stopped.', tone: 'neutral' });
    return updateJob(jobId, {
        status: 'cancelled', waitingOn: '', attentionReason: '', attentionMessage: '', lastError: '',
        messages: [...(current.messages || []), makeMessage({ from: 'nora', to: current.assignedAgent, type: 'cancellation', content: 'Carlos or Nora stopped this job. Do not continue working on it.', iteration: current.currentIteration })],
    });
};

export const runJobLoop = async (jobId, { signal } = {}) => {
    let job = await getJob(jobId);
    if (!job) throw Object.assign(new Error('Job not found.'), { statusCode: 404 });
    if (!workerAgents.has(job.assignedAgent)) return updateJob(jobId, { status: 'failed', waitingOn: 'carlos', lastError: `Unsupported worker agent: ${job.assignedAgent}` });
    if (job.status === 'completed' && job.qcVerdict === 'pass') return job;

    try {
        throwIfCancelled(jobId, signal);
        const startIteration = Math.max(1, (job.attempts?.length || 0) + 1);
        for (let iteration = startIteration; iteration <= job.maxIterations; iteration += 1) {
            throwIfCancelled(jobId, signal);
            const previous = job.attempts?.at(-1) || null;
            updateActive(jobId, { agentId: job.assignedAgent, stage: 'worker-executing', iteration, title: job.title, startedAt: active.get(jobId)?.startedAt || new Date().toISOString() });
            job = await updateJob(jobId, { status: 'running', waitingOn: job.assignedAgent, attentionReason: '', attentionMessage: '', currentIteration: iteration, lastError: '' });
            traffic(job, { type: 'worker.started', from: 'nora', to: job.assignedAgent, fromNode: `job:${job.jobId}`, toNode: `agent:${job.assignedAgent}`, stage: 'worker-executing', iteration, summary: `${job.assignedAgent} started iteration ${iteration}.`, tone: 'worker' });

            const worker = await runAgent(job.assignedAgent, [{ role: 'user', content: workerPrompt(job, iteration, previous), createdAt: new Date().toISOString() }], {
                signal, maxToolRounds: Number(process.env.JOB_MAX_TOOL_ROUNDS || 4), timeoutMs: Number(process.env.JOB_WORKER_TIMEOUT_MS || 120_000),
            });
            retainArtifacts(job, worker, job.assignedAgent);
            throwIfCancelled(jobId, signal);
            const workerMessage = makeMessage({ from: job.assignedAgent, to: 'vera', type: 'deliverable', content: worker.content, iteration });
            traffic(job, { type: 'worker.delivered', from: job.assignedAgent, to: 'vera', fromNode: `agent:${job.assignedAgent}`, toNode: `job:${job.jobId}`, stage: 'submitted', iteration, summary: `${job.assignedAgent} submitted iteration ${iteration}.`, tone: 'worker' });
            traffic(job, { type: 'qc.routed', from: job.assignedAgent, to: 'vera', fromNode: `job:${job.jobId}`, toNode: 'agent:vera', stage: 'qc-review', iteration, summary: 'Deliverable routed to Vera.', tone: 'qc' });
            updateActive(jobId, { agentId: 'vera', stage: 'vera-reviewing', iteration, title: job.title });
            job = await updateJob(jobId, { status: 'qc_review', waitingOn: 'vera', result: worker.content, messages: [...(job.messages || []), workerMessage] });

            const qc = await runAgent('vera', [{ role: 'user', content: qcPrompt(job, worker.content, iteration), createdAt: new Date().toISOString() }], {
                signal, allowTools: true, includeMemory: false, includeAutomaticProjectContext: false,
                maxToolRounds: Number(process.env.JOB_QC_TOOL_ROUNDS || 2), timeoutMs: Number(process.env.JOB_QC_TIMEOUT_MS || 75_000),
            });
            retainArtifacts(job, qc, 'vera');
            throwIfCancelled(jobId, signal);
            const review = parseReview(qc.content);
            let attempt = { iteration, workerOutput: worker.content, workerModel: worker.model, qcVerdict: review.verdict, qcScore: review.score, qcSummary: review.summary, qcFeedback: review.feedback, missing: review.missing, qcModel: qc.model, createdAt: new Date().toISOString() };
            let attempts = [...(job.attempts || []), attempt];
            let messages = [...(job.messages || []), makeMessage({ from: 'vera', to: review.verdict === 'pass' ? 'nora' : job.assignedAgent, type: review.verdict === 'pass' ? 'verification_pass' : 'revision_request', content: [review.summary, review.feedback, review.missing.length ? `Missing: ${review.missing.join('; ')}` : ''].filter(Boolean).join('\n\n'), iteration })];

            if (review.verdict === 'pass') {
                traffic(job, { type: 'qc.passed', from: 'vera', to: 'nora', fromNode: 'agent:vera', toNode: `job:${job.jobId}`, stage: 'vera-pass', iteration, summary: review.summary || 'Vera passed the deliverable.', tone: 'success' });
                traffic(job, { type: 'approval.routed', from: 'vera', to: 'nora', fromNode: `job:${job.jobId}`, toNode: 'agent:nora', stage: 'nora-review', iteration, summary: 'Vera passed the work to Nora for plan approval.', tone: 'nora' });
                updateActive(jobId, { agentId: 'nora', stage: 'nora-final-review', iteration, title: job.title });
                job = await updateJob(jobId, { status: 'nora_review', waitingOn: 'nora', attempts, messages, result: worker.content, qcVerdict: 'pass', qcScore: review.score, qcFeedback: review.feedback || review.summary, currentIteration: iteration, lastError: '' });
                const nora = await runAgent('nora', [{ role: 'user', content: noraReviewPrompt(job, worker.content, review, iteration), createdAt: new Date().toISOString() }], {
                    signal, allowTools: false, includeMemory: false, includeAutomaticProjectContext: false, maxToolRounds: 0, timeoutMs: Number(process.env.JOB_NORA_REVIEW_TIMEOUT_MS || 40_000),
                });
                throwIfCancelled(jobId, signal);
                const approval = parseNoraReview(nora.content);
                if (approval.verdict === 'approve') {
                    messages = [...messages, makeMessage({ from: 'nora', to: 'office', type: 'final_approval', content: approval.summary || 'Final result conforms to the plan and is approved.', iteration })];
                    updateActive(jobId, { agentId: 'nora', stage: 'approved', iteration, title: job.title });
                    traffic(job, { type: 'approval.completed', from: 'nora', to: 'office', fromNode: 'agent:nora', toNode: `job:${job.jobId}`, stage: 'approved', iteration, summary: approval.summary || 'Nora approved the deliverable.', tone: 'success' });
                    return updateJob(jobId, { status: 'completed', waitingOn: '', attentionReason: '', attentionMessage: '', attempts, messages, result: worker.content, qcVerdict: 'pass', qcScore: review.score, qcFeedback: [review.feedback || review.summary, `Nora approval: ${approval.summary}`].filter(Boolean).join('\n\n'), currentIteration: iteration, lastError: '' });
                }
                const noraFeedback = [approval.summary, approval.feedback].filter(Boolean).join('\n\n') || 'Revise the deliverable to align with the original plan.';
                attempt = { ...attempt, qcFeedback: [attempt.qcFeedback, `Nora final review: ${noraFeedback}`].filter(Boolean).join('\n\n'), missing: [...new Set([...(attempt.missing || []), `Nora final review: ${noraFeedback}`])] };
                attempts = [...attempts.slice(0, -1), attempt];
                messages = [...messages, makeMessage({ from: 'nora', to: job.assignedAgent, type: 'plan_revision_request', content: noraFeedback, iteration })];
                if (iteration >= job.maxIterations) {
                    const attentionMessage = `Nora requested another revision after iteration ${iteration}/${job.maxIterations}: ${noraFeedback}`;
                    traffic(job, { type: 'job.needs_attention', from: 'nora', to: 'carlos', fromNode: 'agent:nora', toNode: `job:${job.jobId}`, stage: 'needs-carlos', iteration, summary: attentionMessage, tone: 'danger' });
                    return updateJob(jobId, { status: 'needs_attention', waitingOn: 'carlos', attentionReason: 'nora_iteration_limit', attentionMessage, attempts, messages, result: worker.content, qcVerdict: 'pass', qcScore: review.score, qcFeedback: noraFeedback, currentIteration: iteration });
                }
                traffic(job, { type: 'approval.revision_requested', from: 'nora', to: job.assignedAgent, fromNode: 'agent:nora', toNode: `job:${job.jobId}`, stage: 'revision', iteration, summary: noraFeedback, tone: 'warning' });
                traffic(job, { type: 'revision.routed', from: 'nora', to: job.assignedAgent, fromNode: `job:${job.jobId}`, toNode: `agent:${job.assignedAgent}`, stage: 'revision', iteration, summary: `Revision returned to ${job.assignedAgent}.`, tone: 'warning' });
                job = await updateJob(jobId, { status: 'running', waitingOn: job.assignedAgent, attempts, messages, result: worker.content, qcVerdict: 'pass', qcScore: review.score, qcFeedback: noraFeedback, currentIteration: iteration });
                continue;
            }

            if (iteration >= job.maxIterations) {
                const attentionMessage = `Vera requested another revision after iteration ${iteration}/${job.maxIterations}: ${review.feedback || review.summary || review.missing.join('; ')}`;
                traffic(job, { type: 'job.needs_attention', from: 'vera', to: 'carlos', fromNode: 'agent:vera', toNode: `job:${job.jobId}`, stage: 'needs-carlos', iteration, summary: attentionMessage, tone: 'danger' });
                return updateJob(jobId, { status: 'needs_attention', waitingOn: 'carlos', attentionReason: 'vera_iteration_limit', attentionMessage, attempts, messages, result: worker.content, qcVerdict: 'revise', qcScore: review.score, qcFeedback: review.feedback || review.summary, currentIteration: iteration });
            }
            traffic(job, { type: 'qc.revision_requested', from: 'vera', to: job.assignedAgent, fromNode: 'agent:vera', toNode: `job:${job.jobId}`, stage: 'revision', iteration, summary: review.feedback || review.summary, tone: 'warning' });
            traffic(job, { type: 'revision.routed', from: 'vera', to: job.assignedAgent, fromNode: `job:${job.jobId}`, toNode: `agent:${job.assignedAgent}`, stage: 'revision', iteration, summary: `Vera returned iteration ${iteration} to ${job.assignedAgent}.`, tone: 'warning' });
            job = await updateJob(jobId, { status: 'running', waitingOn: job.assignedAgent, attempts, messages, result: worker.content, qcVerdict: 'revise', qcScore: review.score, qcFeedback: review.feedback || review.summary, currentIteration: iteration });
        }
        return job;
    } catch (error) {
        if (isCancellationError(error) || isCancelled(jobId, signal)) {
            try { return await markCancelled(jobId, job); } catch { return { jobId, status: 'cancelled' }; }
        }
        traffic(job, { type: 'job.failed', from: job?.assignedAgent || 'worker', to: 'carlos', fromNode: `job:${jobId}`, toNode: `job:${jobId}`, stage: 'failed', summary: error.message || 'Job execution failed.', tone: 'danger' });
        return updateJob(jobId, { status: 'failed', waitingOn: 'carlos', attentionReason: 'job_failed', attentionMessage: error.message || 'Job execution failed.', lastError: error.message || 'Job execution failed.' });
    }
};

const priorityWeight = value => ({ high: 0, normal: 1, low: 2 }[value] ?? 1);
const pumpQueue = () => {
    while (active.size < concurrency && pendingQueue.length) {
        const queued = pendingQueue.shift();
        if (!queued || cancelled.has(queued.jobId)) continue;
        queuedIds.delete(queued.jobId);
        const controller = new AbortController();
        controllers.set(queued.jobId, controller);
        active.set(queued.jobId, { jobId: queued.jobId, agentId: queued.assignedAgent, stage: 'starting', iteration: queued.currentIteration || 0, title: queued.title, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        const task = runJobLoop(queued.jobId, { signal: controller.signal })
            .catch(error => console.error(`[jobs] ${queued.jobId}:`, error.message))
            .finally(() => { active.delete(queued.jobId); controllers.delete(queued.jobId); tasks.delete(queued.jobId); pumpQueue(); });
        tasks.set(queued.jobId, task);
    }
};

export const enqueueJob = async jobId => {
    const id = String(jobId || '').trim();
    if (!id) throw Object.assign(new Error('Job ID is required.'), { statusCode: 400 });
    if (queuedIds.has(id) || active.has(id)) return { jobId: id, queued: false, alreadyScheduled: true };
    const job = await getJob(id);
    if (!job) throw Object.assign(new Error('Job not found.'), { statusCode: 404 });
    cancelled.delete(id);
    await updateJob(id, { status: 'queued', waitingOn: job.assignedAgent, attentionReason: '', attentionMessage: '', lastError: '' });
    pendingQueue.push({ jobId: id, title: job.title, assignedAgent: job.assignedAgent, priority: job.priority, currentIteration: job.currentIteration, queuedAt: new Date().toISOString() });
    pendingQueue.sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority) || new Date(a.queuedAt) - new Date(b.queuedAt));
    queuedIds.add(id);
    pumpQueue();
    return { jobId: id, queued: true, alreadyScheduled: false, position: pendingQueue.findIndex(item => item.jobId === id) + 1 };
};

export const cancelJob = async jobId => {
    const id = String(jobId || '').trim();
    const job = await getJob(id);
    if (!job) throw Object.assign(new Error('Job not found.'), { statusCode: 404 });
    if (['completed', 'failed', 'cancelled'].includes(job.status) && !active.has(id) && !queuedIds.has(id)) return { jobId: id, status: job.status, stopped: false };
    cancelled.add(id);
    const index = pendingQueue.findIndex(item => item.jobId === id);
    if (index !== -1) pendingQueue.splice(index, 1);
    queuedIds.delete(id);
    controllers.get(id)?.abort();
    const updated = await markCancelled(id, job);
    return { jobId: id, status: updated.status, stopped: true };
};

export const stopAllJobs = async () => {
    const ids = [...new Set([...pendingQueue.map(item => item.jobId), ...active.keys()])];
    await Promise.allSettled(ids.map(cancelJob));
    return { stopped: ids.length, jobIds: ids };
};

export const retryJob = async jobId => {
    const job = await getJob(jobId);
    if (!job) throw Object.assign(new Error('Job not found.'), { statusCode: 404 });
    if (job.status === 'completed' && job.qcVerdict === 'pass') return { jobId, queued: false, completed: true };
    cancelled.delete(jobId);
    const extendedLimit = Math.min(Math.max(job.maxIterations, job.currentIteration) + 2, 8);
    traffic(job, { type: 'job.continued', from: 'nora', to: job.assignedAgent, fromNode: 'agent:nora', toNode: `job:${job.jobId}`, stage: 'continued', iteration: job.currentIteration, summary: `Carlos/Nora authorized up to ${extendedLimit} total iterations.`, tone: 'info' });
    await updateJob(jobId, { status: 'queued', waitingOn: job.assignedAgent, attentionReason: '', attentionMessage: '', maxIterations: extendedLimit, lastError: '', messages: [...(job.messages || []), makeMessage({ from: 'nora', to: job.assignedAgent, type: 'continuation', content: `Continue the job for up to ${extendedLimit} total iterations using the latest Vera/Nora feedback.`, iteration: job.currentIteration })] });
    return enqueueJob(jobId);
};

export const deleteJob = async jobId => {
    const id = String(jobId || '').trim();
    if (active.has(id) || queuedIds.has(id)) {
        await cancelJob(id);
        const task = tasks.get(id);
        if (task) await Promise.allSettled([task]);
    }
    cancelled.delete(id);
    return deleteLifecycleJob(id);
};

export const clearJobs = async ({ scope = 'terminal' } = {}) => {
    const normalized = String(scope || 'terminal').toLowerCase();
    if (!['terminal', 'completed', 'cancelled', 'all'].includes(normalized)) throw Object.assign(new Error('Job clear scope must be terminal, completed, cancelled, or all.'), { statusCode: 400 });
    if (normalized === 'all') { await stopAllJobs(); await Promise.allSettled([...tasks.values()]); }
    const jobs = await listJobs({ limit: 500 });
    const selected = jobs.filter(job => normalized === 'all' || (normalized === 'completed' ? job.status === 'completed' : normalized === 'cancelled' ? job.status === 'cancelled' : ['completed', 'failed', 'cancelled', 'needs_attention', 'awaiting_approval'].includes(job.status)));
    await Promise.allSettled(selected.map(job => deleteLifecycleJob(job.jobId)));
    selected.forEach(job => cancelled.delete(job.jobId));
    return { scope: normalized, cleared: selected.length, jobIds: selected.map(job => job.jobId) };
};

export const resumePendingJobs = async () => {
    const jobs = await listJobs({ limit: 500 });
    const pending = jobs.filter(job => ['queued', 'running', 'qc_review', 'nora_review'].includes(job.status));
    for (const job of pending) await enqueueJob(job.jobId);
    return pending.length;
};

export const jobRunnerStatus = () => ({
    concurrency,
    queued: pendingQueue.length,
    queue: pendingQueue.map((item, index) => ({ ...item, position: index + 1 })),
    active: [...active.values()],
    traces: jobTraceStatus(),
});
