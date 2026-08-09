import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { executeTool } from '../lib/toolRegistry.mjs';
import { ensureOfficeStore } from '../lib/officeStore.mjs';

const server = new McpServer({
    name: 'carlos-office-tools',
    version: '0.6.0',
}, {
    instructions: 'Tools for Carlos Office, Carlos’s private local company. Nora coordinates Marco, Luma, Dex, Iris, and Vera. State and permanent memory use Obsidian Markdown only. Browser automation is restricted to loopback origins unless explicitly allowlisted. External or destructive actions remain approval-gated.',
});

const asResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const register = (name, description, inputSchema) => server.registerTool(name, {
    description,
    inputSchema,
}, async args => asResult(await executeTool('nora', name, args)));

register('memory_search', 'Search permanent Markdown memory.', z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(20).default(8),
}));
register('memory_read', 'Read one permanent Markdown memory note.', z.object({ path: z.string().min(1) }));
register('memory_list', 'List recent permanent-memory notes.', z.object({
    folder: z.string().default(''),
    limit: z.number().int().min(1).max(100).default(50),
}));
register('memory_write', 'Create, append, or replace a durable Markdown note.', z.object({
    title: z.string().min(1),
    content: z.string().min(1),
    scope: z.enum(['shared', 'agent', 'inbox']).default('shared'),
    tags: z.array(z.string()).default([]),
    source: z.string().default(''),
    path: z.string().default(''),
    mode: z.enum(['create', 'append', 'replace']).default('create'),
}));
register('web_search', 'Search the public web.', z.object({
    query: z.string().min(2),
    maxResults: z.number().int().min(1).max(10).default(6),
}));
register('fetch_url', 'Fetch and extract text from a public web page.', z.object({
    url: z.string().url(),
    maxChars: z.number().int().min(1000).max(30000).default(12000),
}));
register('current_time', 'Return the current time in an IANA time zone.', z.object({
    timeZone: z.string().default('America/Guayaquil'),
}));
register('list_ollama_models', 'List installed Ollama models.', z.object({}));
register('list_agents', 'List Carlos Office agents and model configuration.', z.object({}));
register('project_list_files', 'List repository files through the read-only project inspector.', z.object({
    folder: z.string().default('Front/src'),
    limit: z.number().int().min(1).max(1000).default(200),
}));
register('project_read_file', 'Read one safe repository text file.', z.object({
    path: z.string().min(1),
    maxChars: z.number().int().min(1000).max(100000).default(30000),
}));
register('project_search_files', 'Search text across safe repository files.', z.object({
    query: z.string().min(1),
    folder: z.string().default('Front/src'),
    limit: z.number().int().min(1).max(100).default(20),
}));

const browserBase = {
    url: z.string().url(),
    viewport: z.object({
        width: z.number().int().min(320).max(2560).default(1440),
        height: z.number().int().min(320).max(1600).default(900),
    }).optional(),
    waitMs: z.number().int().min(0).max(10000).default(500),
    screenshot: z.boolean().default(true),
    label: z.string().default('page'),
    maxChars: z.number().int().min(1000).max(100000).default(24000),
};
register('playwright_inspect_page', 'Inspect a permitted local web page and capture its rendered state.', z.object(browserBase));
register('playwright_check_page', 'Run bounded rendering, accessibility, console, and request checks on a permitted page.', z.object(browserBase));
register('playwright_interact', 'Perform bounded Playwright interactions on a permitted page.', z.object({
    ...browserBase,
    steps: z.array(z.object({
        action: z.enum(['click', 'fill', 'press', 'select', 'check', 'uncheck', 'wait']),
        selector: z.string().optional(),
        text: z.string().optional(),
        exact: z.boolean().optional(),
        value: z.string().optional(),
        key: z.string().optional(),
        ms: z.number().int().optional(),
        timeoutMs: z.number().int().optional(),
        continueOnError: z.boolean().optional(),
    })).max(12).default([]),
    waitAfterMs: z.number().int().min(0).max(10000).default(0),
}));

register('create_agent_job', 'Create and optionally run a bounded worker-to-Vera QC job.', z.object({
    assignedAgent: z.enum(['marco', 'luma', 'dex', 'iris']),
    title: z.string().min(2),
    instructions: z.string().min(2),
    expectedResult: z.string().min(2),
    acceptanceCriteria: z.array(z.string().min(1)).min(1).max(20),
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
    maxIterations: z.number().int().min(1).max(8).default(2),
    autoRun: z.boolean().default(true),
}));
register('get_agent_job', 'Read one delegated job and its inter-agent history.', z.object({ jobId: z.string().min(1) }));
register('list_agent_jobs', 'List recent delegated jobs.', z.object({
    limit: z.number().int().min(1).max(100).default(20),
}));
register('retry_agent_job', 'Continue a failed, cancelled, or unaccepted job with optional corrective guidance.', z.object({
    jobId: z.string().min(1),
    feedback: z.string().max(12000).optional(),
}));
register('cancel_agent_job', 'Stop one queued or running job.', z.object({ jobId: z.string().min(1) }));
register('stop_all_agent_jobs', 'Stop all queued and active jobs.', z.object({}));
register('clear_agent_jobs', 'Delete selected Markdown job records.', z.object({
    scope: z.enum(['terminal', 'completed', 'cancelled', 'all']).default('terminal'),
}));

await ensureOfficeStore();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Carlos Office MCP tools running with Iris, Playwright inspection, cancellable Vera QC jobs, and Obsidian-only storage');
