import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { defaultAgentConfig } from '../agents/agents.config.mjs';
import { runAgent } from '../lib/agentRunner.mjs';
import { executeTool, listTools, refreshMcpToolRegistry } from '../lib/toolRegistry.mjs';
import { ensureArtifactLinks, extractArtifacts, mergeArtifacts, readArtifact } from '../lib/artifacts.mjs';
import {
    getMemoryStatus,
    listMemory as listMemoryNotes,
    readMemory as readMemoryNote,
    searchMemory as searchMemoryNotes,
    writeMemory as writeMemoryNote,
} from '../lib/memory.mjs';
import { listAgentConfigs, saveAgentConfig } from '../lib/officeStore.mjs';
import {
    conversationLifecycleStatus,
    deleteConversationRecord,
    deleteConversationRecordAttachments,
    getConversationRecord,
    hydrateConversationRecordMessages,
    invalidateConversationRecordContext,
    listConversationRecords,
    listConversationRecordsByLifecycle,
    readConversationRecordAttachment,
    saveConversationRecord,
    saveConversationRecordAttachments,
    updateConversationRecord,
    archiveConversationRecord,
    trashConversationRecord,
    restoreConversationRecord,
} from '../lib/conversationLifecycle.mjs';
import { retentionManagerStatus } from '../lib/retentionManager.mjs';
import { factMemoryStatus, listFacts } from '../lib/factMemory.mjs';
import { knowledgeLifecycleStatus, listKnowledgeSources } from '../lib/knowledgeLifecycle.mjs';
import { runWithExecutionContext } from '../lib/executionContext.mjs';
import { createRequestAuthority } from '../lib/requestAuthority.mjs';
import { createOfficeRequest, deleteOfficeRequestsForConversation, deleteOfficeRequestsForMessages, planNoraRequest, updateOfficeRequest } from '../lib/noraIntake.mjs';
import { operationalStoreStatus, purgeOperationalWorkForContext } from '../lib/operationalStore.mjs';
import { semanticMemoryStatus } from '../lib/semanticMemory.mjs';
import { runtimeEventStreamStatus } from '../lib/runtimeEventStream.mjs';
import { conversationSearchStatus, searchConversationHistory } from '../lib/conversationSearch.mjs';
import { createSchedule, deleteSchedule as removeSchedule, listSchedules, scheduleManagerStatus, updateSchedule } from '../lib/scheduleManager.mjs';
import { channelGatewayStatus, purgeChannelConversation, resumeAuthorizedOutbound, startChannelGateway } from '../lib/channelGateway.mjs';
import { listSkillProposals, resolveSkillProposal as resolvePendingSkillProposal, skillEvolutionStatus } from '../lib/skillEvolution.mjs';
import { programmaticToolStatus } from '../lib/programmaticTools.mjs';
import { OFFICE_PLATFORM_CONFIG } from '../platform.config.mjs';
import { authorizationStatus, listAuthorizationAudit, listAuthorizationPolicies, listAuthorizationRequests, purgeAuthorizationContext, resolveAuthorizationRequest, saveAuthorizationPolicy } from '../lib/authorizationManager.mjs';
import { extensionStatus, installExtension, listExtensions, readExtension, removeExtension, updateExtension } from '../lib/extensionManager.mjs';
import { integrationStatus, listChannelIntegrations, listProviderIntegrations, updateIntegration } from '../lib/integrationRegistry.mjs';
import {
    assessJob,
    cancelJobsForConversation,
    cancelProcessRun,
    controlJob,
    deleteJob as deleteDurableJob,
    deleteJobsForConversation,
    deleteJobsForMessages,
    deleteProcessDefinition,
    getProcessDefinition,
    getProcessRun,
    listJobEvents,
    jobDeletionImpactForMessages,
    listProcessDefinitions,
    listProcessVersions,
    listProcessRuns,
    operationsSnapshot,
    processEngineStatus,
    provideJobInput,
    publishProcessDefinition,
    resumeProcessRun,
    resumeJobsForAuthorization,
    saveProcessDefinition,
    setAgentRuntimeLimit,
    startProcessRun,
    updateProcessLifecycle,
} from '../lib/processEngine.mjs';
import { createAgentDefinition, deleteAgentDefinition, getAgentDefinition, listAgentDefinitions, promoteAgentDefinition, updateAgentDefinition } from '../lib/agentRegistry.mjs';

