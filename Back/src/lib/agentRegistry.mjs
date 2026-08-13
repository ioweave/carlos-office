import { randomUUID } from 'node:crypto';
import { agentDefinitions } from '../agents/agents.config.mjs';
import { createPersistentMap } from './operationalStore.mjs';

const records = createPersistentMap('agent-definitions-v1');
const builtInIds = new Set(Object.keys(agentDefinitions));
const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const slug = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };

const normalize = (input, previous = null) => {
    const parentAgentId = String(input.parentAgentId || previous?.parentAgentId || '').toLowerCase();
    if (parentAgentId && !records.has(parentAgentId) && !builtInIds.has(parentAgentId)) fail('Parent agent definition was not found.', 404);
    const permanent = input.permanent ?? previous?.permanent ?? !parentAgentId;
    const agentId = slug(input.agentId || previous?.agentId || input.name) || `agent-${randomUUID().slice(0, 8)}`;
    if (!previous && (records.has(agentId) || (builtInIds.has(agentId) && input.creationSource !== 'built-in'))) fail('Agent identifier already exists.', 409);
    const inherited = parentAgentId ? getAgentDefinition(parentAgentId) : null;
    const inheritedSystem = inherited?.system || '';
    const system = String(input.system || previous?.system || inheritedSystem || '').trim().slice(0, 40_000);
    if (!system) fail('System instructions are required.');
    // ToolRegistry applies the actual intersection with the parent definition's
    // effective tools. Keeping the requested subset here makes least-privilege
    // narrowing possible even when a built-in parent uses its implicit defaults.
    const toolGrants = [...new Set((input.toolGrants ?? previous?.toolGrants ?? []).map(String).filter(Boolean))];
    return {
        agentId,
        name: String(input.name || previous?.name || agentId).trim().slice(0, 80),
        role: String(input.role || previous?.role || 'Specialist').trim().slice(0, 120),
        description: String(input.description || previous?.description || '').trim().slice(0, 1_200),
        avatar: String(input.avatar || previous?.avatar || '').trim().slice(0, 500),
        color: String(input.color || previous?.color || inherited?.color || '#64748b').trim().slice(0, 32),
        system,
        maxInstances: Math.max(1, Math.min(Number(input.maxInstances ?? previous?.maxInstances ?? inherited?.maxInstances ?? 1), 20)),
        capabilities: [...new Set((input.capabilities || previous?.capabilities || inherited?.capabilities || []).map(String).filter(Boolean))],
        toolGrants,
        parentAgentId,
        permanent: Boolean(permanent),
        status: permanent ? 'approved' : 'temporary',
        enabled: input.enabled ?? previous?.enabled ?? true,
        creationSource: String(input.creationSource || previous?.creationSource || (builtInIds.has(agentId) ? 'built-in' : 'nora')).slice(0, 80),
        createdAt: previous?.createdAt || now(),
        updatedAt: now(),
    };
};

const seed = () => {
    for (const [agentId, definition] of Object.entries(agentDefinitions)) {
        if (!records.has(agentId)) records.set(agentId, normalize({
            agentId,
            name: definition.name,
            role: definition.role,
            description: definition.role,
            system: definition.system,
            color: { nora: '#06b6d4', marco: '#f59e0b', luma: '#d946ef', dex: '#3b82f6', iris: '#8b5cf6', vera: '#10b981' }[agentId],
            permanent: true,
            creationSource: 'built-in',
        }));
    }
};

export const hydrateAgentDefinitions = () => {
    for (const record of records.values()) agentDefinitions[record.agentId] = {
        name: record.name,
        role: record.role,
        system: record.system,
        parentAgentId: record.parentAgentId,
        permanent: record.permanent,
    };
};

export const listAgentDefinitions = () => [...records.values()].sort((a, b) => a.name.localeCompare(b.name)).map(clone);
export const getAgentDefinition = agentId => {
    const record = records.get(String(agentId || '').toLowerCase());
    return record ? clone(record) : null;
};
export const effectiveAgentId = agentId => getAgentDefinition(agentId)?.parentAgentId || String(agentId || '');
export const createAgentDefinition = input => {
    const record = normalize(input || {});
    records.set(record.agentId, record);
    hydrateAgentDefinitions();
    return clone(record);
};
export const updateAgentDefinition = (agentId, input = {}) => {
    const previous = records.get(String(agentId || '').toLowerCase());
    if (!previous) fail('Agent definition not found.', 404);
    const record = normalize({ ...input, agentId: previous.agentId }, previous);
    records.set(record.agentId, record);
    hydrateAgentDefinitions();
    return clone(record);
};
// Promotion changes staffing status, not authority. The permission parent remains
// until Carlos explicitly changes the definition's privilege boundary.
export const promoteAgentDefinition = agentId => updateAgentDefinition(agentId, { permanent: true });
export const deleteAgentDefinition = agentId => {
    const id = String(agentId || '').toLowerCase();
    if (builtInIds.has(id)) fail('Built-in staff cannot be deleted.', 409);
    delete agentDefinitions[id];
    return { agentId: id, deleted: records.delete(id) };
};
export const agentRegistryStatus = () => ({ total: records.size, permanent: [...records.values()].filter(item => item.permanent).length, temporary: [...records.values()].filter(item => !item.permanent).length });

seed();
hydrateAgentDefinitions();
