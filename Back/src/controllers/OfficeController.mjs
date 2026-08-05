import axios from 'axios';
import { v4 as uuid } from 'uuid';
import AgentConfig from '../models/AgentConfig.mjs';
import Conversation from '../models/Conversation.mjs';
import Job from '../models/Job.mjs';
import { agentDefinitions, defaultAgentConfig } from '../agents/agents.config.mjs';
import { ensureAgentConfig, runAgent } from '../lib/agentRunner.mjs';
import { executeTool, listTools } from '../lib/toolRegistry.mjs';
import {
    appendConversationJournal,
    getMemoryStatus,
    listMemory as listMemoryNotes,
    readMemory as readMemoryNote,
    searchMemory as searchMemoryNotes,
    writeMemory as writeMemoryNote,
} from '../lib/memory.mjs';

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
                ollama,
                memory,
                timestamp: new Date().toISOString(),
            },
        };
    }

    static async listAgents() {
        const agents = [];
        for (const agentId of Object.keys(agentDefinitions)) agents.push(await ensureAgentConfig(agentId));
        return { statusCode: 200, body: agents };
    }

    static async updateAgent({ params, body }) {
        const agentId = params.agentId;
        if (!agentDefinitions[agentId]) return { statusCode: 404, body: { error: 'Unknown agent' } };
        const update = {};
        allowedConfigFields.forEach(field => {
            if (body[field] !== undefined) update[field] = body[field];
        });
        const agent = await AgentConfig.findOneAndUpdate(
            { agentId },
            { $set: update, $setOnInsert: defaultAgentConfig(agentId) },
            { new: true, upsert: true, setDefaultsOnInsert: true },
        ).lean();
        return { statusCode: 200, body: agent };
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
        const conversations = await Conversation.find({}).select('-messages').sort({ updatedAt: -1 }).limit(50).lean();
        return { statusCode: 200, body: conversations };
    }

    static async getConversation({ params }) {
        const conversation = await Conversation.findOne({ conversationId: params.conversationId }).lean();
        if (!conversation) return { statusCode: 404, body: { error: 'Conversation not found' } };
        return { statusCode: 200, body: conversation };
    }

    static async chat({ body }) {
        const message = String(body.message || '').trim();
        const agentId = body.agentId || 'nora';
        if (!message) return { statusCode: 400, body: { error: 'Message is required' } };
        if (!agentDefinitions[agentId]) return { statusCode: 404, body: { error: 'Unknown agent' } };

        const conversationId = body.conversationId || uuid();
        let conversation = await Conversation.findOne({ conversationId });
        if (!conversation) {
            conversation = new Conversation({
                conversationId,
                agentId,
                title: message.slice(0, 72),
                messages: [],
            });
        }

        conversation.messages.push({ role: 'user', content: message, createdAt: new Date() });
        const result = await runAgent(agentId, conversation.messages);
        conversation.messages.push({
            role: 'assistant',
            content: result.content,
            toolEvents: result.toolEvents,
            memoryRefs: result.memoryRefs,
            model: result.model,
            createdAt: new Date(),
        });
        await conversation.save();
        appendConversationJournal({
            conversationId,
            agentId,
            userMessage: message,
            assistantMessage: result.content,
        });

        return {
            statusCode: 200,
            body: {
                conversationId,
                message: conversation.messages.at(-1),
                model: result.model,
            },
        };
    }

    static async listJobs() {
        const jobs = await Job.find({}).sort({ createdAt: -1 }).limit(100).lean();
        return { statusCode: 200, body: jobs };
    }
}