const allowedConfigFields = ['provider', 'model', 'baseUrl', 'temperature', 'maxToolRounds', 'enabled', 'fallback', 'modelPolicy', 'maxInstances', 'capabilities', 'toolGrants', 'timeouts', 'qualityPolicy'];
const isCancellation = error => (
    error?.statusCode === 499
    || error?.code === 'EXECUTION_CANCELLED'
    || error?.code === 'ERR_CANCELED'
    || error?.name === 'AbortError'
    || /cancel(?:led|ed)/i.test(String(error?.message || ''))
);
export default class OfficeController {
    static async health() {
        let ollama = { online: false, models: 0 };
        try {
            const baseUrl = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
            const response = await axios.get(`${baseUrl}/api/tags`, { timeout: 3000 });
            ollama = { online: true, models: response.data?.models?.length || 0 };
        } catch {}
        let memory = { online: false, path: '', notes: 0 };
        try { memory = await getMemoryStatus(); } catch (error) { memory.error = error.message; }
        return {
            statusCode: 200,
            body: {
                status: 'online', localOnly: true, storage: 'governed markdown + sqlite operational state', ollama, memory,
                retention: {
                    conversations: conversationLifecycleStatus(), maintenance: retentionManagerStatus(), facts: await factMemoryStatus(), knowledge: await knowledgeLifecycleStatus(),
                },
                work: processEngineStatus(), operational: operationalStoreStatus(),
                semanticMemory: semanticMemoryStatus(), conversationSearch: conversationSearchStatus(), eventStream: runtimeEventStreamStatus(),
                schedules: scheduleManagerStatus(), channels: channelGatewayStatus(), skillEvolution: skillEvolutionStatus(),
                programmaticTools: programmaticToolStatus(), timestamp: new Date().toISOString(),
                authorizations: authorizationStatus(), processes: processEngineStatus(),
                extensions: await extensionStatus(), integrations: integrationStatus(),
            },
        };
    }

    static async listAgents() {
        const definitions = listAgentDefinitions();
        const agents = await listAgentConfigs(Object.fromEntries(definitions.map(item => [item.agentId, item])), defaultAgentConfig);
        agents.forEach(agent => setAgentRuntimeLimit(agent.agentId, agent.maxInstances || 1));
        return { statusCode: 200, body: agents.map(agent => ({ ...getAgentDefinition(agent.agentId), ...agent })) };
    }
    static async createAgent({ body }) {
        const definition = createAgentDefinition(body);
        const config = await saveAgentConfig(definition.agentId, Object.fromEntries(allowedConfigFields.filter(field => body[field] !== undefined).map(field => [field, body[field]])), defaultAgentConfig(definition.agentId));
        setAgentRuntimeLimit(definition.agentId, config.maxInstances || body.maxInstances || 1);
        return { statusCode: 201, body: { ...definition, ...config } };
    }
    static async updateAgent({ params, body }) {
        const agentId = params.agentId;
        if (!getAgentDefinition(agentId)) return { statusCode: 404, body: { error: 'Unknown agent' } };
        const definitionFields = ['name', 'role', 'description', 'avatar', 'color', 'system', 'maxInstances', 'capabilities', 'toolGrants', 'enabled', 'parentAgentId', 'permanent'];
        const definitionUpdate = Object.fromEntries(definitionFields.filter(field => body[field] !== undefined).map(field => [field, body[field]]));
        const definition = Object.keys(definitionUpdate).length ? updateAgentDefinition(agentId, definitionUpdate) : getAgentDefinition(agentId);
        const update = {};
        allowedConfigFields.forEach(field => { if (body[field] !== undefined) update[field] = body[field]; });
        const saved = await saveAgentConfig(agentId, update, defaultAgentConfig(agentId));
        setAgentRuntimeLimit(agentId, saved.maxInstances || 1);
        return { statusCode: 200, body: { ...definition, ...saved } };
    }
    static async promoteAgent({ params }) {
        const definition = promoteAgentDefinition(params.agentId);
        const [config] = await listAgentConfigs({ [definition.agentId]: definition }, defaultAgentConfig);
        setAgentRuntimeLimit(definition.agentId, config.maxInstances || definition.maxInstances || 1);
        return { statusCode: 200, body: { ...definition, ...config } };
    }
    static async deleteAgent({ params }) { return { statusCode: 200, body: deleteAgentDefinition(params.agentId) }; }
    static async listModels({ query }) {
        const provider = query.provider || 'ollama';
        if (provider !== 'ollama') return { statusCode: 200, body: [] };
        const baseUrl = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
        const response = await axios.get(`${baseUrl}/api/tags`, { timeout: 10000 });
        return { statusCode: 200, body: (response.data?.models || []).map(item => item.name) };
    }

