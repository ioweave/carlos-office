import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = mkdtempSync(path.join(tmpdir(), 'carlos-hermes-validation-'));
process.env.OFFICE_RUNTIME_DIR = root;
process.env.OFFICE_RUNTIME_DB_PATH = path.join(root, 'runtime.sqlite');
process.env.TELEGRAM_BOT_TOKEN = 'validation-token';
process.env.TELEGRAM_ALLOWED_CHAT_IDS = 'validation-chat';
process.env.WHATSAPP_ALLOWED_NUMBERS = '593000000000';
process.env.SKILL_EVOLUTION_ENABLED = 'false';

try {
    const search = await import('../src/lib/conversationSearch.mjs');
    const indexed = search.indexConversation({
        conversationId: 'saved-validation',
        persisted: true,
        title: 'Durable launch notes',
        agentId: 'nora',
        messages: [{ role: 'user', content: 'The heliotrope launch checklist is approved.', createdAt: new Date().toISOString() }],
    });
    assert.equal(indexed.indexed, true);
    assert.equal(search.searchConversationHistory({ query: 'heliotrope launch' })[0]?.conversationId, 'saved-validation');
    assert.equal(search.conversationSearchStatus().automaticMemoryInjection, false);

    const schedules = await import('../src/lib/scheduleManager.mjs');
    const once = schedules.createSchedule({
        name: 'Validation reminder',
        prompt: 'Review the launch checklist.',
        schedule: { kind: 'once', at: new Date(Date.now() + 60_000).toISOString() },
        delivery: { channel: 'telegram', destination: 'validation-chat' },
    });
    assert.equal(once.enabled, true);
    assert.equal(once.delivery.channel, 'telegram');
    assert.ok(schedules.nextRunFor({ kind: 'interval', everyMinutes: 5 }) > Date.now());
    assert.ok(schedules.nextRunFor({ kind: 'cron', expression: '0 0 * * 7', timeZone: 'America/Guayaquil' }) > Date.now());
    assert.equal(schedules.deleteSchedule(once.scheduleId).deleted, true);

    const gateway = await import('../src/lib/channelGateway.mjs');
    const inbound = gateway.enqueueInboundChannelMessage({
        channel: 'telegram', messageId: 'message-1', destination: 'validation-chat', text: 'Hello Nora',
    });
    assert.equal(inbound.queued, true);
    assert.equal(gateway.enqueueInboundChannelMessage({
        channel: 'telegram', messageId: 'message-1', destination: 'validation-chat', text: 'Hello Nora',
    }).duplicate, true);
    assert.throws(() => gateway.enqueueInboundChannelMessage({
        channel: 'telegram', messageId: 'denied', destination: 'not-allowed', text: 'No access',
    }), error => error.statusCode === 403);

    const { executeToolPipeline } = await import('../src/lib/programmaticTools.mjs');
    const calls = [];
    const pipeline = await executeToolPipeline('nora', {
        steps: [
            { id: 'clock', tool: 'current_time', args: {} },
            { id: 'lookup', tool: 'conversation_search', dependsOn: ['clock'], args: { query: { $from: 'clock.zone' } } },
        ],
        outputs: [{ step: 'lookup', path: 'query', as: 'resolvedQuery' }],
    }, { executeTool: async (_agentId, tool, args) => {
        calls.push({ tool, args });
        return tool === 'current_time' ? { zone: 'America/Guayaquil' } : { query: args.query, matches: 2 };
    } });
    assert.equal(calls[1].args.query, 'America/Guayaquil');
    assert.equal(pipeline.outputs.resolvedQuery, 'America/Guayaquil');
    assert.equal(pipeline.intermediateResultsSuppressed, 1);
    await assert.rejects(() => executeToolPipeline('nora', {
        steps: [{ id: 'one', tool: 'project_write_file' }, { id: 'two', tool: 'current_time' }],
    }, { executeTool: async () => ({}) }), error => error.statusCode === 403);

    console.log('Hermes capability validation passed: explicit conversation FTS, durable schedules, allowlisted channel intake, and safe programmatic tool pipelines.');
} finally {
    rmSync(root, { recursive: true, force: true });
}
