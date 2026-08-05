import axios from 'axios';
import { searchWeb } from './search.mjs';
import { fetchOnlineDocument } from './fetchUrl.mjs';
import { listMemory, readMemory, searchMemory, writeMemory } from './memory.mjs';
import { agentDefinitions, defaultAgentConfig } from '../agents/agents.config.mjs';
import { createJob, listAgentConfigs } from './officeStore.mjs';

const allAgents = ['nora', 'marco', 'luma', 'dex'];

const toolDefinitions = [
    {
        name: 'memory_search',
        description: 'Search permanent Markdown memory in the shared Obsidian vault. Use this before assuming prior decisions, preferences, procedures, or project history.',
        allowedAgents: allAgents,
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Specific memory query.' },
                limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
            },
            required: ['query'],
            additionalProperties: false,
        },
        execute: (args, { agentId }) => searchMemory({ ...args, agentId }),
    },
    {
        name: 'memory_read',
        description: 'Read one Markdown note from permanent Obsidian memory by its vault-relative path.',
        allowedAgents: allAgents,
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Vault-relative Markdown path returned by memory_search or memory_list.' },
            },
            required: ['path'],
            additionalProperties: false,
        },
        execute: readMemory,
    },
    {
        name: 'memory_list',
        description: 'List recent Markdown notes in permanent Obsidian memory, optionally within one vault folder.',
        allowedAgents: allAgents,
        inputSchema: {
            type: 'object',
            properties: {
                folder: { type: 'string', description: 'Optional vault-relative folder such as 10-Shared or 20-Agents/Nora.' },
                limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            },
            additionalProperties: false,
        },
        execute: listMemory,
    },
    {
        name: 'memory_write',
        description: 'Write durable knowledge to the Obsidian vault. Nora may curate shared memory; worker attempts to write shared memory are routed to the inbox.',
        allowedAgents: allAgents,
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                content: { type: 'string' },
                scope: { type: 'string', enum: ['shared', 'agent', 'inbox'], default: 'agent' },
                tags: { type: 'array', items: { type: 'string' }, default: [] },
                source: { type: 'string' },
                path: { type: 'string', description: 'Optional existing Markdown path for append or replace.' },
                mode: { type: 'string', enum: ['create', 'append', 'replace'], default: 'create' },
            },
            required: ['title', 'content'],
            additionalProperties: false,
        },
        execute: (args, { agentId }) => writeMemory({ ...args, agentId }),
    },
    {
        name: 'web_search',
        description: 'Search the public web and return normalized result titles, URLs, and snippets.',
        allowedAgents: allAgents,
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Specific search query.' },
                maxResults: { type: 'integer', minimum: 1, maximum: 10, default: 6 },
            },
            required: ['query'],
            additionalProperties: false,
        },
        execute: searchWeb,
    },
    {
        name: 'fetch_url',
        description: 'Fetch a public HTTP or HTTPS page and extract readable text. Local and private network addresses are blocked.',
        allowedAgents: allAgents,
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Public page URL.' },
                maxChars: { type: 'integer', minimum: 1000, maximum: 30000, default: 12000 },
            },
            required: ['url'],
            additionalProperties: false,
        },
        execute: fetchOnlineDocument,
    },
    {
        name: 'current_time',
        description: 'Return the current date and time in an IANA time zone.',
        allowedAgents: allAgents,
        inputSchema: {
            type: 'object',
            properties: {
                timeZone: { type: 'string', default: 'America/Guayaquil' },
            },
            additionalProperties: false,
        },
        execute: async ({ timeZone = 'America/Guayaquil' }) => ({
            timeZone,
            iso: new Date().toISOString(),
            local: new Intl.DateTimeFormat('en-CA', {
                timeZone,
                dateStyle: 'full',
                timeStyle: 'long',
            }).format(new Date()),
        }),
    },
    {
        name: 'list_ollama_models',
        description: 'List models currently installed in the local Ollama instance.',
        allowedAgents: ['nora', 'dex'],
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => {
            const baseUrl = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
            const response = await axios.get(`${baseUrl}/api/tags`, { timeout: 10000 });
            return (response.data?.models || []).map(item => ({
                name: item.name,
                size: item.size,
                modifiedAt: item.modified_at,
                family: item.details?.family,
                parameterSize: item.details?.parameter_size,
            }));
        },
    },
    {
        name: 'list_agents',
        description: 'List configured Carlos Office agents and their current provider/model assignment.',
        allowedAgents: ['nora'],
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => listAgentConfigs(agentDefinitions, defaultAgentConfig),
    },
    {
        name: 'create_agent_job',
        description: 'Queue a scoped job for Marco, Luma, or Dex as a durable Markdown note in the Obsidian vault.',
        allowedAgents: ['nora'],
        inputSchema: {
            type: 'object',
            properties: {
                assignedAgent: { type: 'string', enum: ['marco', 'luma', 'dex'] },
                title: { type: 'string' },
                instructions: { type: 'string' },
                priority: { type: 'string', enum: ['low', 'normal', 'high'], default: 'normal' },
            },
            required: ['assignedAgent', 'title', 'instructions'],
            additionalProperties: false,
        },
        execute: async ({ assignedAgent, title, instructions, priority = 'normal' }) => createJob({
            createdBy: 'nora', assignedAgent, title, instructions, priority, status: 'queued',
        }),
    },
];

export const listTools = agentId => toolDefinitions
    .filter(tool => !agentId || tool.allowedAgents.includes(agentId))
    .map(({ execute, ...tool }) => tool);

export const getOpenAITools = agentId => listTools(agentId).map(tool => ({
    type: 'function',
    function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
    },
}));

export const executeTool = async (agentId, name, args = {}) => {
    const tool = toolDefinitions.find(item => item.name === name);
    if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { statusCode: 404 });
    if (!tool.allowedAgents.includes(agentId)) throw Object.assign(new Error(`${agentId} is not allowed to use ${name}.`), { statusCode: 403 });
    return tool.execute(args, { agentId });
};
