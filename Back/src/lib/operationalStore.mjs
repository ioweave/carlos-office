import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const runtimeRoot = path.resolve(process.env.OFFICE_RUNTIME_DIR || path.join(process.cwd(), '.runtime'));
mkdirSync(runtimeRoot, { recursive: true });
const databasePath = path.resolve(process.env.OFFICE_RUNTIME_DB_PATH || path.join(runtimeRoot, 'office-runtime.sqlite'));
const database = new DatabaseSync(databasePath);

export const getOperationalDatabase = () => database;
export const getOperationalDatabasePath = () => databasePath;

database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS operational_kv (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, key)
    );
    CREATE TABLE IF NOT EXISTS operational_queue (
        work_id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        available_at INTEGER NOT NULL,
        lease_owner TEXT NOT NULL DEFAULT '',
        lease_until INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS operational_queue_ready
        ON operational_queue (status, available_at, priority, created_at);
    CREATE TABLE IF NOT EXISTS semantic_documents (
        path TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        title TEXT NOT NULL,
        scope TEXT NOT NULL,
        agent TEXT NOT NULL DEFAULT '',
        project_id TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        excerpt TEXT NOT NULL,
        vector_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_route_metrics (
        metric_id TEXT PRIMARY KEY,
        task_class TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        success INTEGER NOT NULL,
        fallback_used INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        error_class TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
    );
`);

const parseJson = (value, fallback = null) => {
    try { return JSON.parse(value); } catch { return fallback; }
};
const serialize = value => JSON.stringify(value);
const now = () => Date.now();

const upsertKv = database.prepare(`
    INSERT INTO operational_kv (namespace, key, value_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(namespace, key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
`);
const deleteKv = database.prepare('DELETE FROM operational_kv WHERE namespace = ? AND key = ?');
const listKv = database.prepare('SELECT key, value_json FROM operational_kv WHERE namespace = ?');

const deepProxy = (value, persist, cache = new WeakMap()) => {
    if (!value || typeof value !== 'object') return value;
    if (cache.has(value)) return cache.get(value);
    const proxy = new Proxy(value, {
        get(target, property, receiver) {
            return deepProxy(Reflect.get(target, property, receiver), persist, cache);
        },
        set(target, property, next, receiver) {
            const changed = Reflect.set(target, property, next, receiver);
            persist();
            return changed;
        },
        deleteProperty(target, property) {
            const changed = Reflect.deleteProperty(target, property);
            persist();
            return changed;
        },
    });
    cache.set(value, proxy);
    return proxy;
};

export const createPersistentMap = namespace => {
    const raw = new Map(listKv.all(namespace).map(row => [row.key, parseJson(row.value_json)]));
    const wrapped = new Map();
    const persist = key => {
        if (!raw.has(key)) return;
        upsertKv.run(namespace, String(key), serialize(raw.get(key)), now());
    };
    const wrap = key => {
        if (!raw.has(key)) return undefined;
        if (!wrapped.has(key)) wrapped.set(key, deepProxy(raw.get(key), () => persist(key)));
        return wrapped.get(key);
    };
    return {
        get size() { return raw.size; },
        get: key => wrap(String(key)),
        has: key => raw.has(String(key)),
        set(key, value) {
            const normalized = String(key);
            raw.set(normalized, value);
            wrapped.delete(normalized);
            persist(normalized);
            return this;
        },
        delete(key) {
            const normalized = String(key);
            const existed = raw.delete(normalized);
            wrapped.delete(normalized);
            deleteKv.run(namespace, normalized);
            return existed;
        },
        clear() {
            database.prepare('DELETE FROM operational_kv WHERE namespace = ?').run(namespace);
            raw.clear();
            wrapped.clear();
        },
        keys: () => raw.keys(),
        values: function* () { for (const key of raw.keys()) yield wrap(key); },
        entries: function* () { for (const key of raw.keys()) yield [key, wrap(key)]; },
        [Symbol.iterator]: function* () { for (const key of raw.keys()) yield [key, wrap(key)]; },
    };
};

export const createPersistentList = namespace => {
    const row = database.prepare('SELECT value_json FROM operational_kv WHERE namespace = ? AND key = ?').get(namespace, '__list__');
    const target = Array.isArray(parseJson(row?.value_json, [])) ? parseJson(row?.value_json, []) : [];
    const persist = () => upsertKv.run(namespace, '__list__', serialize(target), now());
    return deepProxy(target, persist);
};

const recoverLeases = database.prepare(`
    UPDATE operational_queue
    SET status = 'queued', lease_owner = '', lease_until = 0, updated_at = ?
    WHERE status = 'leased' AND lease_until <= ?
`);
recoverLeases.run(now(), now());

export const enqueueOperationalWork = ({ kind, payload, dedupeKey, priority = 1, maxAttempts = 5 }) => {
    const existing = database.prepare('SELECT work_id, status FROM operational_queue WHERE dedupe_key = ?').get(dedupeKey);
    if (existing && ['queued', 'leased'].includes(existing.status)) {
        return { workId: existing.work_id, queued: false, alreadyScheduled: true };
    }
    const workId = existing?.work_id || randomUUID();
    const timestamp = now();
    database.prepare(`
        INSERT INTO operational_queue (
            work_id, dedupe_key, kind, payload_json, priority, status, attempts,
            max_attempts, available_at, lease_owner, lease_until, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, '', 0, '', ?, ?)
        ON CONFLICT(dedupe_key) DO UPDATE SET
            kind = excluded.kind,
            payload_json = excluded.payload_json,
            priority = excluded.priority,
            status = 'queued',
            attempts = 0,
            max_attempts = excluded.max_attempts,
            available_at = excluded.available_at,
            lease_owner = '',
            lease_until = 0,
            last_error = '',
            updated_at = excluded.updated_at
    `).run(workId, dedupeKey, kind, serialize(payload), priority, maxAttempts, timestamp, timestamp, timestamp);
    return { workId, queued: true, alreadyScheduled: false };
};

export const leaseNextOperationalWork = ({ owner, leaseMs = 60_000 } = {}) => {
    const timestamp = now();
    database.exec('BEGIN IMMEDIATE');
    try {
        recoverLeases.run(timestamp, timestamp);
        const row = database.prepare(`
            SELECT * FROM operational_queue
            WHERE status = 'queued' AND available_at <= ?
            ORDER BY priority ASC, created_at ASC
            LIMIT 1
        `).get(timestamp);
        if (!row) {
            database.exec('COMMIT');
            return null;
        }
        const leaseUntil = timestamp + Math.max(10_000, Number(leaseMs) || 60_000);
        database.prepare(`
            UPDATE operational_queue
            SET status = 'leased', lease_owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
            WHERE work_id = ?
        `).run(owner, leaseUntil, timestamp, row.work_id);
        database.exec('COMMIT');
        return {
            workId: row.work_id,
            dedupeKey: row.dedupe_key,
            kind: row.kind,
            payload: parseJson(row.payload_json, {}),
            attempts: row.attempts + 1,
            maxAttempts: row.max_attempts,
            leaseUntil,
        };
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
};

export const extendOperationalLease = (workId, owner, leaseMs = 60_000) => {
    const timestamp = now();
    const result = database.prepare(`
        UPDATE operational_queue SET lease_until = ?, updated_at = ?
        WHERE work_id = ? AND status = 'leased' AND lease_owner = ?
    `).run(timestamp + leaseMs, timestamp, workId, owner);
    return Number(result.changes || 0) > 0;
};

export const completeOperationalWork = (workId, owner) => database.prepare(`
    UPDATE operational_queue SET status = 'done', lease_owner = '', lease_until = 0, updated_at = ?
    WHERE work_id = ? AND lease_owner = ?
`).run(now(), workId, owner);

export const failOperationalWork = (work, owner, error) => {
    const exhausted = Number(work.attempts || 0) >= Number(work.maxAttempts || 5);
    const delayMs = Math.min(300_000, 2 ** Math.max(0, Number(work.attempts || 1) - 1) * 2_000);
    database.prepare(`
        UPDATE operational_queue
        SET status = ?, available_at = ?, lease_owner = '', lease_until = 0,
            last_error = ?, updated_at = ?
        WHERE work_id = ? AND lease_owner = ?
    `).run(exhausted ? 'failed' : 'queued', now() + delayMs, String(error?.message || error || '').slice(0, 4_000), now(), work.workId, owner);
    return { exhausted, retryAt: exhausted ? null : now() + delayMs };
};

export const cancelOperationalWork = dedupeKey => database.prepare(`
    UPDATE operational_queue SET status = 'cancelled', lease_owner = '', lease_until = 0, updated_at = ?
    WHERE dedupe_key = ? AND status IN ('queued', 'leased')
`).run(now(), dedupeKey);

export const purgeOperationalWorkForContext = ({ jobId = '', conversationId = '', requestId = '', messageIds = [] } = {}) => {
    const targetMessages = new Set(messageIds.map(String));
    const rows = database.prepare('SELECT work_id, payload_json FROM operational_queue').all();
    const remove = database.prepare('DELETE FROM operational_queue WHERE work_id = ?');
    let deleted = 0;
    for (const row of rows) {
        const payload = parseJson(row.payload_json, {});
        if ((jobId && payload.jobId === jobId)
            || (conversationId && payload.conversationId === conversationId)
            || (requestId && payload.requestId === requestId)
            || (targetMessages.size && targetMessages.has(String(payload.messageId || '')))) {
            remove.run(row.work_id);
            deleted += 1;
        }
    }
    return deleted;
};

export const listOperationalQueue = ({ limit = 100 } = {}) => database.prepare(`
    SELECT work_id, dedupe_key, kind, payload_json, priority, status, attempts,
           max_attempts, available_at, lease_until, last_error, created_at, updated_at
    FROM operational_queue
    WHERE status IN ('queued', 'leased', 'failed')
    ORDER BY priority ASC, created_at ASC
    LIMIT ?
`).all(Math.max(1, Math.min(Number(limit) || 100, 500))).map(row => ({
    workId: row.work_id,
    dedupeKey: row.dedupe_key,
    kind: row.kind,
    payload: parseJson(row.payload_json, {}),
    priority: row.priority,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    leaseUntil: row.lease_until,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
}));

export const operationalQueueStatus = () => {
    const rows = database.prepare(`SELECT status, COUNT(*) AS count FROM operational_queue GROUP BY status`).all();
    return Object.fromEntries(rows.map(row => [row.status, Number(row.count)]));
};

export const upsertSemanticDocument = document => database.prepare(`
    INSERT INTO semantic_documents (
        path, fingerprint, title, scope, agent, project_id, source, excerpt, vector_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
        fingerprint = excluded.fingerprint,
        title = excluded.title,
        scope = excluded.scope,
        agent = excluded.agent,
        project_id = excluded.project_id,
        source = excluded.source,
        excerpt = excluded.excerpt,
        vector_json = excluded.vector_json,
        updated_at = excluded.updated_at
`).run(document.path, document.fingerprint, document.title, document.scope, document.agent || '', document.projectId || '', document.source || '', document.excerpt, serialize(document.vector), now());

export const listSemanticDocuments = () => database.prepare('SELECT * FROM semantic_documents').all().map(row => ({
    path: row.path,
    fingerprint: row.fingerprint,
    title: row.title,
    scope: row.scope,
    agent: row.agent,
    projectId: row.project_id,
    source: row.source,
    excerpt: row.excerpt,
    vector: parseJson(row.vector_json, []),
    updatedAt: row.updated_at,
}));

export const removeSemanticDocumentsExcept = paths => {
    const keep = new Set(paths);
    const rows = database.prepare('SELECT path FROM semantic_documents').all();
    const remove = database.prepare('DELETE FROM semantic_documents WHERE path = ?');
    rows.filter(row => !keep.has(row.path)).forEach(row => remove.run(row.path));
};

export const recordModelRouteMetric = metric => database.prepare(`
    INSERT INTO model_route_metrics (
        metric_id, task_class, agent_id, provider, model, success,
        fallback_used, duration_ms, error_class, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(randomUUID(), metric.taskClass, metric.agentId, metric.provider, metric.model, metric.success ? 1 : 0, metric.fallbackUsed ? 1 : 0, Math.max(0, Number(metric.durationMs || 0)), metric.errorClass || '', now());

export const operationalStoreStatus = () => ({
    databasePath,
    queue: operationalQueueStatus(),
    semanticDocuments: Number(database.prepare('SELECT COUNT(*) AS count FROM semantic_documents').get().count),
    modelRouteMetrics: Number(database.prepare('SELECT COUNT(*) AS count FROM model_route_metrics').get().count),
});
