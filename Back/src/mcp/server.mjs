import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import mongooseConfig from '../../database/mongoose.mjs';
import { executeTool } from '../lib/toolRegistry.mjs';

const server = new McpServer({
    name: 'carlos-office-tools',
    version: '0.1.0',
}, {
    instructions: 'Shared local tools for Nora, Marco, Luma, and Dex. Public web fetching blocks private network addresses. External side effects are not exposed.',
});

const asResult = value => ({
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

server.registerTool('web_search', {
    description: 'Search the public web and return normalized results.',
    inputSchema: z.object({
        query: z.string().min(2),
        maxResults: z.number().int().min(1).max(10).default(6),
    }),
}, async args => asResult(await executeTool('nora', 'web_search', args)));

server.registerTool('fetch_url', {
    description: 'Fetch a public web page and extract readable text. Private network addresses are blocked.',
    inputSchema: z.object({
        url: z.string().url(),
        maxChars: z.number().int().min(1000).max(30000).default(12000),
    }),
}, async args => asResult(await executeTool('nora', 'fetch_url', args)));

server.registerTool('current_time', {
    description: 'Return the current time in an IANA time zone.',
    inputSchema: z.object({
        timeZone: z.string().default('America/Guayaquil'),
    }),
}, async args => asResult(await executeTool('nora', 'current_time', args)));

server.registerTool('list_ollama_models', {
    description: 'List locally installed Ollama models.',
    inputSchema: z.object({}),
}, async () => asResult(await executeTool('nora', 'list_ollama_models', {})));

server.registerTool('list_agents', {
    description: 'List Carlos Office agents and their provider/model configuration.',
    inputSchema: z.object({}),
}, async () => asResult(await executeTool('nora', 'list_agents', {})));

server.registerTool('create_agent_job', {
    description: 'Queue a durable job for Marco, Luma, or Dex.',
    inputSchema: z.object({
        assignedAgent: z.enum(['marco', 'luma', 'dex']),
        title: z.string().min(2),
        instructions: z.string().min(2),
        priority: z.enum(['low', 'normal', 'high']).default('normal'),
    }),
}, async args => asResult(await executeTool('nora', 'create_agent_job', args)));

await mongooseConfig.connect();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Carlos Office MCP tools running on stdio');
