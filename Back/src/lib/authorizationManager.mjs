import { randomUUID } from 'node:crypto';
import { createPersistentList, createPersistentMap } from './operationalStore.mjs';
import { OFFICE_PLATFORM_CONFIG } from '../platform.config.mjs';
import { getAgentDefinition } from './agentRegistry.mjs';

const policies = createPersistentMap('authorization-policies-v1');
const requests = createPersistentMap('authorization-requests-v1');
const audit = createPersistentList('authorization-audit-v1');
const decisions = new Set(['allow', 'ask', 'deny']);
const scopeDefinitions = new Map(OFFICE_PLATFORM_CONFIG.authorization.scopes.map(item => [item.id, item]));
const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const policyKey = (agentId, scope) => `${String(agentId || '*').toLowerCase()}:${scope}`;
const auditContext = context => ({
    ...(context?.jobId ? { jobId: context.jobId } : {}),
    ...(context?.conversationId ? { conversationId: context.conversationId } : {}),
    ...(context?.requestId ? { officeRequestId: context.requestId } : {}),
});

const appendAudit = event => {
    audit.push({ auditId: randomUUID(), createdAt: now(), ...event });
    while (audit.length > 2_000) audit.shift();
};

const updateGrantState = record => {
    if (!record) return record;
    const pendingExpired = record.status === 'pending' && new Date(record.expiresAt).getTime() < Date.now();
    const timedGrantExpired = record.status === 'approved' && record.grant === 'until'
        && record.validUntil && new Date(record.validUntil).getTime() < Date.now();
    if (!pendingExpired && !timedGrantExpired) return record;
    record.status = 'expired';
    record.decidedAt ||= now();
    record.decidedBy ||= 'system';
    requests.set(record.requestId, clone(record));
    appendAudit({ type: 'authorization.expired', actor: 'system', requestId: record.requestId, scope: record.scope });
    return record;
};

const explicitAuthority = (scope, authority = {}) => ({
    'local-write': authority.localProjectMutation,
    'local-delete': authority.projectDelete,
    'dependency-install': authority.dependencyInstall,
    'git-publish': authority.gitPublish,
    'external-write': authority.externalWrite,
    'external-message': authority.externalMessage,
    'skill-admin': authority.skillAdmin,
    'schedule-admin': authority.scheduleAdmin,
    credentials: authority.credentials,
}[scope] === true);

export const listAuthorizationPolicies = () => OFFICE_PLATFORM_CONFIG.authorization.scopes.flatMap(scope => {
    const configured = [...policies.values()].filter(item => item.scope === scope.id);
    return configured.length ? configured.map(clone) : [{
        policyId: policyKey('*', scope.id), agentId: '*', scope: scope.id, decision: scope.defaultPolicy,
        inherited: true, updatedAt: '',
    }];
});

export const authorizationPolicyFor = (agentId, scope) => {
    if (!scopeDefinitions.has(scope)) throw Object.assign(new Error(`Unknown authorization scope: ${scope}`), { statusCode: 400 });
    return policies.get(policyKey(agentId, scope))
        || policies.get(policyKey('*', scope))
        || { agentId: '*', scope, decision: scopeDefinitions.get(scope).defaultPolicy, inherited: true };
};

export const saveAuthorizationPolicy = ({ agentId = '*', scope, decision }) => {
    const normalizedAgent = String(agentId || '*').toLowerCase();
    if (normalizedAgent !== '*' && !getAgentDefinition(normalizedAgent)) throw Object.assign(new Error('Unknown policy agent.'), { statusCode: 400 });
    if (!scopeDefinitions.has(scope)) throw Object.assign(new Error('Unknown authorization scope.'), { statusCode: 400 });
    if (!decisions.has(decision)) throw Object.assign(new Error('Policy decision must be allow, ask, or deny.'), { statusCode: 400 });
    const record = { policyId: policyKey(normalizedAgent, scope), agentId: normalizedAgent, scope, decision, inherited: false, updatedAt: now() };
    policies.set(record.policyId, record);
    appendAudit({ type: 'policy.updated', actor: 'carlos', agentId: normalizedAgent, scope, decision });
    return clone(record);
};

