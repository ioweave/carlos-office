import { randomUUID } from 'node:crypto';
import { getExecutionContext } from './executionContext.mjs';
import { emitRuntimeEvent } from './runtimeWorkflows.mjs';

const runs = new Map();
const events = [];
const retentionMs = Math.max(60_000, Number(process.env.RUNTIME_ACTIVITY_RETENTION_MS || 600_000));
const consoleLogging = String(process.env.RUNTIME_ACTIVITY_CONSOLE || 'true').toLowerCase() !== 'false';
const now = () => new Date().toISOString();
const clone = value => structuredClone(value);
const clip = (value, limit = 140) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length <= limit ? text : `${text.slice(0, Math.max(1, limit - 1))}…`;
};
const safeUrl = value => {
    try {
        const url = new URL(String(value || ''));
        return `${url.origin}${url.pathname}`;
    } catch { return ''; }
};
const definedInput = value => Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null));

const describeTool = (name, args = {}) => {
    if (name === 'project_read_file') return `Reading ${clip(args.path, 100) || 'a project file'}`;
    if (name === 'project_list_files') return `Listing ${clip(args.folder, 100) || 'project files'}`;
    if (name === 'project_search_files') return `Searching ${clip(args.folder, 90) || 'the project'}`;
    if (name === 'web_search') return 'Searching the public web';
    if (name === 'fetch_url') return `Fetching ${clip(safeUrl(args.url), 110) || 'a public source'}`;
    if (name === 'memory_search') return 'Searching retained knowledge';
    if (name === 'memory_read') return `Reading retained note ${clip(args.path, 90)}`.trim();
    if (name === 'memory_list') return 'Listing retained knowledge';
    if (name === 'create_agent_job') return `Delegating ${clip(args.title, 90) || 'work'} to ${clip(args.assignedAgent, 30) || 'a worker'}`;
    if (name === 'get_agent_job') return 'Inspecting delegated work';
    if (name === 'mcp_list_servers') return 'Inspecting connected integrations';
    if (name === 'mcp_list_tools') return `Inspecting ${clip(args.server, 60) || 'MCP'} tools`;
    if (name === 'mcp_call') return `Calling ${clip(args.server, 50) || 'MCP'}.${clip(args.tool, 70) || 'tool'}`;
    if (name.startsWith('playwright_')) return 'Inspecting the browser';
    if (name === 'office_file_read') return `Reading workspace file ${clip(args.path, 90)}`.trim();
    if (name === 'office_file_write') return `Writing workspace file ${clip(args.path, 90)}`.trim();
    if (name === 'project_write_file') return `Writing project file ${clip(args.path, 90)}`.trim();
    if (name === 'project_run_check') return `Running ${clip(args.kind, 70) || 'a project check'}`;
    if (name.startsWith('knowledge_')) return 'Working with curated knowledge';
    if (name.startsWith('monitor_')) return 'Checking an operational monitor';
    return `Using ${String(name || 'tool').replaceAll('_', ' ')}`;
};

const prune = () => {
    const cutoff = Date.now() - retentionMs;
    while (events.length && new Date(events[0].createdAt).getTime() < cutoff) events.shift();
    for (const [runId, run] of runs.entries()) {
        if (run.status === 'running') continue;
        if (new Date(run.updatedAt).getTime() >= cutoff) continue;
        runs.delete(runId);
    }
};

const trafficNodes = run => {
    const agentNode = `agent:${run.agentId}`;
    const peerNode = run.jobId
        ? `job:${run.jobId}`
        : run.conversationId ? `conversation:${run.conversationId}` : '';
    return { agentNode, peerNode };
};

const consoleEvent = event => {
    if (!consoleLogging) return;
    const scope = [
        event.requestId ? `request=${event.requestId.slice(0, 8)}` : '',
        event.conversationId ? `chat=${event.conversationId.slice(0, 8)}` : '',
        event.jobId ? `job=${event.jobId.slice(0, 8)}` : '',
    ].filter(Boolean).join(' ');
    const tool = event.toolName ? ` tool=${event.toolName}` : '';
    console.log(`[activity] ${event.agentId} ${event.phase}${tool}${scope ? ` ${scope}` : ''} — ${event.summary}`);
};

