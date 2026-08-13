import axios from 'axios';
import { searchWeb } from './search.mjs';
import { fetchOnlineDocument } from './fetchUrl.mjs';
import { listMemory, readMemory, searchMemory, writeMemory } from './memory.mjs';
import { agentDefinitions, defaultAgentConfig } from '../agents/agents.config.mjs';
import { listAgentConfigs } from './officeStore.mjs';
import { listProjectFiles, readProjectFile, searchProjectFiles } from './projectFiles.mjs';
import { checkPage, inspectPage, interactWithPage } from './browserTools.mjs';
import { capabilityDefinitions } from './capabilityRegistry.mjs';
import { publishArtifact, readArtifactById } from './artifacts.mjs';
import { readSkillResource } from './skillRegistry.mjs';
import { extensionEnabledForAgent, installExtension, listExtensions, readExtension, removeExtension } from './extensionManager.mjs';
import { executeOpenMontageTool, installOpenMontage, listExternalProjects, openMontagePreflight, probeExternalProjectMedia, readExternalProjectFile } from './externalProjects.mjs';
import { searchConversationHistory } from './conversationSearch.mjs';
import { createSchedule, deleteSchedule, listSchedules, updateSchedule } from './scheduleManager.mjs';
import { executeToolPipeline } from './programmaticTools.mjs';
import { assertAuthorization } from './authorizationManager.mjs';
import { getExecutionContext } from './executionContext.mjs';
import { createAgentDefinition, getAgentDefinition, promoteAgentDefinition } from './agentRegistry.mjs';
import { callMcpTool, classifyMcpAction, listMcpServers, listMcpTools, loadMcpConfig } from './mcpClient.mjs';

