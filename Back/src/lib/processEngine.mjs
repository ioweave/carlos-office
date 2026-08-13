import { randomUUID } from 'node:crypto';
import { createPersistentMap, enqueueOperationalWork, purgeOperationalWorkForContext } from './operationalStore.mjs';
import { OFFICE_PLATFORM_CONFIG, modelOption, platformTimeout } from '../platform.config.mjs';
import { consumeAuthorizationRequest, evaluateAuthorization, getAuthorizationRequest, purgeAuthorizationContext } from './authorizationManager.mjs';
import { createRequestAuthority } from './requestAuthority.mjs';
import { runWithExecutionContext } from './executionContext.mjs';
import { publishRuntimeEvent } from './runtimeEventStream.mjs';
import { deleteJobArtifacts, extractArtifacts, mergeArtifacts } from './artifacts.mjs';
import { getAgentDefinition, listAgentDefinitions } from './agentRegistry.mjs';
import { listProviderIntegrations } from './integrationRegistry.mjs';
import { listTools } from './toolRegistry.mjs';

// The canonical durable-work model. Processes are reusable definitions; jobs are
// immutable executions of published versions. Tasks, attempts, and agent instances
// are children of a job and are never separate user-facing work concepts.
const definitions = createPersistentMap('work-process-definitions-v2');
const versions = createPersistentMap('work-process-versions-v2');
const jobs = createPersistentMap('work-jobs-v2');
const events = createPersistentMap('work-events-v2');
const assessments = createPersistentMap('work-assessments-v2');
const anonymousAggregates = createPersistentMap('anonymous-operational-aggregates-v1');
const activeJobs = new Map();
const deletedJobIds = new Set();
const activeAgents = new Map();
const agentLimits = new Map();
const NODE_TYPES = new Set(['start', 'agent-task', 'human-input', 'human-approval', 'condition', 'parallel-fork', 'parallel-join', 'subprocess', 'delay', 'handover', 'end']);
const TERMINAL = new Set(['completed', 'cancelled', 'failed']);
const QUALITY_DIMENSIONS = ['completeness', 'relevance', 'correctness', 'evidence', 'contract'];
const TRIGGER_TYPES = new Set(['chat', 'manual', 'schedule', 'webhook', 'api']);
const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const clip = (value, limit = 30_000) => String(value ?? '').trim().slice(0, limit);
const slug = value => clip(value, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
const versionKey = (id, version) => `${id}@${version}`;
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const statusForError = error => Number(error?.statusCode || error?.status || error?.response?.status || 0);
const retryAfterFor = error => {
    const raw = error?.response?.headers?.['retry-after'] || error?.response?.headers?.get?.('retry-after');
    if (!raw) return 0;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = new Date(raw).getTime();
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
};
const connectivityError = error => !statusForError(error) && /(?:timeout|network|socket|connect|fetch failed|econn|enotfound|eai_again)/i.test(String(error?.message || ''));
const waitForRetry = (milliseconds, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.max(0, milliseconds));
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('Interrupted'), { code: 'EXECUTION_CANCELLED' })); }, { once: true });
});
const saveJob = job => {
    if (!job || deletedJobIds.has(job.jobId)) return false;
    jobs.set(job.jobId, clone(job));
    return true;
};
const emptyAnonymousAggregate = () => ({
    purgedJobs: 0, terminalJobs: 0, completedJobs: 0, failedJobs: 0, cancelledJobs: 0,
    tasks: 0, attempts: 0, failedAttempts: 0, retriedTasks: 0, recoveredTasks: 0,
    qualityTotal: 0, qualityCount: 0, executionMsTotal: 0, executionCount: 0,
});
const retainAnonymousAggregate = job => {
    if (!job) return;
    const aggregate = { ...emptyAnonymousAggregate(), ...(anonymousAggregates.get('global') || {}) };
    const tasks = job.tasks || [];
    const attempts = tasks.flatMap(task => task.attempts || []);
    aggregate.purgedJobs += 1;
    aggregate.tasks += tasks.length;
    aggregate.attempts += attempts.length;
    aggregate.failedAttempts += attempts.filter(attempt => ['failed', 'quality_failed'].includes(attempt.state)).length;
    aggregate.retriedTasks += tasks.filter(task => (task.attempts || []).length > 1).length;
    aggregate.recoveredTasks += tasks.filter(task => (task.attempts || []).length > 1 && task.state === 'completed').length;
    if (TERMINAL.has(job.status)) aggregate.terminalJobs += 1;
    if (job.status === 'completed') aggregate.completedJobs += 1;
    if (job.status === 'failed') aggregate.failedJobs += 1;
    if (job.status === 'cancelled') aggregate.cancelledJobs += 1;
    if (Number.isFinite(job.finalAssessment?.score)) {
        aggregate.qualityTotal += job.finalAssessment.score;
        aggregate.qualityCount += 1;
    }
    const duration = job.startedAt && job.completedAt ? new Date(job.completedAt) - new Date(job.startedAt) : NaN;
    if (Number.isFinite(duration) && duration >= 0) {
        aggregate.executionMsTotal += duration;
        aggregate.executionCount += 1;
    }
    anonymousAggregates.set('global', aggregate);
};

const builtIns = [
    {
        definitionId: 'governed-product-change', builtInRevision: 2, name: 'Governed product change', description: 'Parallel source and experience analysis, implementation, independent verification, and final Nora handover.', governed: true, enabled: true,
        authorizationScopes: ['local-write'], normalQualityThreshold: 90, finalQualityThreshold: 95,
        nodes: [
            { nodeId: 'start', type: 'start', name: 'Request accepted', position: { x: 60, y: 260 } },
            { nodeId: 'source-audit', type: 'agent-task', name: 'Audit implementation', agentId: 'dex', taskClass: 'coding', prompt: 'Inspect the implementation and return constraints, affected files, and a precise change plan.', tools: [{ toolName: 'project_list_files' }, { toolName: 'project_search_files' }, { toolName: 'project_read_file' }], dependsOn: ['start'], position: { x: 260, y: 150 } },
            { nodeId: 'experience-audit', type: 'agent-task', name: 'Define experience', agentId: 'luma', taskClass: 'planning', prompt: 'Define the interaction, visual, and acceptance requirements.', dependsOn: ['start'], position: { x: 260, y: 370 } },
            { nodeId: 'implementation', type: 'agent-task', name: 'Implement change', agentId: 'dex', taskClass: 'coding', prompt: 'Implement the objective using both handovers and verify it.', tools: [{ toolName: 'project_search_files' }, { toolName: 'project_read_file' }, { toolName: 'project_write_file' }, { toolName: 'project_run_check' }], dependsOn: ['source-audit', 'experience-audit'], position: { x: 500, y: 260 } },
            { nodeId: 'verification', type: 'agent-task', name: 'Independent verification', agentId: 'vera', taskClass: 'quality', prompt: 'Verify every required outcome and provide evidence.', tools: [{ toolName: 'project_read_file' }, { toolName: 'project_run_check' }], dependsOn: ['implementation'], position: { x: 740, y: 260 } },
            { nodeId: 'handover', type: 'end', name: 'Nora handover', agentId: 'nora', dependsOn: ['verification'], position: { x: 970, y: 260 } },
        ],
    },
    {
        definitionId: 'parallel-discovery', builtInRevision: 2, name: 'Parallel discovery and decision', description: 'Research and commercial analysis run in parallel before synthesis and verification.', governed: true, enabled: true,
        authorizationScopes: [], normalQualityThreshold: 90, finalQualityThreshold: 95,
        nodes: [
            { nodeId: 'start', type: 'start', name: 'Start', position: { x: 60, y: 260 } },
            { nodeId: 'research', type: 'agent-task', name: 'Evidence research', agentId: 'iris', taskClass: 'research', prompt: 'Research primary evidence. Return sources, findings, and uncertainty.', tools: [{ toolName: 'web_search' }, { toolName: 'fetch_url' }], dependsOn: ['start'], position: { x: 270, y: 150 } },
            { nodeId: 'commercial', type: 'agent-task', name: 'Commercial assessment', agentId: 'marco', taskClass: 'planning', prompt: 'Assess options, constraints, implications, and a recommendation.', tools: [{ toolName: 'web_search' }], dependsOn: ['start'], position: { x: 270, y: 370 } },
            { nodeId: 'synthesis', type: 'agent-task', name: 'Synthesize decision', agentId: 'nora', taskClass: 'synthesis', prompt: 'Synthesize both handovers into one supported recommendation.', dependsOn: ['research', 'commercial'], position: { x: 520, y: 260 } },
            { nodeId: 'verification', type: 'agent-task', name: 'Verify decision', agentId: 'vera', taskClass: 'quality', prompt: 'Independently verify the recommendation.', tools: [{ toolName: 'web_search' }], dependsOn: ['synthesis'], position: { x: 750, y: 260 } },
            { nodeId: 'handover', type: 'end', name: 'Final handover', agentId: 'nora', dependsOn: ['verification'], position: { x: 970, y: 260 } },
        ],
    },
];

