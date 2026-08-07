import axios from 'axios';
import { searchWeb } from './search.mjs';
import { fetchOnlineDocument } from './fetchUrl.mjs';
import { listMemory, readMemory, searchMemory, writeMemory } from './memory.mjs';
import { agentDefinitions, defaultAgentConfig } from '../agents/agents.config.mjs';
import { listAgentConfigs } from './officeStore.mjs';
import { createJob, getJob, listJobs } from './jobLifecycle.mjs';
import { listProjectFiles, readProjectFile, searchProjectFiles } from './projectFiles.mjs';
import { checkPage, inspectPage, interactWithPage } from './browserTools.mjs';
import { capabilityDefinitions } from './capabilityRegistry.mjs';

const allAgents = ['nora', 'marco', 'luma', 'dex', 'iris', 'vera'];
const sourceAgents = ['nora', 'dex', 'iris', 'vera'];
const browserInspectors = ['nora', 'dex', 'iris', 'vera'];

const browserProperties = {
    url: { type: 'string', description: 'Allowed HTTP/HTTPS URL. Localhost is allowed by default.' },
    viewport: {
        type: 'object',
        properties: {
            width: { type: 'integer', minimum: 320, maximum: 2560, default: 1440 },
            height: { type: 'integer', minimum: 320, maximum: 1600, default: 900 },
        },
        additionalProperties: false,
    },
    waitMs: { type: 'integer', minimum: 0, maximum: 10000, default: 500 },
    maxChars: { type: 'integer', minimum: 1000, maximum: 100000, default: 24000 },
    screenshot: { type: 'boolean', default: true },
    label: { type: 'string', description: 'Short label used for the saved screenshot filename.' },
};

