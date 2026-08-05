import { agentDefinitions, defaultAgentConfig } from '../agents/agents.config.mjs';
import { callAI, providerSupportsTools } from './ai.mjs';
import { executeTool, getOpenAITools } from './toolRegistry.mjs';
import { buildMemoryContext } from './memory.mjs';
import { getAgentConfig } from './officeStore.mjs';

export const ensureAgentConfig = async agentId => {
    const definition = agentDefinitions[agentId];
    if (!definition) throw Object.assign(new Error(`Unknown agent: ${agentId}`), { statusCode: 404 });
    return getAgentConfig(agentId, defaultAgentConfig(agentId));
};

const parseArguments = value => {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return {}; }
};

const invokeWithFallback = async (config, messages, tools) => {
    try {
        return await callAI(config, messages, tools);
    } catch (error) {
        if (!config.fallback?.enabled) throw error;
        const fallbackConfig = {
            ...config,
            provider: config.fallback.provider,
            model: config.fallback.model,
            baseUrl: config.fallback.baseUrl,
        };
        if (!fallbackConfig.model) throw error;
        return callAI(fallbackConfig, messages, tools);
    }
};

export const runAgent = async (agentId, history = []) => {
    const config = await ensureAgentConfig(agentId);
    if (!config.enabled) throw Object.assign(new Error(`${config.name} is disabled.`), { statusCode: 409 });

    const definition = agentDefinitions[agentId];
    let memory = { content: '', notes: [] };
    try { memory = await buildMemoryContext(agentId, history); }
    catch (error) { console.error('[memory] Retrieval failed:', error.message); }

    const messages = [
        { role: 'system', content: definition.system },
        ...(memory.content ? [{ role: 'system', content: memory.content }] : []),
        ...history.filter(item => ['user', 'assistant'].includes(item.role)).map(item => ({
            role: item.role,
            content: item.content || '',
        })),
    ];
    const tools = providerSupportsTools(config.provider) ? getOpenAITools(agentId) : [];
    const toolEvents = [];
    let response = null;

    for (let round = 0; round <= (config.maxToolRounds || 4); round++) {
        response = await invokeWithFallback(config, messages, tools);
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
        model: { provider: config.provider, model: config.model },
    };
};
