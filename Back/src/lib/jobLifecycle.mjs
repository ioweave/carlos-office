import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
    createJob as createStoredJob,
    getJob as getStoredJob,
    listJobs as listStoredJobs,
    updateJob as updateStoredJob,
} from './officeStore.mjs';
import { getVaultPath, invalidateIndex } from './memoryCore.mjs';
import { getExecutionContext } from './executionContext.mjs';
import { attachJobToWorkflow, ensureRuntimeWorkflow, workflowForJob } from './runtimeWorkflows.mjs';

const traces = new Map();
const traceTtlMs = Math.max(60_000, Number(process.env.JOB_TRACE_RETENTION_MS || 86_400_000));
const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'needs_attention', 'awaiting_approval']);
const clone = value => structuredClone(value);
const now = () => new Date().toISOString();

const traceFrom = job => ({
    jobId: job.jobId,
    status: String(job.status || ''),
    attempts: clone(job.attempts || []),
    messages: clone(job.messages || []),
    result: String(job.result || ''),
    workflowId: String(job.workflowId || workflowForJob(job.jobId) || ''),
    waitingOn: String(job.waitingOn || ''),
    attentionReason: String(job.attentionReason || ''),
    attentionMessage: String(job.attentionMessage || ''),
    retainedAt: now(),
    expiresAt: new Date(Date.now() + traceTtlMs).toISOString(),
});

const prune = () => {
    const time = Date.now();
    for (const [jobId, trace] of traces.entries()) {
        if (new Date(trace.expiresAt).getTime() <= time) traces.delete(jobId);
    }
};

const mergeTrace = job => {
    if (!job) return null;
    prune();
    const trace = traces.get(job.jobId);
    return trace ? {
        ...job,
        attempts: clone(trace.attempts),
        messages: clone(trace.messages),
        result: trace.result,
        workflowId: trace.workflowId,
        waitingOn: trace.waitingOn,
        attentionReason: trace.attentionReason,
        attentionMessage: trace.attentionMessage,
        traceRetention: 'memory',
        traceExpiresAt: trace.expiresAt,
    } : {
        ...job,
        workflowId: workflowForJob(job.jobId),
        waitingOn: job.status === 'needs_attention' || job.status === 'awaiting_approval' ? 'carlos' : '',
        attentionReason: '',
        attentionMessage: '',
        traceRetention: 'receipt-only',
        traceExpiresAt: null,
    };
};

const compactUpdate = (next, update) => {
    const terminal = terminalStatuses.has(next.status);
    return {
        ...update,
        attempts: [],
        messages: [],
        result: terminal ? String(next.result || '').slice(0, Number(process.env.JOB_RECEIPT_RESULT_CHARS || 80_000)) : '',
        qcFeedback: String(next.qcFeedback || '').slice(0, 12_000),
        lastError: String(next.lastError || '').slice(0, 4000),
    };
};

const deleteStoredJob = async jobId => {
    const stored = await getStoredJob(jobId);
    if (!stored) throw Object.assign(new Error('Job not found.'), { statusCode: 404 });
    const root = path.resolve(getVaultPath());
    const target = path.resolve(root, String(stored.path || ''));
    if (!stored.path || target === root || !target.startsWith(`${root}${path.sep}`)) {
        throw Object.assign(new Error('Stored job path is invalid.'), { statusCode: 400 });
    }
    await fs.rm(target, { force: true });
    invalidateIndex();
    return { jobId, deleted: true };
};

export const createJob = async value => {
    const stored = await createStoredJob(value);
    const context = getExecutionContext();
    let workflowId = '';
    if (context.agentId === 'nora' && context.requestId) {
        const workflow = ensureRuntimeWorkflow({
            requestId: context.requestId,
            conversationId: context.conversationId,
            objective: context.objective,
            title: context.objective || stored.title,
            plan: 'Nora delegated one or more jobs from the current request. Workers execute, Vera verifies, then Nora performs final plan review.',
        });
        workflowId = workflow.workflowId;
        attachJobToWorkflow(workflowId, stored);
    }
    const decorated = { ...stored, workflowId, waitingOn: stored.assignedAgent };
    traces.set(stored.jobId, traceFrom(decorated));
    await updateStoredJob(stored.jobId, compactUpdate(decorated, { attempts: [], messages: [], result: '' }));
    return mergeTrace(decorated);
};

export const getJob = async jobId => mergeTrace(await getStoredJob(jobId));

export const listJobs = async args => (await listStoredJobs(args)).map(mergeTrace);

export const updateJob = async (jobId, update = {}) => {
    const stored = await getStoredJob(jobId);
    if (!stored) throw Object.assign(new Error('Job not found.'), { statusCode: 404 });
    const current = mergeTrace(stored);
    const next = {
        ...current,
        ...update,
        attempts: update.attempts === undefined ? current.attempts : clone(update.attempts),
        messages: update.messages === undefined ? current.messages : clone(update.messages),
        result: update.result === undefined ? current.result : String(update.result || ''),
        updatedAt: now(),
    };
    traces.set(jobId, traceFrom(next));
    const receipt = await updateStoredJob(jobId, compactUpdate(next, update));
    return mergeTrace({ ...receipt, workflowId: next.workflowId, result: terminalStatuses.has(next.status) ? receipt.result : '' });
};

export const deleteJob = async jobId => {
    traces.delete(jobId);
    return deleteStoredJob(jobId);
};

export const clearJobTraces = ({ terminalOnly = false } = {}) => {
    prune();
    if (!terminalOnly) {
        const count = traces.size;
        traces.clear();
        return { cleared: count };
    }
    let count = 0;
    for (const [jobId, trace] of traces.entries()) {
        if (!terminalStatuses.has(trace.status)) continue;
        traces.delete(jobId);
        count += 1;
    }
    return { cleared: count };
};

export const jobTraceStatus = () => {
    prune();
    return { traces: traces.size, ttlMs: traceTtlMs };
};
