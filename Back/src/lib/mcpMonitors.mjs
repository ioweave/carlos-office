import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { callMcpTool } from './mcpClient.mjs';
import { getVaultPath, invalidateIndex } from './memoryCore.mjs';

const timers = new Map();
const states = new Map();
const CONFIG_PATH = path.resolve(process.env.MCP_MONITORS_CONFIG_PATH || path.join(process.cwd(), 'mcp.monitors.json'));
const DEFAULT_CONFIG = path.resolve(process.cwd(), 'mcp.monitors.example.json');

const interpolate = value => {
    if (typeof value === 'string') return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => process.env[key] || '');
    if (Array.isArray(value)) return value.map(interpolate);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item)]));
    return value;
};
const readJson = async file => {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
const enabled = item => item?.enabled !== false
    && (item.enabledIfEnv || []).every(name => Boolean(process.env[name]));
const safeId = value => String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const stable = value => JSON.stringify(value, Object.keys(value || {}).sort());
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const clip = (value, limit = 100_000) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return text.length > limit ? `${text.slice(0, limit)}\n\n[truncated]` : text;
};

export const loadMonitorConfig = async () => interpolate(await readJson(CONFIG_PATH) || await readJson(DEFAULT_CONFIG) || { monitors: [] });

const monitorFolder = id => path.join(getVaultPath(), '50-Monitors', safeId(id));

export const runMonitor = async id => {
    const config = await loadMonitorConfig();
    const item = (config.monitors || []).find(record => safeId(record.id) === safeId(id));
    if (!item) throw Object.assign(new Error(`Unknown monitor: ${id}`), { statusCode: 404 });
    if (!enabled(item)) throw Object.assign(new Error(`Monitor ${id} is disabled or missing environment configuration.`), { statusCode: 409 });

    const startedAt = new Date().toISOString();
    states.set(item.id, { ...(states.get(item.id) || {}), id: item.id, status: 'running', startedAt });
    try {
        const response = await callMcpTool('nora', item.server, item.tool, item.args || {});
        const rendered = clip(response.result);
        const hash = digest(rendered);
        const previous = states.get(item.id)?.hash || '';
        const changed = previous !== hash;
        const folder = monitorFolder(item.id);
        await fs.mkdir(folder, { recursive: true });
        const now = new Date().toISOString();
        const markdown = [
            '---',
            `type: "mcp-monitor"`,
            `id: ${JSON.stringify(item.id)}`,
            `server: ${JSON.stringify(item.server)}`,
            `tool: ${JSON.stringify(item.tool)}`,
            `updatedAt: ${JSON.stringify(now)}`,
            `changed: ${changed}`,
            '---', '',
            `# ${item.description || item.id}`, '',
            `- **Server:** ${item.server}`,
            `- **Tool:** ${item.tool}`,
            `- **Checked:** ${now}`,
            `- **Changed:** ${changed ? 'yes' : 'no'}`, '',
            '## Latest snapshot', '',
            '```json', rendered, '```', '',
        ].join('\n');
        await fs.writeFile(path.join(folder, 'latest.md'), markdown, 'utf8');
        if (changed) {
            await fs.appendFile(path.join(folder, 'events.jsonl'), `${JSON.stringify({ at: now, hash, server: item.server, tool: item.tool })}\n`, 'utf8');
        }
        invalidateIndex();
        const next = { id: item.id, status: 'ready', lastRunAt: now, changed, hash, server: item.server, tool: item.tool };
        states.set(item.id, next);
        return next;
    } catch (error) {
        const next = { id: item.id, status: 'error', lastRunAt: new Date().toISOString(), error: error.message, server: item.server, tool: item.tool };
        states.set(item.id, next);
        throw error;
    }
};

export const listMonitors = async () => {
    const config = await loadMonitorConfig();
    return (config.monitors || []).map(item => ({
        id: item.id,
        description: item.description || '',
        enabled: enabled(item),
        server: item.server,
        tool: item.tool,
        intervalMinutes: Math.max(1, Number(item.intervalMinutes || 15)),
        state: states.get(item.id) || { status: 'idle' },
        path: `50-Monitors/${safeId(item.id)}/latest.md`,
    }));
};

export const readMonitor = async id => {
    const target = path.join(monitorFolder(id), 'latest.md');
    try { return { id, path: `50-Monitors/${safeId(id)}/latest.md`, content: await fs.readFile(target, 'utf8'), state: states.get(id) || null }; }
    catch (error) { if (error.code === 'ENOENT') throw Object.assign(new Error('Monitor has no snapshot yet.'), { statusCode: 404 }); throw error; }
};

export const startMcpMonitors = async () => {
    if (String(process.env.MCP_MONITORS_ENABLED || 'true').toLowerCase() === 'false') return [];
    const monitors = await listMonitors();
    for (const item of monitors.filter(record => record.enabled)) {
        if (timers.has(item.id)) continue;
        runMonitor(item.id).catch(error => console.error(`[monitor:${item.id}]`, error.message));
        const timer = setInterval(() => {
            runMonitor(item.id).catch(error => console.error(`[monitor:${item.id}]`, error.message));
        }, item.intervalMinutes * 60_000);
        timer.unref?.();
        timers.set(item.id, timer);
    }
    return monitors;
};

export const stopMcpMonitors = () => {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
};
