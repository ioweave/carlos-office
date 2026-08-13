import { randomUUID } from 'node:crypto';
import { enqueueOperationalWork, getOperationalDatabase } from './operationalStore.mjs';

const database = getOperationalDatabase();
database.exec(`
    CREATE TABLE IF NOT EXISTS office_schedules (
        schedule_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        schedule_json TEXT NOT NULL,
        delivery_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        next_run_at INTEGER NOT NULL,
        last_run_at INTEGER NOT NULL DEFAULT 0,
        last_status TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS office_schedules_due
        ON office_schedules (enabled, next_run_at);
`);

const parse = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const boundedText = (value, limit, label) => {
    const text = String(value || '').trim();
    if (!text) throw Object.assign(new Error(`${label} is required.`), { statusCode: 400 });
    return text.slice(0, limit);
};
const timeParts = (timestamp, timeZone) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, minute: '2-digit', hour: '2-digit', hourCycle: 'h23',
        day: '2-digit', month: '2-digit', weekday: 'short', year: 'numeric',
    }).formatToParts(new Date(timestamp));
    const get = type => parts.find(item => item.type === type)?.value;
    return {
        minute: Number(get('minute')), hour: Number(get('hour')), day: Number(get('day')),
        month: Number(get('month')), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    };
};
const fieldMatches = (field, value, min, max) => String(field).split(',').some(part => {
    const [range, stepRaw] = part.split('/');
    const step = Math.max(1, Number(stepRaw || 1));
    const [startRaw, endRaw] = range === '*' ? [min, max] : range.includes('-') ? range.split('-').map(Number) : [Number(range), Number(range)];
    if (![startRaw, endRaw].every(Number.isFinite) || startRaw < min || endRaw > max || startRaw > endRaw) return false;
    return value >= startRaw && value <= endRaw && (value - startRaw) % step === 0;
});
const cronMatches = (expression, timestamp, timeZone) => {
    const fields = String(expression || '').trim().split(/\s+/);
    if (fields.length !== 5) throw Object.assign(new Error('Cron expressions require five fields: minute hour day month weekday.'), { statusCode: 400 });
    const value = timeParts(timestamp, timeZone);
    const dayOfMonth = fieldMatches(fields[2], value.day, 1, 31);
    const weekday = fieldMatches(fields[4], value.weekday, 0, 7)
        || (value.weekday === 0 && fieldMatches(fields[4], 7, 0, 7));
    const dayMatches = fields[2] === '*' || fields[4] === '*'
        ? dayOfMonth && weekday
        : dayOfMonth || weekday;
    return fieldMatches(fields[0], value.minute, 0, 59)
        && fieldMatches(fields[1], value.hour, 0, 23)
        && fieldMatches(fields[3], value.month, 1, 12)
        && dayMatches;
};

export const nextRunFor = (schedule, after = Date.now()) => {
    const kind = String(schedule?.kind || 'once');
    if (kind === 'once') {
        const at = new Date(schedule.at).getTime();
        if (!Number.isFinite(at)) throw Object.assign(new Error('A valid ISO date is required for a one-time schedule.'), { statusCode: 400 });
        if (at <= after) throw Object.assign(new Error('One-time schedules must be in the future.'), { statusCode: 400 });
        return at;
    }
    if (kind === 'interval') {
        const everyMinutes = Math.max(1, Math.min(Number(schedule.everyMinutes || 60), 525_600));
        return after + everyMinutes * 60_000;
    }
    if (kind === 'cron') {
        const timeZone = String(schedule.timeZone || process.env.MEMORY_TIME_ZONE || 'America/Guayaquil');
        new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
        let cursor = Math.floor(after / 60_000) * 60_000 + 60_000;
        const deadline = cursor + 366 * 24 * 60 * 60_000;
        while (cursor <= deadline) {
            if (cronMatches(schedule.expression, cursor, timeZone)) return cursor;
            cursor += 60_000;
        }
        throw Object.assign(new Error('Cron expression has no occurrence within the next year.'), { statusCode: 400 });
    }
    throw Object.assign(new Error('Schedule kind must be once, interval, or cron.'), { statusCode: 400 });
};

const rowToSchedule = row => ({
    scheduleId: row.schedule_id, name: row.name, prompt: row.prompt,
    schedule: parse(row.schedule_json, {}), delivery: parse(row.delivery_json, {}),
    enabled: Boolean(row.enabled), nextRunAt: row.next_run_at ? new Date(row.next_run_at).toISOString() : null,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    lastStatus: row.last_status, lastError: row.last_error,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
});
const normalizeDelivery = value => {
    const channel = String(value?.channel || 'none').toLowerCase();
    if (!['none', 'telegram', 'whatsapp', 'email', 'slack', 'discord', 'webhook'].includes(channel)) throw Object.assign(new Error('Unsupported schedule delivery channel.'), { statusCode: 400 });
    const destination = String(value?.destination || '').trim();
    if (channel !== 'none' && !destination) throw Object.assign(new Error('A delivery destination is required.'), { statusCode: 400 });
    return { channel, destination: destination.slice(0, 160) };
};

