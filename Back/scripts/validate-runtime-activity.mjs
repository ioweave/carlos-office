import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.RUNTIME_ACTIVITY_CONSOLE = 'false';

const { runWithExecutionContext } = await import('../src/lib/executionContext.mjs');
const {
    beginAgentRun,
    finishAgentRun,
    recordAgentActivity,
    recordToolActivity,
    runtimeActivitySnapshot,
} = await import('../src/lib/runtimeActivity.mjs');
const { listRuntimeEvents } = await import('../src/lib/runtimeWorkflows.mjs');
const { attachJobToWorkflow, createRuntimeWorkflow } = await import('../src/lib/runtimeWorkflows.mjs');
const { progressOnlyResponse } = await import('../src/lib/agentRunner.mjs');
const { executionContextForJob } = await import('../src/lib/jobRunner.mjs');
const {
    deleteTemporaryConversation,
    listTemporaryConversations,
    saveTemporaryConversation,
} = await import('../src/lib/temporaryConversations.mjs');

const requestId = randomUUID();
const conversationId = randomUUID();

saveTemporaryConversation({
    conversationId,
    agentId: 'nora',
    title: 'Runtime activity validation',
    messages: [{ role: 'user', content: 'Test live observability.' }],
});

const runId = runWithExecutionContext({ requestId, conversationId, objective: 'Validate activity', agentId: 'nora' }, () => {
    const id = beginAgentRun('nora', { requestId: undefined, conversationId: undefined });
    recordAgentActivity(id, { phase: 'thinking', summary: 'Nora is thinking…', direction: 'in' });
    recordToolActivity(id, 'project_read_file', { path: 'Back/artifacts/README.md' }, { phase: 'tool-started', direction: 'out' });
    recordToolActivity(id, 'project_read_file', { path: 'Back/artifacts/README.md' }, { phase: 'tool-completed', direction: 'in', tone: 'success' });
    finishAgentRun(id, 'Nora finished the response.');
    return id;
});

const snapshot = runtimeActivitySnapshot({ requestId, conversationId });
assert.equal(snapshot.active.length, 0, 'Finished activity must leave the active-run set.');
assert.equal(snapshot.recent[0]?.runId, runId, 'The completed run must remain temporarily inspectable.');
assert.equal(snapshot.recent[0]?.requestId, requestId, 'AsyncLocalStorage request context must survive undefined option fields.');
assert.equal(snapshot.recent[0]?.conversationId, conversationId, 'AsyncLocalStorage conversation context must survive undefined option fields.');
assert(snapshot.events.some(event => event.phase === 'thinking'), 'Thinking activity must be observable.');
assert(snapshot.events.some(event => event.phase === 'tool-started' && event.toolName === 'project_read_file'), 'Tool start activity must be observable.');
assert(snapshot.events.some(event => event.phase === 'tool-completed' && event.toolName === 'project_read_file'), 'Tool completion activity must be observable.');
assert(snapshot.events.every(event => !('args' in event) && !('result' in event)), 'Live activity must not expose raw tool arguments/results.');

const traffic = listRuntimeEvents({ limit: 100 });
assert(traffic.some(event => event.fromNode === `conversation:${conversationId}` && event.toNode === 'agent:nora'), 'Conversation-to-agent traffic must drive Office Map packets.');
assert(traffic.some(event => event.fromNode === 'agent:nora' && event.toNode === `conversation:${conversationId}`), 'Agent-to-conversation traffic must drive Office Map packets.');

assert(progressOnlyResponse('Now let me inspect the remaining source files:'), 'Forward-looking progress notes must not be accepted as final deliverables.');
assert(progressOnlyResponse('Excellent. I have the first sources. Let me grab the license next.'), 'Embedded progress notes must trigger continued execution.');
assert.equal(progressOnlyResponse('The research report is complete and includes the requested license matrix.'), false, 'Completed deliverables must not be forced through another model turn.');

const workflow = createRuntimeWorkflow({ requestId, conversationId, objective: 'Validate job activity' });
const job = { jobId: randomUUID(), workflowId: workflow.workflowId, assignedAgent: 'iris', title: 'Runtime job validation' };
attachJobToWorkflow(workflow.workflowId, job);
const jobContext = executionContextForJob(job);
assert.equal(jobContext.requestId, requestId, 'Delegated work must retain its originating request identity.');
assert.equal(jobContext.conversationId, conversationId, 'Delegated work must retain its originating conversation identity.');
assert.equal(jobContext.workflowId, workflow.workflowId, 'Delegated work must carry its workflow identity.');
assert.equal(jobContext.jobId, job.jobId, 'Delegated work must carry its job identity.');
const jobRunId = beginAgentRun('iris', jobContext);
recordAgentActivity(jobRunId, { phase: 'thinking', summary: 'Iris is researching.', direction: 'in' });
finishAgentRun(jobRunId, 'Iris finished the job.');
const jobTraffic = listRuntimeEvents({ jobId: job.jobId, limit: 20 });
assert(jobTraffic.some(event => event.fromNode === `job:${job.jobId}` && event.toNode === 'agent:iris'), 'Job activity must drive job-to-worker Office Map packets.');
assert(jobTraffic.some(event => event.fromNode === 'agent:iris' && event.toNode === `job:${job.jobId}`), 'Job activity must drive worker-to-job Office Map packets.');

const temporary = listTemporaryConversations({ limit: 10 }).find(item => item.conversationId === conversationId);
assert(temporary, 'Temporary conversations must be available to the runtime topology.');
assert.equal(temporary.persisted, false);
assert.equal(temporary.messageCount, 1);

deleteTemporaryConversation(conversationId);

console.log('Runtime activity contract passed (ephemeral logs + temporary-chat map traffic).');