export const requestAuthorization = ({ agentId = 'nora', scope, action = '', details = {}, context = {} }) => {
    const existing = [...requests.values()].map(updateGrantState).find(item => ['pending', 'approved'].includes(item.status)
        && !(item.grant === 'once' && Number(item.usesRemaining || 0) <= 0)
        && item.agentId === agentId && item.scope === scope && item.context?.dedupeKey && item.context.dedupeKey === context.dedupeKey);
    if (existing) return clone(existing);
    const requestedAt = now();
    const record = {
        requestId: randomUUID(), agentId, scope, action: String(action || scope).slice(0, 240),
        details: clone(details || {}), context: clone(context || {}), status: 'pending', requestedAt,
        expiresAt: new Date(Date.now() + OFFICE_PLATFORM_CONFIG.timeouts.authorizationMs).toISOString(),
        decidedAt: '', decidedBy: '', note: '',
    };
    requests.set(record.requestId, record);
    appendAudit({ type: 'authorization.requested', actor: agentId, requestId: record.requestId, scope, action: record.action, ...auditContext(context) });
    return clone(record);
};

export const evaluateAuthorization = ({ agentId = 'nora', scope, action = '', authority = {}, details = {}, context = {}, createRequest = true }) => {
    if (!scopeDefinitions.has(scope)) return { decision: 'deny', reason: 'unknown-scope' };
    if (explicitAuthority(scope, authority)) {
        appendAudit({ type: 'authorization.allowed', actor: agentId, scope, action, source: 'current-request', ...auditContext(context) });
        return { decision: 'allow', source: 'current-request' };
    }
    const approved = [...requests.values()].map(updateGrantState).find(item => {
        if (item.status !== 'approved' || item.agentId !== agentId || item.scope !== scope) return false;
        if (item.validUntil && new Date(item.validUntil).getTime() < Date.now()) return false;
        if (item.grant === 'once') return Number(item.usesRemaining || 0) > 0 && item.context?.dedupeKey && item.context.dedupeKey === context.dedupeKey;
        if (item.grant === 'until') return Boolean(item.validUntil);
        if (item.grant === 'job') return item.context?.jobId && item.context.jobId === context.jobId;
        if (item.grant === 'process') return item.context?.definitionId && item.context.definitionId === context.definitionId
            && (!item.context?.processVersion || item.context.processVersion === context.processVersion);
        if (item.grant === 'standing') return true;
        return item.context?.dedupeKey && item.context.dedupeKey === context.dedupeKey;
    });
    if (approved) {
        if (approved.grant === 'once') {
            approved.usesRemaining = Math.max(0, Number(approved.usesRemaining || 1) - 1);
            if (!approved.usesRemaining) approved.status = 'consumed';
            requests.set(approved.requestId, clone(approved));
            appendAudit({ type: 'authorization.consumed', actor: agentId, requestId: approved.requestId, scope, action, ...auditContext(context) });
        }
        return { decision: 'allow', source: 'human-approval', request: clone(approved) };
    }
    const policy = authorizationPolicyFor(agentId, scope);
    if (policy.decision !== 'ask') {
        appendAudit({ type: `authorization.${policy.decision === 'allow' ? 'allowed' : 'denied'}`, actor: agentId, scope, action, source: 'policy', ...auditContext(context) });
        return { decision: policy.decision, source: 'policy', policy };
    }
    const request = createRequest ? requestAuthorization({ agentId, scope, action, details, context }) : null;
    if (request?.status === 'approved') return { decision: 'allow', source: 'human-approval', request };
    return { decision: 'ask', source: 'policy', policy, request };
};

export const assertAuthorization = input => {
    const result = evaluateAuthorization(input);
    if (result.decision === 'allow') return result;
    if (result.decision === 'deny') throw Object.assign(new Error(`Authorization policy denied ${input.scope}: ${input.action || input.scope}.`), { statusCode: 403, code: 'AUTHORIZATION_DENIED' });
    throw Object.assign(new Error(`Human authorization is required for ${input.scope}: ${input.action || input.scope}.`), { statusCode: 428, code: 'AUTHORIZATION_REQUIRED', authorizationRequest: result.request });
};

