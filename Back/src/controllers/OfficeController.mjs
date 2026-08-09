import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { agentDefinitions, defaultAgentConfig } from '../agents/agents.config.mjs';
import { runAgent } from '../lib/agentRunner.mjs';
import { executeTool, listTools } from '../lib/toolRegistry.mjs';
import { readArtifact } from '../lib/artifacts.mjs';
import {
    getMemoryStatus,
    listMemory as listMemoryNotes,
    readMemory as readMemoryNote,
    searchMemory as searchMemoryNotes,
    writeMemory as writeMemoryNote,
} from '../lib/memory.mjs';
import { listAgentConfigs, saveAgentConfig } from '../lib/officeStore.mjs';
import {
    deleteConversationRecord,
    getConversationRecord,
    hydrateConversationRecordMessages,
    listSavedConversations,
    promoteConversation,
    readConversationRecordAttachment,
    saveConversationRecord,
    saveConversationRecordAttachments,
    updateConversationRecord,
} from '../lib/conversationLifecycle.mjs';
import { temporaryConversationStatus } from '../lib/temporaryConversations.mjs';
import { factMemoryStatus, listFacts } from '../lib/factMemory.mjs';
import { knowledgeLifecycleStatus, listKnowledgeSources } from '../lib/knowledgeLifecycle.mjs';
import { getJob as getLifecycleJob, listJobs as listLifecycleJobs } from '../lib/jobLifecycle.mjs';
import {
    cancelJob,
    clearJobs,
    deleteJob,
    enqueueJob,
    jobRunnerStatus,
    retryJob,
    stopAllJobs,
} from '../lib/jobRunner.mjs';
import { runWithExecutionContext } from '../lib/executionContext.mjs';
import {
    listRuntimeEvents,
    listRuntimeWorkflows,
    runtimeWorkflowStatus,
    waitForRuntimeWorkflow,
    workflowForRequest,
} from '../lib/runtimeWorkflows.mjs';

