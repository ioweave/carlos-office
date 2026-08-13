import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'carlos-office-operational-'));
process.env.OFFICE_RUNTIME_DB_PATH = path.join(runtime, 'runtime.sqlite');
process.env.MEMORY_SEMANTIC_ENABLED = 'false';

const {
    completeOperationalWork,
    createPersistentList,
    createPersistentMap,
    enqueueOperationalWork,
    leaseNextOperationalWork,
    operationalStoreStatus,
} = await import('../src/lib/operationalStore.mjs');
const { resolveTaskModelRoute } = await import('../src/lib/modelRouting.mjs');
const { createRuntimeEventStream, publishRuntimeEvent } = await import('../src/lib/runtimeEventStream.mjs');

try {
    const jobs = createPersistentMap('test-jobs');
    jobs.set('job-1', { status: 'queued', tasks: [] });
    jobs.get('job-1').status = 'running';
    assert.equal(createPersistentMap('test-jobs').get('job-1').status, 'running', 'Nested durable-job mutations must persist immediately.');

    const events = createPersistentList('test-events');
    events.push({ type: 'job.queued' });
    assert.equal(createPersistentList('test-events').length, 1, 'Runtime event history must persist in SQLite.');

    enqueueOperationalWork({ kind: 'scheduled-request', payload: { scheduleId: 'schedule-1' }, dedupeKey: 'schedule:schedule-1:one' });
    const duplicate = enqueueOperationalWork({ kind: 'scheduled-request', payload: { scheduleId: 'schedule-1' }, dedupeKey: 'schedule:schedule-1:one' });
    assert.equal(duplicate.alreadyScheduled, true, 'Queue deduplication must prevent duplicate jobs.');
    const lease = leaseNextOperationalWork({ owner: 'validator', leaseMs: 10_000 });
    assert.equal(lease.payload.scheduleId, 'schedule-1');
    completeOperationalWork(lease.workId, 'validator');

    const route = resolveTaskModelRoute({
        agentId: 'dex',
        config: { provider: 'ollama', model: 'agent-default', baseUrl: 'http://localhost', temperature: 0.2, maxToolRounds: 4, modelPolicy: { mode: 'adaptive', allowedModelOptionIds: ['minimax-cloud', 'qwen-local'], preferredCapabilities: ['coding'] } },
        options: { taskType: 'coding', modelOptionId: 'qwen-local', allowTools: false },
    });
    assert.equal(route.config.model, 'qwen3:8b', 'A process-step model requirement must override task and agent preferences.');
    assert.equal(route.source, 'process-step:qwen-local');
    assert.equal(route.taskClass, 'coding');

    const stream = createRuntimeEventStream({ conversationId: 'conversation-1' });
    let payload = '';
    stream.on('data', chunk => { payload += chunk.toString(); });
    publishRuntimeEvent({ type: 'job.started', conversationId: 'conversation-1' });
    await new Promise(resolve => setImmediate(resolve));
    assert.match(payload, /event: runtime[\s\S]*job\.started/, 'Matching runtime events must be published over SSE.');
    stream.destroy();

    assert.equal(operationalStoreStatus().queue.done, 1);
    console.log('Operational runtime contract passed.');
} finally {
    await fs.rm(runtime, { recursive: true, force: true });
}
