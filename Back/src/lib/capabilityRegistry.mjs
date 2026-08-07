import { agentDefinitions, defaultAgentConfig } from '../agents/agents.config.mjs';
import { getAgentConfig, saveAgentConfig } from './officeStore.mjs';
import { listMcpServers, listMcpTools, callMcpTool } from './mcpClient.mjs';
import { listMonitors, readMonitor, runMonitor } from './mcpMonitors.mjs';
import { listOfficeFiles, readOfficeFile, writeOfficeFile, archiveOfficeFile } from './officeFiles.mjs';
import { writeProjectFile, removeProjectFile, runProjectCheck } from './devTools.mjs';
import { forgetFact, listFacts, rememberFact, updateFact } from './factMemory.mjs';
import {
    createRetentionDirective,
    executeRetentionDirective,
    listKnowledgeSources,
    registerKnowledgeSource,
    removeKnowledgeSource,
    scanKnowledgeRetention,
    updateKnowledgeSource,
} from './knowledgeLifecycle.mjs';
import { promoteKnowledgeProposal, writeDerivedKnowledge } from './knowledgeNotes.mjs';

const allAgents = ['nora', 'marco', 'luma', 'dex', 'iris', 'vera'];
const schema = value => value;

const existingSource = async sourceId => {
    if (!sourceId) return null;
    return (await listKnowledgeSources({})).find(item => item.sourceId === sourceId) || null;
};
const assertSourceGovernance = async (agentId, args = {}) => {
    if (agentId === 'nora') return;
    const current = await existingSource(args.sourceId);
    if (args.lifecycle === 'universal' || current?.lifecycle === 'universal') {
        throw Object.assign(new Error('Only Nora may create, redefine, or update universal knowledge sources.'), { statusCode: 403 });
    }
};