    static async platformConfig() {
        return { statusCode: 200, body: { ...OFFICE_PLATFORM_CONFIG, integrations: integrationStatus() } };
    }

    static async listTools({ query }) { return { statusCode: 200, body: listTools(query.agentId) }; }
    static async refreshTools() { return { statusCode: 200, body: { ...(await refreshMcpToolRegistry()), catalog: listTools() } }; }
    static async invokeTool({ params, body }) {
        const agentId = body.agentId || 'nora';
        return { statusCode: 200, body: await executeTool(agentId, params.toolName, body.args || {}) };
    }
    static async readArtifact({ query }) {
        return { statusCode: 200, body: await readArtifact({ source: query.source, path: query.path, agentId: query.agentId || 'nora' }) };
    }

    static async listMemory({ query }) {
        const limit = Math.max(1, Math.min(Number(query.limit) || 100, 500));
        const notes = query.query
            ? await searchMemoryNotes({ query: query.query, agentId: query.agentId || 'nora', limit })
            : await listMemoryNotes({ folder: query.folder || '', limit });
        return { statusCode: 200, body: notes };
    }
    static async readMemory({ query }) {
        if (!query.path) return { statusCode: 400, body: { error: 'Memory path is required' } };
        return { statusCode: 200, body: await readMemoryNote({ path: query.path }) };
    }
    static async writeMemory({ body }) {
        return { statusCode: 200, body: await writeMemoryNote({ agentId: body.agentId || 'nora', title: body.title, content: body.content, scope: body.scope, tags: body.tags, source: body.source, path: body.path, mode: body.mode }) };
    }
    static async listFacts({ query }) {
        return { statusCode: 200, body: await listFacts({ scope: query.scope || '', projectId: query.projectId || '', agentId: query.agentId || '', status: query.status ?? 'active', limit: query.limit }) };
    }
    static async listKnowledgeSources({ query }) {
        return { statusCode: 200, body: await listKnowledgeSources({ lifecycle: query.lifecycle || '', projectId: query.projectId || '', status: query.status || '' }) };
    }

    static async listAuthorizations({ query }) { return { statusCode: 200, body: { requests: listAuthorizationRequests({ status: query.status || '', limit: query.limit }), policies: listAuthorizationPolicies(), audit: listAuthorizationAudit({ limit: query.auditLimit }) } }; }
    static async saveAuthorizationPolicy({ body }) { return { statusCode: 200, body: saveAuthorizationPolicy(body) }; }
    static async resolveAuthorization({ params, body }) {
        const record = resolveAuthorizationRequest({ requestId: params.requestId, decision: body.decision, note: body.note, persistPolicy: body.persistPolicy, grant: body.grant, validUntil: body.validUntil });
        const resumedJobs = resumeJobsForAuthorization(params.requestId);
        const resumedDelivery = record.status === 'approved' ? resumeAuthorizedOutbound(params.requestId) : { resumed: false };
        return { statusCode: 200, body: { ...record, resumedJobs, resumedDelivery } };
    }