const allowedConfigFields = ['provider', 'model', 'baseUrl', 'temperature', 'maxToolRounds', 'enabled', 'fallback'];
const isCancellation = error => (
    error?.statusCode === 499
    || error?.code === 'EXECUTION_CANCELLED'
    || error?.code === 'ERR_CANCELED'
    || error?.name === 'AbortError'
    || /cancel(?:led|ed)/i.test(String(error?.message || ''))
);
const clip = (value, limit = 50_000) => {
    const text = String(value || '');
    return text.length <= limit ? text : `${text.slice(0, limit)}\n\n[truncated]`;
};
const workflowSynthesisPrompt = (objective, workflow) => `You are Nora returning to Carlos after the delegated workflow for his request.\n\nORIGINAL REQUEST\n${objective}\n\nWORKFLOW STATUS\n${workflow.status}\nStage: ${workflow.stage}\nWaiting on: ${workflow.waitingOn || 'nobody'}\n${workflow.attentionReason ? `Attention reason: ${workflow.attentionReason}` : ''}\n${workflow.attentionMessage ? `Attention message: ${workflow.attentionMessage}` : ''}\n\nDELEGATED JOB RESULTS\n${workflow.jobs?.map(job => `\n## ${job.title}\nWorker: ${job.assignedAgent}\nStatus: ${job.status}\nIteration: ${job.currentIteration}/${job.maxIterations}\nVera: ${job.qcVerdict || 'pending'} ${job.qcScore ? `(${job.qcScore}/100)` : ''}\n${job.attentionMessage ? `Attention: ${job.attentionMessage}\n` : ''}\nResult:\n${clip(job.result, 30_000)}`).join('\n') || 'No job results are available.'}\n\nReturn the final user-facing response only. If status is completed, synthesize the approved results into one coherent answer and do not merely say jobs were submitted. If status is needs_attention or failed, clearly explain what is blocked, who requested the revision, why, and what Carlos can do next. Do not expose hidden chain-of-thought. Preserve useful source URLs contained in worker results.`;

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
                status: 'online', localOnly: true, storage: 'obsidian + volatile runtime', ollama, memory,
                retention: {
                    conversations: temporaryConversationStatus(), facts: await factMemoryStatus(), knowledge: await knowledgeLifecycleStatus(),
                },
                jobs: jobRunnerStatus(), workflows: runtimeWorkflowStatus(), timestamp: new Date().toISOString(),
            },
        };
    }

    static async listAgents() { return { statusCode: 200, body: await listAgentConfigs(agentDefinitions, defaultAgentConfig) }; }
    static async updateAgent({ params, body }) {
        const agentId = params.agentId;
        if (!agentDefinitions[agentId]) return { statusCode: 404, body: { error: 'Unknown agent' } };
        const update = {};
        allowedConfigFields.forEach(field => { if (body[field] !== undefined) update[field] = body[field]; });
        return { statusCode: 200, body: await saveAgentConfig(agentId, update, defaultAgentConfig(agentId)) };
    }
    static async listModels({ query }) {
        const provider = query.provider || 'ollama';
        if (provider !== 'ollama') return { statusCode: 200, body: [] };
        const baseUrl = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
        const response = await axios.get(`${baseUrl}/api/tags`, { timeout: 10000 });
        return { statusCode: 200, body: (response.data?.models || []).map(item => item.name) };
    }

    static async listTools({ query }) { return { statusCode: 200, body: listTools(query.agentId) }; }
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

    static async listConversations({ query }) { return { statusCode: 200, body: await listSavedConversations({ limit: Math.min(Number(query.limit) || 100, 500) }) }; }
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
    static async saveConversation({ params }) { return { statusCode: 200, body: await promoteConversation(params.conversationId) }; }
    static async deleteConversation({ params }) { return { statusCode: 200, body: await deleteConversationRecord(params.conversationId) }; }
    static async getConversationAttachment({ params }) { return { statusCode: 200, body: await readConversationRecordAttachment(params.conversationId, params.attachmentId) }; }

    static async chat({ body, signal }) {
        const suppliedMessage = String(body.message || '').trim();
        const attachmentInputs = Array.isArray(body.attachments) ? body.attachments.slice(0, 8) : [];
        const message = suppliedMessage || (attachmentInputs.length ? 'Review the attached files.' : '');
        const agentId = body.agentId || 'nora';
        if (!message) return { statusCode: 400, body: { error: 'Message or attachment is required' } };
        if (!agentDefinitions[agentId]) return { statusCode: 404, body: { error: 'Unknown agent' } };

        const conversationId = body.conversationId || randomUUID();
        const requestId = randomUUID();
        const now = new Date().toISOString();
        let conversation = await getConversationRecord(conversationId) || {
            conversationId, agentId,
            title: (suppliedMessage || attachmentInputs[0]?.name || 'New conversation').slice(0, 72),
            messages: [], createdAt: now, updatedAt: now, persisted: false, storage: 'volatile',
        };
        const persisted = Boolean(conversation.persisted);
        if (conversation.agentId !== agentId && conversation.messages.length) return { statusCode: 409, body: { error: 'A conversation with messages cannot change agents. Start a new chat instead.' } };

        const attachments = attachmentInputs.length ? await saveConversationRecordAttachments(conversationId, attachmentInputs, { persisted }) : [];
        conversation.messages.push({ role: 'user', content: message, attachments, createdAt: now });
        conversation = await saveConversationRecord(conversation, { persisted });

        let result;
        let workflow = null;
        try {
            const modelHistory = await hydrateConversationRecordMessages(conversationId, conversation.messages, { persisted });
            result = await runWithExecutionContext({ requestId, conversationId, objective: message, agentId }, () => runAgent(agentId, modelHistory, { signal, conversationId }));

            const workflowId = agentId === 'nora' ? workflowForRequest(requestId) : '';
            if (workflowId) {
                workflow = await waitForRuntimeWorkflow(workflowId, { timeoutMs: Number(process.env.WORKFLOW_CHAT_WAIT_MS || 300_000) });
                if (!workflow.timedOut) {
                    const synthesis = await runAgent('nora', [{ role: 'user', content: workflowSynthesisPrompt(message, workflow), createdAt: new Date().toISOString() }], {
                        signal, allowTools: false, includeMemory: false, includeAutomaticProjectContext: false,
                        maxToolRounds: 0, timeoutMs: Number(process.env.WORKFLOW_SYNTHESIS_TIMEOUT_MS || 90_000),
                    });
                    result = {
                        ...synthesis,
                        toolEvents: [
                            ...(result.toolEvents || []),
                            {
                                name: 'delegated_workflow',
                                args: { workflowId },
                                result: {
                                    status: workflow.status,
                                    waitingOn: workflow.waitingOn,
                                    jobs: workflow.jobs?.map(job => ({ jobId: job.jobId, status: job.status })) || [],
                                    artifacts: workflow.artifacts || [],
                                },
                                failed: false,
                            },
                        ],
                        memoryRefs: [...new Set([...(result.memoryRefs || []), ...(synthesis.memoryRefs || [])])],
                    };
                }
            }
        } catch (error) {
            if (isCancellation(error)) return { statusCode: 499, body: { error: 'Response generation stopped.', cancelled: true, conversationId, persisted } };
            const assistantFailure = { role: 'assistant', content: `I could not complete that request: ${error.message || 'Model execution failed.'}`, toolEvents: [], memoryRefs: [], model: null, attachments: [], error: true, createdAt: new Date().toISOString() };
            conversation.messages.push(assistantFailure);
            const failed = await saveConversationRecord(conversation, { persisted });
            return { statusCode: error.statusCode || 500, body: { error: error.message || 'Model execution failed.', conversationId, persisted, conversation: { title: failed.title, updatedAt: failed.updatedAt, messageCount: failed.messages.length, persisted }, message: assistantFailure } };
        }

        const assistantMessage = { role: 'assistant', content: result.content, toolEvents: result.toolEvents, memoryRefs: result.memoryRefs, model: result.model, attachments: [], createdAt: new Date().toISOString() };
        conversation.messages.push(assistantMessage);
        const saved = await saveConversationRecord(conversation, { persisted });
        return {
            statusCode: 200,
            body: {
                conversationId, persisted, workflow,
                conversation: { title: saved.title, updatedAt: saved.updatedAt, messageCount: saved.messages.length, persisted },
                message: assistantMessage, model: result.model,
            },
        };
    }

    static async listJobs({ query }) { return { statusCode: 200, body: await listLifecycleJobs({ limit: Math.min(Number(query.limit) || 100, 500) }) }; }
    static async getJob({ params }) {
        const job = await getLifecycleJob(params.jobId);
        if (!job) return { statusCode: 404, body: { error: 'Job not found' } };
        return { statusCode: 200, body: job };
    }
    static async runJob({ params, body = {} }) {
        const job = await getLifecycleJob(params.jobId);
        if (!job) return { statusCode: 404, body: { error: 'Job not found' } };
        const execution = ['failed', 'needs_attention', 'awaiting_approval', 'cancelled'].includes(job.status) ? await retryJob(job.jobId, { feedback: body.feedback || '' }) : await enqueueJob(job.jobId);
        return { statusCode: 202, body: execution };
    }
    static async stopJob({ params }) { return { statusCode: 202, body: await cancelJob(params.jobId) }; }
    static async stopAllJobs() { return { statusCode: 202, body: await stopAllJobs() }; }
    static async deleteJob({ params }) { return { statusCode: 200, body: await deleteJob(params.jobId) }; }
    static async clearJobs({ query }) { return { statusCode: 200, body: await clearJobs({ scope: query.scope || 'terminal' }) }; }

    static async officeMap() {
        const [agents, conversations, jobs] = await Promise.all([
            listAgentConfigs(agentDefinitions, defaultAgentConfig),
            listSavedConversations({ limit: 300 }),
            listLifecycleJobs({ limit: 300 }),
        ]);
        return {
            statusCode: 200,
            body: {
                agents, conversations, jobs,
                workflows: listRuntimeWorkflows({ jobs }),
                events: listRuntimeEvents({ limit: 500 }),
                runner: jobRunnerStatus(),
                generatedAt: new Date().toISOString(),
            },
        };
    }
}