export const capabilityDefinitions = [
    {
        name: 'office_file_list',
        description: 'List files in the agent-owned local workspace or the shared read area. Persistent files live under the Obsidian-backed 60-Workspace folder.',
        allowedAgents: allAgents,
        inputSchema: schema({ type: 'object', properties: { folder: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 } }, additionalProperties: false }),
        execute: (args, { agentId }) => listOfficeFiles(agentId, args),
    },
    {
        name: 'office_file_read',
        description: 'Read a UTF-8 file from the agent-owned workspace or Shared.',
        allowedAgents: allAgents,
        inputSchema: schema({ type: 'object', properties: { path: { type: 'string' }, maxChars: { type: 'integer', minimum: 1000, maximum: 500000, default: 100000 } }, required: ['path'], additionalProperties: false }),
        execute: (args, { agentId }) => readOfficeFile(agentId, args),
    },
    {
        name: 'office_file_write',
        description: 'Create, replace, or append a text file in the agent-owned workspace. Only Nora may write directly to Shared.',
        allowedAgents: ['nora', 'marco', 'luma', 'dex', 'iris'],
        inputSchema: schema({ type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append'], default: 'replace' } }, required: ['path', 'content'], additionalProperties: false }),
        execute: (args, { agentId }) => writeOfficeFile(agentId, args),
    },
    {
        name: 'office_file_archive',
        description: 'Move an owned workspace file into the archive instead of deleting it permanently.',
        allowedAgents: ['nora', 'marco', 'luma', 'dex', 'iris'],
        inputSchema: schema({ type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }),
        execute: (args, { agentId }) => archiveOfficeFile(agentId, args),
    },
    {
        name: 'memory_remember_fact',
        description: 'Nora-only compact semantic memory for stable facts worth retaining without saving an entire conversation. Do not use for temporary chatter or secrets.',
        allowedAgents: ['nora'],
        inputSchema: schema({
            type: 'object',
            properties: {
                subject: { type: 'string' }, statement: { type: 'string' },
                scope: { type: 'string', enum: ['universal', 'project', 'agent'], default: 'universal' },
                projectId: { type: 'string' }, agentId: { type: 'string' },
                confidence: { type: 'string', enum: ['confirmed', 'high', 'medium', 'low'], default: 'medium' },
                source: { type: 'string' }, importance: { type: 'string', enum: ['critical', 'high', 'normal', 'low'], default: 'normal' },
                expiresAt: { type: 'string' }, pinned: { type: 'boolean', default: false },
            }, required: ['subject', 'statement'], additionalProperties: false,
        }),
        execute: rememberFact,
    },
    {
        name: 'memory_list_facts',
        description: 'List compact remembered facts separately from Markdown knowledge and conversation history.',
        allowedAgents: ['nora', 'iris'],
        inputSchema: schema({ type: 'object', properties: { scope: { type: 'string' }, projectId: { type: 'string' }, agentId: { type: 'string' }, status: { type: 'string', default: 'active' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 } }, additionalProperties: false }),
        execute: listFacts,
    },
    {
        name: 'memory_update_fact',
        description: 'Nora-only update, stale marker, supersession, expiry, or pin change for a remembered fact.',
        allowedAgents: ['nora'],
        inputSchema: schema({ type: 'object', properties: { factId: { type: 'string' }, statement: { type: 'string' }, confidence: { type: 'string' }, importance: { type: 'string' }, status: { type: 'string', enum: ['active', 'stale', 'superseded'] }, expiresAt: { type: 'string' }, supersededBy: { type: 'string' }, pinned: { type: 'boolean' } }, required: ['factId'], additionalProperties: false }),
        execute: ({ factId, ...update }) => updateFact(factId, update),
    },
    {
        name: 'memory_forget_fact',
        description: 'Nora-only permanent deletion of one compact remembered fact after it is no longer useful.',
        allowedAgents: ['nora'],
        inputSchema: schema({ type: 'object', properties: { factId: { type: 'string' } }, required: ['factId'], additionalProperties: false }),
        execute: ({ factId }) => forgetFact(factId),
    },
    {
        name: 'knowledge_source_list',
        description: 'List session, project, and universal knowledge-source definitions. Session sources are volatile; project/universal source manifests are persistent.',
        allowedAgents: ['nora', 'iris'],
        inputSchema: schema({ type: 'object', properties: { lifecycle: { type: 'string', enum: ['session', 'project', 'universal'] }, projectId: { type: 'string' }, status: { type: 'string' } }, additionalProperties: false }),
        execute: listKnowledgeSources,
    },
    {
        name: 'knowledge_source_register',
        description: 'Register a knowledge source. Session sources remain in memory only; project sources require projectId; only Nora may designate universal sources.',
        allowedAgents: ['nora', 'iris'],
        inputSchema: schema({ type: 'object', properties: {
            sourceId: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
            lifecycle: { type: 'string', enum: ['session', 'project', 'universal'] }, type: { type: 'string', enum: ['upload', 'directory', 'google-drive', 'web', 'github', 'manual'] },
            locator: { type: 'string' }, projectId: { type: 'string' }, authority: { type: 'string', enum: ['authoritative', 'reference', 'historical', 'experimental'] },
            refresh: { type: 'string' }, topics: { type: 'array', items: { type: 'string' } }, expiresAt: { type: 'string' }, managedCopy: { type: 'boolean' },
        }, required: ['name', 'lifecycle', 'type'], additionalProperties: false }),
        execute: async (args, { agentId }) => {
            await assertSourceGovernance(agentId, args);
            return registerKnowledgeSource(args);
        },
    },
    {
        name: 'knowledge_source_update',
        description: 'Update source freshness/status after ingestion. Iris may maintain project/session sources; universal-source governance remains Nora-only.',
        allowedAgents: ['nora', 'iris'],
        inputSchema: schema({ type: 'object', properties: { sourceId: { type: 'string' }, lifecycle: { type: 'string', enum: ['session', 'project', 'universal'] }, status: { type: 'string', enum: ['active', 'stale', 'retiring', 'retired'] }, lastIngestedAt: { type: 'string' }, expiresAt: { type: 'string' }, refresh: { type: 'string' }, authority: { type: 'string' } }, required: ['sourceId'], additionalProperties: false }),
        execute: async ({ sourceId, ...update }, { agentId }) => {
            await assertSourceGovernance(agentId, { sourceId, ...update });
            return updateKnowledgeSource(sourceId, update);
        },
    },
    {
        name: 'knowledge_source_remove',
        description: 'Nora-only removal of a source definition. Removing a manifest does not delete the external original unless a separate retention directive explicitly targets managed knowledge files.',
        allowedAgents: ['nora'],
        inputSchema: schema({ type: 'object', properties: { sourceId: { type: 'string' } }, required: ['sourceId'], additionalProperties: false }),
        execute: ({ sourceId }) => removeKnowledgeSource(sourceId),
    },
    {
        name: 'knowledge_note_write',
        description: 'Nora/Iris write one atomic derived knowledge note. Project knowledge is written to that project. Universal knowledge written by Iris becomes an inbox proposal; Nora may write it directly.',
        allowedAgents: ['nora', 'iris'],
        inputSchema: schema({
            type: 'object',
            properties: {
                title: { type: 'string' }, content: { type: 'string' },
                lifecycle: { type: 'string', enum: ['project', 'universal'] }, projectId: { type: 'string' }, sourceId: { type: 'string' },
                authority: { type: 'string', enum: ['authoritative', 'reference', 'historical', 'experimental'], default: 'reference' },
                category: { type: 'string', default: 'Reference' }, tags: { type: 'array', items: { type: 'string' }, default: [] },
                status: { type: 'string', enum: ['active', 'stale', 'superseded', 'retiring'], default: 'active' }, expiresAt: { type: 'string' },
            }, required: ['title', 'content', 'lifecycle'], additionalProperties: false,
        }),
        execute: (args, { agentId }) => writeDerivedKnowledge({ ...args, agentId }),
    },
    {
        name: 'knowledge_note_promote',
        description: 'Nora-only promotion of an Iris universal-knowledge proposal from 00-Inbox/Knowledge into curated 10-Shared knowledge.',
        allowedAgents: ['nora'],
        inputSchema: schema({ type: 'object', properties: { path: { type: 'string' }, category: { type: 'string', default: 'Reference' } }, required: ['path'], additionalProperties: false }),
        execute: ({ path, category }) => promoteKnowledgeProposal({ path, category }),
    },
    {
        name: 'knowledge_retention_scan',
        description: 'Scan curated knowledge for explicit stale, superseded, retiring, or expired metadata. This proposes candidates; it does not delete anything.',
        allowedAgents: ['nora', 'iris'],
        inputSchema: schema({ type: 'object', properties: {}, additionalProperties: false }),
        execute: scanKnowledgeRetention,
    },
    {
        name: 'knowledge_retention_directive',
        description: 'Nora-only approval directive authorizing Iris to archive or delete one curated knowledge note.',
        allowedAgents: ['nora'],
        inputSchema: schema({ type: 'object', properties: { path: { type: 'string' }, action: { type: 'string', enum: ['archive', 'delete'], default: 'archive' }, reason: { type: 'string' } }, required: ['path'], additionalProperties: false }),
        execute: createRetentionDirective,
    },
    {
        name: 'knowledge_retention_execute',
        description: 'Iris-only execution of a pre-existing Nora-approved retention directive. Iris cannot invent or broaden the target.',
        allowedAgents: ['iris'],
        inputSchema: schema({ type: 'object', properties: { directiveId: { type: 'string' } }, required: ['directiveId'], additionalProperties: false }),
        execute: ({ directiveId }) => executeRetentionDirective(directiveId),
    },
    {
        name: 'mcp_list_servers',
        description: 'List configured MCP integrations and the current agent access level. Use before claiming an external service is unavailable.',
        allowedAgents: allAgents,
        inputSchema: schema({ type: 'object', properties: {}, additionalProperties: false }),
        execute: (_, { agentId }) => listMcpServers(agentId),
    },
    {
        name: 'mcp_list_tools',
        description: 'Discover the live tools exposed by one configured MCP server. This keeps the base model context small while allowing arbitrary configured MCP integrations.',
        allowedAgents: allAgents,
        inputSchema: schema({ type: 'object', properties: { server: { type: 'string' }, refresh: { type: 'boolean', default: false } }, required: ['server'], additionalProperties: false }),
        execute: ({ server, refresh = false }, { agentId }) => listMcpTools(agentId, server, { refresh }),
    },
    {
        name: 'mcp_call',
        description: 'Invoke one discovered MCP tool. Carlos Office enforces server allowlists, per-agent read/write access, dangerous-action gates, and an Obsidian audit trail.',
        allowedAgents: allAgents,
        inputSchema: schema({ type: 'object', properties: { server: { type: 'string' }, tool: { type: 'string' }, args: { type: 'object', additionalProperties: true, default: {} } }, required: ['server', 'tool'], additionalProperties: false }),
        execute: ({ server, tool, args = {} }, { agentId }) => callMcpTool(agentId, server, tool, args),
    },
    {
        name: 'monitor_list',
        description: 'List periodic MCP monitors such as Gmail triage and calendar agenda checks, including their latest state.',
        allowedAgents: allAgents,
        inputSchema: schema({ type: 'object', properties: {}, additionalProperties: false }),
        execute: () => listMonitors(),
    },
    {
        name: 'monitor_read',
        description: 'Read the latest persisted snapshot from a periodic MCP monitor.',
        allowedAgents: allAgents,
        inputSchema: schema({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }),
        execute: ({ id }) => readMonitor(id),
    },
    {
        name: 'monitor_run',
        description: 'Run a configured periodic monitor immediately. Intended for Nora and Iris when fresh operational information is needed.',
        allowedAgents: ['nora', 'iris'],
        inputSchema: schema({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }),
        execute: ({ id }) => runMonitor(id),
    },
    {
        name: 'project_write_file',
        description: 'Dex-only atomic source-file writer with an optional SHA-256 stale-write guard. Secrets, dependencies, build output, and non-source files are blocked.',
        allowedAgents: ['dex'],
        inputSchema: schema({ type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, expectedSha256: { type: 'string' }, createOnly: { type: 'boolean', default: false } }, required: ['path', 'content'], additionalProperties: false }),
        execute: writeProjectFile,
    },
    {
        name: 'project_delete_file',
        description: 'Dex-only source deletion. Disabled unless Carlos explicitly enables DEX_ALLOW_PROJECT_DELETE.',
        allowedAgents: ['dex'],
        inputSchema: schema({ type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }),
        execute: removeProjectFile,
    },
    {
        name: 'project_run_check',
        description: 'Run a bounded, allowlisted development check such as node --check, git status/diff/log/show, or a declared npm script. Dex executes checks; Vera may independently re-run verification checks.',
        allowedAgents: ['dex', 'vera'],
        inputSchema: schema({
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['node-check', 'git-status', 'git-diff', 'git-log', 'git-show', 'npm-script', 'npm-install'] },
                cwd: { type: 'string', default: '.' },
                path: { type: 'string' }, script: { type: 'string' },
                args: { type: 'array', items: { type: 'string' }, maxItems: 20, default: [] },
                timeoutMs: { type: 'integer', minimum: 1000, maximum: 180000, default: 60000 },
            },
            required: ['kind'], additionalProperties: false,
        }),
        execute: (args, { agentId }) => runProjectCheck({ ...args, agentId }),
    },
    {
        name: 'agent_get_config',
        description: 'Nora-only read of one agent runtime configuration.',
        allowedAgents: ['nora'],
        inputSchema: schema({ type: 'object', properties: { agentId: { type: 'string', enum: allAgents } }, required: ['agentId'], additionalProperties: false }),
        execute: ({ agentId }) => getAgentConfig(agentId, defaultAgentConfig(agentId)),
    },
    {
        name: 'agent_update_config',
        description: 'Nora-only update of an existing agent runtime model, fallback, temperature, tool-round limit, or enabled state. This does not alter agent source-code definitions or credentials.',
        allowedAgents: ['nora'],
        inputSchema: schema({
            type: 'object',
            properties: {
                agentId: { type: 'string', enum: allAgents }, provider: { type: 'string' }, model: { type: 'string' }, baseUrl: { type: 'string' },
                temperature: { type: 'number', minimum: 0, maximum: 2 }, maxToolRounds: { type: 'integer', minimum: 0, maximum: 12 }, enabled: { type: 'boolean' },
                fallback: { type: 'object', properties: { enabled: { type: 'boolean' }, provider: { type: 'string' }, model: { type: 'string' }, baseUrl: { type: 'string' } }, additionalProperties: false },
            }, required: ['agentId'], additionalProperties: false,
        }),
        execute: async ({ agentId, ...update }) => {
            if (!agentDefinitions[agentId]) throw Object.assign(new Error('Unknown agent.'), { statusCode: 404 });
            return saveAgentConfig(agentId, update, defaultAgentConfig(agentId));
        },
    },
];

export const listCapabilityTools = agentId => capabilityDefinitions
    .filter(tool => !agentId || tool.allowedAgents.includes(agentId))
    .map(({ execute, ...tool }) => tool);

export const getCapabilityOpenAITools = agentId => listCapabilityTools(agentId).map(tool => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
}));

export const executeCapabilityTool = async (agentId, name, args = {}) => {
    const tool = capabilityDefinitions.find(item => item.name === name);
    if (!tool) throw Object.assign(new Error(`Unknown capability tool: ${name}`), { statusCode: 404 });
    if (!tool.allowedAgents.includes(agentId)) throw Object.assign(new Error(`${agentId} is not allowed to use ${name}.`), { statusCode: 403 });
    return tool.execute(args, { agentId });
};