    static async listProcesses() { return { statusCode: 200, body: listProcessDefinitions() }; }
    static async getProcess({ params }) {
        const process = getProcessDefinition(params.definitionId);
        return process ? { statusCode: 200, body: process } : { statusCode: 404, body: { error: 'Process not found' } };
    }
    static async listProcessVersions({ params }) { return { statusCode: 200, body: listProcessVersions(params.definitionId) }; }
    static async saveProcess({ body }) { return { statusCode: body.definitionId ? 200 : 201, body: saveProcessDefinition(body) }; }
    static async publishProcess({ params }) { return { statusCode: 201, body: publishProcessDefinition(params.definitionId) }; }
    static async deleteProcess({ params }) { return { statusCode: 200, body: deleteProcessDefinition(params.definitionId) }; }
    static async processLifecycle({ params, body }) { return { statusCode: 200, body: updateProcessLifecycle(params.definitionId, body.action) }; }
    static async listProcessRuns({ query }) { return { statusCode: 200, body: listProcessRuns({ definitionId: query.definitionId, status: query.status, limit: query.limit }) }; }
    static async getProcessRun({ params }) {
        const run = getProcessRun(params.runId);
        return run ? { statusCode: 200, body: run } : { statusCode: 404, body: { error: 'Process run not found' } };
    }
    static async startProcessRun({ body }) { return { statusCode: 202, body: startProcessRun(body) }; }
    static async resumeProcessRun({ params }) { return { statusCode: 202, body: resumeProcessRun(params.runId) }; }
    static async cancelProcessRun({ params }) { return { statusCode: 202, body: cancelProcessRun(params.runId) }; }
    static async provideJobInput({ params, body }) { return { statusCode: 200, body: provideJobInput(params.jobId, body) }; }
    static async assessJob({ params, body }) { return { statusCode: 200, body: assessJob(params.jobId, body) }; }
    static async controlJob({ params, body }) { return { statusCode: 202, body: controlJob(params.jobId, body) }; }
    static async listJobEvents({ query }) { return { statusCode: 200, body: listJobEvents({ jobId: query.jobId, conversationId: query.conversationId, limit: query.limit }) }; }
    static async operations() { return { statusCode: 200, body: operationsSnapshot() }; }

    static async listExtensions({ query }) {
        const catalog = new Set(listTools(query.agentId || undefined).map(item => item.name));
        const records = await listExtensions({ agentId: query.agentId || '' });
        return { statusCode: 200, body: records.map(item => ({ ...item, requiredTools: item.allowedTools || [], availableTools: (item.allowedTools || []).filter(name => catalog.has(name)), missingTools: (item.allowedTools || []).filter(name => !catalog.has(name)) })) };
    }
    static async getExtension({ params }) {
        const detail = await readExtension(params.name); const catalog = new Set(listTools().map(item => item.name));
        return { statusCode: 200, body: { ...detail, requiredTools: detail.allowedTools || [], availableTools: (detail.allowedTools || []).filter(name => catalog.has(name)), missingTools: (detail.allowedTools || []).filter(name => !catalog.has(name)) } };
    }
    static async installExtension({ body }) { return { statusCode: 201, body: await installExtension(body) }; }
    static async updateExtension({ params, body }) { return { statusCode: 200, body: updateExtension({ name: params.name, enabledAgents: body.enabledAgents }) }; }
    static async removeExtension({ params, body, query }) { return { statusCode: 200, body: await removeExtension({ name: params.name, confirm: body.confirm === true || query.confirm === 'true' }) }; }
    static async listSkillProposals({ query }) { return { statusCode: 200, body: listSkillProposals({ status: query.status || '' }) }; }
    static async resolveSkillProposal({ params, body }) { return { statusCode: 200, body: await resolvePendingSkillProposal(params.proposalId, body) }; }

