import { promises as fs } from 'node:fs';
import path from 'node:path';
import { agentDefinitions, defaultAgentConfig } from '../agents/agents.config.mjs';
import { callAI, providerSupportsTools } from './ai.mjs';
import { executeTool, getOpenAITools } from './toolRegistry.mjs';
import { buildMemoryContext } from './memory.mjs';
import { getVaultPath } from './memoryCore.mjs';
import { getAgentConfig, saveAgentConfig } from './officeStore.mjs';
import { connectivityErrorText, isConnectivityFailure } from './connectivity.mjs';
import { buildAutomaticProjectContext, buildRuntimeManifest } from './runtimeContext.mjs';
import { getExecutionContext, mergeExecutionContext, runWithExecutionContext } from './executionContext.mjs';
import { requestAuthorityManifest } from './requestAuthority.mjs';
import { recordTaskModelCall, resolveTaskModelRoute } from './modelRouting.mjs';
import {
    beginAgentRun,
    failAgentRun,
    finishAgentRun,
    recordAgentActivity,
    recordToolActivity,
} from './runtimeActivity.mjs';

const agentQueues = new Map();

const abortError = () => Object.assign(new Error('Execution cancelled.'), {
    code: 'EXECUTION_CANCELLED',
    statusCode: 499,
});

const throwIfAborted = signal => {
    if (signal?.aborted) throw abortError();
};

const isAbortFailure = error => (
    error?.code === 'EXECUTION_CANCELLED'
    || error?.code === 'ERR_CANCELED'
    || error?.name === 'AbortError'
    || String(error?.message || '').toLowerCase().includes('canceled')
    || String(error?.message || '').toLowerCase().includes('cancelled')
);

export const ensureAgentConfig = async agentId => {
    const definition = agentDefinitions[agentId];
    if (!definition) throw Object.assign(new Error(`Unknown agent: ${agentId}`), { statusCode: 404 });
    const defaults = defaultAgentConfig(agentId);
    const config = await getAgentConfig(agentId, defaults);
    const marker = path.join(
        getVaultPath(), '90-System', 'Runtime', 'Agents', '.Migrations', `${agentId}-minimax-m3-v1.md`,
    );
    try {
        await fs.access(marker);
        return config;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const migrated = await saveAgentConfig(agentId, {
        provider: defaults.provider,
        model: defaults.model,
        baseUrl: defaults.baseUrl,
        fallback: defaults.fallback,
    }, defaults);
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(marker, [
        '---',
        'type: "runtime-migration"',
        `agent: ${JSON.stringify(agentId)}`,
        'migration: "minimax-m3-primary-v1"',
        `appliedAt: ${JSON.stringify(new Date().toISOString())}`,
        '---',
        '',
        '# MiniMax M3 primary migration',
        '',
        `Primary model: ${migrated.model}`,
        `Offline fallback: ${migrated.fallback?.model || 'disabled'}`,
        '',
    ].join('\n'), 'utf8');
    return migrated;
};

const parseArguments = value => {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return {}; }
};

const pathValue = (source, expression) => String(expression || '').split('.').filter(Boolean).reduce((value, key) => value?.[key], source);
const resolvePlannedValue = (value, source) => {
    if (Array.isArray(value)) return value.map(item => resolvePlannedValue(item, source));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolvePlannedValue(item, source)]));
    if (typeof value !== 'string') return value;
    const exact = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (exact) return pathValue(source, exact[1]);
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression) => {
        const resolved = pathValue(source, expression);
        return resolved === undefined || resolved === null ? '' : typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
    });
};

const fallbackConfig = config => ({
    ...config,
    provider: config.fallback.provider,
    model: config.fallback.model,
    baseUrl: config.fallback.baseUrl,
});

const mayUseFallback = (config, error) => {
    if (isAbortFailure(error)) return false;
    if (!config.fallback?.enabled || !config.fallback?.model) return false;
    const status = Number(error?.response?.status || error?.statusCode || 0);
    return isConnectivityFailure(error) || status === 429 || status >= 500;
};

const retryDelayMs = (error, attempt) => {
    const retryAfter = error?.response?.headers?.['retry-after'];
    if (retryAfter) {
        const seconds = Number(retryAfter);
        const timestamp = new Date(retryAfter).getTime();
        if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(500, seconds * 1_000));
        if (Number.isFinite(timestamp)) return Math.min(30_000, Math.max(500, timestamp - Date.now()));
    }
    return Math.min(8_000, 500 * (2 ** attempt));
};
const waitForRetry = (ms, signal) => new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
});

