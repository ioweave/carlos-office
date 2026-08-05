import axios from 'axios';
import { v4 as uuid } from 'uuid';
import { searchWeb } from './search.mjs';
import { fetchOnlineDocument } from './fetchUrl.mjs';
import Job from '../models/Job.mjs';
import AgentConfig from '../models/AgentConfig.mjs';

const toolDefinitions = [
    {
        name: 'web_search',
        description: 'Search the public web and return normalized result titles, URLs, and snippets.',
        allowedAgents: ['nora', 'marco', 'luma', 'dex'],
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
        allowedAgents: ['nora', 'marco', 'luma', 'dex'],
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
        allowedAgents: ['nora', 'marco', 'luma', 'dex'],
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
        execute: async () => AgentConfig.find({}).select('-__v').lean(),
    },
    {
        name: 'create_agent_job',
        description: 'Queue a scoped job for Marco, Luma, or Dex. This creates a durable record but does not publish or execute external actions.',
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
        execute: async ({ assignedAgent, title, instructions, priority = 'normal' }) => {
            const job = await Job.create({
                jobId: uuid(),
                createdBy: 'nora',
                assignedAgent,
                title,
                instructions,
                priority,
                status: 'queued',
            });
            return job.toObject();
        },
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
    return tool.execute(args);
};
