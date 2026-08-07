import { randomUUID } from 'node:crypto';

const workflows = new Map();
const jobWorkflow = new Map();
const requestWorkflow = new Map();
const events = [];
const eventRetentionMs = Math.max(60_000, Number(process.env.RUNTIME_EVENT_RETENTION_MS || 300_000));
const workflowRetentionMs = Math.max(eventRetentionMs, Number(process.env.RUNTIME_WORKFLOW_RETENTION_MS || 86_400_000));
const terminal = new Set(['completed', 'failed', 'cancelled', 'needs_attention', 'awaiting_approval']);
const active = new Set(['queued', 'running', 'qc_review', 'nora_review']);
const now = () => new Date().toISOString();
const clone = value => structuredClone(value);

const prune = () => {
    const cutoff = Date.now() - eventRetentionMs;
    while (events.length && new Date(events[0].createdAt).getTime() < cutoff) events.shift();
    const workflowCutoff = Date.now() - workflowRetentionMs;
    for (const [id, workflow] of workflows.entries()) {
        if (!workflow.completedAt) continue;
        if (new Date(workflow.completedAt).getTime() >= workflowCutoff) continue;
        workflows.delete(id);
        workflow.jobIds.forEach(jobId => jobWorkflow.delete(jobId));
        if (workflow.requestId) requestWorkflow.delete(workflow.requestId);
    }
};

export const emitRuntimeEvent = input => {
    prune();
    const event = {
        eventId: randomUUID(),
        type: String(input.type || 'runtime.event'),
        workflowId: String(input.workflowId || ''),
        jobId: String(input.jobId || ''),
        from: String(input.from || ''),
        to: String(input.to || ''),
        fromNode: String(input.fromNode || (input.from ? `agent:${input.from}` : '')),
        toNode: String(input.toNode || (input.to ? `agent:${input.to}` : '')),
        stage: String(input.stage || ''),
        summary: String(input.summary || ''),
        iteration: Math.max(0, Number(input.iteration || 0)),
        tone: String(input.tone || 'info'),
        createdAt: now(),
    };
    events.push(event);
    if (events.length > 2000) events.splice(0, events.length - 2000);
    return clone(event);
};

export const createRuntimeWorkflow = ({ title, objective = '', plan = '', conversationId = '', requestId = '' } = {}) => {
    prune();
    const workflowId = randomUUID();
    const workflow = {
        workflowId,
        requestId: String(requestId || ''),
        title: String(title || objective || 'Delegated workflow').trim().slice(0, 140),
        objective: String(objective || '').trim(),
        plan: String(plan || '').trim(),
        conversationId: String(conversationId || ''),
        status: 'planning',
        stage: 'planning',
        waitingOn: 'nora',
        attentionReason: '',
        attentionMessage: '',
        jobIds: [],
        createdAt: now(),
        updatedAt: now(),
        completedAt: '',
    };
    workflows.set(workflowId, workflow);
    if (workflow.requestId) requestWorkflow.set(workflow.requestId, workflowId);
    emitRuntimeEvent({
        type: 'workflow.planned', workflowId, from: 'nora', to: 'office',
        fromNode: 'agent:nora', toNode: 'agent:nora', stage: 'planning',
        summary: workflow.plan || workflow.objective || workflow.title,
    });
    return clone(workflow);
};

export const ensureRuntimeWorkflow = ({ requestId = '', conversationId = '', objective = '', title = '', plan = '' } = {}) => {
    prune();
    const key = String(requestId || '');
    const existingId = key ? requestWorkflow.get(key) : '';
    if (existingId && workflows.has(existingId)) return clone(workflows.get(existingId));
    return createRuntimeWorkflow({ requestId: key, conversationId, objective, title: title || objective, plan });
};

export const workflowForRequest = requestId => requestWorkflow.get(String(requestId || '')) || '';

export const attachJobToWorkflow = (workflowId, job) => {
    if (!workflowId) return null;
    const workflow = workflows.get(String(workflowId));
    if (!workflow) throw Object.assign(new Error('Workflow not found or expired.'), { statusCode: 404 });
    if (!workflow.jobIds.includes(job.jobId)) workflow.jobIds.push(job.jobId);
    workflow.status = 'running';
    workflow.stage = 'delegating';
    workflow.waitingOn = job.assignedAgent || 'worker';
    workflow.updatedAt = now();
    jobWorkflow.set(job.jobId, workflow.workflowId);
    emitRuntimeEvent({
        type: 'job.assigned', workflowId: workflow.workflowId, jobId: job.jobId,
        from: 'nora', to: job.assignedAgent, fromNode: 'agent:nora', toNode: `job:${job.jobId}`,
        stage: 'delegated', summary: `${job.title} assigned to ${job.assignedAgent}.`, tone: 'info',
    });
    emitRuntimeEvent({
        type: 'job.routed', workflowId: workflow.workflowId, jobId: job.jobId,
        from: 'nora', to: job.assignedAgent, fromNode: `job:${job.jobId}`, toNode: `agent:${job.assignedAgent}`,
        stage: 'queued', summary: `${job.assignedAgent} received the assignment.`, tone: 'info',
    });
    return clone(workflow);
};

export const workflowForJob = jobId => jobWorkflow.get(String(jobId || '')) || '';

