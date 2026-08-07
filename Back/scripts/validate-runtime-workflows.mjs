import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'carlos-office-workflow-'));
process.env.OBSIDIAN_VAULT_PATH = vault;
process.env.JOB_TRACE_RETENTION_MS = '60000';
process.env.RUNTIME_EVENT_RETENTION_MS = '60000';

const { runWithExecutionContext } = await import('../src/lib/executionContext.mjs');
const { createJob, listJobs, updateJob } = await import('../src/lib/jobLifecycle.mjs');
const { emitRuntimeEvent, getRuntimeWorkflow, listRuntimeEvents } = await import('../src/lib/runtimeWorkflows.mjs');

try {
    const job = await runWithExecutionContext({
        requestId: 'request-test-1',
        conversationId: 'temporary-chat-test',
        objective: 'Evaluate a delegated workflow.',
        agentId: 'nora',
    }, () => createJob({
        createdBy: 'nora',
        assignedAgent: 'iris',
        title: 'Research test',
        instructions: 'Research the requested subject.',
        expectedResult: 'A verified brief.',
        acceptanceCriteria: ['Evidence is verified.'],
        priority: 'normal',
        maxIterations: 2,
        status: 'queued',
    }));

    assert.ok(job.workflowId, 'Nora-created job must attach to the originating runtime workflow.');
    assert.equal(job.waitingOn, 'iris');

    emitRuntimeEvent({
        workflowId: job.workflowId,
        jobId: job.jobId,
        type: 'qc.routed',
        from: 'iris',
        to: 'vera',
        fromNode: `job:${job.jobId}`,
        toNode: 'agent:vera',
        stage: 'qc-review',
        summary: 'Test event.',
        tone: 'qc',
    });
    assert.ok(listRuntimeEvents({ workflowId: job.workflowId }).some(event => event.type === 'qc.routed'));

    await updateJob(job.jobId, {
        status: 'needs_attention',
        waitingOn: 'carlos',
        attentionReason: 'vera_iteration_limit',
        attentionMessage: 'Vera requested another revision after iteration 2/2.',
        qcVerdict: 'revise',
        qcScore: 72,
        qcFeedback: 'One mandatory criterion remains unmet.',
        currentIteration: 2,
    });

    const jobs = await listJobs({ limit: 20 });
    const workflow = getRuntimeWorkflow(job.workflowId, { jobs });
    assert.equal(workflow.status, 'needs_attention');
    assert.equal(workflow.waitingOn, 'carlos');
    assert.equal(workflow.attentionReason, 'vera_iteration_limit');
    assert.match(workflow.attentionMessage, /Vera requested another revision/i);

    console.log('Runtime workflow contract passed.');
    console.log(`Disposable vault: ${vault}`);
} finally {
    await fs.rm(vault, { recursive: true, force: true });
}
