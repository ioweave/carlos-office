import { agentDefinitions, defaultAgentConfig } from '../agents/agents.config.mjs';
import { getAgentConfig, saveAgentConfig } from './officeStore.mjs';
import { listMcpServers, listMcpTools, callMcpTool } from './mcpClient.mjs';
import { listMonitors, readMonitor, runMonitor } from './mcpMonitors.mjs';
import { listOfficeFiles, readOfficeFile, writeOfficeFile, archiveOfficeFile } from './officeFiles.mjs';
import { writeProjectFile, removeProjectFile, runProjectCheck } from './devTools.mjs';

const allAgents = ['nora', 'marco', 'luma', 'dex', 'iris', 'vera'];
const schema = value => value;

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
                path: { type: 'string' },
                script: { type: 'string' },
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