const textOnlyContent = value => {
    if (!Array.isArray(value)) return value || '';
    const text = value.filter(part => part?.type === 'text').map(part => part.text || '').join('\n');
    const imageCount = value.filter(part => part?.type === 'image_url').length;
    return [
        text,
        imageCount
            ? `[${imageCount} image attachment${imageCount === 1 ? '' : 's'} omitted because the offline fallback is text-only.]`
            : '',
    ].filter(Boolean).join('\n\n');
};

const textOnlyMessages = messages => messages.map(item => ({
    ...item,
    content: textOnlyContent(item.content),
}));

export const progressOnlyResponse = value => {
    const content = String(value || '').trim();
    if (!content || content.length > 4_000) return false;
    return /\b(?:now\s+)?let me\s+(?:read|inspect|check|grab|get|try|search|continue|drill|look|fetch|review|verify|find|open)\b/i.test(content)
        || /\bi(?:'ll| will)\s+(?:read|inspect|check|grab|get|try|search|continue|drill|look|fetch|review|verify|find|open)\b/i.test(content);
};

const finalResponseInstruction = `The tool-use phase is complete. Return the complete answer or deliverable now.
Do not describe what you intend to inspect, fetch, read, or do next. Do not return a progress report.
Use the evidence already gathered, state any remaining uncertainty explicitly, and satisfy the user's requested output as fully as possible.`;

const runAgentUnlocked = async (agentId, history = [], options = {}) => {
    const runtimeRunId = options.runtimeRunId || '';
    throwIfAborted(options.signal);
    const config = await ensureAgentConfig(agentId);
    if (!config.enabled) throw Object.assign(new Error(`${config.name} is disabled.`), { statusCode: 409 });
    const modelRoute = resolveTaskModelRoute({ agentId, config, history, options });

    recordAgentActivity(runtimeRunId, {
        phase: 'grounding',
        summary: `${config.name} is loading runtime, repository, and memory context.`,
        direction: 'out',
    });

    const definition = agentDefinitions[agentId];
    const [runtimeManifest, automaticProjectContext] = await Promise.all([
        buildRuntimeManifest(agentId),
        options.includeAutomaticProjectContext === false
            ? Promise.resolve({ content: '', files: [] })
            : buildAutomaticProjectContext(agentId, history),
    ]);
    const authorityManifest = requestAuthorityManifest(options.authority || getExecutionContext().authority);

    let memory = { content: '', notes: [], facts: [] };
    if (options.includeMemory !== false) {
        try {
            memory = await buildMemoryContext(agentId, history, { projectId: options.projectId || '' });
        } catch (error) {
            console.error('[memory] Retrieval failed:', error.message);
        }
    }

    let messages = [
        { role: 'system', content: definition.system },
        { role: 'system', content: runtimeManifest },
        ...(authorityManifest ? [{ role: 'system', content: authorityManifest }] : []),
        ...(memory.content ? [{ role: 'system', content: memory.content }] : []),
        ...(automaticProjectContext.content ? [{ role: 'system', content: automaticProjectContext.content }] : []),
        ...history.filter(item => ['user', 'assistant'].includes(item.role)).map(item => ({
            role: item.role,
            content: item.modelContent || item.content || '',
        })),
    ];
    const toolEvents = automaticProjectContext.files.length ? [{
        name: 'automatic_project_grounding',
        args: { files: automaticProjectContext.files },
        result: { files: automaticProjectContext.files },
        failed: false,
    }] : [];
    let runtimeConfig = modelRoute.config;
    let fallbackUsed = false;
    let fallbackReason = '';
    let response = null;
    let forceFinalResponse = false;
    const invokeAI = async (callConfig, callMessages, callTools, callOptions) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const startedAt = Date.now();
            try {
                const result = await callAI(callConfig, callMessages, callTools, callOptions);
                recordTaskModelCall({ route: modelRoute, agentId, config: callConfig, startedAt, success: true, fallbackUsed });
                return result;
            } catch (error) {
                recordTaskModelCall({ route: modelRoute, agentId, config: callConfig, startedAt, success: false, fallbackUsed, error });
                const status = Number(error?.response?.status || error?.statusCode || 0);
                const retryable = status === 429 || status >= 500 || isConnectivityFailure(error);
                if (!retryable || attempt === 2 || isAbortFailure(error)) throw error;
                await waitForRetry(retryDelayMs(error, attempt), callOptions.signal);
            }
        }
        throw new Error('Model retry loop ended unexpectedly.');
    };
    const allowTools = options.allowTools !== false;
    const allowedToolNames = Array.isArray(options.allowedToolNames) ? new Set(options.allowedToolNames) : null;
    const blockedToolNames = new Set(Array.isArray(options.blockedToolNames) ? options.blockedToolNames : []);
    const toolSequence = Array.isArray(options.toolSequence) ? options.toolSequence.filter(Boolean) : [];
    const toolPlan = Array.isArray(options.toolPlan) ? options.toolPlan : [];
    const plannedToolResults = {};
    let toolSequenceIndex = 0;
    const toolsForRun = () => getOpenAITools(agentId).filter(tool => (
        (!allowedToolNames || allowedToolNames.has(tool.function?.name))
        && !blockedToolNames.has(tool.function?.name)
        && (!toolSequence.length || tool.function?.name === toolSequence[toolSequenceIndex])
    ));
    const configuredRounds = Number(options.maxToolRounds ?? runtimeConfig.maxToolRounds ?? 4);
    const roundLimit = Math.max(0, Math.min(Number(options.maxToolRoundsLimit ?? 12), 50));
    const maxToolRounds = allowTools ? Math.max(0, Math.min(configuredRounds, roundLimit)) : 0;

    for (let round = 0; round <= maxToolRounds; round++) {
        throwIfAborted(options.signal);
        if (typeof options.beforeRound === 'function') {
            const additions = await options.beforeRound({ round, messages, toolEvents });
            if (Array.isArray(additions)) messages.push(...additions.filter(item => ['user', 'assistant'].includes(item?.role)));
        }
        const tools = allowTools && providerSupportsTools(runtimeConfig.provider)
            ? toolsForRun()
            : [];
        recordAgentActivity(runtimeRunId, {
            phase: 'thinking',
            round: round + 1,
            summary: round === 0
                ? `${config.name} is thinking…`
                : `${config.name} is continuing after tool results…`,
            direction: 'in',
        });
        try {
            response = await invokeAI(runtimeConfig, messages, tools, {
                signal: options.signal,
                timeoutMs: options.timeoutMs,
            });
        } catch (error) {
            if (isAbortFailure(error)) throw abortError();
            if (fallbackUsed || !mayUseFallback(config, error)) throw error;
            runtimeConfig = fallbackConfig(config);
            fallbackUsed = true;
            fallbackReason = connectivityErrorText(error).slice(0, 500);
            messages = textOnlyMessages(messages);
            recordAgentActivity(runtimeRunId, {
                phase: 'fallback',
                round: round + 1,
                summary: `${config.name} is switching to the configured fallback model.`,
                direction: 'out',
                tone: 'warning',
            });
            const fallbackTools = allowTools && providerSupportsTools(runtimeConfig.provider)
                ? toolsForRun()
                : [];
            response = await invokeAI(runtimeConfig, messages, fallbackTools, {
                signal: options.signal,
                timeoutMs: options.timeoutMs,
            });
        }

        if (typeof options.onTranscript === 'function') options.onTranscript({
            type: 'assistant', round: round + 1, content: String(response?.content || '').slice(0, 12_000),
            toolCalls: (response?.toolCalls || []).map(call => call.function?.name).filter(Boolean),
        });

        if (!response.toolCalls?.length || !allowTools) {
            if (allowTools && toolSequenceIndex < toolSequence.length && round < maxToolRounds) {
                const nextTool = toolSequence[toolSequenceIndex];
                messages.push({ role: 'assistant', content: response.content || '' });
                messages.push({ role: 'user', content: `The process contract is not complete. Execute the next required tool now: ${nextTool}. Do not skip, replace, or reorder it.` });
                recordAgentActivity(runtimeRunId, {
                    phase: 'tool-required', round: round + 1, direction: 'in', tone: 'warning',
                    summary: `${config.name} must execute ${nextTool} before completing this task.`,
                });
                continue;
            }
            const shouldContinue = allowTools
                && round < maxToolRounds
                && toolEvents.length > 0
                && progressOnlyResponse(response.content);
            if (!shouldContinue) {
                forceFinalResponse = allowTools && progressOnlyResponse(response.content);
                break;
            }
            recordAgentActivity(runtimeRunId, {
                phase: 'continuing',
                round: round + 1,
                summary: `${config.name} returned a progress note and is continuing toward the deliverable.`,
                direction: 'in',
                tone: 'warning',
            });
            messages.push({ role: 'assistant', content: response.content || '' });
            messages.push({ role: 'user', content: finalResponseInstruction });
            continue;
        }

        recordAgentActivity(runtimeRunId, {
            phase: 'tool-plan',
            round: round + 1,
            summary: `${config.name} requested ${response.toolCalls.length} tool ${response.toolCalls.length === 1 ? 'operation' : 'operations'}.`,
            direction: 'out',
        });

        messages.push({
            role: 'assistant',
            content: response.content || '',
            tool_calls: response.toolCalls,
        });

        for (const call of response.toolCalls) {
            throwIfAborted(options.signal);
            const name = call.function?.name;
            let args = parseArguments(call.function?.arguments);
            let result;
            let failed = false;

            if (toolSequence.length) {
                const expected = toolSequence[toolSequenceIndex];
                if (name !== expected) {
                    const error = new Error(`Process tool contract violation: expected ${expected || 'no further tool'}, received ${name || 'unknown tool'}.`);
                    error.statusCode = 409;
                    throw error;
                }
                const planned = toolPlan[toolSequenceIndex];
                if (planned?.args && Object.keys(planned.args).length) {
                    args = resolvePlannedValue(planned.args, { ...(options.toolPlanContext || {}), ...plannedToolResults, results: plannedToolResults });
                }
            }

            recordToolActivity(runtimeRunId, name, args, {
                phase: 'tool-started',
                round: round + 1,
                direction: 'out',
            });

            try {
                result = await executeTool(agentId, name, args, { signal: options.signal, ...(options.toolExecutionContext || {}) });
            } catch (error) {
                failed = true;
                result = { error: error.message };
                if (options.failOnToolError) {
                    toolEvents.push({ name, args, result, failed: true });
                    throw error;
                }
            }

            if (typeof options.onTranscript === 'function') options.onTranscript({
                type: 'tool', round: round + 1, tool: name, failed,
                content: String(typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 8_000),
            });

            recordToolActivity(runtimeRunId, name, args, {
                phase: failed ? 'tool-failed' : 'tool-completed',
                round: round + 1,
                direction: 'in',
                failed,
                tone: failed ? 'danger' : 'success',
                summary: `${String(name || 'tool').replaceAll('_', ' ')} ${failed ? 'failed' : 'completed'}.`,
            });

            toolEvents.push({ name, args, result, failed });
            if (!failed && toolSequence.length) {
                const planned = toolPlan[toolSequenceIndex];
                plannedToolResults[planned?.resultPath || name] = result;
                toolSequenceIndex += 1;
            }
            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                name,
                content: JSON.stringify(result),
            });
        }
        if (round >= maxToolRounds) forceFinalResponse = true;
    }

    if (toolSequenceIndex < toolSequence.length) {
        const error = new Error(`Process tool contract incomplete: ${toolSequence.slice(toolSequenceIndex).join(' → ')} did not run.`);
        error.statusCode = 409;
        throw error;
    }

    if (forceFinalResponse) {
        throwIfAborted(options.signal);
        messages.push({ role: 'user', content: finalResponseInstruction });
        recordAgentActivity(runtimeRunId, {
            phase: 'final-response',
            summary: `${config.name} is producing the deliverable from the gathered evidence.`,
            direction: 'in',
        });
        response = await invokeAI(runtimeConfig, messages, [], {
            signal: options.signal,
            timeoutMs: options.timeoutMs,
        });
    }

    throwIfAborted(options.signal);
    recordAgentActivity(runtimeRunId, {
        phase: 'finalizing',
        summary: `${config.name} is finalizing the response.`,
        direction: 'in',
    });
    return {
        content: response?.content || 'The model returned no text response.',
        toolEvents,
        memoryRefs: [
            ...(memory.notes || []),
            ...(memory.facts || []).map(factId => `fact:${factId}`),
        ],
        model: {
            provider: runtimeConfig.provider,
            model: runtimeConfig.model,
            fallbackUsed,
            primaryModel: modelRoute.config.model,
            fallbackReason,
            taskClass: modelRoute.taskClass,
            routeSource: modelRoute.source,
        },
    };
};