const toolDefinitions = [
    {
        name: 'memory_search',
        description: 'Search permanent Markdown knowledge in the local Obsidian vault. Compact remembered facts are injected separately when relevant.',
        allowedAgents: allAgents,
        inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Specific memory query.' }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 } }, required: ['query'], additionalProperties: false },
        execute: (args, { agentId }) => searchMemory({ ...args, agentId }),
    },
    {
        name: 'memory_read',
        description: 'Read one Markdown note from permanent Obsidian knowledge by its vault-relative path.',
        allowedAgents: allAgents,
        inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Vault-relative Markdown path returned by memory_search or memory_list.' } }, required: ['path'], additionalProperties: false },
        execute: readMemory,
    },
    {
        name: 'memory_list',
        description: 'List recent Markdown notes in permanent Obsidian knowledge, optionally within one vault folder.',
        allowedAgents: allAgents,
        inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'Optional vault-relative folder such as 10-Shared or 20-Agents/Iris.' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 } }, additionalProperties: false },
        execute: listMemory,
    },
    {
        name: 'memory_write',
        description: 'Write durable Markdown knowledge. Nora may curate shared knowledge; worker attempts to write shared knowledge are routed to the inbox. Do not use this for incidental facts; Nora has compact fact memory for that.',
        allowedAgents: allAgents,
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string' }, content: { type: 'string' },
                scope: { type: 'string', enum: ['shared', 'agent', 'inbox'], default: 'agent' },
                tags: { type: 'array', items: { type: 'string' }, default: [] }, source: { type: 'string' },
                path: { type: 'string', description: 'Optional existing Markdown path for append or replace.' },
                mode: { type: 'string', enum: ['create', 'append', 'replace'], default: 'create' },
            }, required: ['title', 'content'], additionalProperties: false,
        },
        execute: (args, { agentId }) => writeMemory({ ...args, agentId }),
    },
    {
        name: 'web_search',
        description: 'Search the public web and return normalized result titles, URLs, and snippets.',
        allowedAgents: allAgents,
        inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Specific search query.' }, maxResults: { type: 'integer', minimum: 1, maximum: 10, default: 6 } }, required: ['query'], additionalProperties: false },
        execute: searchWeb,
    },
    {
        name: 'fetch_url',
        description: 'Fetch a public HTTP or HTTPS page and extract readable text. Local and private network addresses are blocked.',
        allowedAgents: allAgents,
        inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'Public page URL.' }, maxChars: { type: 'integer', minimum: 1000, maximum: 30000, default: 12000 } }, required: ['url'], additionalProperties: false },
        execute: fetchOnlineDocument,
    },
    {
        name: 'project_list_files',
        description: 'List readable source and documentation files inside the local Carlos Office repository. Secrets, dependencies, build output, and hidden environment files are blocked.',
        allowedAgents: sourceAgents,
        inputSchema: { type: 'object', properties: { folder: { type: 'string', default: 'Front/src', description: 'Repository-relative folder.' }, limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 } }, additionalProperties: false },
        execute: listProjectFiles,
    },
    {
        name: 'project_read_file',
        description: 'Read one safe text source file from the local Carlos Office repository. This tool is read-only and blocks secrets and dependency folders.',
        allowedAgents: sourceAgents,
        inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Repository-relative text file path.' }, maxChars: { type: 'integer', minimum: 1000, maximum: 100000, default: 30000 } }, required: ['path'], additionalProperties: false },
        execute: readProjectFile,
    },
    {
        name: 'project_search_files',
        description: 'Search readable local repository files for an exact text fragment and return contextual excerpts.',
        allowedAgents: sourceAgents,
        inputSchema: { type: 'object', properties: { query: { type: 'string' }, folder: { type: 'string', default: 'Front/src' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }, required: ['query'], additionalProperties: false },
        execute: searchProjectFiles,
    },
    {
        name: 'playwright_inspect_page',
        description: 'Open an allowed page in headless Chromium and return a structured DOM snapshot, visible controls, overflow state, browser errors, and an optional screenshot saved in the Obsidian vault.',
        allowedAgents: browserInspectors,
        inputSchema: { type: 'object', properties: browserProperties, required: ['url'], additionalProperties: false },
        execute: inspectPage,
    },
    {
        name: 'playwright_check_page',
        description: 'Run bounded UI checks in headless Chromium for overflow, unlabeled controls, console errors, page errors, and failed requests. Saves an optional screenshot in the Obsidian vault.',
        allowedAgents: browserInspectors,
        inputSchema: { type: 'object', properties: browserProperties, required: ['url'], additionalProperties: false },
        execute: checkPage,
    },
    {
        name: 'playwright_interact',
        description: 'Execute a bounded sequence of interactions against an allowed local web page, then return the resulting DOM snapshot, diagnostics, and screenshot. Intended for UI verification, not unsupervised external actions.',
        allowedAgents: ['nora', 'dex', 'vera'],
        inputSchema: {
            type: 'object',
            properties: {
                ...browserProperties,
                steps: {
                    type: 'array', minItems: 1, maxItems: 12,
                    items: {
                        type: 'object',
                        properties: {
                            action: { type: 'string', enum: ['click', 'fill', 'press', 'select', 'check', 'uncheck', 'wait'] },
                            selector: { type: 'string' }, text: { type: 'string' }, exact: { type: 'boolean', default: false }, value: { type: 'string' }, key: { type: 'string' },
                            ms: { type: 'integer', minimum: 0, maximum: 10000 }, timeoutMs: { type: 'integer', minimum: 1000, maximum: 30000 }, continueOnError: { type: 'boolean', default: false },
                        }, required: ['action'], additionalProperties: false,
                    },
                },
                waitAfterMs: { type: 'integer', minimum: 0, maximum: 10000, default: 300 },
            }, required: ['url', 'steps'], additionalProperties: false,
        },
        execute: interactWithPage,
    },
    {
        name: 'current_time',
        description: 'Return the current date and time in an IANA time zone.',
        allowedAgents: allAgents,
        inputSchema: { type: 'object', properties: { timeZone: { type: 'string', default: 'America/Guayaquil' } }, additionalProperties: false },
        execute: async ({ timeZone = 'America/Guayaquil' }) => ({
            timeZone,
            iso: new Date().toISOString(),
            local: new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'full', timeStyle: 'long' }).format(new Date()),
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
            return (response.data?.models || []).map(item => ({ name: item.name, size: item.size, modifiedAt: item.modified_at, family: item.details?.family, parameterSize: item.details?.parameter_size }));
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
        description: 'Create and automatically run a bounded worker-to-Vera QC loop for Marco, Luma, Dex, or Iris. Detailed execution traces are volatile; Vera verifies the work and Nora performs final plan approval before the compact receipt is complete.',
        allowedAgents: ['nora'],
        inputSchema: {
            type: 'object',
            properties: {
                assignedAgent: { type: 'string', enum: ['marco', 'luma', 'dex', 'iris'] }, title: { type: 'string' }, instructions: { type: 'string' },
                expectedResult: { type: 'string', description: 'Concrete final deliverable or outcome Vera must verify.' },
                acceptanceCriteria: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20, description: 'Objective pass/fail conditions for Vera and Nora.' },
                priority: { type: 'string', enum: ['low', 'normal', 'high'], default: 'normal' }, maxIterations: { type: 'integer', minimum: 1, maximum: 8, default: 2 }, autoRun: { type: 'boolean', default: true },
            }, required: ['assignedAgent', 'title', 'instructions', 'expectedResult', 'acceptanceCriteria'], additionalProperties: false,
        },
        execute: async ({ assignedAgent, title, instructions, expectedResult, acceptanceCriteria, priority = 'normal', maxIterations = Number(process.env.JOB_DEFAULT_ITERATIONS || 2), autoRun = true }) => {
            const job = await createJob({ createdBy: 'nora', assignedAgent, title, instructions, expectedResult, acceptanceCriteria, priority, maxIterations, status: 'queued' });
            let execution = { queued: false };
            if (autoRun) {
                const { enqueueJob } = await import('./jobRunner.mjs');
                execution = await enqueueJob(job.jobId);
            }
            return { ...job, execution };
        },
    },
    {
        name: 'get_agent_job',
        description: 'Read one delegated job. Live/recent jobs include the volatile worker/Vera/Nora trace; older terminal jobs expose the compact persistent receipt.',
        allowedAgents: ['nora'],
        inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'], additionalProperties: false },
        execute: async ({ jobId }) => {
            const job = await getJob(jobId);
            if (!job) throw Object.assign(new Error('Job not found.'), { statusCode: 404 });
            return job;
        },
    },
    {
        name: 'list_agent_jobs',
        description: 'List recent delegated jobs and their worker/Vera/Nora approval state. Detailed traces are included while retained in memory.',
        allowedAgents: ['nora'],
        inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }, additionalProperties: false },
        execute: async ({ limit = 20 }) => listJobs({ limit }),
    },
    {
        name: 'retry_agent_job',
        description: 'Continue a failed, cancelled, or unaccepted job with up to two additional bounded iterations.',
        allowedAgents: ['nora'],
        inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'], additionalProperties: false },
        execute: async ({ jobId }) => { const { retryJob } = await import('./jobRunner.mjs'); return retryJob(jobId); },
    },
    {
        name: 'cancel_agent_job',
        description: 'Stop a queued or running job and abort its in-flight model request. The persistent receipt retains only the cancelled state; detailed trace expires from memory.',
        allowedAgents: ['nora'],
        inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'], additionalProperties: false },
        execute: async ({ jobId }) => { const { cancelJob } = await import('./jobRunner.mjs'); return cancelJob(jobId); },
    },
    {
        name: 'stop_all_agent_jobs',
        description: 'Stop all queued and running jobs without deleting their compact persistent receipts.',
        allowedAgents: ['nora'],
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => { const { stopAllJobs } = await import('./jobRunner.mjs'); return stopAllJobs(); },
    },
    {
        name: 'clear_agent_jobs',
        description: 'Delete compact job receipts by scope after active work has been stopped.',
        allowedAgents: ['nora'],
        inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['terminal', 'completed', 'cancelled', 'all'], default: 'terminal' } }, additionalProperties: false },
        execute: async ({ scope = 'terminal' }) => { const { clearJobs } = await import('./jobRunner.mjs'); return clearJobs({ scope }); },
    },
    ...capabilityDefinitions,
];

export const listTools = agentId => toolDefinitions.filter(tool => !agentId || tool.allowedAgents.includes(agentId)).map(({ execute, ...tool }) => tool);
export const getOpenAITools = agentId => listTools(agentId).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }));
export const executeTool = async (agentId, name, args = {}) => {
    const tool = toolDefinitions.find(item => item.name === name);
    if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { statusCode: 404 });
    if (!tool.allowedAgents.includes(agentId)) throw Object.assign(new Error(`${agentId} is not allowed to use ${name}.`), { statusCode: 403 });
    return tool.execute(args, { agentId });
};