const normalizeNode = (value, index) => {
    const type = NODE_TYPES.has(value?.type) ? value.type : 'agent-task';
    const nodeId = slug(value?.nodeId || `${type}-${index + 1}`);
    const agentId = clip(value?.agentId || (type === 'end' ? 'nora' : ''), 40).toLowerCase();
    if (!nodeId) fail('Every process node needs a stable identifier.');
    if (['agent-task', 'handover', 'end'].includes(type) && !getAgentDefinition(agentId)) fail(`Unknown process agent: ${agentId || '(missing)'}.`);
    if (value?.modelOptionId && !modelOption(value.modelOptionId)) fail(`Unknown model option: ${value.modelOptionId}.`);
    const tools = (value?.tools || value?.toolPlan || []).map(tool => ({ toolName: clip(tool?.toolName || tool?.name, 120), args: tool?.args && typeof tool.args === 'object' ? clone(tool.args) : {}, resultPath: clip(tool?.resultPath, 120) })).filter(tool => tool.toolName);
    if (type === 'agent-task') {
        const allowed = new Set(listTools(agentId).map(tool => tool.name));
        const unavailable = tools.find(tool => !allowed.has(tool.toolName));
        if (unavailable) fail(`${agentId} cannot use planned tool ${unavailable.toolName}. Assign a permitted agent or change the exact tool plan.`);
    } else if (tools.length) fail(`Only Agent Task nodes can contain tool plans; ${nodeId} is ${type}.`);
    return {
        nodeId, type, name: clip(value?.name || type.replace('-', ' '), 120), description: clip(value?.description, 600),
        agentId, taskClass: clip(value?.taskClass || 'general', 40), prompt: clip(value?.prompt, 16_000),
        dependsOn: [...new Set((value?.dependsOn || []).map(slug).filter(Boolean))],
        tools,
        inputSchema: value?.inputSchema && typeof value.inputSchema === 'object' ? clone(value.inputSchema) : { type: 'object' },
        outputSchema: value?.outputSchema && typeof value.outputSchema === 'object' ? clone(value.outputSchema) : { type: 'string' },
        condition: value?.condition && typeof value.condition === 'object' ? clone(value.condition) : null,
        conditionBranch: ['true', 'false', 'always'].includes(value?.conditionBranch) ? value.conditionBranch : 'always',
        processDefinitionId: clip(value?.processDefinitionId, 80), delayMs: Math.max(0, Math.min(Number(value?.delayMs || 0), 604_800_000)),
        modelOptionId: clip(value?.modelOptionId, 80),
        modelSettings: { temperature: Math.max(0, Math.min(Number(value?.modelSettings?.temperature ?? value?.temperature ?? 0.2), 2)) },
        timeoutMs: Math.max(15_000, Math.min(Number(value?.timeoutMs || platformTimeout('processNodeMs')), 7_200_000)),
        maxToolRounds: Math.max(0, Math.min(Number(value?.maxToolRounds ?? 8), 50)), maxAttempts: Math.max(1, Math.min(Number(value?.maxAttempts || 3), 10)),
        failurePolicy: ['pause', 'fail', 'continue', 'reassign'].includes(value?.failurePolicy) ? value.failurePolicy : 'pause',
        fallbackAgentIds: [...new Set((value?.fallbackAgentIds || []).map(item => clip(item, 40).toLowerCase()).filter(item => getAgentDefinition(item)))],
        evaluatorAgentId: getAgentDefinition(String(value?.evaluatorAgentId || '').toLowerCase()) ? String(value.evaluatorAgentId).toLowerCase() : 'nora',
        qualityThreshold: Math.max(0, Math.min(Number(value?.qualityThreshold ?? 90), 100)),
        position: { x: Number(value?.position?.x ?? 180 + index * 220), y: Number(value?.position?.y ?? 260) },
    };
};

const validateGraph = input => {
    const nodes = (input?.nodes || []).map(normalizeNode);
    if (nodes.length < 2 || nodes.length > 60) fail('A process needs between 2 and 60 nodes.');
    const ids = new Set(nodes.map(node => node.nodeId));
    if (ids.size !== nodes.length) fail('Process node identifiers must be unique.');
    if (nodes.filter(node => node.type === 'start').length !== 1) fail('A process must have exactly one Start node.');
    if (nodes.filter(node => node.type === 'end').length !== 1) fail('A process must have exactly one End node.');
    nodes.forEach(node => node.dependsOn.forEach(parent => { if (!ids.has(parent) || parent === node.nodeId) fail(`Invalid connection ${parent} → ${node.nodeId}.`); }));
    const start = nodes.find(node => node.type === 'start'); const end = nodes.find(node => node.type === 'end');
    if (start.dependsOn.length) fail('The Start node cannot depend on another node.');
    nodes.filter(node => node.type !== 'start').forEach(node => { if (!node.dependsOn.length) fail(`${node.name} is disconnected from Start.`); });
    const byId = new Map(nodes.map(node => [node.nodeId, node])); const visiting = new Set(); const visited = new Set();
    const visit = id => { if (visiting.has(id)) fail('Process graph contains a cycle. Use a bounded recovery route.'); if (visited.has(id)) return; visiting.add(id); byId.get(id).dependsOn.forEach(visit); visiting.delete(id); visited.add(id); };
    nodes.forEach(node => visit(node.nodeId));
    const descendants = new Set([start.nodeId]);
    for (let changed = true; changed;) {
        changed = false;
        for (const node of nodes) if (!descendants.has(node.nodeId) && node.dependsOn.some(id => descendants.has(id))) { descendants.add(node.nodeId); changed = true; }
    }
    if (descendants.size !== nodes.length) fail('Every process node must be reachable from Start.');
    const ancestors = new Set([end.nodeId]);
    for (let changed = true; changed;) {
        changed = false;
        for (const nodeId of [...ancestors]) for (const parentId of byId.get(nodeId).dependsOn) if (!ancestors.has(parentId)) { ancestors.add(parentId); changed = true; }
    }
    if (ancestors.size !== nodes.length) fail('Every process branch must converge on End.');
    const scopes = [...new Set((input.authorizationScopes || []).map(String))]; const known = new Set(OFFICE_PLATFORM_CONFIG.authorization.scopes.map(scope => scope.id));
    scopes.forEach(scope => { if (!known.has(scope)) fail(`Unknown authorization scope: ${scope}.`); });
    for (const node of nodes.filter(item => item.type === 'agent-task')) {
        const catalog = new Map(listTools(node.agentId).map(tool => [tool.name, tool]));
        const required = [...new Set(node.tools.flatMap(tool => catalog.get(tool.toolName)?.authorizationScopes || []))];
        const missing = required.filter(scope => !scopes.includes(scope));
        if (missing.length) fail(`${node.name} uses governed tools. Add these process authorizations: ${missing.join(', ')}.`);
    }
    return { nodes, scopes };
};

export const saveProcessDefinition = input => {
    const { nodes, scopes } = validateGraph(input); const definitionId = slug(input.definitionId || input.name) || randomUUID(); const previous = definitions.get(definitionId);
    const triggers = (Array.isArray(input.triggers) ? input.triggers : [{ type: 'chat' }, { type: 'manual' }])
        .filter(item => TRIGGER_TYPES.has(item?.type)).map(item => ({ type: item.type }));
    const record = {
        definitionId, name: clip(input.name || 'Untitled process', 140), description: clip(input.description, 1_200), status: 'draft',
        kind: ['reusable', 'one-off'].includes(input.kind) ? input.kind : previous?.kind || 'reusable', owner: clip(input.owner || previous?.owner || 'carlos', 80),
        archivedAt: input.archivedAt === null ? '' : clip(input.archivedAt || previous?.archivedAt, 80), builtInRevision: Number(input.builtInRevision || previous?.builtInRevision || 0),
        governed: input.governed !== false, enabled: input.enabled !== false, authorizationScopes: scopes, nodes,
        failFast: Boolean(input.failFast ?? previous?.failFast ?? false),
        triggers: triggers.length ? [...new Map(triggers.map(item => [item.type, item])).values()] : [{ type: 'manual' }],
        normalQualityThreshold: Math.max(0, Math.min(Number(input.normalQualityThreshold ?? 90), 100)),
        finalQualityThreshold: Math.max(0, Math.min(Number(input.finalQualityThreshold ?? 95), 100)),
        latestVersion: Number(previous?.latestVersion || 0), createdAt: previous?.createdAt || now(), updatedAt: now(),
    };
    definitions.set(definitionId, record); return clone(record);
};
export const publishProcessDefinition = definitionId => {
    const draft = definitions.get(String(definitionId || '')); if (!draft) fail('Process definition not found.', 404);
    const version = Number(draft.latestVersion || 0) + 1; const snapshot = { ...clone(draft), status: 'published', version, publishedAt: now(), updatedAt: now() };
    versions.set(versionKey(draft.definitionId, version), snapshot); definitions.set(draft.definitionId, { ...draft, latestVersion: version, publishedAt: snapshot.publishedAt, updatedAt: now() }); return clone(snapshot);
};
export const listProcessDefinitions = () => [...definitions.values()].sort((a, b) => a.name.localeCompare(b.name)).map(record => clone({ ...record, version: record.latestVersion }));
export const getProcessDefinition = id => { const record = definitions.get(String(id || '')); return record ? clone({ ...record, version: record.latestVersion }) : null; };
export const listProcessVersions = id => [...versions.values()].filter(record => record.definitionId === String(id || '')).sort((a, b) => b.version - a.version).map(clone);
export const updateProcessLifecycle = (id, action) => {
    const current = definitions.get(String(id || '')); if (!current) fail('Process definition not found.', 404);
    if (action === 'archive' || action === 'restore') {
        const next = { ...current, archivedAt: action === 'archive' ? now() : '', enabled: action !== 'archive', updatedAt: now() };
        definitions.set(next.definitionId, next); return clone(next);
    }
    if (action === 'promote') {
        if (current.kind !== 'one-off') fail('Only a one-off process can be promoted.', 409);
        const next = { ...current, kind: 'reusable', owner: 'carlos', updatedAt: now() }; definitions.set(next.definitionId, next); return clone(next);
    }
    if (action === 'duplicate') {
        const copy = saveProcessDefinition({ ...current, definitionId: `${current.definitionId}-copy-${randomUUID().slice(0, 6)}`, name: `${current.name} copy`, kind: 'reusable', owner: 'carlos', archivedAt: '', latestVersion: 0 });
        return copy;
    }
    fail('Unknown process lifecycle action.', 400);
};
export const deleteProcessDefinition = id => { const definitionId = String(id || ''); if ([...jobs.values()].some(job => job.processDefinitionId === definitionId && !TERMINAL.has(job.status))) fail('Cancel active jobs before deleting this process.', 409); return { deleted: definitions.delete(definitionId), definitionId }; };