export const runAgent = (agentId, history = [], options = {}) => {
    const runtimeRunId = beginAgentRun(agentId, {
        requestId: options.requestId,
        conversationId: options.conversationId,
        workflowId: options.workflowId,
        jobId: options.jobId,
    });
    const queueKey = String(options.queueKey || agentId);
    const previous = agentQueues.get(queueKey) || Promise.resolve();
    const executionContext = mergeExecutionContext({
        requestId: options.requestId,
        conversationId: options.conversationId,
        workflowId: options.workflowId,
        jobId: options.jobId,
        agentId,
    });
    const task = previous
        .then(() => runWithExecutionContext(executionContext, () => runAgentUnlocked(agentId, history, { ...options, runtimeRunId })))
        .then(result => {
            finishAgentRun(runtimeRunId, `${agentDefinitions[agentId]?.name || agentId} finished the response.`);
            return result;
        }, error => {
            failAgentRun(runtimeRunId, error);
            throw error;
        });
    const queueTail = task.catch(error => {
        if (!isAbortFailure(error)) console.error(`[agent:${agentId}]`, error.message);
    });
    agentQueues.set(queueKey, queueTail);
    queueTail.finally(() => {
        if (agentQueues.get(queueKey) === queueTail) agentQueues.delete(queueKey);
    });
    return task;
};
