import http from 'node:http';
import Router from './src/Router.mjs';
import routes from './src/modules.config.mjs';
import { ensureOfficeStore } from './src/lib/officeStore.mjs';
import { resumePendingJobs } from './src/lib/jobRunner.mjs';
import { getRuntimeDiagnostics } from './src/lib/runtimeContext.mjs';

const router = new Router(routes);
const host = process.env.LOCAL_HOST || '127.0.0.1';
const port = Number(process.env.LOCAL_PORT || 3002);
const maxBodyBytes = Math.max(1_000_000, Number(process.env.MAX_CHAT_BODY_BYTES || 30_000_000));
const allowedOrigins = new Set(
    String(process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173')
        .split(',').map(item => item.trim()).filter(Boolean),
);
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const boundToLoopback = loopbackHosts.has(host);
const allowLoopbackOrigins = boundToLoopback
    && String(process.env.ALLOW_LOOPBACK_ORIGINS || 'true').toLowerCase() !== 'false';

const isLoopbackOrigin = value => {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && loopbackHosts.has(url.hostname);
    } catch {
        return false;
    }
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
        if (!raw) return resolve({});
        try { return resolve(JSON.parse(raw)); }
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
        'Access-Control-Allow-Headers': 'Content-Type',
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
    res.once('close', () => {
        if (!res.writableEnded) requestController.abort();
    });

    try {
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
        const response = await router.handle(req.method, req.url, {
            headers: req.headers,
            body,
            signal: requestController.signal,
        });
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(response.statusCode || 200, {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            ...corsHeaders,
            ...(response.headers || {}),
        });
        res.end(JSON.stringify(response.body ?? {}));
    } catch (error) {
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders });
        res.end(JSON.stringify({ error: error.message || 'Internal server error' }));
    }
});

await ensureOfficeStore();
server.listen(port, host, async () => {
    console.log(`Carlos Office backend: http://${host}:${port}`);
    console.log('Private local company mode: authentication is disabled.');
    console.log('All state is stored in the Obsidian vault.');
    try {
        const runtime = await getRuntimeDiagnostics('nora');
        console.log(`Project root: ${runtime.projectRoot}`);
        console.log(`Detected layout: ${runtime.projectLayout}`);
        console.log(`Nora tools (${runtime.tools.length}): ${runtime.tools.join(', ')}`);
    } catch (error) {
        console.error('[runtime] Could not print capability manifest:', error.message);
    }
    try {
        const resumed = await resumePendingJobs();
        if (resumed) console.log(`Resumed ${resumed} pending Vera QC job${resumed === 1 ? '' : 's'}.`);
    } catch (error) {
        console.error('[jobs] Could not resume pending jobs:', error.message);
    }
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