const emit = (run, input = {}) => {
    prune();
    const event = {
        eventId: randomUUID(),
        runId: run.runId,
        requestId: run.requestId,
        conversationId: run.conversationId,
        workflowId: run.workflowId,
        jobId: run.jobId,
        agentId: run.agentId,
        phase: String(input.phase || run.phase || 'working'),
        toolName: String(input.toolName || ''),
        round: Math.max(0, Number(input.round || 0)),
        failed: Boolean(input.failed),
        summary: clip(input.summary || 'Working…', 220),
        createdAt: now(),
    };
    events.push(event);
    if (events.length > 3000) events.splice(0, events.length - 3000);
    consoleEvent(event);

    const { agentNode, peerNode } = trafficNodes(run);
    if (peerNode) {
        const outbound = input.direction !== 'in';
        emitRuntimeEvent({
            type: `agent.${event.phase}`,
            workflowId: run.workflowId,
            jobId: run.jobId,
            from: outbound ? run.agentId : 'runtime',
            to: outbound ? 'runtime' : run.agentId,
            fromNode: outbound ? agentNode : peerNode,
            toNode: outbound ? peerNode : agentNode,
            stage: event.phase,
            summary: event.summary,
            tone: event.failed ? 'danger' : input.tone || (event.phase.includes('tool') ? 'worker' : 'info'),
        });
    } else {
        emitRuntimeEvent({
            type: `agent.${event.phase}`,
            workflowId: run.workflowId,
            jobId: run.jobId,
            from: run.agentId,
            to: run.agentId,
            fromNode: agentNode,
            toNode: agentNode,
            stage: event.phase,
            summary: event.summary,
            tone: event.failed ? 'danger' : input.tone || 'info',
        });
    }
    return clone(event);
};

export const beginAgentRun = (agentId, input = {}) => {
    prune();
    const context = { ...getExecutionContext(), ...definedInput(input) };
    const runId = randomUUID();
    const run = {
        runId,
        requestId: String(context.requestId || ''),
        conversationId: String(context.conversationId || ''),
        workflowId: String(context.workflowId || ''),
        jobId: String(context.jobId || ''),
        agentId: String(agentId || 'unknown'),
        status: 'running',
        phase: 'starting',
        toolName: '',
        summary: `${String(agentId || 'Agent')} started working.`,
        startedAt: now(),
        updatedAt: now(),
        completedAt: '',
    };
    runs.set(runId, run);
    emit(run, { phase: 'started', summary: run.summary, direction: 'in' });
    return runId;
};

export const recordAgentActivity = (runId, input = {}) => {
    const run = runs.get(String(runId || ''));
    if (!run) return null;
    run.phase = String(input.phase || run.phase || 'working');
    run.toolName = String(input.toolName || '');
    run.summary = clip(input.summary || run.summary || 'Working…', 220);
    run.updatedAt = now();
    return emit(run, input);
};

export const recordToolActivity = (runId, name, args = {}, input = {}) => recordAgentActivity(runId, {
    ...input,
    toolName: String(name || ''),
    summary: input.summary || describeTool(name, args),
});

export const finishAgentRun = (runId, summary = 'Response ready.') => {
    const run = runs.get(String(runId || ''));
    if (!run) return null;
    run.status = 'completed';
    run.phase = 'completed';
    run.toolName = '';
    run.summary = clip(summary, 220);
    run.updatedAt = now();
    run.completedAt = run.updatedAt;
    emit(run, { phase: 'completed', summary: run.summary, direction: 'out', tone: 'success' });
    return clone(run);
};

export const failAgentRun = (runId, error) => {
    const run = runs.get(String(runId || ''));
    if (!run) return null;
    run.status = 'failed';
    run.phase = 'failed';
    run.toolName = '';
    run.summary = clip(error?.message || error || 'Agent execution failed.', 220);
    run.updatedAt = now();
    run.completedAt = run.updatedAt;
    emit(run, { phase: 'failed', summary: run.summary, direction: 'out', failed: true, tone: 'danger' });
    return clone(run);
};

export const runtimeActivitySnapshot = ({ requestId = '', conversationId = '', agentId = '', limit = 120 } = {}) => {
    prune();
    const matches = item => (!requestId || item.requestId === requestId)
        && (!conversationId || item.conversationId === conversationId)
        && (!agentId || item.agentId === agentId);
    const selectedEvents = events.filter(matches).slice(-Math.max(1, Math.min(Number(limit) || 120, 500))).map(clone);
    const selectedRuns = [...runs.values()].filter(matches).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return {
        active: selectedRuns.filter(run => run.status === 'running').map(clone),
        recent: selectedRuns.slice(0, 20).map(clone),
        events: selectedEvents,
        retentionMs,
        consoleLogging,
    };
};

export const runtimeActivityStatus = () => {
    prune();
    return {
        active: [...runs.values()].filter(run => run.status === 'running').length,
        runs: runs.size,
        events: events.length,
        retentionMs,
        consoleLogging,
    };
};