const emit = (job, type, values = {}) => {
    if (deletedJobIds.has(job.jobId)) return null;
    const record = { eventId: `${Date.now()}-${randomUUID()}`, type, jobId: job.jobId, requestId: job.requestId, conversationId: job.conversationId, createdAt: now(), visibility: 'activity', ...values };
    events.set(record.eventId, record);
    publishRuntimeEvent({
        ...record,
        workflowId: `job:${job.jobId}`,
        from: values.from || values.agentId || 'runtime',
        to: values.to || 'job',
        fromNode: values.fromNode || (values.agentId ? `agent:${values.agentId}` : `job:${job.jobId}`),
        toNode: values.toNode || `job:${job.jobId}`,
        stage: values.stage || type,
        tone: values.tone || (type.includes('failed') || type.includes('paused') ? 'danger' : type.includes('completed') ? 'success' : 'info'),
    });
    return record;
};
const runtimeTask = (jobId, node) => ({
    taskId: `${jobId}:${node.nodeId}`, nodeId: node.nodeId, type: node.type, name: node.name, agentId: node.agentId,
    state: 'pending', attempts: [], inputQuality: null, outputQuality: null, result: '', resultSummary: '', artifacts: [], error: '',
    startedAt: '', completedAt: '', updatedAt: now(),
});
const parseJson = value => {
    const text = String(value || ''); const start = text.indexOf('{'); const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
};
const validateSchema = (value, schema = {}) => {
    if (!schema || schema.type === undefined) return { valid: true, errors: [] };
    let parsed = value;
    if (schema.type !== 'string' && typeof value === 'string') { try { parsed = JSON.parse(value); } catch {} }
    const errors = [];
    const type = Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed;
    if (schema.type && type !== schema.type) errors.push(`Expected ${schema.type}; received ${type}.`);
    if (schema.type === 'object' && parsed && typeof parsed === 'object') {
        for (const key of schema.required || []) if (parsed[key] === undefined) errors.push(`Missing required field: ${key}.`);
    }
    return { valid: errors.length === 0, errors, value: parsed };
};
const fixedAssessment = ({ evaluator = 'system', threshold = 0, score = 100, comments = '', dimensions = null } = {}) => ({
    assessmentId: randomUUID(), evaluator, score, threshold, passed: score >= threshold,
    dimensions: dimensions || Object.fromEntries(QUALITY_DIMENSIONS.map(key => [key, score])), comments, createdAt: now(),
});
const calculateQuality = async ({ output, threshold, evaluator = 'nora', objective = '', task = '', schema = { type: 'string' }, signal }) => {
    const contract = validateSchema(output, schema);
    if (!contract.valid || !clip(output)) return fixedAssessment({ evaluator, threshold, score: 0, comments: contract.errors.join(' ') || 'No output was produced.', dimensions: { completeness: 0, relevance: 0, correctness: 0, evidence: 0, contract: contract.valid ? 100 : 0 } });
    try {
        const { runAgent } = await import('./agentRunner.mjs');
        const prompt = `Assess this task output. Use only the supplied objective, task contract, and output. Return JSON only with dimensions completeness, relevance, correctness, evidence, contract (0-100), comments, and a concise resultSummary. Do not reward length. Unsupported claims reduce correctness and evidence.\n\nOBJECTIVE\n${clip(objective, 8_000)}\n\nTASK\n${clip(task, 4_000)}\n\nOUTPUT SCHEMA\n${JSON.stringify(schema)}\n\nOUTPUT\n${clip(output, 20_000)}`;
        const result = await runAgent(evaluator, [{ role: 'user', content: prompt, createdAt: now() }], {
            signal, taskType: 'quality', allowTools: false, includeMemory: false, includeAutomaticProjectContext: false,
            maxToolRounds: 0, timeoutMs: Math.min(platformTimeout('processNodeMs'), 300_000),
        });
        const parsed = parseJson(result.content);
        if (!parsed?.dimensions) throw new Error('Evaluator returned invalid JSON.');
        const dimensions = Object.fromEntries(QUALITY_DIMENSIONS.map(key => [key, Math.max(0, Math.min(Number(parsed.dimensions[key]) || 0, 100))]));
        if (!contract.valid) dimensions.contract = 0;
        const score = Math.round(QUALITY_DIMENSIONS.reduce((sum, key) => sum + dimensions[key], 0) / QUALITY_DIMENSIONS.length);
        return { ...fixedAssessment({ evaluator, threshold, score, dimensions, comments: clip(parsed.comments, 2_000) }), resultSummary: clip(parsed.resultSummary, 320), model: result.model || null };
    } catch (error) {
        return fixedAssessment({ evaluator, threshold, score: 0, comments: `Quality evaluation unavailable: ${error.message}` });
    }
};
const replaceTemplates = (value, context) => {
    if (typeof value === 'string') return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, path) => path.split('.').reduce((item, key) => item?.[key], context) ?? '');
    if (Array.isArray(value)) return value.map(item => replaceTemplates(item, context));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTemplates(item, context)]));
    return value;
};
const acquireAgent = agentId => {
    const definition = getAgentDefinition(agentId);
    const limit = Math.max(1, Number(agentLimits.get(agentId) || definition?.maxInstances || 1)); const current = Number(activeAgents.get(agentId) || 0);
    if (current >= limit) return false; activeAgents.set(agentId, current + 1); return true;
};

const valueAt = (source, field = '') => String(field || '').split('.').filter(Boolean).reduce((value, key) => value?.[key], source);
const conditionMatches = (condition, context) => {
    if (!condition || typeof condition !== 'object') return false;
    const left = valueAt(context, condition.field || condition.path);
    const right = condition.value;
    switch (condition.operator || 'equals') {
        case 'not-equals': return left !== right;
        case 'contains': return String(left ?? '').includes(String(right ?? ''));
        case 'not-contains': return !String(left ?? '').includes(String(right ?? ''));
        case 'exists': return left !== undefined && left !== null && left !== '';
        case 'greater-than': return Number(left) > Number(right);
        case 'less-than': return Number(left) < Number(right);
        case 'in': return Array.isArray(right) && right.includes(left);
        default: return left === right;
    }
};
const releaseAgent = agentId => activeAgents.set(agentId, Math.max(0, Number(activeAgents.get(agentId) || 1) - 1));
export const setAgentRuntimeLimit = (agentId, maxInstances = 1) => agentLimits.set(String(agentId), Math.max(1, Math.min(Number(maxInstances) || 1, 20)));
const authorityFor = job => ({
    ...createRequestAuthority(job.objective), source: 'durable-job',
    localProjectMutation: job.approvedScopes.includes('local-write'), projectDelete: job.approvedScopes.includes('local-delete'),
    dependencyInstall: job.approvedScopes.includes('dependency-install'), gitPublish: job.approvedScopes.includes('git-publish'),
    externalWrite: job.approvedScopes.includes('external-write'), externalMessage: job.approvedScopes.includes('external-message'),
    skillAdmin: job.approvedScopes.includes('skill-admin'), scheduleAdmin: job.approvedScopes.includes('schedule-admin'),
});
const taskPrompt = (definition, job, node, plannedResults = []) => {
    const upstream = node.dependsOn.map(id => job.tasks.find(task => task.nodeId === id)).map(task => ({ task: task.name, agent: task.agentId, result: clip(task.result, 12_000), quality: task.outputQuality?.score }));
    return [
        `PROCESS: ${definition.name}`, `OBJECTIVE: ${job.objective}`, `TASK: ${node.name}`, `INSTRUCTIONS:\n${node.prompt}`,
        `INPUTS:\n${JSON.stringify(job.inputs)}`, `UPSTREAM HANDOVERS:\n${JSON.stringify(upstream)}`,
        node.tools.length ? `TOOLS PLANNED IN THIS EXACT ORDER:\n${node.tools.map((tool, index) => `${index + 1}. ${tool.toolName} args=${JSON.stringify(tool.args || {})}${tool.resultPath ? ` result=${tool.resultPath}` : ''}`).join('\n')}` : '',
        plannedResults.length ? `PLANNED TOOL RESULTS:\n${JSON.stringify(plannedResults)}` : '',
        `OUTPUT CONTRACT:\n${JSON.stringify(node.outputSchema || { type: 'string' })}`,
        'Return outcome, evidence, artifacts or changes, checks, blockers, and next action. Do not expose private chain-of-thought.',
    ].filter(Boolean).join('\n\n');
};
const propagateInputQuality = (definition, job, completedNodeId) => {
    definition.nodes.filter(node => node.dependsOn.includes(completedNodeId)).forEach(node => {
        const target = job.tasks.find(task => task.nodeId === node.nodeId);
        const scores = node.dependsOn.map(id => job.tasks.find(task => task.nodeId === id)?.outputQuality?.score).filter(Number.isFinite);
        if (target && scores.length) target.inputQuality = { score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), sources: [...node.dependsOn], assessedAt: now() };
    });
};