    static async listIntegrations() { return { statusCode: 200, body: { providers: listProviderIntegrations(), channels: listChannelIntegrations() } }; }
    static async updateIntegration({ params, body }) {
        const integration = updateIntegration({ kind: params.kind, id: params.id, ...body });
        if (params.kind === 'channel') startChannelGateway();
        return { statusCode: 200, body: integration };
    }

    static async listConversations({ query }) { return { statusCode: 200, body: await listConversationRecordsByLifecycle({ limit: Math.min(Number(query.limit) || 100, 500), trash: query.lifecycle === 'trash' || query.trash === 'true', archived: query.lifecycle === 'archived' }) }; }
    static async searchConversations({ query }) { return { statusCode: 200, body: searchConversationHistory({ query: query.query, limit: query.limit, agentId: query.agentId || '' }) }; }
    static async getConversation({ params }) {
        const conversation = await getConversationRecord(params.conversationId);
        if (!conversation) return { statusCode: 404, body: { error: 'Conversation not found' } };
        return { statusCode: 200, body: conversation };
    }
    static async updateConversation({ params, body }) {
        const title = String(body.title || '').trim();
        if (!title) return { statusCode: 400, body: { error: 'Conversation title is required' } };
        return { statusCode: 200, body: await updateConversationRecord(params.conversationId, { title }) };
    }
    static async editConversationMessage({ params, body }) {
        const conversation = await getConversationRecord(params.conversationId);
        if (!conversation) return { statusCode: 404, body: { error: 'Conversation not found' } };
        const index = conversation.messages.findIndex(message => message.messageId === params.messageId);
        if (index < 0) return { statusCode: 404, body: { error: 'Message not found' } };
        const content = String(body.content || '').trim();
        if (!content) return { statusCode: 400, body: { error: 'Message content is required' } };
        const removedMessageIds = conversation.messages.slice(index).map(message => message.messageId).filter(Boolean);
        const removedAttachments = conversation.messages.slice(index + 1).flatMap(message => message.attachments || []);
        await deleteJobsForMessages(conversation.conversationId, removedMessageIds);
        await deleteConversationRecordAttachments(removedAttachments);
        deleteOfficeRequestsForMessages(conversation.conversationId, removedMessageIds);
        invalidateConversationRecordContext(conversation.conversationId);
        conversation.messages = conversation.messages.slice(0, index + 1);
        conversation.messages[index] = { ...conversation.messages[index], content, editedAt: new Date().toISOString() };
        return { statusCode: 200, body: await saveConversationRecord(conversation) };
    }
    static async conversationMessageEditImpact({ params }) {
        const conversation = await getConversationRecord(params.conversationId);
        if (!conversation) return { statusCode: 404, body: { error: 'Conversation not found' } };
        const index = conversation.messages.findIndex(message => message.messageId === params.messageId);
        if (index < 0) return { statusCode: 404, body: { error: 'Message not found' } };
        const removed = conversation.messages.slice(index + 1);
        const jobImpact = jobDeletionImpactForMessages(conversation.conversationId, conversation.messages.slice(index).map(message => message.messageId).filter(Boolean));
        return { statusCode: 200, body: { laterMessages: removed.length, attachments: removed.reduce((sum, message) => sum + (message.attachments?.length || 0), 0), ...jobImpact, externalActionWarning: jobImpact.jobs > 0 ? 'Completed external side effects cannot be undone by editing history.' : '' } };
    }
    static async deleteConversation({ params }) {
        const conversation = await getConversationRecord(params.conversationId);
        if (!conversation) return { statusCode: 404, body: { error: 'Conversation not found' } };
        const cancelledJobs = cancelJobsForConversation(params.conversationId);
        return { statusCode: 200, body: { ...(await trashConversationRecord(params.conversationId)), cancelledJobs } };
    }
    static async restoreConversation({ params }) { return { statusCode: 200, body: await restoreConversationRecord(params.conversationId) }; }
    static async archiveConversation({ params }) { return { statusCode: 200, body: await archiveConversationRecord(params.conversationId) }; }
    static async purgeConversation({ params }) {
        await deleteJobsForConversation(params.conversationId);
        deleteOfficeRequestsForConversation(params.conversationId);
        purgeOperationalWorkForContext({ conversationId: params.conversationId });
        purgeAuthorizationContext({ conversationId: params.conversationId });
        purgeChannelConversation(params.conversationId);
        return { statusCode: 200, body: await deleteConversationRecord(params.conversationId) };
    }
    static async getConversationAttachment({ params }) { return { statusCode: 200, body: await readConversationRecordAttachment(params.conversationId, params.attachmentId) }; }

