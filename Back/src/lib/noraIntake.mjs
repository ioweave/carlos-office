import { randomUUID } from 'node:crypto';
import { runAgent } from './agentRunner.mjs';
import { createPersistentMap } from './operationalStore.mjs';
import { listProcessDefinitions, publishProcessDefinition, saveProcessDefinition } from './processEngine.mjs';
import { listAgentDefinitions } from './agentRegistry.mjs';
import { listTools } from './toolRegistry.mjs';

const requests = createPersistentMap('office-requests-v1');
const now = () => new Date().toISOString();
const clip = (value, limit = 8_000) => String(value || '').trim().slice(0, limit);
const clone = value => JSON.parse(JSON.stringify(value));
const parseJson = value => {
    const source = String(value || ''); const start = source.indexOf('{'); const end = source.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(source.slice(start, end + 1)); } catch { return null; }
};

export const createOfficeRequest = ({ requestId = randomUUID(), conversationId, messageId, content, channel = 'chat' }) => {
    const record = { requestId, conversationId, messageId, content: clip(content, 20_000), channel, status: 'intake', jobIds: [], createdAt: now(), updatedAt: now() };
    requests.set(record.requestId, record); return clone(record);
};

export const updateOfficeRequest = (requestId, update = {}) => {
    const current = requests.get(String(requestId || '')); if (!current) return null;
    const record = { ...current, ...clone(update), requestId: current.requestId, updatedAt: now() };
    requests.set(record.requestId, record); return clone(record);
};

export const listOfficeRequests = ({ conversationId = '', limit = 200 } = {}) => [...requests.values()]
    .filter(item => !conversationId || item.conversationId === conversationId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, Math.max(1, Math.min(Number(limit) || 200, 500))).map(clone);

export const deleteOfficeRequestsForMessages = (conversationId, messageIds = []) => {
    const targets = new Set(messageIds.map(String));
    let deleted = 0;
    for (const [requestId, request] of requests.entries()) {
        if (request.conversationId !== conversationId || !targets.has(String(request.messageId || ''))) continue;
        requests.delete(requestId);
        deleted += 1;
    }
    return deleted;
};

export const deleteOfficeRequestsForConversation = conversationId => {
    let deleted = 0;
    for (const [requestId, request] of requests.entries()) {
        if (request.conversationId !== conversationId) continue;
        requests.delete(requestId);
        deleted += 1;
    }
    return deleted;
};

const fallbackPlan = objective => {
    const work = /\b(implement|build|fix|change|update|install|remove|delete|push|publish|deploy|redesign|create (?:a |an )?(?:file|app|ui|api|system|workflow|process))\b/i.test(objective);
    const discovery = /\b(research|compare|evaluate|investigate|audit|analy[sz]e|recommend)\b/i.test(objective);
    if (work) return { mode: 'jobs', rationale: 'The request requires governed multi-step work.', jobs: [{ definitionId: 'governed-product-change', objective }] };
    if (discovery) return { mode: 'jobs', rationale: 'The request requires parallel evidence and synthesis.', jobs: [{ definitionId: 'parallel-discovery', objective }] };
    return { mode: 'direct', rationale: 'The request can be answered safely in conversation.', jobs: [] };
};