const executeAgentTask = async (definition, job, node, task, signal) => {
    const agentId = task.agentId || node.agentId;
    if (!acquireAgent(agentId)) return false;
    const number = job.agentInstances.filter(instance => instance.agentId === agentId).length + 1;
    const instance = { instanceId: randomUUID(), agentId, label: `${agentId[0].toUpperCase()}${agentId.slice(1)}-${number}`, taskId: task.taskId, state: 'working', createdAt: now(), updatedAt: now() };
    const attempt = { attemptId: randomUUID(), number: task.attempts.length + 1, state: 'running', startedAt: now(), completedAt: '', error: '', toolActivity: [], model: null };
    job.agentInstances.push(instance); task.attempts.push(attempt); task.state = 'running'; task.startedAt ||= now(); task.updatedAt = now(); job.updatedAt = now(); saveJob(job);
    emit(job, 'task.started', { taskId: task.taskId, agentId, summary: `${instance.label} started ${node.name}.` });
    try {
        const { listTools } = await import('./toolRegistry.mjs');
        const toolCatalog = new Map(listTools(agentId).map(tool => [tool.name, tool]));
        const requiredModelOptions = [...new Set(node.tools.map(tool => toolCatalog.get(tool.toolName)?.requiredModelOptionId).filter(Boolean))];
        if (requiredModelOptions.length > 1) throw Object.assign(new Error(`Planned tools require incompatible models: ${requiredModelOptions.join(', ')}.`), { statusCode: 409 });
        const { runAgent } = await import('./agentRunner.mjs'); const authority = authorityFor(job);
        const result = await runWithExecutionContext({ requestId: job.requestId, conversationId: job.conversationId, jobId: job.jobId, definitionId: job.processDefinitionId, processVersion: job.processVersion, objective: job.objective, authority, agentId }, () => runAgent(agentId, [{ role: 'user', content: taskPrompt(definition, job, { ...node, agentId }), createdAt: now() }], {
            signal, authority, jobId: job.jobId, taskType: node.taskClass, modelOptionId: requiredModelOptions[0] || node.modelOptionId,
            modelRequirementSource: requiredModelOptions.length ? 'tool' : 'process', temperature: node.modelSettings?.temperature,
            timeoutMs: node.timeoutMs, allowTools: node.tools.length > 0,
            allowedToolNames: node.tools.map(tool => tool.toolName), toolSequence: node.tools.map(tool => tool.toolName),
            toolPlan: node.tools,
            toolPlanContext: { objective: job.objective, inputs: job.inputs, upstream: Object.fromEntries(node.dependsOn.map(id => [id, job.tasks.find(task => task.nodeId === id)?.result])) },
            maxToolRounds: Math.max(node.maxToolRounds || 0, node.tools.length + 2), maxToolRoundsLimit: 50,
            failOnToolError: true, toolExecutionContext: { jobId: job.jobId, taskId: task.taskId },
            queueKey: `job:${job.jobId}:${node.nodeId}`, includeAutomaticProjectContext: true,
        }));
        attempt.toolActivity = (result.toolEvents || []).filter(event => event.name !== 'automatic_project_grounding').map(event => {
            const metadata = toolCatalog.get(event.name) || {};
            return {
                toolName: event.name, state: event.failed ? 'failed' : 'completed', startedAt: attempt.startedAt, completedAt: now(),
                result: event.failed ? '' : clip(JSON.stringify(event.result), 8_000), error: event.failed ? clip(event.result?.error || 'Tool failed.', 2_000) : '',
                args: event.args || {}, idempotent: metadata.idempotent !== false, authorizationScopes: metadata.authorizationScopes || [],
            };
        });
        for (const activity of attempt.toolActivity) emit(job, `tool.${activity.state}`, { taskId: task.taskId, agentId, toolName: activity.toolName, summary: `${agentId} ${activity.state} ${activity.toolName}.` });
        task.artifacts = mergeArtifacts(task.artifacts, extractArtifacts(result.toolEvents || [], { agentId }));
        task.result = clip(result.content); task.resultSummary = clip(result.content, 320); task.state = 'completed'; task.completedAt = now();
        attempt.state = 'completed'; attempt.completedAt = now(); attempt.model = result.model || null;
        task.outputQuality = await calculateQuality({ output: task.result, threshold: node.qualityThreshold ?? definition.normalQualityThreshold, evaluator: node.evaluatorAgentId || 'nora', objective: job.objective, task: `${node.name}\n${node.prompt}`, schema: node.outputSchema, signal });
        if (task.outputQuality.resultSummary) task.resultSummary = task.outputQuality.resultSummary;
        assessments.set(task.outputQuality.assessmentId, { ...task.outputQuality, jobId: job.jobId, taskId: task.taskId, type: 'task-output' });
        if (!task.outputQuality.passed) {
            task.error = `Output quality ${task.outputQuality.score} is below ${task.outputQuality.threshold}. ${task.outputQuality.comments}`;
            task.state = attempt.number < node.maxAttempts ? 'retry' : 'paused'; task.completedAt = '';
            attempt.state = 'quality_failed';
            emit(job, `task.${task.state}`, { taskId: task.taskId, agentId, quality: task.outputQuality.score, summary: task.error, requiresCarlos: task.state === 'paused' });
        } else {
            propagateInputQuality(definition, job, node.nodeId);
            emit(job, 'task.completed', { taskId: task.taskId, agentId, quality: task.outputQuality.score, summary: `${node.name} completed at ${task.outputQuality.score}% quality.` });
        }
    } catch (error) {
        attempt.state = signal.aborted ? 'interrupted' : 'failed'; attempt.completedAt = now(); attempt.error = clip(error.message, 4_000); task.error = attempt.error;
        const status = statusForError(error);
        const failedTool = attempt.toolActivity.findLast(item => item.state === 'failed');
        const retryableStatus = status === 429 || status >= 500 || connectivityError(error) || error?.code === 'INVALID_TOOL_OUTPUT';
        const unknownSideEffect = failedTool?.idempotent === false && retryableStatus;
        if (!signal.aborted && status === 428 && error.authorizationRequest) {
            if (!job.authorizationRequestIds.includes(error.authorizationRequest.requestId)) job.authorizationRequestIds.push(error.authorizationRequest.requestId);
            task.state = 'paused'; job.status = 'waiting_authorization'; job.waitingOn = 'carlos';
        } else if (!signal.aborted && unknownSideEffect) {
            task.state = 'paused'; task.error = `The side-effect result is unknown. Reconcile external state before retrying. ${task.error}`;
        } else if (!signal.aborted && status === 401) {
            task.state = 'paused'; task.error = `Credential refresh or reconnection is required. ${task.error}`;
        } else if (!signal.aborted && [403, 428].includes(status)) {
            task.state = 'paused'; task.error = `Carlos must review the authorization boundary. ${task.error}`;
        } else if (!signal.aborted && status === 400) {
            task.state = attempt.number < Math.min(2, node.maxAttempts) ? 'retry' : 'paused';
        } else if (!signal.aborted && retryableStatus) {
            if (attempt.number < node.maxAttempts) {
                const delayMs = status === 429 ? Math.min(60_000, retryAfterFor(error) || 2 ** (attempt.number - 1) * 2_000) : Math.min(30_000, 2 ** (attempt.number - 1) * 2_000);
                emit(job, 'task.backoff', { taskId: task.taskId, agentId, summary: `${node.name} will retry after ${Math.ceil(delayMs / 1000)} seconds.` });
                await waitForRetry(delayMs, signal);
                task.state = 'retry';
            } else task.state = 'paused';
        } else {
            task.state = signal.aborted ? 'interrupted' : (attempt.number < node.maxAttempts && failedTool?.idempotent !== false ? 'retry' : node.failurePolicy === 'continue' ? 'skipped' : node.failurePolicy === 'fail' ? 'failed' : 'paused');
        }
        if (!signal.aborted && node.failurePolicy === 'reassign' && node.fallbackAgentIds.length) {
            const next = node.fallbackAgentIds.find(agentId => agentId !== task.agentId);
            if (next) { task.agentId = next; if (!['paused', 'waiting_authorization'].includes(task.state)) task.state = 'retry'; }
        }
        emit(job, `task.${task.state}`, { taskId: task.taskId, agentId, summary: `${node.name}: ${task.error}`, requiresCarlos: task.state === 'paused' });
    } finally {
        instance.state = task.state === 'completed' ? 'completed' : task.state; instance.updatedAt = now(); task.updatedAt = now(); job.updatedAt = now(); releaseAgent(agentId); saveJob(job);
    }
    return true;
};