export const listAuthorizationRequests = ({ status = '', limit = 200 } = {}) => [...requests.values()]
    .map(updateGrantState)
    .filter(item => !status || item.status === status)
    .sort((left, right) => new Date(right.requestedAt) - new Date(left.requestedAt))
    .slice(0, Math.max(1, Math.min(Number(limit) || 200, 500)))
    .map(clone);

export const resolveAuthorizationRequest = ({ requestId, decision, note = '', persistPolicy = false, grant = 'once', validUntil = '' }) => {
    const record = requests.get(requestId);
    if (!record) throw Object.assign(new Error('Authorization request not found.'), { statusCode: 404 });
    if (record.status !== 'pending') throw Object.assign(new Error('Authorization request is no longer pending.'), { statusCode: 409 });
    if (!['approved', 'rejected'].includes(decision)) throw Object.assign(new Error('Decision must be approved or rejected.'), { statusCode: 400 });
    record.status = decision;
    record.decidedAt = now();
    record.decidedBy = 'carlos';
    record.note = String(note || '').slice(0, 2_000);
    record.grant = persistPolicy ? 'standing' : ['once', 'job', 'process', 'until'].includes(grant) ? grant : 'once';
    record.validUntil = record.grant === 'until' && validUntil ? new Date(validUntil).toISOString() : '';
    record.usesRemaining = decision === 'approved' && record.grant === 'once' ? 1 : null;
    requests.set(requestId, clone(record));
    if (persistPolicy) saveAuthorizationPolicy({ agentId: record.agentId, scope: record.scope, decision: decision === 'approved' ? 'allow' : 'deny' });
    appendAudit({ type: `authorization.${decision}`, actor: 'carlos', requestId, scope: record.scope, note: record.note });
    return clone(record);
};

export const consumeAuthorizationRequest = requestId => {
    const record = requests.get(String(requestId || ''));
    if (!record || record.status !== 'approved' || record.grant !== 'once') return record ? clone(record) : null;
    record.usesRemaining = Math.max(0, Number(record.usesRemaining || 1) - 1);
    if (!record.usesRemaining) record.status = 'consumed';
    requests.set(record.requestId, clone(record));
    appendAudit({ type: 'authorization.consumed', actor: record.agentId, requestId: record.requestId, scope: record.scope, ...auditContext(record.context) });
    return clone(record);
};

export const authorizationRequestApproved = requestId => requests.get(String(requestId || ''))?.status === 'approved';
export const getAuthorizationRequest = requestId => {
    const record = updateGrantState(requests.get(String(requestId || '')));
    return record ? clone(record) : null;
};
export const listAuthorizationAudit = ({ limit = 300 } = {}) => [...audit].slice(-Math.max(1, Math.min(Number(limit) || 300, 1_000))).reverse().map(clone);

export const purgeAuthorizationContext = ({ jobId = '', conversationId = '', requestId = '' } = {}) => {
    const removedRequestIds = new Set();
    for (const [id, record] of requests.entries()) {
        const context = record.context || {};
        if ((jobId && context.jobId === jobId)
            || (conversationId && context.conversationId === conversationId)
            || (requestId && context.requestId === requestId)) {
            requests.delete(id);
            removedRequestIds.add(id);
        }
    }
    for (let index = audit.length - 1; index >= 0; index -= 1) {
        const event = audit[index];
        if (removedRequestIds.has(event?.requestId)
            || (jobId && event?.jobId === jobId)
            || (conversationId && event?.conversationId === conversationId)
            || (requestId && event?.officeRequestId === requestId)) audit.splice(index, 1);
    }
    return { requests: removedRequestIds.size };
};

export const authorizationStatus = () => ({
    pending: [...requests.values()].map(updateGrantState).filter(item => item.status === 'pending').length,
    policies: policies.size,
    scopes: OFFICE_PLATFORM_CONFIG.authorization.scopes,
});