export const planNoraRequest = async ({ objective, conversation = [], signal } = {}) => {
    const published = listProcessDefinitions().filter(item => item.enabled && item.latestVersion).map(item => ({ definitionId: item.definitionId, name: item.name, description: item.description, triggers: item.triggers }));
    const workforce = listAgentDefinitions().filter(agent => agent.enabled !== false).map(agent => ({
        agentId: agent.agentId, role: agent.role, maxInstances: agent.maxInstances,
        tools: listTools(agent.agentId).map(tool => ({ name: tool.name, scopes: tool.authorizationScopes || [], sideEffect: tool.sideEffect })),
    }));
    const prompt = `You are Nora's intake and process planner. Decide whether Carlos's message needs durable work or a direct answer. Use an exact published process when it fits. If none fits, adapt the closest strategy into a private one-off ProcessDefinition. A job is required for multi-step work, side effects, delegated or parallel work, artifacts, long-running work, or quality-governed deliverables. Ask a question only when ambiguity materially changes the outcome or authorization boundary. A request may start several independent jobs; do not split one cohesive outcome artificially.

For a one-off process: exactly one Start and one End; every branch reaches End; Agent Task nodes declare an exact ordered tools array using only tools granted to that agent; independent work may share Start and run in parallel; use qualityThreshold 90 normally, 80 only when explicitly non-critical; End threshold is 95. Include every authorization scope required by selected tools. Use typed JSON schemas. Do not invent tools, agents, JavaScript conditions, or unbounded loops. Return JSON only.

PUBLISHED PROCESS CATALOG
${JSON.stringify(published)}

WORKFORCE AND EFFECTIVE TOOLS
${JSON.stringify(workforce)}

RECENT CONVERSATION
${JSON.stringify(conversation.slice(-6).map(item => ({ role: item.role, content: clip(item.content, 1_500) })))}

REQUEST
${clip(objective, 12_000)}

JSON SHAPE
{"mode":"direct|jobs|one-off","rationale":"brief","jobs":[{"definitionId":"catalog id","objective":"bounded objective","inputs":{}}],"oneOffProcess":{"name":"specific private process","description":"...","authorizationScopes":[],"normalQualityThreshold":90,"finalQualityThreshold":95,"nodes":[{"nodeId":"start","type":"start","name":"Request accepted","dependsOn":[],"position":{"x":60,"y":260}},{"nodeId":"task","type":"agent-task","name":"...","agentId":"dex","prompt":"precise contract","dependsOn":["start"],"tools":[{"toolName":"project_read_file"}],"inputSchema":{"type":"object"},"outputSchema":{"type":"string"},"qualityThreshold":90,"position":{"x":300,"y":260}},{"nodeId":"end","type":"end","name":"Nora handover","agentId":"nora","dependsOn":["task"],"position":{"x":700,"y":260}}]}}`;
    try {
        const result = await runAgent('nora', [{ role: 'user', content: prompt, createdAt: now() }], { signal, taskType: 'planning', allowTools: false, maxToolRounds: 0, includeMemory: false, includeAutomaticProjectContext: false });
        const parsed = parseJson(result.content); const known = new Set(published.map(item => item.definitionId));
        const jobs = (Array.isArray(parsed?.jobs) ? parsed.jobs : []).filter(item => known.has(item.definitionId)).slice(0, 4).map(item => ({ definitionId: item.definitionId, objective: clip(item.objective || objective, 16_000), inputs: item.inputs && typeof item.inputs === 'object' ? item.inputs : {} }));
        if (parsed?.mode === 'direct') return { mode: 'direct', rationale: clip(parsed.rationale, 500), jobs: [], model: result.model };
        if (jobs.length) return { mode: 'jobs', rationale: clip(parsed?.rationale, 500), jobs, model: result.model };
        if (parsed?.mode === 'one-off' && parsed.oneOffProcess?.nodes) {
            const draft = saveProcessDefinition({ ...parsed.oneOffProcess, definitionId: `one-off-${randomUUID()}`, kind: 'one-off', owner: 'nora', governed: true, enabled: true, triggers: [{ type: 'chat' }] });
            const publishedOneOff = publishProcessDefinition(draft.definitionId);
            return { mode: 'jobs', rationale: clip(parsed.rationale || 'Nora generated a fit-for-purpose one-off process.', 500), jobs: [{ definitionId: publishedOneOff.definitionId, objective: clip(objective, 16_000), inputs: {} }], model: result.model, generatedProcess: publishedOneOff.definitionId };
        }
    } catch {}
    return fallbackPlan(objective);
};

export const noraIntakeStatus = () => ({ requests: requests.size, durable: true, multiJob: true });
