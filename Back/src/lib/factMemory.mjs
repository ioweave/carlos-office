import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureVault, getVaultPath, invalidateIndex } from './memoryCore.mjs';

const FILE = '10-Knowledge/Facts.md';
const maxFacts = Math.max(100, Math.min(Number(process.env.MAX_REMEMBERED_FACTS || 2000), 10000));
const block = value => `<!-- carlos-office-facts\n${Buffer.from(JSON.stringify(value)).toString('base64')}\n-->`;
const unblock = raw => {
    const found = String(raw || '').match(/<!-- carlos-office-facts\s+([A-Za-z0-9+/=\s]+?)\s+-->/);
    if (!found) return [];
    try { return JSON.parse(Buffer.from(found[1].replace(/\s+/g, ''), 'base64').toString()); } catch { return []; }
};
const full = () => path.join(getVaultPath(), FILE);
const now = () => new Date().toISOString();
const tokenize = value => [...new Set(String(value || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) || [])].slice(0, 30);

const normalize = value => ({
    factId: String(value?.factId || randomUUID()),
    subject: String(value?.subject || '').trim().slice(0, 160),
    statement: String(value?.statement || '').trim().slice(0, 4000),
    scope: ['universal', 'project', 'agent'].includes(value?.scope) ? value.scope : 'universal',
    projectId: String(value?.projectId || '').trim().slice(0, 120),
    agentId: String(value?.agentId || '').trim().slice(0, 40),
    confidence: ['confirmed', 'high', 'medium', 'low'].includes(value?.confidence) ? value.confidence : 'medium',
    source: String(value?.source || '').trim().slice(0, 500),
    importance: ['critical', 'high', 'normal', 'low'].includes(value?.importance) ? value.importance : 'normal',
    status: ['active', 'stale', 'superseded'].includes(value?.status) ? value.status : 'active',
    createdAt: value?.createdAt || now(),
    updatedAt: value?.updatedAt || now(),
    lastUsedAt: value?.lastUsedAt || null,
    useCount: Math.max(0, Number(value?.useCount || 0)),
    expiresAt: value?.expiresAt || null,
    supersededBy: String(value?.supersededBy || '').trim(),
    pinned: Boolean(value?.pinned),
});

const render = facts => `---\ntitle: "Remembered Facts"\nscope: "system-memory"\ntags: ["facts", "memory", "compact"]\nsource: "Carlos Office"\n---\n\n# Remembered Facts\n\nCompact semantic facts retained because they may be useful later. This is not a conversation archive.\n\n${facts.filter(item => item.status === 'active').slice(0, 200).map(item => `- **${item.subject || 'Fact'}:** ${item.statement}`).join('\n') || '_No remembered facts._'}\n\n${block(facts)}\n`;

const readAll = async () => {
    await ensureVault();
    try { return unblock(await fs.readFile(full(), 'utf8')).map(normalize); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};
const writeAll = async facts => {
    await fs.mkdir(path.dirname(full()), { recursive: true });
    const target = full();
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, render(facts.slice(0, maxFacts)), 'utf8');
    await fs.rename(temporary, target);
    invalidateIndex();
};

export const listFacts = async ({ scope = '', projectId = '', agentId = '', status = 'active', limit = 100 } = {}) => {
    const facts = await readAll();
    return facts.filter(item => (!scope || item.scope === scope)
        && (!projectId || item.projectId === projectId)
        && (!agentId || item.agentId === agentId)
        && (!status || item.status === status))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, Math.max(1, Math.min(Number(limit) || 100, 500)));
};

export const rememberFact = async value => {
    const next = normalize(value);
    if (!next.subject || !next.statement) throw Object.assign(new Error('Fact subject and statement are required.'), { statusCode: 400 });
    const facts = await readAll();
    const duplicate = facts.find(item => item.status === 'active'
        && item.scope === next.scope
        && item.projectId === next.projectId
        && item.subject.toLowerCase() === next.subject.toLowerCase()
        && item.statement.toLowerCase() === next.statement.toLowerCase());
    if (duplicate) return duplicate;
    facts.unshift(next);
    await writeAll(facts);
    return next;
};

export const updateFact = async (factId, update = {}) => {
    const facts = await readAll();
    const index = facts.findIndex(item => item.factId === factId);
    if (index === -1) throw Object.assign(new Error('Remembered fact not found.'), { statusCode: 404 });
    facts[index] = normalize({ ...facts[index], ...update, factId: facts[index].factId, createdAt: facts[index].createdAt, updatedAt: now() });
    await writeAll(facts);
    return facts[index];
};

export const forgetFact = async factId => {
    const facts = await readAll();
    const next = facts.filter(item => item.factId !== factId);
    if (next.length === facts.length) throw Object.assign(new Error('Remembered fact not found.'), { statusCode: 404 });
    await writeAll(next);
    return { factId, deleted: true };
};

export const searchFacts = async ({ query = '', projectId = '', agentId = '', limit = 6, touch = false } = {}) => {
    const phrase = String(query || '').trim().toLowerCase();
    const tokens = tokenize(query);
    if (!phrase) return [];
    const facts = await readAll();
    const nowMs = Date.now();
    const scored = facts.filter(item => item.status === 'active')
        .filter(item => !item.expiresAt || new Date(item.expiresAt).getTime() > nowMs)
        .filter(item => item.scope === 'universal' || (item.scope === 'project' && projectId && item.projectId === projectId) || (item.scope === 'agent' && agentId && item.agentId === agentId))
        .map(item => {
            const haystack = `${item.subject} ${item.statement} ${item.source}`.toLowerCase();
            let score = haystack.includes(phrase) ? 18 : 0;
            tokens.forEach(token => { if (haystack.includes(token)) score += 4; });
            if (item.importance === 'critical') score += 6;
            else if (item.importance === 'high') score += 3;
            if (item.pinned) score += 8;
            return { item, score };
        }).filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(1, Math.min(Number(limit) || 6, 20)));
    if (touch && scored.length) {
        const selected = new Set(scored.map(entry => entry.item.factId));
        const updated = facts.map(item => selected.has(item.factId) ? { ...item, lastUsedAt: now(), useCount: item.useCount + 1 } : item);
        await writeAll(updated);
    }
    return scored.map(entry => entry.item);
};

export const factMemoryStatus = async () => ({ count: (await readAll()).length, path: FILE, maxFacts });