export const updateRuntimeWorkflow = (workflowId, update = {}) => {
    const workflow = workflows.get(String(workflowId || ''));
    if (!workflow) return null;
    Object.assign(workflow, update, { updatedAt: now() });
    if (['completed', 'failed', 'cancelled', 'needs_attention'].includes(workflow.status) && !workflow.completedAt) workflow.completedAt = now();
    return clone(workflow);
};

const summarizeWorkflow = (workflow, jobs = []) => {
    const members = workflow.jobIds.map(jobId => jobs.find(job => job.jobId === jobId)).filter(Boolean);
    if (!members.length) return clone(workflow);
    const attentionJob = members.find(job => ['needs_attention', 'awaiting_approval'].includes(job.status));
    const failedJob = members.find(job => job.status === 'failed');
    const cancelledJob = members.find(job => job.status === 'cancelled');
    const activeJob = members.find(job => active.has(job.status));
    const allCompleted = members.length === workflow.jobIds.length && members.every(job => job.status === 'completed');
    let status = workflow.status;
    let stage = workflow.stage;
    let waitingOn = workflow.waitingOn;
    let attentionReason = workflow.attentionReason;
    let attentionMessage = workflow.attentionMessage;
    if (attentionJob) {
        status = 'needs_attention'; stage = 'needs-carlos'; waitingOn = 'carlos';
        attentionReason = attentionJob.attentionReason || (attentionJob.qcVerdict === 'revise' ? 'vera_iteration_limit' : 'nora_iteration_limit');
        attentionMessage = attentionJob.attentionMessage || attentionJob.qcFeedback || `${attentionJob.title} needs a decision.`;
    } else if (failedJob) {
        status = 'failed'; stage = 'failed'; waitingOn = 'carlos'; attentionReason = 'job_failed'; attentionMessage = failedJob.lastError || `${failedJob.title} failed.`;
    } else if (cancelledJob && members.every(job => terminal.has(job.status))) {
        status = 'cancelled'; stage = 'cancelled'; waitingOn = '';
    } else if (allCompleted) {
        status = 'completed'; stage = 'complete'; waitingOn = 'nora';
    } else if (activeJob) {
        status = 'running'; stage = activeJob.status; waitingOn = activeJob.status === 'qc_review' ? 'vera' : activeJob.status === 'nora_review' ? 'nora' : activeJob.assignedAgent;
    } else if (members.some(job => job.status === 'queued')) {
        status = 'running'; stage = 'queued'; waitingOn = members.find(job => job.status === 'queued')?.assignedAgent || 'worker';
    }
    return { ...workflow, status, stage, waitingOn, attentionReason, attentionMessage, jobs: members.map(job => ({
        jobId: job.jobId, title: job.title, assignedAgent: job.assignedAgent, status: job.status,
        currentIteration: job.currentIteration, maxIterations: job.maxIterations, qcVerdict: job.qcVerdict,
        qcScore: job.qcScore, waitingOn: job.waitingOn || '', attentionReason: job.attentionReason || '',
        attentionMessage: job.attentionMessage || '', result: job.result || '', updatedAt: job.updatedAt,
    })) };
};

export const listRuntimeWorkflows = ({ jobs = [], conversationId = '' } = {}) => {
    prune();
    return [...workflows.values()]
        .filter(item => !conversationId || item.conversationId === conversationId)
        .map(item => summarizeWorkflow(item, jobs))
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
};

export const getRuntimeWorkflow = (workflowId, { jobs = [] } = {}) => {
    prune();
    const workflow = workflows.get(String(workflowId || ''));
    return workflow ? summarizeWorkflow(workflow, jobs) : null;
};

export const listRuntimeEvents = ({ workflowId = '', jobId = '', limit = 300 } = {}) => {
    prune();
    return events.filter(event => (!workflowId || event.workflowId === workflowId) && (!jobId || event.jobId === jobId))
        .slice(-Math.max(1, Math.min(Number(limit) || 300, 1000))).map(clone);
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export const waitForRuntimeWorkflow = async (workflowId, { timeoutMs = 180_000, pollMs = 400 } = {}) => {
    const id = String(workflowId || '');
    const deadline = Date.now() + Math.max(1_000, Math.min(Number(timeoutMs) || 180_000, 600_000));
    while (Date.now() < deadline) {
        const { listJobs } = await import('./jobLifecycle.mjs');
        const jobs = await listJobs({ limit: 500 });
        const workflow = getRuntimeWorkflow(id, { jobs });
        if (!workflow) throw Object.assign(new Error('Workflow not found or expired.'), { statusCode: 404 });
        if (['completed', 'failed', 'cancelled', 'needs_attention'].includes(workflow.status)) {
            updateRuntimeWorkflow(id, { status: workflow.status, stage: workflow.stage, waitingOn: workflow.waitingOn, attentionReason: workflow.attentionReason, attentionMessage: workflow.attentionMessage });
            return { ...workflow, events: listRuntimeEvents({ workflowId: id, limit: 120 }) };
        }
        await delay(Math.max(100, Math.min(Number(pollMs) || 400, 2000)));
    }
    const { listJobs } = await import('./jobLifecycle.mjs');
    const jobs = await listJobs({ limit: 500 });
    return { ...getRuntimeWorkflow(id, { jobs }), timedOut: true, events: listRuntimeEvents({ workflowId: id, limit: 120 }) };
};

export const runtimeWorkflowStatus = () => {
    prune();
    return { workflows: workflows.size, events: events.length, eventRetentionMs, workflowRetentionMs };
};
