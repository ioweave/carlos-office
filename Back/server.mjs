import http from 'node:http';
import Router from './src/Router.mjs';
import routes from './src/modules.config.mjs';
import { ensureOfficeStore } from './src/lib/officeStore.mjs';
import { getRuntimeDiagnostics } from './src/lib/runtimeContext.mjs';
import { startMcpMonitors, stopMcpMonitors } from './src/lib/mcpMonitors.mjs';
import { shutdownMcpClients } from './src/lib/mcpClient.mjs';
import { ensureOfficeWorkspace } from './src/lib/officeFiles.mjs';
import { migrateAgentRuntimeConfigs } from './src/lib/agentMigrations.mjs';
import { startRetentionManager, stopRetentionManager } from './src/lib/retentionManager.mjs';
import { warmSemanticIndex } from './src/lib/semanticMemory.mjs';
import { warmConversationSearch } from './src/lib/conversationSearch.mjs';
import { startScheduleManager, stopScheduleManager } from './src/lib/scheduleManager.mjs';
import { startChannelGateway, stopChannelGateway } from './src/lib/channelGateway.mjs';
import { resumeProcessRuns } from './src/lib/processEngine.mjs';
import { startOperationalWorker, stopOperationalWorker } from './src/lib/operationalWorker.mjs';

const router = new Router(routes);
const host = process.env.LOCAL_HOST || '127.0.0.1';
const port = Number(process.env.LOCAL_PORT || 3002);
const maxBodyBytes = Math.max(1_000_000, Number(process.env.MAX_CHAT_BODY_BYTES || 30_000_000));
const allowedOrigins = new Set(String(process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173').split(',').map(item => item.trim()).filter(Boolean));
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const boundToLoopback = loopbackHosts.has(host);
const allowLoopbackOrigins = boundToLoopback && String(process.env.ALLOW_LOOPBACK_ORIGINS || 'true').toLowerCase() !== 'false';

const isLoopbackOrigin = value => {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && loopbackHosts.has(url.hostname);
    } catch { return false; }
};

const readBody = req => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
        size += chunk.length;
        if (size > maxBodyBytes) {
            reject(Object.assign(new Error(`Request body exceeds the ${maxBodyBytes}-byte local limit.`), { statusCode: 413 }));
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        if (!raw) return resolve({ body: {}, rawBody: '' });
        try { return resolve({ body: JSON.parse(raw), rawBody: raw }); }
        catch { return reject(Object.assign(new Error('Invalid JSON body.'), { statusCode: 400 })); }
    });
    req.on('error', reject);
});

const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const corsAllowed = !origin || allowedOrigins.has(origin) || (allowLoopbackOrigins && isLoopbackOrigin(origin));
    const corsHeaders = origin && corsAllowed ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Range',
        'Access-Control-Expose-Headers': 'Accept-Ranges,Content-Range,Content-Length,Content-Disposition',
        Vary: 'Origin',
    } : {};
    if (!corsAllowed) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Origin not allowed' }));
        return;
    }
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
    }
    const requestController = new AbortController();
    req.once('aborted', () => requestController.abort());
    res.once('close', () => { if (!res.writableEnded) requestController.abort(); });
    try {
        const requestBody = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : { body: {}, rawBody: '' };
        const response = await router.handle(req.method, req.url, { headers: req.headers, body: requestBody.body, rawBody: requestBody.rawBody, signal: requestController.signal });
        if (res.destroyed || res.writableEnded) return;

        if (response.stream && typeof response.stream.pipe === 'function') {
            const streamHeaders = {
                'Content-Type': 'application/octet-stream',
                'X-Content-Type-Options': 'nosniff',
                ...corsHeaders,
                ...(response.headers || {}),
            };
            res.writeHead(response.statusCode || 200, streamHeaders);
            if (String(streamHeaders['Content-Type']).startsWith('text/event-stream')) res.flushHeaders?.();
            response.stream.once('error', error => {
                console.error('[office] media stream error', error.message);
                if (!res.destroyed) res.destroy(error);
            });
            requestController.signal.addEventListener('abort', () => response.stream.destroy(), { once: true });
            response.stream.pipe(res);
            return;
        }

        res.writeHead(response.statusCode || 200, {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            ...corsHeaders,
            ...(response.headers || {}),
        });
        res.end(response.raw ? String(response.body ?? '') : JSON.stringify(response.body ?? {}));
    } catch (error) {
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders });
        res.end(JSON.stringify({ error: error.message || 'Internal server error' }));
    }
});

await ensureOfficeStore();
await ensureOfficeWorkspace();
warmSemanticIndex();
warmConversationSearch();
startScheduleManager();
startOperationalWorker();
try {
    const migrated = await migrateAgentRuntimeConfigs();
    if (migrated.length) console.log(`[agents] Migrated ${migrated.length} runtime configuration${migrated.length === 1 ? '' : 's'} to current capability defaults.`);
} catch (error) {
    console.error('[agents] Could not migrate runtime configurations:', error.message);
}
try {
    const retention = await startRetentionManager();
    console.log(`Retention manager: verbose tool events and internal context are lifecycle-scoped; cleanup every ${Math.round(retention.intervalMs / 60_000)} minute(s).`);
} catch (error) {
    console.error('[retention] Could not start retention manager:', error.message);
}

server.listen(port, host, async () => {
    console.log(`Carlos Office backend: http://${host}:${port}`);
    console.log('Private local company mode: authentication is disabled.');
    console.log('Governed Markdown stores durable conversations and knowledge; SQLite stores restart-safe requests, process jobs, queues, authorizations, schedules, semantic vectors, and routing metrics.');
    try {
        const runtime = await getRuntimeDiagnostics('nora');
        console.log(`Project root: ${runtime.projectRoot}`);
        console.log(`Detected layout: ${runtime.projectLayout}`);
        console.log(`Nora tools (${runtime.tools.length}): ${runtime.tools.join(', ')}`);
    } catch (error) { console.error('[runtime] Could not print capability manifest:', error.message); }
    try {
        const monitors = await startMcpMonitors();
        const enabled = monitors.filter(item => item.enabled).length;
        if (enabled) console.log(`Started ${enabled} connected-service monitor${enabled === 1 ? '' : 's'}.`);
    } catch (error) { console.error('[monitors] Could not start connected-service monitors:', error.message); }
    try {
        const resumedProcesses = resumeProcessRuns();
        if (resumedProcesses) console.log(`Resumed ${resumedProcesses} durable process run${resumedProcesses === 1 ? '' : 's'}.`);
    } catch (error) { console.error('[processes] Could not resume process runs:', error.message); }
    try {
        const channels = startChannelGateway();
        if (channels.telegram.running) console.log('Telegram gateway is receiving allowlisted messages.');
    } catch (error) { console.error('[gateway] Could not start channel gateway:', error.message); }
});

const shutdown = async () => {
    stopRetentionManager();
    stopScheduleManager();
    await stopOperationalWorker();
    stopMcpMonitors();
    await stopChannelGateway();
    await shutdownMcpClients();
    server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
