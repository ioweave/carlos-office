import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { agentDefinitions, defaultAgentConfig } from '../agents/agents.config.mjs';
import { runAgent } from '../lib/agentRunner.mjs';
import { executeTool, listTools } from '../lib/toolRegistry.mjs';
import {
    appendConversationJournal,
    getMemoryStatus,
    listMemory as listMemoryNotes,
    readMemory as readMemoryNote,
    searchMemory as searchMemoryNotes,
    writeMemory as writeMemoryNote,
} from '../lib/memory.mjs';
import {
    getConversation as getStoredConversation,
    getJob as getStoredJob,
    listAgentConfigs,
    listConversations as listStoredConversations,
    listJobs as listStoredJobs,
    saveAgentConfig,
    saveConversation,
} from '../lib/officeStore.mjs';
import { enqueueJob, jobRunnerStatus, retryJob } from '../lib/jobRunner.mjs';

const allowedConfigFields = [
    'provider', 'model', 'baseUrl', 'temperature', 'maxToolRounds', 'enabled', 'fallback',
];

export default class OfficeController {
    static async health() {
        let ollama = { online: false, models: 0 };
        try {
            const baseUrl = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
            const response = await axios.get(`${baseUrl}/api/tags`, { timeout: 3000 });
            ollama = { online: true, models: response.data?.models?.length || 0 };
        } catch {}

        let memory = { online: false, path: '', notes: 0 };
        try { memory = await getMemoryStatus(); }
        catch (error) { memory.error = error.message; }

        return {
            statusCode: 200,
            body: {
                status: 'online',
                localOnly: true,
                storage: 'obsidian',
                ollama,
                memory,
                jobs: jobRunnerStatus(),
                timestamp: new Date().toISOString(),
            },
        };
    }

    static async listAgents() {
        return {
            statusCode: 200,
            body: await listAgentConfigs(agentDefinitions, defaultAgentConfig),
        };
    }

    static async updateAgent({ params, body }) {
        const agentId = params.agentId;
        if (!agentDefinitions[agentId]) return { statusCode: 404, body: { error: 'Unknown agent' } };
        const update = {};
        allowedConfigFields.forEach(field => {
            if (body[field] !== undefined) update[field] = body[field];
        });
        return {
            statusCode: 200,
            body: await saveAgentConfig(agentId, update, defaultAgentConfig(agentId)),
        };
    }

    static async listModels({ query }) {
        const provider = query.provider || 'ollama';
        if (provider !== 'ollama') return { statusCode: 200, body: [] };
        const baseUrl = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
        const response = await axios.get(`${baseUrl}/api/tags`, { timeout: 10000 });
        return { statusCode: 200, body: (response.data?.models || []).map(item => item.name) };
    }

    static async listTools({ query }) {
        return { statusCode: 200, body: listTools(query.agentId) };
    }

    static async invokeTool({ params, body }) {
        const agentId = body.agentId || 'nora';
        const result = await executeTool(agentId, params.toolName, body.args || {});
        return { statusCode: 200, body: result };
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
        const note = await writeMemoryNote({
            agentId: body.agentId || 'nora',
            title: body.title,
            content: body.content,
            scope: body.scope,
            tags: body.tags,
            source: body.source,
            path: body.path,
            mode: body.mode,
        });
        return { statusCode: 200, body: note };
    }

    static async listConversations() {
        return { statusCode: 200, body: await listStoredConversations({ limit: 50 }) };
    }

    static async getConversation({ params }) {
        const conversation = await getStoredConversation(params.conversationId);
        if (!conversation) return { statusCode: 404, body: { error: 'Conversation not found' } };
        return { statusCode: 200, body: conversation };
    }

    static async chat({ body }) {
        const message = String(body.message || '').trim();
        const agentId = body.agentId || 'nora';
        if (!message) return { statusCode: 400, body: { error: 'Message is required' } };
        if (!agentDefinitions[agentId]) return { statusCode: 404, body: { error: 'Unknown agent' } };

        const conversationId = body.conversationId || randomUUID();
        const now = new Date().toISOString();
        const conversation = await getStoredConversation(conversationId) || {
            conversationId,
            agentId,
            title: message.slice(0, 72),
            messages: [],
            createdAt: now,
            updatedAt: now,
        };

        conversation.messages.push({ role: 'user', content: message, createdAt: now });
        const result = await runAgent(agentId, conversation.messages);
        const assistantMessage = {
            role: 'assistant',
            content: result.content,
            toolEvents: result.toolEvents,
            memoryRefs: result.memoryRefs,
            model: result.model,
            createdAt: new Date().toISOString(),
        };
        conversation.messages.push(assistantMessage);
        await saveConversation(conversation);
        await appendConversationJournal({
            conversationId,
            agentId,
            userMessage: message,
            assistantMessage: result.content,
        });

        return {
            statusCode: 200,
            body: {
                conversationId,
                message: assistantMessage,
                model: result.model,
            },
        };
    }

    static async listJobs() {
        return { statusCode: 200, body: await listStoredJobs({ limit: 100 }) };
    }

    static async getJob({ params }) {
        const job = await getStoredJob(params.jobId);
        if (!job) return { statusCode: 404, body: { error: 'Job not found' } };
        return { statusCode: 200, body: job };
    }

    static async runJob({ params }) {
        const job = await getStoredJob(params.jobId);
        if (!job) return { statusCode: 404, body: { error: 'Job not found' } };
        const execution = ['failed', 'awaiting_approval'].includes(job.status)
            ? await retryJob(job.jobId)
            : await enqueueJob(job.jobId);
        return { statusCode: 202, body: execution };
    }
}
