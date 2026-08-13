import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getVaultPath } from './memoryCore.mjs';
import { assertAuthorization } from './authorizationManager.mjs';
import { getExecutionContext } from './executionContext.mjs';

const clients = new Map();
const toolCache = new Map();
const DEFAULT_CONFIG = path.resolve(process.cwd(), 'mcp.config.example.json');
const CONFIG_PATH = path.resolve(process.env.MCP_CONFIG_PATH || path.join(process.cwd(), 'mcp.config.json'));
const CACHE_MS = Math.max(5_000, Number(process.env.MCP_TOOL_CACHE_MS || 60_000));

const secretKey = /(?:token|secret|password|authorization|cookie|api[-_]?key|client[-_]?secret)/i;
const interpolate = value => {
    if (typeof value === 'string') return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => process.env[key] || '');
    if (Array.isArray(value)) return value.map(interpolate);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item)]));
    return value;
};
const redact = value => {
    if (Array.isArray(value)) return value.map(redact);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? '[REDACTED]' : redact(item)]));
};
const cleanEnvironment = values => Object.fromEntries(Object.entries(values || {})
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)]));

const readJson = async file => {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) {
        if (error.code === 'ENOENT') return null;
        throw Object.assign(new Error(`Could not read MCP config ${file}: ${error.message}`), { statusCode: 500 });
    }
};

export const loadMcpConfig = async () => {
    const configured = await readJson(CONFIG_PATH);
    return interpolate(configured || await readJson(DEFAULT_CONFIG) || { servers: {} });
};

const serverEnabled = config => {
    if (config?.enabled === false) return false;
    const required = Array.isArray(config?.enabledIfEnv) ? config.enabledIfEnv : [];
    return required.every(name => Boolean(process.env[name]));
};

const assertServerAccess = (agentId, name, config) => {
    if (!config) throw Object.assign(new Error(`Unknown MCP server: ${name}`), { statusCode: 404 });
    if (!serverEnabled(config)) throw Object.assign(new Error(`MCP server ${name} is disabled or missing required environment configuration.`), { statusCode: 409 });
    const allowed = Array.isArray(config.allowedAgents) ? config.allowedAgents : [];
    if (allowed.length && !allowed.includes(agentId)) throw Object.assign(new Error(`${agentId} is not allowed to use MCP server ${name}.`), { statusCode: 403 });
};

const makeTransport = config => {
    if (config.transport === 'http') {
        if (!config.url) throw new Error('HTTP MCP server requires url.');
        return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers || {} } });
    }
    if (!config.command) throw new Error('stdio MCP server requires command.');
    return new StdioClientTransport({
        command: config.command,
        args: Array.isArray(config.args) ? config.args : [],
        cwd: config.cwd || undefined,
        env: cleanEnvironment({ ...process.env, ...(config.env || {}) }),
        stderr: 'inherit',
    });
};

const connectServer = async (name, config) => {
    const existing = clients.get(name);
    if (existing?.client) return existing;
    if (existing?.connecting) return existing.connecting;
    const connecting = (async () => {
        const client = new Client({ name: 'carlos-office', version: '0.5.0' });
        const transport = makeTransport(config);
        try {
            await client.connect(transport);
            const record = { client, transport, connectedAt: new Date().toISOString(), config };
            clients.set(name, record);
            return record;
        } catch (error) {
            clients.delete(name);
            try { await transport.close?.(); } catch {}
            throw Object.assign(new Error(`MCP server ${name} could not connect: ${error.message}`), { statusCode: 502 });
        }
    })();
    clients.set(name, { connecting });
    return connecting;
};

const toolsFor = async (name, config, { refresh = false } = {}) => {
    const cached = toolCache.get(name);
    if (!refresh && cached?.expiresAt > Date.now()) return cached.tools;
    const { client } = await connectServer(name, config);
    const response = await client.listTools();
    const tools = (response.tools || []).map(tool => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        annotations: tool.annotations || {},
    }));
    toolCache.set(name, { expiresAt: Date.now() + CACHE_MS, tools });
    return tools;
};

const actionText = (toolName, args) => [toolName, args?.operation, args?.action, args?.method]
    .filter(Boolean).join(' ').toLowerCase();

export const classifyMcpAction = (tool, args = {}) => {
    if (tool?.annotations?.readOnlyHint === true) return 'read';
    if (tool?.annotations?.destructiveHint === true) return 'dangerous';
    const name = String(tool?.name || '').toLowerCase();
    const operation = String(args?.operation || args?.action || args?.method || '').toLowerCase();
    const text = actionText(name, args);

    if (name === 'manage_email' && /^(send|reply|replyall|forward|trash|untrash|modify)$/.test(operation)) return 'dangerous';
    if (name === 'manage_calendar' && /^(create|quickadd|update|delete)$/.test(operation)) return 'dangerous';
    if (name === 'manage_drive' && /^(delete|share|unshare|listpermissions|permission)$/.test(operation)) return 'dangerous';
    if (name === 'manage_accounts' && /^(authenticate|remove|refresh)$/.test(operation)) return 'dangerous';
    if (/browser.*(click|type|fill|press|select|check|uncheck|drag|upload|submit)|\b(click|type|fill|press|drag|submit)\b/i.test(text)) return 'dangerous';
    if (/\b(send|reply|replyall|forward|delete|trash|remove|revoke|unshare|share|permission|publish|post|submit|purchase|pay|deploy|release|merge|push|commit)\b/i.test(text)) return 'dangerous';
    if (/\b(create|update|write|upload|copy|move|modify|draft|label|folder|file|document|sheet|slide|append|replace|rename)\b/i.test(text)) return 'write';
    return 'read';
};