const executeSystemNode = async (definition, job, node, task, signal) => {
    task.state = 'running'; task.startedAt ||= now();
    if (node.type === 'delay' && node.delayMs) await new Promise((resolve, reject) => { const timer = setTimeout(resolve, node.delayMs); signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Interrupted')); }, { once: true }); });
    if (['human-input', 'human-approval'].includes(node.type)) {
        task.state = 'waiting_human'; task.waitingKind = node.type; job.status = 'paused'; job.waitingOn = 'carlos';
        emit(job, node.type === 'human-approval' ? 'job.needs-approval' : 'job.needs-input', { taskId: task.taskId, summary: node.prompt || `${node.name} needs Carlos.`, requiresCarlos: true });
        return;
    }
    if (node.type === 'condition') {
        const upstream = Object.fromEntries(node.dependsOn.map(id => [id, job.tasks.find(item => item.nodeId === id)?.result]));
        const matched = conditionMatches(node.condition, { inputs: job.inputs, upstream, job: { objective: job.objective, priority: job.priority } });
        task.result = JSON.stringify({ matched, condition: node.condition });
        const skipBranch = nodeId => {
            const branchTask = job.tasks.find(item => item.nodeId === nodeId);
            if (!branchTask || branchTask.state !== 'pending') return;
            branchTask.state = 'skipped'; branchTask.resultSummary = `Condition ${node.nodeId} did not select this route.`; branchTask.completedAt = now();
            for (const child of definition.nodes.filter(item => item.dependsOn.includes(nodeId))) {
                const dependencies = child.dependsOn.map(id => job.tasks.find(item => item.nodeId === id));
                if (dependencies.length && dependencies.every(item => item?.state === 'skipped')) skipBranch(child.nodeId);
            }
        };
        for (const candidate of definition.nodes.filter(item => item.dependsOn.includes(node.nodeId))) {
            if (candidate.conditionBranch === 'always') continue;
            if ((candidate.conditionBranch === 'true') !== matched) {
                skipBranch(candidate.nodeId);
            }
        }
    }
    if (node.type === 'handover') {
        task.result = node.dependsOn.map(id => job.tasks.find(item => item.nodeId === id)?.result).filter(Boolean).join('\n\n');
        task.resultSummary = clip(`${node.name} transferred the validated upstream result to ${getAgentDefinition(node.agentId)?.name || node.agentId}.`, 320);
    }
    if (node.type === 'subprocess') {
        if (!node.processDefinitionId) throw Object.assign(new Error('Subprocess node has no process definition.'), { statusCode: 400 });
        if (node.processDefinitionId === job.processDefinitionId) throw Object.assign(new Error('A process cannot call itself as a subprocess.'), { statusCode: 409 });
        const child = startProcessRun({ definitionId: node.processDefinitionId, objective: `${job.objective}\n\nSubprocess task: ${node.name}`, inputs: { ...job.inputs, parentJobId: job.jobId, parentTaskId: task.taskId }, conversationId: job.conversationId, requestId: job.requestId, messageId: job.originatingMessageId, priority: job.priority });
        task.childJobId = child.jobId;
        while (!signal.aborted) {
            const current = jobs.get(child.jobId);
            if (!current) throw new Error('Subprocess disappeared.');
            if (current.status === 'completed') { task.result = current.tasks.find(item => item.type === 'end')?.result || current.title; break; }
            if (['failed', 'cancelled', 'paused', 'waiting_authorization'].includes(current.status)) throw Object.assign(new Error(`Subprocess ${current.status}: ${current.error || current.waitingOn || 'attention required'}.`), { statusCode: 409 });
            await new Promise(resolve => setTimeout(resolve, 250));
        }
    }
    if (node.type === 'end') {
        const upstream = node.dependsOn.map(id => job.tasks.find(item => item.nodeId === id)?.result).filter(Boolean).join('\n\n');
        task.result = upstream;
        job.finalAssessment = await calculateQuality({ output: upstream, threshold: definition.finalQualityThreshold, evaluator: node.evaluatorAgentId || 'nora', objective: job.objective, task: `${definition.name} final handover`, schema: node.outputSchema, signal });
        task.outputQuality = job.finalAssessment;
        assessments.set(job.finalAssessment.assessmentId, { ...job.finalAssessment, jobId: job.jobId, taskId: task.taskId, type: 'final-output', carlos: null });
        if (!job.finalAssessment.passed) {
            task.state = 'paused'; task.error = `Final output quality ${job.finalAssessment.score} is below ${job.finalAssessment.threshold}. ${job.finalAssessment.comments}`; task.updatedAt = now();
            emit(job, 'job.quality-blocked', { taskId: task.taskId, agentId: node.agentId || 'nora', quality: job.finalAssessment.score, summary: task.error, requiresCarlos: true });
            return;
        }
    }
    task.state = 'completed'; task.completedAt = now(); task.updatedAt = now(); task.resultSummary = clip(task.result || node.description || `${node.name} completed.`, 320);
    if (node.type !== 'end') {
        task.outputQuality = fixedAssessment({ evaluator: 'system', threshold: node.qualityThreshold ?? definition.normalQualityThreshold, score: 100, comments: 'Deterministic control node completed successfully.' });
        assessments.set(task.outputQuality.assessmentId, { ...task.outputQuality, jobId: job.jobId, taskId: task.taskId, type: 'task-output' });
        propagateInputQuality(definition, job, node.nodeId);
    }
    emit(job, 'task.completed', { taskId: task.taskId, agentId: node.agentId || 'system', quality: job.finalAssessment?.score, summary: `${node.name} completed.` });
};

const executeJob = async jobId => {
    const job = jobs.get(jobId);
    if (!job || activeJobs.has(jobId) || TERMINAL.has(job.status) || job.status === 'waiting_authorization') return;
    const definition = versions.get(versionKey(job.processDefinitionId, job.processVersion));
    if (!definition) { job.status = 'failed'; job.error = 'Published process version not found.'; jobs.set(jobId, job); return; }
    const controller = new AbortController(); activeJobs.set(jobId, controller); job.status = 'running'; job.startedAt ||= now(); job.waitingOn = ''; saveJob(job); emit(job, 'job.started', { summary: `${definition.name} started.` });
    try {
        while (!controller.signal.aborted && job.status === 'running') {
            job.tasks.filter(task => task.state === 'retry').forEach(task => { task.state = 'pending'; });
            if (definition.failFast && job.tasks.some(task => task.state === 'failed')) { job.status = 'failed'; break; }
            if (definition.failFast && job.tasks.some(task => task.state === 'paused')) { job.status = 'paused'; job.waitingOn = 'carlos'; break; }
            if (job.tasks.some(task => task.state === 'waiting_human')) { job.status = 'paused'; job.waitingOn = 'carlos'; break; }
            let blockedChanged = true;
            while (blockedChanged) {
                blockedChanged = false;
                for (const task of job.tasks.filter(item => item.state === 'pending')) {
                    const node = definition.nodes.find(item => item.nodeId === task.nodeId);
                    const blocker = (node?.dependsOn || []).map(id => job.tasks.find(item => item.nodeId === id)).find(item => ['failed', 'paused', 'blocked'].includes(item?.state));
                    if (!blocker) continue;
                    task.state = 'blocked'; task.error = `Blocked by ${blocker.name}: ${blocker.error || blocker.state}.`; task.updatedAt = now(); blockedChanged = true;
                    emit(job, 'task.blocked', { taskId: task.taskId, agentId: task.agentId || 'system', summary: task.error, requiresCarlos: true });
                }
            }
            if (job.tasks.every(task => ['completed', 'skipped'].includes(task.state))) {
                if (!job.finalAssessment?.passed) { job.status = 'paused'; job.waitingOn = 'nora'; job.error = 'Final output has not passed the required quality threshold.'; }
                else { job.status = 'completed'; job.completedAt = now(); }
                break;
            }
            const ready = definition.nodes.filter(node => {
                const task = job.tasks.find(item => item.nodeId === node.nodeId);
                return task.state === 'pending' && node.dependsOn.every(id => ['completed', 'skipped'].includes(job.tasks.find(item => item.nodeId === id)?.state));
            });
            if (!ready.length) {
                const blockers = job.tasks.filter(task => ['failed', 'paused', 'blocked'].includes(task.state));
                if (blockers.length) { job.status = 'paused'; job.waitingOn = 'carlos'; job.error = `${blockers[0].name} needs recovery; independent branches finished or have no remaining runnable work.`; break; }
                await new Promise(resolve => setTimeout(resolve, 120)); continue;
            }
            const executed = await Promise.all(ready.slice(0, OFFICE_PLATFORM_CONFIG.processes.maxParallelNodes).map(async node => {
                const task = job.tasks.find(item => item.nodeId === node.nodeId);
                if (node.type === 'agent-task') return executeAgentTask(definition, job, node, task, controller.signal);
                await executeSystemNode(definition, job, node, task, controller.signal); return true;
            }));
            if (!executed.some(Boolean)) await new Promise(resolve => setTimeout(resolve, 180));
        }
        if (controller.signal.aborted) {
            job.tasks.filter(task => task.state === 'running').forEach(task => { task.state = 'interrupted'; });
            job.status = job.controlIntent === 'pause' ? 'paused' : 'cancelled';
            job.waitingOn = job.status === 'paused' ? 'carlos' : '';
            job.completedAt = job.status === 'cancelled' ? now() : '';
            job.controlIntent = '';
        }
    } catch (error) {
        job.status = controller.signal.aborted && job.controlIntent === 'pause' ? 'paused' : controller.signal.aborted ? 'cancelled' : 'failed';
        job.waitingOn = job.status === 'paused' ? 'carlos' : '';
        job.error = controller.signal.aborted && job.status === 'paused' ? 'Paused by Carlos. Running attempts were marked interrupted.' : clip(error.message, 4_000);
        job.completedAt = job.status === 'paused' ? '' : now(); job.controlIntent = '';
    } finally {
        job.updatedAt = now();
        activeJobs.delete(jobId);
        if (!deletedJobIds.has(jobId)) {
            saveJob(job);
            emit(job, `job.${job.status}`, { summary: `${definition.name}: ${job.status}.`, quality: job.finalAssessment?.score });
            void syncConversationForJob(job, definition);
            if (job.status === 'completed') enqueueOperationalWork({ kind: 'skill-review', payload: { jobId: job.jobId }, dedupeKey: `skill-review:${job.jobId}`, priority: 3, maxAttempts: 3 });
        }
        setImmediate(pumpJobs);
    }
};

const pumpJobs = () => {
    const capacity = Math.max(1, Number(OFFICE_PLATFORM_CONFIG.processes.maxParallelJobs || 8));
    if (activeJobs.size >= capacity) return;
    const ready = [...jobs.values()].filter(job => job.status === 'queued' && !activeJobs.has(job.jobId)).sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || new Date(a.createdAt) - new Date(b.createdAt));
    ready.slice(0, capacity - activeJobs.size).forEach(job => void executeJob(job.jobId));
};

const syncConversationForJob = async (job, definition) => {
    if (!job.conversationId || !['completed', 'paused', 'failed', 'cancelled'].includes(job.status)) return;
    try {
        const { getConversationRecord, saveConversationRecord } = await import('./conversationLifecycle.mjs');
        const conversation = await getConversationRecord(job.conversationId); if (!conversation) return;
        const marker = `job-status:${job.jobId}:${job.status}:${job.updatedAt}`;
        if (conversation.messages.some(message => message.activityMarker === marker)) return;
        const duration = job.startedAt ? Math.max(0, new Date(job.completedAt || job.updatedAt) - new Date(job.startedAt)) : 0;
        const completed = job.tasks.filter(task => task.state === 'completed');
        const blocked = job.tasks.find(task => ['paused', 'failed', 'waiting_human'].includes(task.state));
        const final = job.tasks.find(task => task.type === 'end');
        const toolsUsed = [...new Set(job.tasks.flatMap(task => task.attempts || []).flatMap(attempt => attempt.toolActivity || []).filter(item => item.state === 'completed').map(item => item.toolName))];
        const artifacts = job.tasks.flatMap(task => task.artifacts || []);
        const content = job.status === 'completed'
            ? [`## ${definition.name} completed`, final?.resultSummary || final?.result || job.title, `**Process:** ${definition.name} v${job.processVersion}`, `**Quality:** ${job.finalAssessment?.score ?? '—'}/100 (required ${job.finalAssessment?.threshold ?? definition.finalQualityThreshold})`, `**Agents:** ${[...new Set(completed.map(task => task.agentId).filter(Boolean))].join(', ') || 'Nora'}`, `**Evidence:** ${job.tasks.reduce((total, task) => total + (task.attempts?.length || 0), 0)} recorded attempt(s); ${toolsUsed.length ? `tools ${toolsUsed.join(', ')}` : 'no programmatic tools'}; ${artifacts.length} artifact(s).`, `**Authorizations exercised:** ${job.approvedScopes.length ? job.approvedScopes.join(', ') : 'None'}`, '**Unresolved items:** None', `**Duration:** ${Math.round(duration / 1000)}s`, artifacts.length ? '**Artifacts:** available in the job activity card.' : 'No artifact was published.'].join('\n\n')
            : [`## ${definition.name} ${job.status}`, blocked?.error || job.error || 'The job needs attention.', blocked ? `**Blocked step:** ${blocked.name}` : '', job.status === 'paused' ? 'Use the job activity card to provide input, approve, retry, reassign, or cancel.' : 'Nora preserved the job record and evidence for review.'].filter(Boolean).join('\n\n');
        conversation.messages.push({ messageId: randomUUID(), role: 'assistant', content, jobIds: [job.jobId], activityMarker: marker, artifacts: job.tasks.flatMap(task => task.artifacts || []), toolEvents: [], memoryRefs: [], model: null, attachments: [], createdAt: now() });
        await saveConversationRecord(conversation);
        const { queueOutboundForConversation } = await import('./channelGateway.mjs');
        queueOutboundForConversation(job.conversationId, content, { dedupeKey: `job-delivery:${job.jobId}:${job.status}:${job.updatedAt}` });
    } catch (error) { console.error('[process] Could not synchronize job conversation:', error.message); }
};
const authorizationState = job => {
    const records = job.authorizationRequestIds.map(getAuthorizationRequest).filter(Boolean);
    if (records.some(record => ['rejected', 'expired'].includes(record.status))) return 'rejected';
    return records.every(record => ['approved', 'consumed'].includes(record.status)) ? 'approved' : 'pending';
};

export const startProcessRun = ({ definitionId, objective, inputs = {}, conversationId = '', requestId = '', messageId = '', processVersion = 0, priority = 0 }) => {
    const draft = definitions.get(String(definitionId || '')); if (!draft) fail('Process definition not found.', 404);
    let version = Number(processVersion || draft.latestVersion || 0); if (!version) version = publishProcessDefinition(draft.definitionId).version;
    const definition = versions.get(versionKey(draft.definitionId, version)); if (!definition?.enabled) fail('This process is disabled.', 409);
    const jobId = randomUUID(); const authorizationRequestIds = []; const approvedScopes = [];
    for (const scope of definition.authorizationScopes) {
        const evaluation = evaluateAuthorization({ agentId: 'nora', scope, action: `Run process: ${definition.name}`, authority: { source: 'job-preflight' }, details: { definitionId, processVersion: version, objective }, context: { dedupeKey: `job:${jobId}:${scope}`, jobId, definitionId, processVersion: version } });
        if (evaluation.decision === 'deny') fail(`Authorization policy denies ${scope} for this job.`, 403);
        if (evaluation.decision === 'allow') approvedScopes.push(scope);
        if (evaluation.request) authorizationRequestIds.push(evaluation.request.requestId);
    }
    const job = {
        jobId, runId: jobId, requestId: requestId || randomUUID(), conversationId, originatingMessageId: messageId,
        processDefinitionId: definition.definitionId, definitionId: definition.definitionId, processVersion: version, definitionVersion: version,
        name: definition.name, title: clip(objective || definition.name, 140), objective: clip(objective || definition.description, 16_000), inputs: clone(inputs || {}), priority: Number(priority || 0),
        status: authorizationRequestIds.length ? 'waiting_authorization' : 'queued', waitingOn: authorizationRequestIds.length ? 'carlos' : '',
        authorizationRequestIds, approvedScopes, tasks: definition.nodes.map(node => runtimeTask(jobId, node)), agentInstances: [],
        finalAssessment: null, carlosAssessment: null, error: '', createdAt: now(), startedAt: '', completedAt: '', updatedAt: now(),
    };
    jobs.set(jobId, job); emit(job, 'job.created', { summary: `${definition.name} created from the request.` });
    if (!authorizationRequestIds.length) pumpJobs(); return clone(job);
};
export const resumeProcessRun = runId => {
    const job = jobs.get(String(runId || '')); if (!job) fail('Job not found.', 404);
    if (job.authorizationRequestIds.length) {
        const state = authorizationState(job);
        if (state === 'pending') fail('The job still has pending authorization requests.', 409);
        if (state === 'rejected') { job.status = 'failed'; job.error = 'A required authorization was rejected or expired.'; saveJob(job); return clone(job); }
        const approvedRequests = job.authorizationRequestIds.map(getAuthorizationRequest)
            .filter(item => ['approved', 'consumed'].includes(item?.status));
        job.approvedScopes = [...new Set([
            ...job.approvedScopes,
            ...approvedRequests
                .filter(item => ['once', 'job', 'process', 'standing'].includes(item.grant))
                .map(item => item.scope),
        ])];
        approvedRequests.filter(item => item.grant === 'once' && item.status === 'approved').forEach(item => consumeAuthorizationRequest(item.requestId));
    }
    job.tasks.filter(task => ['failed', 'cancelled', 'interrupted', 'paused', 'blocked', 'waiting_human'].includes(task.state)).forEach(task => { task.state = 'pending'; task.error = ''; });
    job.status = 'queued'; job.waitingOn = ''; job.error = ''; job.completedAt = ''; job.updatedAt = now(); saveJob(job); pumpJobs(); return clone(job);
};
export const controlJob = (jobId, input = {}) => {
    const job = jobs.get(String(jobId || '')); if (!job) fail('Job not found.', 404);
    const action = String(input.action || '').toLowerCase();
    if (action === 'resume' || action === 'retry') return resumeProcessRun(job.jobId);
    if (action === 'cancel') return cancelProcessRun(job.jobId);
    if (action === 'pause') {
        if (TERMINAL.has(job.status)) fail('A terminal job cannot be paused.', 409);
        job.controlIntent = 'pause'; job.updatedAt = now(); saveJob(job);
        const controller = activeJobs.get(job.jobId);
        if (controller) controller.abort();
        else { job.status = 'paused'; job.waitingOn = 'carlos'; saveJob(job); emit(job, 'job.paused', { summary: 'Carlos paused this job.', requiresCarlos: true }); }
        return clone(job);
    }
    if (action === 'reassign') {
        const task = job.tasks.find(item => item.taskId === input.taskId || item.nodeId === input.taskId);
        const agent = getAgentDefinition(String(input.agentId || '').toLowerCase());
        if (!task || task.type !== 'agent-task') fail('Choose an Agent Task to reassign.', 400);
        if (!agent?.enabled) fail('Choose an enabled agent definition.', 400);
        task.agentId = agent.agentId; task.state = 'pending'; task.error = ''; task.completedAt = ''; task.updatedAt = now();
        job.status = 'queued'; job.waitingOn = ''; job.completedAt = ''; job.updatedAt = now(); saveJob(job); emit(job, 'task.reassigned', { taskId: task.taskId, agentId: agent.agentId, summary: `${task.name} reassigned to ${agent.name}.` }); pumpJobs(); return clone(job);
    }
    if (action === 'skip') {
        const task = job.tasks.find(item => item.taskId === input.taskId || item.nodeId === input.taskId);
        if (!task || ['start', 'end'].includes(task.type)) fail('This task cannot be skipped.', 400);
        task.state = 'skipped'; task.error = ''; task.resultSummary = clip(input.reason || 'Skipped by Carlos.', 320); task.completedAt = now(); task.updatedAt = now();
        job.status = 'queued'; job.waitingOn = ''; job.updatedAt = now(); saveJob(job); emit(job, 'task.skipped', { taskId: task.taskId, summary: task.resultSummary }); pumpJobs(); return clone(job);
    }
    if (action === 'restart' || action === 'migrate') {
        if (!TERMINAL.has(job.status)) cancelProcessRun(job.jobId);
        const next = startProcessRun({ definitionId: job.processDefinitionId, processVersion: action === 'restart' ? job.processVersion : 0, objective: job.objective, inputs: { ...job.inputs, [`${action}edFromJobId`]: job.jobId }, conversationId: job.conversationId, requestId: randomUUID(), messageId: job.originatingMessageId, priority: job.priority });
        return { ...next, predecessorJobId: job.jobId, controlAction: action };
    }
    fail('Unknown job action.', 400);
};
export const resumeJobsForAuthorization = requestId => {
    let resumed = 0;
    for (const job of jobs.values()) {
        if (job.status !== 'waiting_authorization' || !job.authorizationRequestIds.includes(String(requestId || ''))) continue;
        if (authorizationState(job) !== 'pending') { resumeProcessRun(job.jobId); resumed += 1; }
    }
    return resumed;
};
export const provideJobInput = (jobId, { taskId = '', value = '', approved = true } = {}) => {
    const job = jobs.get(String(jobId || '')); if (!job) fail('Job not found.', 404);
    const task = job.tasks.find(item => item.taskId === taskId || (!taskId && item.state === 'waiting_human')); if (!task) fail('No task is waiting for human input.', 409);
    task.result = typeof value === 'string' ? value : JSON.stringify(value); task.resultSummary = clip(task.result, 320); task.state = approved ? 'completed' : 'failed'; task.completedAt = now();
    job.status = approved ? 'queued' : 'cancelled'; job.waitingOn = ''; job.updatedAt = now(); saveJob(job); emit(job, 'task.human-response', { taskId: task.taskId, summary: approved ? 'Carlos supplied the required decision.' : 'Carlos declined the task.' });
    if (approved) pumpJobs(); return clone(job);
};
export const assessJob = (jobId, input = {}) => {
    const job = jobs.get(String(jobId || '')); if (!job) fail('Job not found.', 404);
    const dimensions = Object.fromEntries(QUALITY_DIMENSIONS.map(name => [name, Math.max(0, Math.min(Number(input.dimensions?.[name] ?? job.finalAssessment?.dimensions?.[name] ?? 0), 100))]));
    const score = Math.max(0, Math.min(Number(input.score ?? Math.round(QUALITY_DIMENSIONS.reduce((sum, name) => sum + dimensions[name], 0) / QUALITY_DIMENSIONS.length)), 100));
    job.carlosAssessment = { assessmentId: randomUUID(), evaluator: 'carlos', score, dimensions, comments: clip(input.comments, 2_000), decision: ['accept', 'revise', 'reopen'].includes(input.decision) ? input.decision : 'accept', createdAt: now() };
    assessments.set(job.carlosAssessment.assessmentId, { ...job.carlosAssessment, jobId: job.jobId, type: 'carlos-final' });
    if (['revise', 'reopen'].includes(job.carlosAssessment.decision)) { job.status = 'paused'; job.waitingOn = 'nora'; }
    job.updatedAt = now(); saveJob(job); return clone(job);
};
export const cancelProcessRun = runId => { const id = String(runId || ''); const job = jobs.get(id); if (!job) fail('Job not found.', 404); job.controlIntent = 'cancel'; activeJobs.get(id)?.abort(); if (!activeJobs.has(id)) { job.status = 'cancelled'; job.completedAt = now(); job.updatedAt = now(); job.controlIntent = ''; saveJob(job); } return { jobId: id, runId: id, cancelled: true }; };
export const deleteJob = async jobId => {
    const id = String(jobId || '');
    const job = jobs.get(id);
    if (!job) return { jobId: id, deleted: false };
    deletedJobIds.add(id);
    retainAnonymousAggregate(job);
    activeJobs.get(id)?.abort();
    for (const [key, event] of events.entries()) if (event.jobId === id) events.delete(key);
    for (const [key, item] of assessments.entries()) if (item.jobId === id) assessments.delete(key);
    const deleted = jobs.delete(id);
    purgeAuthorizationContext({ jobId: id });
    purgeOperationalWorkForContext({ jobId: id });
    await deleteJobArtifacts(id);
    const [{ purgeSkillProposalsForJob }, { purgeLearnedSkillProvenance }] = await Promise.all([import('./skillEvolution.mjs'), import('./skillRegistry.mjs')]);
    purgeSkillProposalsForJob(id);
    await purgeLearnedSkillProvenance(id);
    return { jobId: id, deleted };
};
export const cancelJobsForConversation = conversationId => {
    let cancelled = 0;
    for (const job of [...jobs.values()]) {
        if (job.conversationId !== conversationId || TERMINAL.has(job.status)) continue;
        cancelProcessRun(job.jobId);
        cancelled += 1;
    }
    return cancelled;
};
export const deleteJobsForConversation = async conversationId => { let deleted = 0; for (const job of [...jobs.values()]) if (job.conversationId === conversationId) { await deleteJob(job.jobId); deleted += 1; } return deleted; };
export const deleteJobsForMessages = async (conversationId, messageIds = []) => {
    const targets = new Set(messageIds); let deleted = 0;
    for (const job of [...jobs.values()]) if (job.conversationId === conversationId && targets.has(job.originatingMessageId)) { await deleteJob(job.jobId); deleted += 1; }
    return deleted;
};
export const jobDeletionImpactForMessages = (conversationId, messageIds = []) => {
    const targets = new Set(messageIds.map(String));
    const matched = [...jobs.values()].filter(job => job.conversationId === conversationId && targets.has(String(job.originatingMessageId || '')));
    const jobIds = new Set(matched.map(job => job.jobId));
    return {
        jobs: matched.length,
        tasks: matched.reduce((sum, job) => sum + (job.tasks?.length || 0), 0),
        attempts: matched.reduce((sum, job) => sum + (job.tasks || []).reduce((taskSum, task) => taskSum + (task.attempts?.length || 0), 0), 0),
        artifacts: matched.reduce((sum, job) => sum + (job.tasks || []).reduce((taskSum, task) => taskSum + (task.artifacts?.length || 0), 0), 0),
        assessments: [...assessments.values()].filter(item => jobIds.has(item.jobId)).length,
        events: [...events.values()].filter(item => jobIds.has(item.jobId)).length,
        activeJobs: matched.filter(job => !TERMINAL.has(job.status)).length,
        jobIds: matched.map(job => job.jobId),
    };
};
export const listProcessRuns = ({ definitionId = '', status = '', conversationId = '', limit = 200 } = {}) => [...jobs.values()].filter(job => (!definitionId || job.processDefinitionId === definitionId) && (!status || job.status === status) && (!conversationId || job.conversationId === conversationId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, Math.max(1, Math.min(Number(limit) || 200, 500))).map(clone);
export const getProcessRun = runId => { const job = jobs.get(String(runId || '')); return job ? clone(job) : null; };
export const listJobEvents = ({ jobId = '', conversationId = '', limit = 500 } = {}) => [...events.values()].filter(event => (!jobId || event.jobId === jobId) && (!conversationId || event.conversationId === conversationId)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-Math.max(1, Math.min(Number(limit) || 500, 2_000))).map(clone);
export const cleanupProcessRetention = ({ verboseBefore = Date.now() - OFFICE_PLATFORM_CONFIG.retention.verboseToolEventDays * 86_400_000 } = {}) => {
    const cutoff = Number(verboseBefore);
    let eventsRemoved = 0; let toolResultsRedacted = 0; let jobsUpdated = 0;
    for (const [eventId, event] of events.entries()) {
        if (new Date(event.createdAt).getTime() >= cutoff) continue;
        events.delete(eventId); eventsRemoved += 1;
    }
    for (const job of jobs.values()) {
        let changed = false;
        for (const task of job.tasks || []) for (const attempt of task.attempts || []) {
            const completedAt = new Date(attempt.completedAt || attempt.startedAt || job.createdAt).getTime();
            if (!Number.isFinite(completedAt) || completedAt >= cutoff) continue;
            for (const activity of attempt.toolActivity || []) {
                if (!activity.result) continue;
                activity.result = '';
                activity.redactedAt = now();
                toolResultsRedacted += 1; changed = true;
            }
        }
        if (changed) { saveJob(job); jobsUpdated += 1; }
    }
    return { cutoff: new Date(cutoff).toISOString(), eventsRemoved, toolResultsRedacted, jobsUpdated };
};
export const resumeProcessRuns = () => { let resumed = 0; for (const job of jobs.values()) { if (!['queued', 'running'].includes(job.status)) continue; job.tasks.filter(task => task.state === 'running').forEach(task => { const last = task.attempts.at(-1); const unsafe = (last?.toolActivity || []).some(tool => tool.state === 'running' && tool.idempotent === false); if (unsafe) { task.state = 'paused'; task.error = 'Server restarted during a non-idempotent tool call. Reconcile the external state before retrying.'; } else { task.state = 'pending'; task.error = 'Interrupted by server restart; safe to retry.'; if (last?.state === 'running') { last.state = 'interrupted'; last.completedAt = now(); } } }); job.status = job.tasks.some(task => task.state === 'paused') ? 'paused' : 'queued'; job.waitingOn = job.status === 'paused' ? 'carlos' : ''; job.updatedAt = now(); saveJob(job); resumed += 1; } pumpJobs(); return resumed; };
export const operationsSnapshot = () => {
    const all = [...jobs.values()]; const terminal = all.filter(job => TERMINAL.has(job.status)); const completed = all.filter(job => job.status === 'completed');
    const historical = { ...emptyAnonymousAggregate(), ...(anonymousAggregates.get('global') || {}) };
    const failedAttempts = all.flatMap(job => job.tasks).flatMap(task => task.attempts).filter(attempt => ['failed', 'quality_failed'].includes(attempt.state)).length;
    const quality = completed.map(job => job.finalAssessment?.score).filter(Number.isFinite); const durations = completed.map(job => new Date(job.completedAt) - new Date(job.startedAt)).filter(Number.isFinite);
    const attempts = all.flatMap(job => job.tasks.map(task => ({ job, task }))).flatMap(({ job, task }) => task.attempts.map(attempt => ({ job, task, attempt })));
    const toolCalls = attempts.flatMap(record => (record.attempt.toolActivity || []).map(tool => ({ ...record, tool })));
    const grouped = (values, keyFor) => [...values.reduce((map, value) => { const key = keyFor(value) || 'unknown'; const row = map.get(key) || { id: key, attempts: 0, failures: 0 }; row.attempts += 1; if (value.attempt?.state === 'failed' || value.tool?.state === 'failed') row.failures += 1; map.set(key, row); return map; }, new Map()).values()].map(row => ({ ...row, failureRate: row.attempts ? Math.round(row.failures / row.attempts * 1000) / 10 : 0 }));
    const queueTimes = all.map(job => new Date(job.startedAt) - new Date(job.createdAt)).filter(value => Number.isFinite(value) && value >= 0);
    const retriedTasks = all.flatMap(job => job.tasks).filter(task => task.attempts.length > 1);
    const recoveredTasks = retriedTasks.filter(task => task.state === 'completed');
    const terminalCount = terminal.length + historical.terminalJobs;
    const failedCount = terminal.filter(job => job.status === 'failed').length + historical.failedJobs;
    const qualityTotal = quality.reduce((a, b) => a + b, 0) + historical.qualityTotal;
    const qualityCount = quality.length + historical.qualityCount;
    const executionTotal = durations.reduce((a, b) => a + b, 0) + historical.executionMsTotal;
    const executionCount = durations.length + historical.executionCount;
    const recoveryAttempted = retriedTasks.length + historical.retriedTasks;
    const recoverySucceeded = recoveredTasks.length + historical.recoveredTasks;
    const taskCount = all.flatMap(job => job.tasks).length + historical.tasks;
    return {
        totals: { jobs: all.length + historical.purgedJobs, visibleJobs: all.length, purgedHistorical: historical.purgedJobs, active: all.filter(job => ['queued', 'running'].includes(job.status)).length, paused: all.filter(job => ['paused', 'waiting_authorization'].includes(job.status)).length, terminal: terminalCount },
        failureRate: terminalCount ? Math.round(failedCount / terminalCount * 1000) / 10 : 0,
        failedAttempts: failedAttempts + historical.failedAttempts, terminalFailures: failedCount, averageExecutionMs: executionCount ? Math.round(executionTotal / executionCount) : 0,
        averageQuality: qualityCount ? Math.round(qualityTotal / qualityCount) : 0, authorizationBlocks: all.filter(job => job.status === 'waiting_authorization').length,
        averageQueueMs: queueTimes.length ? Math.round(queueTimes.reduce((a, b) => a + b, 0) / queueTimes.length) : 0,
        recovery: { attempted: recoveryAttempted, succeeded: recoverySucceeded, successRate: recoveryAttempted ? Math.round(recoverySucceeded / recoveryAttempted * 1000) / 10 : 0 },
        reworkRate: taskCount ? Math.round(recoveryAttempted / taskCount * 1000) / 10 : 0,
        carlosOverrideRate: completed.length ? Math.round(completed.filter(job => ['revise', 'reopen'].includes(job.carlosAssessment?.decision)).length / completed.length * 1000) / 10 : 0,
        byProcess: grouped(attempts, record => record.job.processDefinitionId),
        byJob: grouped(attempts, record => record.job.jobId).map(row => { const job = jobs.get(row.id); return { ...row, status: job?.status || 'unknown', quality: job?.finalAssessment?.score ?? null }; }),
        byTask: grouped(attempts, record => `${record.job.processDefinitionId}:${record.task.nodeId}`),
        byTool: grouped(toolCalls, record => record.tool.toolName),
        byProvider: grouped(attempts.filter(record => record.attempt.model), record => record.attempt.model.provider || 'unknown'),
        byModel: grouped(attempts.filter(record => record.attempt.model), record => `${record.attempt.model.provider || 'provider'}:${record.attempt.model.model || 'model'}`),
        qualityTrend: completed.slice(-20).map(job => ({ jobId: job.jobId, name: job.name, score: job.finalAssessment?.score || 0, completedAt: job.completedAt })),
        qualityByDimension: QUALITY_DIMENSIONS.map(dimension => {
            const values = completed.map(job => job.finalAssessment?.dimensions?.[dimension]).filter(Number.isFinite);
            return { dimension, average: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0, samples: values.length };
        }),
        incidents: all.filter(job => ['failed', 'paused', 'waiting_authorization'].includes(job.status)).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 40).map(job => {
            const task = job.tasks.find(item => ['failed', 'paused', 'waiting_human'].includes(item.state));
            return { jobId: job.jobId, processDefinitionId: job.processDefinitionId, status: job.status, taskId: task?.taskId || '', task: task?.name || '', agentId: task?.agentId || '', error: task?.error || job.error || job.waitingOn || 'Attention required', updatedAt: job.updatedAt, recoverable: job.status !== 'failed' };
        }),
        byAgent: listAgentDefinitions().map(agent => {
            const tasks = all.flatMap(job => job.tasks).filter(task => task.agentId === agent.agentId);
            const agentAttempts = attempts.filter(record => record.task.agentId === agent.agentId);
            const failures = agentAttempts.filter(record => ['failed', 'quality_failed'].includes(record.attempt.state)).length;
            return { id: agent.agentId, agentId: agent.agentId, tasks: tasks.length, attempts: agentAttempts.length, failures, failureRate: agentAttempts.length ? Math.round(failures / agentAttempts.length * 1000) / 10 : 0, active: Number(activeAgents.get(agent.agentId) || 0), maxInstances: Number(agentLimits.get(agent.agentId) || agent.maxInstances || 1) };
        }),
        providers: listProviderIntegrations().map(provider => ({ providerId: provider.id, label: provider.label, enabled: provider.enabled, health: provider.configured ? (provider.local ? 'local' : 'configured') : 'unconfigured' })),
        anonymousHistory: historical,
        generatedAt: now(),
    };
};
export const processEngineStatus = () => ({ definitions: definitions.size, versions: versions.size, jobs: jobs.size, active: activeJobs.size, waitingAuthorization: [...jobs.values()].filter(job => job.status === 'waiting_authorization').length, maxParallelTasks: OFFICE_PLATFORM_CONFIG.processes.maxParallelNodes });

const seed = () => builtIns.forEach(item => {
    const current = definitions.get(item.definitionId);
    if (!current || Number(current.builtInRevision || 0) < Number(item.builtInRevision || 0)) {
        const draft = saveProcessDefinition({ ...item, kind: 'reusable', owner: 'office' });
        publishProcessDefinition(draft.definitionId);
    }
});
seed();