export const createSchedule = ({ name, prompt, schedule, delivery, enabled = true } = {}) => {
    const timestamp = Date.now();
    const normalizedSchedule = { ...(schedule || {}) };
    const nextRunAt = nextRunFor(normalizedSchedule, timestamp - 1);
    const item = {
        scheduleId: randomUUID(), name: boundedText(name, 120, 'Schedule name'), prompt: boundedText(prompt, 20_000, 'Schedule prompt'),
        schedule: normalizedSchedule, delivery: normalizeDelivery(delivery), enabled: Boolean(enabled), nextRunAt,
    };
    database.prepare(`
        INSERT INTO office_schedules (
            schedule_id, name, prompt, schedule_json, delivery_json, enabled,
            next_run_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(item.scheduleId, item.name, item.prompt, JSON.stringify(item.schedule), JSON.stringify(item.delivery), item.enabled ? 1 : 0, item.nextRunAt, timestamp, timestamp);
    return getSchedule(item.scheduleId);
};

export const getSchedule = scheduleId => {
    const row = database.prepare('SELECT * FROM office_schedules WHERE schedule_id = ?').get(String(scheduleId || ''));
    return row ? rowToSchedule(row) : null;
};
export const listSchedules = () => database.prepare('SELECT * FROM office_schedules ORDER BY created_at DESC').all().map(rowToSchedule);
export const updateSchedule = (scheduleId, update = {}) => {
    const current = getSchedule(scheduleId);
    if (!current) throw Object.assign(new Error('Schedule not found.'), { statusCode: 404 });
    const schedule = update.schedule ? { ...update.schedule } : current.schedule;
    const enabled = update.enabled === undefined ? current.enabled : Boolean(update.enabled);
    const nextRunAt = enabled ? nextRunFor(schedule, Date.now() - 1) : 0;
    database.prepare(`
        UPDATE office_schedules SET name = ?, prompt = ?, schedule_json = ?, delivery_json = ?,
            enabled = ?, next_run_at = ?, updated_at = ? WHERE schedule_id = ?
    `).run(
        update.name === undefined ? current.name : boundedText(update.name, 120, 'Schedule name'),
        update.prompt === undefined ? current.prompt : boundedText(update.prompt, 20_000, 'Schedule prompt'),
        JSON.stringify(schedule), JSON.stringify(update.delivery ? normalizeDelivery(update.delivery) : current.delivery),
        enabled ? 1 : 0, nextRunAt, Date.now(), scheduleId,
    );
    return getSchedule(scheduleId);
};
export const deleteSchedule = scheduleId => ({
    scheduleId,
    deleted: Number(database.prepare('DELETE FROM office_schedules WHERE schedule_id = ?').run(String(scheduleId || '')).changes || 0) > 0,
});

const dueSchedules = () => {
    const timestamp = Date.now();
    const due = database.prepare('SELECT * FROM office_schedules WHERE enabled = 1 AND next_run_at > 0 AND next_run_at <= ? ORDER BY next_run_at LIMIT 20').all(timestamp);
    return due.map(row => ({ ...rowToSchedule(row), dueAt: row.next_run_at, timestamp }));
};

export const pollSchedules = () => {
    const queued = [];
    for (const item of dueSchedules()) {
        const dueAt = item.dueAt;
        const scheduled = enqueueOperationalWork({
            kind: 'scheduled-request',
            payload: {
                scheduleId: item.scheduleId, prompt: item.prompt, delivery: item.delivery,
                conversationId: `schedule-${item.scheduleId}`, dueAt,
            },
            dedupeKey: `schedule:${item.scheduleId}:${dueAt}`,
            priority: 1,
            maxAttempts: 5,
        });
        // Advance only after the durable queue accepts the occurrence. A crash before
        // this update merely replays the same deduplicated enqueue on the next poll.
        const nextRunAt = item.schedule.kind === 'once' ? 0 : nextRunFor(item.schedule, Math.max(item.timestamp, dueAt));
        const enabled = item.schedule.kind === 'once' ? 0 : 1;
        const result = database.prepare(`
            UPDATE office_schedules SET enabled = ?, next_run_at = ?, last_run_at = ?, last_status = 'queued',
                last_error = '', updated_at = ? WHERE schedule_id = ? AND next_run_at = ?
        `).run(enabled, nextRunAt, item.timestamp, item.timestamp, item.scheduleId, dueAt);
        if (Number(result.changes || 0)) queued.push(scheduled);
    }
    return queued;
};

export const markScheduleResult = (scheduleId, { status, error = '' } = {}) => {
    database.prepare('UPDATE office_schedules SET last_status = ?, last_error = ?, updated_at = ? WHERE schedule_id = ?')
        .run(String(status || ''), String(error || '').slice(0, 2_000), Date.now(), String(scheduleId || ''));
};

let timer = null;
export const startScheduleManager = () => {
    if (timer) return scheduleManagerStatus();
    pollSchedules();
    timer = setInterval(pollSchedules, Math.max(5_000, Number(process.env.SCHEDULE_POLL_MS || 15_000)));
    timer.unref?.();
    return scheduleManagerStatus();
};
export const stopScheduleManager = () => { if (timer) clearInterval(timer); timer = null; };
export const scheduleManagerStatus = () => ({ running: Boolean(timer), schedules: listSchedules().length, enabled: listSchedules().filter(item => item.enabled).length });
