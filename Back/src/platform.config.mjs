const deepFreeze = value => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
};

export const OFFICE_PLATFORM_CONFIG = deepFreeze({
    schema: 'carlos-office.platform.v1',
    architecture: {
        rootAgent: 'nora',
        qualityAgent: 'vera',
        specialists: ['marco', 'luma', 'dex', 'iris'],
        principles: ['local-first', 'durable-work', 'least-authority', 'independent-verification', 'human-control'],
    },
    providers: [
        { id: 'ollama', label: 'Ollama', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434', credentialEnv: '', local: true },
        { id: 'openai', label: 'OpenAI', adapter: 'openai', baseUrl: 'https://api.openai.com/v1', credentialEnv: 'OPENAI_API_KEY' },
        { id: 'openai-compatible', label: 'OpenAI compatible', adapter: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', credentialEnv: 'OPENAI_COMPATIBLE_API_KEY' },
        { id: 'claude', label: 'Anthropic', adapter: 'claude', baseUrl: 'https://api.anthropic.com', credentialEnv: 'ANTHROPIC_API_KEY' },
        { id: 'gemini', label: 'Google Gemini', adapter: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', credentialEnv: 'GOOGLE_GENERATIVE_AI_API_KEY' },
    ],
    modelOptions: [
        { id: 'minimax-cloud', label: 'MiniMax M3 Cloud', provider: 'ollama', model: 'minimax-m3:cloud', enabled: true, capabilities: ['tools', 'reasoning', 'planning', 'coding', 'research', 'quality', 'synthesis'], quality: 8, speed: 7, cost: 7, contextWindow: 196608 },
        { id: 'qwen-local', label: 'Qwen 3 8B Local', provider: 'ollama', model: 'qwen3:8b', enabled: true, capabilities: ['tools', 'fast', 'general', 'offline'], quality: 5, speed: 9, cost: 10, contextWindow: 32768 },
        { id: 'openai-general', label: 'OpenAI configured model', provider: 'openai', model: 'gpt-5.2', enabled: true, capabilities: ['tools', 'reasoning', 'planning', 'coding', 'research', 'quality', 'synthesis'], quality: 10, speed: 6, cost: 4, contextWindow: 200000 },
        { id: 'claude-general', label: 'Claude configured model', provider: 'claude', model: 'claude-sonnet-4-5', enabled: true, capabilities: ['reasoning', 'planning', 'coding', 'research', 'quality', 'synthesis'], quality: 9, speed: 7, cost: 5, contextWindow: 200000 },
        { id: 'gemini-fast', label: 'Gemini configured model', provider: 'gemini', model: 'gemini-3-flash-preview', enabled: true, capabilities: ['fast', 'general', 'research', 'synthesis'], quality: 7, speed: 10, cost: 8, contextWindow: 1000000 },
    ],
    modelRouting: {
        defaultModelOptionId: 'minimax-cloud',
        fallbackModelOptionId: 'qwen-local',
        taskWeights: {
            general: { quality: 0.45, speed: 0.3, cost: 0.25 },
            fast: { quality: 0.15, speed: 0.55, cost: 0.3 },
            planning: { quality: 0.65, speed: 0.15, cost: 0.2 },
            coding: { quality: 0.65, speed: 0.2, cost: 0.15 },
            research: { quality: 0.55, speed: 0.25, cost: 0.2 },
            quality: { quality: 0.75, speed: 0.1, cost: 0.15 },
            synthesis: { quality: 0.65, speed: 0.2, cost: 0.15 },
        },
        agentDefaults: {
            nora: { mode: 'adaptive', defaultModelOptionId: 'minimax-cloud', preferredCapabilities: ['planning', 'synthesis'] },
            marco: { mode: 'adaptive', defaultModelOptionId: 'minimax-cloud', preferredCapabilities: ['research', 'planning'] },
            luma: { mode: 'adaptive', defaultModelOptionId: 'minimax-cloud', preferredCapabilities: ['synthesis', 'planning'] },
            dex: { mode: 'adaptive', defaultModelOptionId: 'minimax-cloud', preferredCapabilities: ['coding', 'reasoning'] },
            iris: { mode: 'adaptive', defaultModelOptionId: 'minimax-cloud', preferredCapabilities: ['research', 'reasoning'] },
            vera: { mode: 'adaptive', defaultModelOptionId: 'minimax-cloud', preferredCapabilities: ['quality', 'reasoning'] },
        },
    },
    timeouts: {
        aiRequestMs: 2_700_000,
        chatAgentMs: 2_700_000,
        agentTaskMs: 2_700_000,
        processNodeMs: 2_700_000,
        authorizationMs: 86_400_000,
        toolMs: 300_000,
    },
    agents: { defaultMaxInstances: 1, hardMaxInstances: 20, oneTaskPerInstance: true, orchestrationLane: 'nora' },
    processes: {
        maxNodes: 60, maxParallelNodes: 8, maxParallelJobs: 8, maxAttemptsPerNode: 3, requireGovernanceForWrites: true,
        nodeTypes: ['start', 'agent-task', 'human-input', 'human-approval', 'condition', 'parallel-fork', 'parallel-join', 'subprocess', 'delay', 'handover', 'end'],
        quality: { scale: 100, normalThreshold: 90, finalThreshold: 95, nonCriticalThreshold: 80, dimensions: ['completeness', 'relevance', 'correctness', 'evidence', 'contract'] },
    },
    context: { maxEstimatedTokens: 120000, compressionThreshold: 0.7, recentMessages: 24, summaryMaxChars: 12000, conversationScoped: true },
    retention: { verboseToolEventDays: 14, cleanupIntervalMs: 3_600_000, anonymousAggregates: 'indefinite', artifacts: 'explicit-or-cascade' },
    recovery: {
        400: 'correct-once-then-pause', 401: 'refresh-then-reconnect', 403: 'authorization-request',
        429: 'retry-after-backoff-then-equivalent-provider', network: 'backoff-retry-fallback',
        invalidToolOutput: 'correct-retry-pause', unknownSideEffect: 'reconcile-before-retry',
    },
    authorization: {
        scopes: [
            { id: 'local-write', label: 'Write project or office files', defaultPolicy: 'ask' },
            { id: 'local-delete', label: 'Delete local files or records', defaultPolicy: 'ask' },
            { id: 'dependency-install', label: 'Install dependencies', defaultPolicy: 'ask' },
            { id: 'git-publish', label: 'Commit and push source', defaultPolicy: 'ask' },
            { id: 'external-write', label: 'Modify a connected service', defaultPolicy: 'ask' },
            { id: 'external-message', label: 'Send a message externally', defaultPolicy: 'ask' },
            { id: 'credentials', label: 'Change credentials or access', defaultPolicy: 'deny' },
            { id: 'skill-admin', label: 'Install or remove extensions', defaultPolicy: 'ask' },
            { id: 'schedule-admin', label: 'Create or alter schedules', defaultPolicy: 'ask' },
            { id: 'agent-admin', label: 'Promote staff or expand workforce privileges', defaultPolicy: 'ask' },
        ],
    },
    channels: [
        { id: 'telegram', label: 'Telegram', inbound: true, outbound: true, credentialEnv: 'TELEGRAM_BOT_TOKEN' },
        { id: 'whatsapp', label: 'WhatsApp Cloud', inbound: true, outbound: true, credentialEnv: 'WHATSAPP_ACCESS_TOKEN' },
        { id: 'email', label: 'Email adapter', inbound: true, outbound: true, credentialEnv: 'EMAIL_WEBHOOK_URL' },
        { id: 'slack', label: 'Slack webhook', inbound: false, outbound: true, credentialEnv: 'SLACK_WEBHOOK_URL' },
        { id: 'discord', label: 'Discord webhook', inbound: false, outbound: true, credentialEnv: 'DISCORD_WEBHOOK_URL' },
        { id: 'webhook', label: 'Generic webhook', inbound: true, outbound: true, credentialEnv: 'OFFICE_WEBHOOK_URL' },
    ],
});

export const platformTimeout = (name, environmentName = '') => {
    const configured = environmentName ? Number(process.env[environmentName]) : NaN;
    return Number.isFinite(configured) && configured > 0 ? configured : OFFICE_PLATFORM_CONFIG.timeouts[name];
};

export const modelOption = id => OFFICE_PLATFORM_CONFIG.modelOptions.find(item => item.id === id) || null;
