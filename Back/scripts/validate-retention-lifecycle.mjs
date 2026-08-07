import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'carlos-office-retention-'));
process.env.OBSIDIAN_VAULT_PATH = vault;
process.env.TEMP_CONVERSATION_TTL_MS = '60000';
process.env.TEMP_SOURCE_TTL_MS = '60000';
process.env.JOB_TRACE_RETENTION_MS = '60000';

const temporary = await import('../src/lib/temporaryConversations.mjs');
const conversations = await import('../src/lib/conversationLifecycle.mjs');
const facts = await import('../src/lib/factMemory.mjs');
const knowledge = await import('../src/lib/knowledgeLifecycle.mjs');
const notes = await import('../src/lib/knowledgeNotes.mjs');
const jobs = await import('../src/lib/jobLifecycle.mjs');

try {
    const conversationId = 'retention-test-chat';
    temporary.saveTemporaryConversation({
        conversationId,
        agentId: 'nora',
        title: 'Temporary retention test',
        messages: [{ role: 'user', content: 'temporary only', attachments: [], createdAt: new Date().toISOString() }],
    });
    const temporaryAttachments = temporary.saveTemporaryAttachments(conversationId, [{
        name: 'temporary.txt',
        mimeType: 'text/plain',
        data: Buffer.from('temporary source text').toString('base64'),
    }]);
    temporary.saveTemporaryConversation({
        ...temporary.getTemporaryConversation(conversationId),
        messages: [{
            role: 'user', content: 'temporary only', attachments: temporaryAttachments,
            createdAt: new Date().toISOString(),
        }],
    });

    await assert.rejects(fs.access(path.join(vault, '30-Conversations', 'Threads', `${conversationId}.md`)));
    const promoted = await conversations.promoteConversation(conversationId);
    assert.equal(promoted.persisted, true);
    await fs.access(path.join(vault, '30-Conversations', 'Threads', `${conversationId}.md`));
    assert.equal(temporary.getTemporaryConversation(conversationId), null);
    const persistedAttachment = promoted.messages[0].attachments[0];
    assert.ok(persistedAttachment.path, 'Saved attachment must receive a persistent vault path.');
    await fs.access(path.join(vault, persistedAttachment.path));

    const fact = await facts.rememberFact({
        subject: 'retention-test', statement: 'Remember the smallest useful unit.',
        scope: 'universal', confidence: 'confirmed', source: 'Carlos', importance: 'high',
    });
    assert.ok(fact.factId);
    const factMatches = await facts.searchFacts({ query: 'smallest useful unit', agentId: 'nora', limit: 5 });
    assert.equal(factMatches[0]?.factId, fact.factId);
    await fs.access(path.join(vault, '15-Memory', 'Facts.md'));

    const sessionSource = await knowledge.registerKnowledgeSource({
        sourceId: 'session-source', name: 'Session source', lifecycle: 'session', type: 'manual',
    });
    assert.equal(sessionSource.persisted, false);
    await assert.rejects(fs.access(path.join(vault, '70-Knowledge-Sources', 'session-source.md')));

    await knowledge.registerKnowledgeSource({
        sourceId: 'project-book', name: 'Project Book', lifecycle: 'project', type: 'manual',
        projectId: 'alpha', authority: 'reference',
    });
    const projectNote = await notes.writeDerivedKnowledge({
        agentId: 'iris', sourceId: 'project-book', lifecycle: 'project', projectId: 'alpha',
        title: 'Project-only principle', content: 'This principle belongs only to project alpha.',
        authority: 'reference', tags: ['alpha'],
    });
    assert.ok(projectNote.path.startsWith('25-Projects/alpha/Knowledge/'));
    await fs.access(path.join(vault, projectNote.path));

    await knowledge.registerKnowledgeSource({
        sourceId: 'universal-book', name: 'Universal Book', lifecycle: 'universal', type: 'manual',
        authority: 'reference',
    });
    const universalProposal = await notes.writeDerivedKnowledge({
        agentId: 'iris', sourceId: 'universal-book', lifecycle: 'universal',
        title: 'Reusable universal principle', content: 'A cross-project principle proposed by Iris.',
        authority: 'reference', category: 'Reference',
    });
    assert.equal(universalProposal.proposal, true);
    assert.ok(universalProposal.path.startsWith('00-Inbox/Knowledge/'));
    const universal = await notes.promoteKnowledgeProposal({ path: universalProposal.path, category: 'Reference' });
    assert.ok(universal.path.startsWith('10-Shared/Reference/'));
    await fs.access(path.join(vault, universal.path));
    await assert.rejects(fs.access(path.join(vault, universalProposal.path)));

    const directive = await knowledge.createRetentionDirective({
        path: projectNote.path,
        action: 'archive',
        reason: 'Project closed; retain only as archive.',
    });
    const executed = await knowledge.executeRetentionDirective(directive.directiveId);
    assert.equal(executed.status, 'executed');
    await assert.rejects(fs.access(path.join(vault, projectNote.path)));
    await fs.access(path.join(vault, '90-System', 'Archive', 'Knowledge', projectNote.path));

    const job = await jobs.createJob({
        jobId: 'retention-job', createdBy: 'nora', assignedAgent: 'iris', title: 'Retention job',
        instructions: 'Produce a test result.', expectedResult: 'A result.', acceptanceCriteria: ['Return a result'],
        status: 'queued', maxIterations: 2,
    });
    assert.equal(job.traceRetention, 'memory');
    const transientMarker = 'TRANSIENT_TRACE_MUST_NOT_PERSIST';
    const updatedJob = await jobs.updateJob(job.jobId, {
        status: 'running', currentIteration: 1,
        messages: [{ messageId: 'trace-message', from: 'iris', to: 'vera', type: 'deliverable', content: transientMarker, iteration: 1, createdAt: new Date().toISOString() }],
        attempts: [{ iteration: 1, workerOutput: transientMarker, qcVerdict: 'revise', qcScore: 50, qcSummary: 'revise', qcFeedback: 'fix', missing: ['criterion'], createdAt: new Date().toISOString() }],
        result: transientMarker,
    });
    assert.equal(updatedJob.messages[0]?.content, transientMarker);
    const receiptRaw = await fs.readFile(path.join(vault, updatedJob.path), 'utf8');
    assert.ok(!receiptRaw.includes(transientMarker), 'Transient job trace leaked into persistent receipt.');

    const completed = await jobs.updateJob(job.jobId, {
        status: 'completed', qcVerdict: 'pass', qcScore: 100,
        qcFeedback: 'Nora approval: complete.', result: 'FINAL_DURABLE_RESULT',
    });
    const completedRaw = await fs.readFile(path.join(vault, completed.path), 'utf8');
    assert.ok(completedRaw.includes('FINAL_DURABLE_RESULT'));
    assert.ok(!completedRaw.includes(transientMarker));

    console.log('Retention lifecycle contract passed.');
    console.log(`Disposable vault: ${vault}`);
} finally {
    await fs.rm(vault, { recursive: true, force: true });
}
