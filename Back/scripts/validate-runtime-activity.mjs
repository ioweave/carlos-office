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

const temporary = listTemporaryConversations({ limit: 10 }).find(item => item.conversationId === conversationId);
assert(temporary, 'Temporary conversations must be available to the runtime topology.');
assert.equal(temporary.persisted, false);
assert.equal(temporary.messageCount, 1);

deleteTemporaryConversation(conversationId);

console.log('Runtime activity contract passed (ephemeral logs + temporary-chat map traffic).');
