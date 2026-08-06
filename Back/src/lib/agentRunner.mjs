import { promises as fs } from 'node:fs';
import path from 'node:path';
import { agentDefinitions, defaultAgentConfig } from '../agents/agents.config.mjs';
import { callAI, providerSupportsTools } from './ai.mjs';
import { executeTool, getOpenAITools } from './toolRegistry.mjs';
import { buildMemoryContext } from './memory.mjs';
import { getVaultPath } from './memoryCore.mjs';
import { getAgentConfig, saveAgentConfig } from './officeStore.mjs';
import { connectivityErrorText, isConnectivityFailure } from './connectivity.mjs';

let agentQueue = Promise.resolve();

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

const fallbackConfig = config => ({
    ...config,
    provider: config.fallback.provider,
    model: config.fallback.model,
    baseUrl: config.fallback.baseUrl,
});

const mayUseFallback = (config, error) => {
    if (!config.fallback?.enabled || !config.fallback?.model) return false;
    return isConnectivityFailure(error);
};

const textOnlyContent = value => {
    if (!Array.isArray(value)) return value || '';
    const text = value.filter(part => part?.type === 'text').map(part => part.text || '').join('\n');
    const imageCount = value.filter(part => part?.type === 'image_url').length;
    return [text, imageCount ? `[${imageCount} image attachment${imageCount === 1 ? '' : 's'} omitted because the offline fallback is text-only.]` : '']
        .filter(Boolean).join('\n\n');
};

const textOnlyMessages = messages => messages.map(item => ({
    ...item,
    content: textOnlyContent(item.content),
}));

const runAgentUnlocked = async (agentId, history = []) => {
    const config = await ensureAgentConfig(agentId);
    if (!config.enabled) throw Object.assign(new Error(`${config.name} is disabled.`), { statusCode: 409 });

    const definition = agentDefinitions[agentId];
    let memory = { content: '', notes: [] };
    try { memory = await buildMemoryContext(agentId, history); }
    catch (error) { console.error('[memory] Retrieval failed:', error.message); }

    let messages = [
        { role: 'system', content: definition.system },
        ...(memory.content ? [{ role: 'system', content: memory.content }] : []),
        ...history.filter(item => ['user', 'assistant'].includes(item.role)).map(item => ({
            role: item.role,
            content: item.modelContent || item.content || '',
        })),
    ];
    const toolEvents = [];
    let runtimeConfig = config;
    let fallbackUsed = false;
    let fallbackReason = '';
    let response = null;

    for (let round = 0; round <= (config.maxToolRounds || 4); round++) {
        const tools = providerSupportsTools(runtimeConfig.provider) ? getOpenAITools(agentId) : [];
        try {
            response = await callAI(runtimeConfig, messages, tools);
        } catch (error) {
            if (fallbackUsed || !mayUseFallback(config, error)) throw error;
            runtimeConfig = fallbackConfig(config);
            fallbackUsed = true;
            fallbackReason = connectivityErrorText(error).slice(0, 500);
            messages = textOnlyMessages(messages);
            const fallbackTools = providerSupportsTools(runtimeConfig.provider) ? getOpenAITools(agentId) : [];
            response = await callAI(runtimeConfig, messages, fallbackTools);
        }

        if (!response.toolCalls?.length) break;

        messages.push({
            role: 'assistant',
            content: response.content || '',
            tool_calls: response.toolCalls,
        });

        for (const call of response.toolCalls) {
            const name = call.function?.name;
            const args = parseArguments(call.function?.arguments);
            let result;
            let failed = false;

            try {
                result = await executeTool(agentId, name, args);
            } catch (error) {
                failed = true;
                result = { error: error.message };
            }

            toolEvents.push({ name, args, result, failed });
            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                name,
                content: JSON.stringify(result),
            });
        }
    }

    return {
        content: response?.content || 'The model returned no text response.',
        toolEvents,
        memoryRefs: memory.notes,
        model: {
            provider: runtimeConfig.provider,
            model: runtimeConfig.model,
            fallbackUsed,
            primaryModel: config.model,
            fallbackReason,
        },
    };
};

export const runAgent = (agentId, history = []) => {
    const task = agentQueue.then(() => runAgentUnlocked(agentId, history));
    agentQueue = task.catch(error => {
        console.error(`[agent:${agentId}]`, error.message);
    });
    return task;
};