    static async listSchedules() { return { statusCode: 200, body: listSchedules() }; }
    static async createSchedule({ body }) { return { statusCode: 201, body: createSchedule(body) }; }
    static async updateSchedule({ params, body }) { return { statusCode: 200, body: updateSchedule(params.scheduleId, body) }; }
    static async deleteSchedule({ params }) { return { statusCode: 200, body: removeSchedule(params.scheduleId) }; }

    static async chat({ body, signal }) {
        const suppliedMessage = String(body.message || '').trim();
        const attachmentInputs = Array.isArray(body.attachments) ? body.attachments.slice(0, 8) : [];
        const message = suppliedMessage || (attachmentInputs.length ? 'Review the attached files.' : '');
        const agentId = 'nora';
        if (!message) return { statusCode: 400, body: { error: 'Message or attachment is required' } };

        const conversationId = body.conversationId || randomUUID(); const requestId = String(body.requestId || randomUUID()); const messageId = randomUUID(); const createdAt = new Date().toISOString();
        let conversation = await getConversationRecord(conversationId) || {
            conversationId, agentId,
            title: (suppliedMessage || attachmentInputs[0]?.name || 'New conversation').slice(0, 72),
            messages: [], createdAt, updatedAt: createdAt, persisted: true, storage: 'obsidian',
        };
        const duplicateIndex = conversation.messages.findIndex(item => item.role === 'user' && item.requestId === requestId);
        if (duplicateIndex >= 0) {
            const userMessage = conversation.messages[duplicateIndex];
            const assistantMessage = conversation.messages.slice(duplicateIndex + 1).find(item => item.role === 'assistant' && (item.jobIds?.length || !item.activityMarker)) || null;
            const jobs = listProcessRuns({ conversationId, limit: 500 }).filter(job => job.requestId === requestId);
            return { statusCode: jobs.length ? 202 : 200, body: { conversationId, requestId, persisted: true, idempotentReplay: true, userMessage, message: assistantMessage, jobs, job: jobs[0] || null, conversation: { title: conversation.title, updatedAt: conversation.updatedAt, messageCount: conversation.messages.length, persisted: true } } };
        }
        const priorMessages = [...conversation.messages];
        const attachments = attachmentInputs.length ? await saveConversationRecordAttachments(conversationId, attachmentInputs) : [];
        const userMessage = { messageId, requestId, role: 'user', content: message, attachments, createdAt };
        conversation.messages.push(userMessage);
        conversation = await saveConversationRecord(conversation);
        createOfficeRequest({ requestId, conversationId, messageId, content: message, channel: body.channel || 'chat' });
        try {
            const plan = await planNoraRequest({ objective: message, conversation: priorMessages, signal });
            if (plan.mode === 'jobs') {
                const jobs = plan.jobs.map(item => startProcessRun({ definitionId: item.definitionId, objective: item.objective || message, inputs: { request: message, attachments, ...(item.inputs || {}) }, conversationId, requestId, messageId }));
                updateOfficeRequest(requestId, { status: 'dispatched', jobIds: jobs.map(job => job.jobId), intakeRationale: plan.rationale });
                const assistantMessage = {
                    messageId: randomUUID(), role: 'assistant', content: jobs.length === 1 ? `I started **${jobs[0].name}** for this request. The live job card below shows every task, agent, attempt, tool, result, and quality gate. I’ll pause here if your input or authorization is needed.` : `I started ${jobs.length} independent process jobs for this request. Each job has its own live activity card and quality-gated handover.`,
                    jobIds: jobs.map(job => job.jobId), artifacts: [], toolEvents: [], memoryRefs: [], model: plan.model || null, attachments: [], createdAt: new Date().toISOString(),
                };
                conversation.messages.push(assistantMessage); conversation = await saveConversationRecord(conversation);
                return { statusCode: 202, body: { conversationId, requestId, persisted: true, userMessage, job: jobs[0], jobs, conversation: { title: conversation.title, updatedAt: conversation.updatedAt, messageCount: conversation.messages.length, persisted: true }, message: assistantMessage } };
            }
            updateOfficeRequest(requestId, { status: 'direct', intakeRationale: plan.rationale });
            const hydratedHistory = await hydrateConversationRecordMessages(conversationId, conversation.messages); const authority = createRequestAuthority(message);
            const result = await runWithExecutionContext({ requestId, conversationId, objective: message, authority, agentId }, () => runAgent(agentId, hydratedHistory, {
                signal, conversationId, objective: message, authority, timeoutMs: Number(process.env.CHAT_AGENT_TIMEOUT_MS || 2_700_000),
            }));
            const artifacts = mergeArtifacts([], extractArtifacts(result.toolEvents || [], { agentId }));
            const assistantMessage = { messageId: randomUUID(), role: 'assistant', content: ensureArtifactLinks(result.content, artifacts), artifacts, toolEvents: result.toolEvents, memoryRefs: result.memoryRefs, model: result.model, attachments: [], createdAt: new Date().toISOString() };
            conversation.messages.push(assistantMessage); conversation = await saveConversationRecord(conversation);
            return { statusCode: 200, body: { conversationId, requestId, persisted: true, userMessage, conversation: { title: conversation.title, updatedAt: conversation.updatedAt, messageCount: conversation.messages.length, persisted: true }, message: assistantMessage, model: result.model } };
        } catch (error) {
            if (isCancellation(error)) return { statusCode: 499, body: { error: 'Response generation stopped.', cancelled: true, conversationId, persisted: true } };
            const assistantFailure = { messageId: randomUUID(), role: 'assistant', content: `I could not complete that request: ${error.message || 'Model execution failed.'}`, toolEvents: [], memoryRefs: [], model: null, attachments: [], error: true, createdAt: new Date().toISOString() };
            conversation.messages.push(assistantFailure); const failed = await saveConversationRecord(conversation);
            return { statusCode: error.statusCode || 500, body: { error: error.message || 'Model execution failed.', conversationId, persisted: true, conversation: { title: failed.title, updatedAt: failed.updatedAt, messageCount: failed.messages.length, persisted: true }, message: assistantFailure } };
        }
    }