const enforceToolPolicy = (agentId, serverName, config, tool, args) => {
    const action = classifyMcpAction(tool, args);
    const readOnlyAgents = Array.isArray(config.readOnlyAgents) ? config.readOnlyAgents : [];
    const writeAgents = Array.isArray(config.writeAgents) ? config.writeAgents : [];
    if (action !== 'read' && (readOnlyAgents.includes(agentId) || !writeAgents.includes(agentId))) {
        throw Object.assign(new Error(`${agentId} has read-only access to ${serverName}; ${tool.name} is classified as ${action}.`), { statusCode: 403 });
    }
    return action;
};

const appendAudit = async event => {
    try {
        const now = new Date();
        const folder = path.join(getVaultPath(), '90-System', 'Runtime', 'MCP');
        await fs.mkdir(folder, { recursive: true });
        const file = path.join(folder, `audit-${now.toISOString().slice(0, 10)}.jsonl`);
        await fs.appendFile(file, `${JSON.stringify(redact(event))}\n`, 'utf8');
    } catch (error) { console.error('[mcp] Audit log failed:', error.message); }
};

export const listMcpServers = async agentId => {
    const config = await loadMcpConfig();
    return Object.entries(config.servers || {}).map(([name, server]) => ({
        name,
        description: server.description || '',
        enabled: serverEnabled(server),
        configuredTransport: server.transport || 'stdio',
        connected: Boolean(clients.get(name)?.client),
        allowed: !server.allowedAgents?.length || server.allowedAgents.includes(agentId),
        access: server.readOnlyAgents?.includes(agentId)
            ? 'read-only'
            : server.writeAgents?.includes(agentId) ? 'read-write' : 'read-only',
        requiredEnvironment: server.enabledIfEnv || [],
    }));
};

export const listMcpTools = async (agentId, serverName, { refresh = false } = {}) => {
    const config = await loadMcpConfig();
    const server = config.servers?.[serverName];
    assertServerAccess(agentId, serverName, server);
    const tools = await toolsFor(serverName, server, { refresh });
    return tools.map(tool => ({
        ...tool,
        access: server.readOnlyAgents?.includes(agentId) || !server.writeAgents?.includes(agentId)
            ? 'read-only policy'
            : 'read/write policy',
    }));
};

export const callMcpTool = async (agentId, serverName, toolName, args = {}) => {
    const config = await loadMcpConfig();
    const server = config.servers?.[serverName];
    assertServerAccess(agentId, serverName, server);
    const tools = await toolsFor(serverName, server);
    const tool = tools.find(item => item.name === toolName);
    if (!tool) throw Object.assign(new Error(`MCP tool ${toolName} was not found on ${serverName}.`), { statusCode: 404 });
    const action = enforceToolPolicy(agentId, serverName, server, tool, args);
    if (action !== 'read') assertAuthorization({
        agentId,
        scope: action === 'dangerous' && /\b(send|reply|forward|post|message|notify)\b/i.test(actionText(toolName, args)) ? 'external-message' : 'external-write',
        action: `${serverName}.${toolName}`,
        authority: getExecutionContext().authority,
        details: { serverName, toolName, args: redact(args) },
        context: { dedupeKey: `${getExecutionContext().requestId || 'runtime'}:mcp:${serverName}:${toolName}:${JSON.stringify(redact(args)).slice(0, 500)}` },
    });
    const startedAt = new Date().toISOString();
    const { client } = await connectServer(serverName, server);
    try {
        const result = await client.callTool({ name: toolName, arguments: args || {} });
        await appendAudit({ startedAt, finishedAt: new Date().toISOString(), agentId, server: serverName, tool: toolName, action, args, ok: true });
        return { server: serverName, tool: toolName, action, result };
    } catch (error) {
        await appendAudit({ startedAt, finishedAt: new Date().toISOString(), agentId, server: serverName, tool: toolName, action, args, ok: false, error: error.message });
        throw Object.assign(new Error(`MCP ${serverName}.${toolName} failed: ${error.message}`), { statusCode: 502 });
    }
};

export const getMcpStatus = async () => {
    const config = await loadMcpConfig();
    return Object.entries(config.servers || {}).map(([name, server]) => ({
        name,
        enabled: serverEnabled(server),
        connected: Boolean(clients.get(name)?.client),
        transport: server.transport || 'stdio',
        description: server.description || '',
    }));
};

export const shutdownMcpClients = async () => {
    const records = [...clients.values()];
    clients.clear();
    toolCache.clear();
    await Promise.allSettled(records.map(async record => {
        try { await record.client?.close?.(); } catch {}
        try { await record.transport?.close?.(); } catch {}
    }));
};