const allAgents = ['nora', 'marco', 'luma', 'dex', 'iris', 'vera'];
const sourceAgents = ['nora', 'dex', 'iris', 'vera'];
const browserInspectors = ['nora', 'dex', 'iris', 'vera'];
// Retired public runtime concepts. Durable work is expressed only through
// ProcessDefinition → Job → Task/Attempt/AgentInstance. MCP servers are providers;
// their methods are normalized into named tools before agents may use them.

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
        name: 'artifact_read',
        description: 'Read a generated artifact by its immutable artifact reference. Use offsets for large artifacts; do not ask another agent to paste the artifact into a message.',
        allowedAgents: allAgents,
        inputSchema: {
            type: 'object',
            properties: {
                artifactId: { type: 'string', description: 'Artifact ID from an artifact:// reference.' },
                offset: { type: 'integer', minimum: 0, default: 0 },
                maxChars: { type: 'integer', minimum: 1000, maximum: 100000, default: 40000 },
            },
            required: ['artifactId'],
            additionalProperties: false,
        },
        execute: async ({ artifactId, offset = 0, maxChars = 40_000 }) => readArtifactById({ artifactId, offset, maxChars }),
    },
    {
        name: 'artifact_publish',
        description: 'Publish an existing workspace, project, or managed external-project output as an inline-preview artifact. This grants no new filesystem authority.',
        allowedAgents: ['nora', 'marco', 'luma', 'dex', 'iris'],
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string', enum: ['workspace', 'project', 'external-project'], default: 'workspace' },
                path: { type: 'string' },
                title: { type: 'string' },
            },
            required: ['path'], additionalProperties: false,
        },
        execute: (args, { agentId }) => publishArtifact(agentId, args),
    },
    {
        name: 'skill_list',
        description: 'List installed Agent Skills using metadata-only progressive disclosure. Each descriptor carries an integrity-checked content hash derived from the upstream SKILL.md.',
        allowedAgents: allAgents,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: (_args, { agentId }) => listExtensions({ agentId }),
    },
    {
        name: 'skill_read',
        description: 'Activate one installed Agent Skill by reading its complete canonical Markdown descriptor (frontmatter + body). The central permission engine remains authoritative; a skill cannot add tools beyond the invoking agent allowlist.',
        allowedAgents: allAgents,
        inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
        execute: ({ name }, { agentId }) => {
            if (!extensionEnabledForAgent(name, agentId)) throw Object.assign(new Error(`${name} is disabled for ${agentId}.`), { statusCode: 403 });
            return readExtension(name);
        },
    },
    {
        name: 'skill_read_resource',
        description: 'Read one integrity-checked managed skill resource by SHA-256 or original relative path. Text is returned as UTF-8 and binary data as bounded base64 chunks.',
        allowedAgents: allAgents,
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Installed skill name.' },
                sha256: { type: 'string', description: 'Optional SHA-256 of the desired resource as listed in the skill manifest.' },
                originalPath: { type: 'string', description: 'Optional original relative path of the resource inside the skill tree.' },
                query: { type: 'string', description: 'When no file selector is supplied, filter the paged resource inventory by path or MIME type.' },
                limit: { type: 'integer', minimum: 1, maximum: 250, default: 100 },
                offset: { type: 'integer', minimum: 0, default: 0 },
                maxBytes: { type: 'integer', minimum: 1, maximum: 200000, default: 64000 },
            },
            required: ['name'], additionalProperties: false,
        },
        execute: ({ name, sha256: hash, originalPath, query = '', limit = 100, offset = 0, maxBytes = 64_000 }, { agentId }) => {
            if (!extensionEnabledForAgent(name, agentId)) throw Object.assign(new Error(`${name} is disabled for ${agentId}.`), { statusCode: 403 });
            return readSkillResource(name, { sha256: hash, originalPath, query, limit, offset, maxBytes });
        },
    },
    {
        name: 'skill_install',
        description: 'Nora-only installation of a complete universal skill package from an approved local root, a GitHub repository root, or a GitHub tree subfolder. The ingestion produces a canonical Markdown descriptor, a manifest sidecar, and content-addressed resources. Dependencies are never installed by skill ingestion.',
        allowedAgents: ['nora'],
        inputSchema: { type: 'object', properties: { source: { type: 'string' }, replace: { type: 'boolean', default: false } }, required: ['source'], additionalProperties: false },
        execute: installExtension,
    },
    {
        name: 'skill_remove',
        description: 'Nora-only removal of one installed skill. Explicit confirm=true is required.',
        allowedAgents: ['nora'],
        inputSchema: { type: 'object', properties: { name: { type: 'string' }, confirm: { type: 'boolean', default: false } }, required: ['name', 'confirm'], additionalProperties: false },
        execute: removeExtension,
    },
    {
        name: 'external_project_list',
        description: 'List managed external operational projects and their installed/runtime state.',
        allowedAgents: ['nora', 'luma', 'dex', 'iris', 'vera'],
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: listExternalProjects,
    },
    {
        name: 'external_project_install',
        description: 'Install the curated OpenMontage repository into its isolated external-project root, optionally with its declared Python and Remotion dependencies.',
        allowedAgents: ['nora'],
        inputSchema: { type: 'object', properties: { projectId: { type: 'string', enum: ['openmontage'] }, installDependencies: { type: 'boolean', default: false } }, required: ['projectId'], additionalProperties: false },
        execute: ({ installDependencies = false }) => installOpenMontage({ installDependencies }),
    },
    {
        name: 'external_project_read',
        description: 'Read a bounded text file from a managed external project. Paths are relative to the managed external-project root.',
        allowedAgents: ['nora', 'luma', 'dex', 'iris', 'vera'],
        inputSchema: { type: 'object', properties: { path: { type: 'string' }, maxChars: { type: 'integer', minimum: 1000, maximum: 200000, default: 60000 } }, required: ['path'], additionalProperties: false },
        execute: readExternalProjectFile,
    },
    {
        name: 'external_project_media_probe',
        description: 'Inspect a managed external video/audio artifact with local ffprobe. Returns duration, dimensions, stream types, codecs, and size without executing the project.',
        allowedAgents: ['nora', 'luma', 'dex', 'iris', 'vera'],
        inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
        execute: probeExternalProjectMedia,
    },
    {
        name: 'openmontage_preflight',
        description: 'Inspect OpenMontage provider availability, composition runtimes, setup offers, and runtime warnings before proposing video production.',
        allowedAgents: ['nora', 'luma', 'dex', 'vera'],
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: openMontagePreflight,
    },
    {
        name: 'openmontage_execute',
        description: 'Execute one discovered OpenMontage registry tool after its pipeline/stage skill has been read and Carlos has approved consequential production choices. Returned media is exposed as previewable artifacts.',
        allowedAgents: ['nora', 'luma', 'dex'],
        inputSchema: {
            type: 'object',
            properties: { toolName: { type: 'string' }, args: { type: 'object', additionalProperties: true, default: {} }, approved: { type: 'boolean', default: false } },
            required: ['toolName', 'approved'], additionalProperties: false,
        },
        execute: executeOpenMontageTool,
    },
    {
        name: 'list_agents',
        description: 'List configured Carlos Office agents and their current provider/model assignment.',
        allowedAgents: ['nora'],
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => listAgentConfigs(agentDefinitions, defaultAgentConfig),
    },
    {
        name: 'agent_create_temporary',
        description: 'Create a temporary AgentDefinition under an existing parent. The specialist can only use the parent boundary and executes one task per instance.',
        allowedAgents: ['nora'],
        inputSchema: {
            type: 'object', properties: {
                name: { type: 'string' }, role: { type: 'string' }, system: { type: 'string' }, parentAgentId: { type: 'string' },
                maxInstances: { type: 'integer', minimum: 1, maximum: 20, default: 1 },
                toolGrants: { type: 'array', items: { type: 'string' }, default: [] }, capabilities: { type: 'array', items: { type: 'string' }, default: [] },
            }, required: ['name', 'role', 'system', 'parentAgentId'], additionalProperties: false,
        },
        execute: args => createAgentDefinition({ ...args, permanent: false, creationSource: 'nora' }),
    },
    {
        name: 'agent_promote',
        description: 'Promote a temporary AgentDefinition into permanent staff without expanding its inherited tool or authorization boundary.',
        allowedAgents: ['nora'],
        inputSchema: { type: 'object', properties: { agentId: { type: 'string' } }, required: ['agentId'], additionalProperties: false },
        execute: ({ agentId }) => promoteAgentDefinition(agentId),
    },
    {
        name: 'conversation_search',
        description: 'Explicitly search saved conversation history with SQLite full-text search. Returns bounded excerpts and never injects chat history into ambient memory.',
        allowedAgents: ['nora'],
        inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 }, agentId: { type: 'string', enum: allAgents } }, required: ['query'], additionalProperties: false },
        execute: searchConversationHistory,
    },
    {
        name: 'schedule_manage',
        description: 'Create, list, update, or delete durable Nora automations. Results may remain in a saved conversation or use any configured outbound channel adapter.',
        allowedAgents: ['nora'],
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['create', 'list', 'update', 'delete'] },
                scheduleId: { type: 'string' }, name: { type: 'string' }, prompt: { type: 'string' }, enabled: { type: 'boolean' },
                schedule: { type: 'object', properties: { kind: { type: 'string', enum: ['once', 'interval', 'cron'] }, at: { type: 'string' }, everyMinutes: { type: 'integer', minimum: 1, maximum: 525600 }, expression: { type: 'string' }, timeZone: { type: 'string', default: 'America/Guayaquil' } }, required: ['kind'], additionalProperties: false },
                delivery: { type: 'object', properties: { channel: { type: 'string', enum: ['none', 'telegram', 'whatsapp', 'email', 'slack', 'discord', 'webhook'], default: 'none' }, destination: { type: 'string' } }, additionalProperties: false },
            }, required: ['action'], additionalProperties: false,
        },
        execute: args => {
            if (args.action === 'list') return listSchedules();
            if (args.action === 'create') return createSchedule(args);
            if (args.action === 'update') return updateSchedule(args.scheduleId, args);
            if (args.action === 'delete') return deleteSchedule(args.scheduleId);
            throw Object.assign(new Error('Unsupported schedule action.'), { statusCode: 400 });
        },
    },
    {
        name: 'tool_pipeline',
        description: 'Run 2-20 safe read-only tools as one dependency-aware pipeline. Use for repeated searches, reads, extraction, filtering, or parallel inspection. Intermediate results remain out of model context; only selected outputs return.',
        allowedAgents: allAgents,
        inputSchema: {
            type: 'object',
            properties: {
                steps: { type: 'array', minItems: 2, maxItems: 20, items: { type: 'object', properties: { id: { type: 'string' }, tool: { type: 'string' }, args: { type: 'object', additionalProperties: true }, dependsOn: { type: 'array', items: { type: 'string' }, default: [] }, continueOnError: { type: 'boolean', default: false } }, required: ['id', 'tool'], additionalProperties: false } },
                outputs: { type: 'array', maxItems: 20, items: { type: 'object', properties: { step: { type: 'string' }, path: { type: 'string' }, as: { type: 'string' }, maxChars: { type: 'integer', minimum: 100, maximum: 50000 } }, required: ['step'], additionalProperties: false } },
                concurrency: { type: 'integer', minimum: 1, maximum: 4, default: 4 }, timeoutMs: { type: 'integer', minimum: 1000, maximum: 300000, default: 120000 },
            }, required: ['steps'], additionalProperties: false,
        },
        execute: (args, { agentId }) => executeToolPipeline(agentId, args, { executeTool }),
    },
    ...capabilityDefinitions,
];

