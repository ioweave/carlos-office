import { recordModelRouteMetric } from './operationalStore.mjs';
import { OFFICE_PLATFORM_CONFIG, modelOption } from '../platform.config.mjs';
import { listProviderIntegrations } from './integrationRegistry.mjs';

const taskClasses = new Set(['general', 'fast', 'planning', 'coding', 'research', 'quality', 'synthesis']);
const textContent = value => Array.isArray(value)
    ? value.filter(part => part?.type === 'text').map(part => part.text || '').join('\n')
    : String(value || '');

export const inferTaskClass = ({ agentId, history = [], options = {} } = {}) => {
    const explicit = String(options.taskType || '').toLowerCase();
    if (taskClasses.has(explicit)) return explicit;
    if (agentId === 'vera') return 'quality';
    if (agentId === 'dex' && (options.jobId || options.workflowId)) return 'coding';
    if (agentId === 'iris' && (options.jobId || options.workflowId)) return 'research';
    if (agentId === 'nora' && Array.isArray(options.allowedToolNames)
        && options.allowedToolNames.length === 1 && options.allowedToolNames[0] === 'artifact_read') return 'synthesis';
    const latest = history.filter(item => item.role === 'user').slice(-1).map(item => textContent(item.content)).join(' ').toLowerCase();
    if (/\b(?:implement|fix|refactor|repository|source code|commit|push|pull request)\b/.test(latest)) return 'coding';
    if (/\b(?:research|investigate|sources|compare|market|evidence)\b/.test(latest)) return 'research';
    if (/\b(?:plan|architecture|design|strategy|roadmap)\b/.test(latest)) return 'planning';
    if (/\b(?:summari[sz]e|title|classify|extract)\b/.test(latest)) return 'fast';
    return 'general';
};

const numberOr = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export const resolveTaskModelRoute = ({ agentId, config, history = [], options = {} }) => {
    const taskClass = inferTaskClass({ agentId, history, options });
    const policy = config.modelPolicy || {};
    const providers = new Map(listProviderIntegrations().map(item => [item.id, item]));
    const requested = options.modelOptionId ? modelOption(options.modelOptionId) : null;
    const allowed = new Set(policy.allowedModelOptionIds?.length ? policy.allowedModelOptionIds : OFFICE_PLATFORM_CONFIG.modelOptions.map(item => item.id));
    if (requested) allowed.add(requested.id);
    const requiresTools = options.allowTools !== false && Number(options.maxToolRounds ?? config.maxToolRounds ?? 0) > 0;
    const candidates = OFFICE_PLATFORM_CONFIG.modelOptions.filter(item => (
        item.enabled !== false
        &&
        allowed.has(item.id)
        && providers.get(item.provider)?.enabled
        && providers.get(item.provider)?.configured
        && (!requiresTools || item.capabilities.includes('tools'))
    ));
    const weights = OFFICE_PLATFORM_CONFIG.modelRouting.taskWeights[taskClass] || OFFICE_PLATFORM_CONFIG.modelRouting.taskWeights.general;
    const capability = taskClass === 'general' ? 'general' : taskClass;
    const score = item => (
        item.quality * weights.quality + item.speed * weights.speed + item.cost * weights.cost
        + (item.capabilities.includes(capability) ? 3 : 0)
        + (policy.preferredCapabilities || []).filter(name => item.capabilities.includes(name)).length * 0.35
        + (item.id === policy.defaultModelOptionId ? 0.2 : 0)
    );
    const adaptive = policy.mode === 'adaptive' && candidates.length
        ? [...candidates].sort((left, right) => score(right) - score(left))[0]
        : null;
    const agentPreferred = candidates.find(item => item.id === policy.defaultModelOptionId);
    const globalDefault = candidates.find(item => item.id === OFFICE_PLATFORM_CONFIG.modelRouting.defaultModelOptionId);
    const globalFallback = candidates.find(item => item.id === OFFICE_PLATFORM_CONFIG.modelRouting.fallbackModelOptionId);
    const selected = requested && allowed.has(requested.id) && candidates.some(item => item.id === requested.id)
        ? requested
        : adaptive || agentPreferred || globalDefault || globalFallback || null;
    const selectedProvider = selected ? providers.get(selected.provider) : null;
    const routed = {
        ...config,
        provider: selected?.provider || config.provider,
        model: selected?.model || config.model,
        baseUrl: selectedProvider?.baseUrl || config.baseUrl,
        temperature: numberOr(options.temperature, config.temperature),
        maxToolRounds: numberOr(options.maxToolRounds, config.maxToolRounds),
    };
    return {
        taskClass,
        modelOptionId: selected?.id || '',
        source: requested && selected?.id === requested.id ? `${options.modelRequirementSource === 'tool' ? 'tool-required' : 'process-step'}:${selected.id}`
            : adaptive && selected?.id === adaptive.id ? `task-capability:${selected.id}`
                : agentPreferred && selected?.id === agentPreferred.id ? `agent-preference:${selected.id}`
                    : selected ? `global-default:${selected.id}` : 'agent-runtime-fallback',
        config: routed,
    };
};

export const recordTaskModelCall = ({ route, agentId, config, startedAt, success, fallbackUsed = false, error }) => {
    try {
        recordModelRouteMetric({
            taskClass: route.taskClass,
            agentId,
            provider: config.provider,
            model: config.model,
            success,
            fallbackUsed,
            durationMs: Date.now() - startedAt,
            errorClass: error ? String(error.code || error.name || 'model_error').slice(0, 120) : '',
        });
    } catch (metricError) {
        console.error('[models] Could not record route metric:', metricError.message);
    }
};