    static async listJobs({ query }) { return { statusCode: 200, body: listProcessRuns({ conversationId: query.conversationId || '', status: query.status || '', limit: Math.min(Number(query.limit) || 100, 500) }) }; }
    static async getJob({ params }) {
        const job = getProcessRun(params.jobId);
        if (!job) return { statusCode: 404, body: { error: 'Job not found' } };
        return { statusCode: 200, body: job };
    }
    static async runJob({ params }) { return { statusCode: 202, body: resumeProcessRun(params.jobId) }; }
    static async stopJob({ params }) { return { statusCode: 202, body: cancelProcessRun(params.jobId) }; }
    static async deleteJob({ params }) { return { statusCode: 200, body: await deleteDurableJob(params.jobId) }; }

    static async officeMap() {
        const [agents, conversations] = await Promise.all([
            this.listAgents().then(response => response.body),
            listConversationRecords({ limit: 300 }),
        ]);
        const jobs = listProcessRuns({ limit: 300 });
        return {
            statusCode: 200,
            body: {
                agents, conversations, jobs,
                processes: listProcessDefinitions(),
                agentInstances: jobs.flatMap(job => job.agentInstances || []),
                events: listJobEvents({ limit: 500 }),
                runner: { active: jobs.filter(job => ['queued', 'running'].includes(job.status)) },
                generatedAt: new Date().toISOString(),
            },
        };
    }
}