const dynamicMcpToolNames = new Set();
const normalizedMcpName = (server, tool) => `${String(server).replace(/[^A-Za-z0-9_-]+/g, '_')}_${String(tool).replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 64);
export const refreshMcpToolRegistry = async () => {
    for (let index = toolDefinitions.length - 1; index >= 0; index -= 1) {
        if (dynamicMcpToolNames.has(toolDefinitions[index].name)) toolDefinitions.splice(index, 1);
    }
    dynamicMcpToolNames.clear();
    const config = await loadMcpConfig();
    const status = new Map((await listMcpServers('nora')).map(item => [item.name, item]));
    const providers = [];
    for (const [serverName, server] of Object.entries(config.servers || {})) {
        const serverStatus = status.get(serverName);
        if (!serverStatus?.enabled) {
            providers.push({ server: serverName, status: 'disabled', tools: 0 });
            continue;
        }
        try {
            const discovered = await listMcpTools('nora', serverName, { refresh: true });
            const allowedAgents = server.allowedAgents?.length ? server.allowedAgents : allAgents;
            for (const method of discovered) {
                const name = normalizedMcpName(serverName, method.name);
                const action = classifyMcpAction(method, {});
                const externalMessage = /\b(send|reply|forward|post|message|notify)\b/i.test(method.name);
                toolDefinitions.push({
                    name,
                    stableId: `${serverName}.${method.name}`,
                    provider: serverName,
                    source: 'mcp',
                    description: method.description || `${method.name} from ${serverName}.`,
                    allowedAgents,
                    inputSchema: method.inputSchema || { type: 'object', properties: {} },
                    sideEffect: action === 'read' ? 'read' : 'governed-write',
                    authorizationScopes: action === 'read' ? [] : [externalMessage ? 'external-message' : 'external-write'],
                    idempotent: action === 'read',
                    execute: (args, { agentId }) => callMcpTool(agentId, serverName, method.name, args),
                });
                dynamicMcpToolNames.add(name);
            }
            providers.push({ server: serverName, status: 'available', tools: discovered.length });
        } catch (error) {
            providers.push({ server: serverName, status: 'unavailable', tools: 0, error: error.message });
        }
    }
    return { providers, tools: dynamicMcpToolNames.size };
};

const agentMayUse = (tool, agentId, seen = new Set()) => {
    if (!agentId) return true;
    if (seen.has(agentId)) return false;
    seen.add(agentId);
    const definition = getAgentDefinition(agentId);
    return tool.allowedAgents.includes(agentId)
        || Boolean(definition?.parentAgentId && agentMayUse(tool, definition.parentAgentId, seen))
        || Boolean(definition?.permanent && definition?.creationSource !== 'built-in' && definition.toolGrants?.includes(tool.name));
};
export const listTools = agentId => {
    const definition = agentId ? getAgentDefinition(agentId) : null;
    const grants = new Set(definition?.toolGrants || []);
    return toolDefinitions.filter(tool => agentMayUse(tool, agentId)
        && (!grants.size || grants.has(tool.name)))
        .map(({ execute, ...tool }) => ({
            version: '1.0.0', provider: tool.provider || 'native', sideEffect: tool.sideEffect || (authorizationScopesForTool(tool.name).length ? 'governed-write' : 'read'),
            authorizationScopes: tool.authorizationScopes || authorizationScopesForTool(tool.name), timeoutMs: tool.timeoutMs || 300000, idempotent: tool.idempotent ?? authorizationScopesForTool(tool.name).length === 0,
            health: 'available', redaction: 'bounded', ...tool,
        }));
};
export const getOpenAITools = agentId => listTools(agentId).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }));
const authorizationScopesForTool = (name, args = {}) => {
    const scopes = [];
    if (name === 'project_write_file') scopes.push('local-write');
    if (name === 'project_delete_file') scopes.push('local-delete');
    if (name === 'project_publish_changes') scopes.push('git-publish');
    if (name === 'skill_install' || name === 'skill_remove') scopes.push('skill-admin');
    if (name === 'agent_promote') scopes.push('agent-admin');
    if (name === 'schedule_manage' && args.action !== 'list') {
        scopes.push('schedule-admin');
        if (args.delivery?.channel && args.delivery.channel !== 'none') scopes.push('external-message');
    }
    if (name === 'project_run_check' && args.kind === 'npm-install') scopes.push('dependency-install');
    return scopes;
};
export const executeTool = async (agentId, name, args = {}, context = {}) => {
    const tool = toolDefinitions.find(item => item.name === name);
    if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { statusCode: 404 });
    if (!agentMayUse(tool, agentId)) throw Object.assign(new Error(`${agentId} is not allowed to use ${name}.`), { statusCode: 403 });
    const definition = getAgentDefinition(agentId);
    if (definition?.toolGrants?.length && !definition.toolGrants.includes(name)) throw Object.assign(new Error(`${agentId} is not granted ${name}.`), { statusCode: 403 });
    const scopes = [...new Set([...(tool.authorizationScopes || []), ...authorizationScopesForTool(name, args)])];
    const execution = getExecutionContext();
    scopes.forEach(scope => assertAuthorization({
        agentId, scope, action: name, authority: execution.authority,
        details: { args }, context: {
            dedupeKey: `${execution.requestId || 'runtime'}:${name}:${JSON.stringify(args).slice(0, 500)}`,
            requestId: execution.requestId || '', conversationId: execution.conversationId || '', jobId: execution.jobId || '',
            definitionId: execution.definitionId || '', processVersion: execution.processVersion || 0,
        },
    }));
    return tool.execute(args, { agentId, ...context });
};
