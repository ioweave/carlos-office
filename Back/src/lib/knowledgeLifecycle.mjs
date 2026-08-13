import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureVault, getVaultPath, invalidateIndex, parseFrontmatter } from './memoryCore.mjs';

const REGISTRY = '70-Knowledge-Sources/Registry.md';
const DIRECTIVES = '90-System/Runtime/Retention/Directives.md';
const sessionSources = new Map();
const sessionTtlMs = Math.max(60_000, Number(process.env.TEMP_SOURCE_TTL_MS || 86_400_000));
const sourceBlock = value => `<!-- carlos-office-knowledge-sources\n${Buffer.from(JSON.stringify(value)).toString('base64')}\n-->`;
const directiveBlock = value => `<!-- carlos-office-retention-directives\n${Buffer.from(JSON.stringify(value)).toString('base64')}\n-->`;
const decodeBlock = (raw, name) => {
    const found = String(raw || '').match(new RegExp(`<!-- carlos-office-${name}\\s+([A-Za-z0-9+/=\\s]+?)\\s+-->`));
    if (!found) return [];
    try { return JSON.parse(Buffer.from(found[1].replace(/\s+/g, ''), 'base64').toString()); } catch { return []; }
};
const now = () => new Date().toISOString();
const safeId = value => String(value || '').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || randomUUID();
const full = relative => path.join(getVaultPath(), relative);

const normalizeSource = value => ({
    sourceId: safeId(value?.sourceId || value?.name),
    name: String(value?.name || 'Knowledge source').trim().slice(0, 200),
    description: String(value?.description || '').trim().slice(0, 2000),
    lifecycle: ['session', 'project', 'universal'].includes(value?.lifecycle) ? value.lifecycle : 'project',
    type: ['upload', 'directory', 'google-drive', 'web', 'github', 'manual'].includes(value?.type) ? value.type : 'manual',
    locator: String(value?.locator || '').trim().slice(0, 4000),
    projectId: String(value?.projectId || '').trim().slice(0, 120),
    authority: ['authoritative', 'reference', 'historical', 'experimental'].includes(value?.authority) ? value.authority : 'reference',
    status: ['active', 'stale', 'retiring', 'retired'].includes(value?.status) ? value.status : 'active',
    refresh: String(value?.refresh || 'manual').trim().slice(0, 120),
    topics: [...new Set((Array.isArray(value?.topics) ? value.topics : []).map(item => String(item).trim().toLowerCase()).filter(Boolean))].slice(0, 30),
    createdAt: value?.createdAt || now(),
    updatedAt: value?.updatedAt || now(),
    lastIngestedAt: value?.lastIngestedAt || null,
    expiresAt: value?.expiresAt || null,
    managedCopy: Boolean(value?.managedCopy),
});

const readRegistry = async () => {
    await ensureVault();
    try { return decodeBlock(await fs.readFile(full(REGISTRY), 'utf8'), 'knowledge-sources').map(normalizeSource); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};
const writeRegistry = async sources => {
    const target = full(REGISTRY);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const content = `---\ntitle: "Knowledge Source Registry"\nscope: "system"\ntags: ["knowledge", "sources", "retention"]\n---\n\n# Knowledge Source Registry\n\nPersistent project and universal source definitions. Session sources are intentionally not stored here.\n\n${sources.map(item => `- **${item.name}** — ${item.lifecycle} · ${item.type} · ${item.status}${item.projectId ? ` · project ${item.projectId}` : ''}`).join('\n') || '_No persistent sources registered._'}\n\n${sourceBlock(sources)}\n`;
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, target);
    invalidateIndex();
};

export const cleanupSessionSources = () => {
    const cutoff = Date.now() - sessionTtlMs;
    let removed = 0;
    for (const [sourceId, item] of sessionSources.entries()) {
        if (new Date(item.updatedAt).getTime() >= cutoff) continue;
        sessionSources.delete(sourceId);
        removed += 1;
    }
    return removed;
};

export const registerKnowledgeSource = async value => {
    const source = normalizeSource(value);
    if (source.lifecycle === 'project' && !source.projectId) throw Object.assign(new Error('Project knowledge sources require projectId.'), { statusCode: 400 });
    if (source.lifecycle === 'session') {
        cleanupSessionSources();
        sessionSources.set(source.sourceId, source);
        return { ...source, persisted: false };
    }
    const sources = await readRegistry();
    const index = sources.findIndex(item => item.sourceId === source.sourceId);
    if (index >= 0) sources[index] = { ...sources[index], ...source, createdAt: sources[index].createdAt, updatedAt: now() };
    else sources.push(source);
    await writeRegistry(sources);
    return { ...source, persisted: true };
};

export const listKnowledgeSources = async ({ lifecycle = '', projectId = '', status = '' } = {}) => {
    cleanupSessionSources();
    const persistent = await readRegistry();
    return [...sessionSources.values(), ...persistent]
        .filter(item => !lifecycle || item.lifecycle === lifecycle)
        .filter(item => !projectId || item.projectId === projectId)
        .filter(item => !status || item.status === status)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
};

export const updateKnowledgeSource = async (sourceId, update = {}) => {
    const id = safeId(sourceId);
    if (sessionSources.has(id)) {
        const next = normalizeSource({ ...sessionSources.get(id), ...update, sourceId: id, createdAt: sessionSources.get(id).createdAt, updatedAt: now() });
        sessionSources.set(id, next);
        return { ...next, persisted: false };
    }
    const sources = await readRegistry();
    const index = sources.findIndex(item => item.sourceId === id);
    if (index === -1) throw Object.assign(new Error('Knowledge source not found.'), { statusCode: 404 });
    sources[index] = normalizeSource({ ...sources[index], ...update, sourceId: id, createdAt: sources[index].createdAt, updatedAt: now() });
    await writeRegistry(sources);
    return { ...sources[index], persisted: true };
};

export const removeKnowledgeSource = async sourceId => {
    const id = safeId(sourceId);
    if (sessionSources.delete(id)) return { sourceId: id, deleted: true, persisted: false };
    const sources = await readRegistry();
    const next = sources.filter(item => item.sourceId !== id);
    if (next.length === sources.length) throw Object.assign(new Error('Knowledge source not found.'), { statusCode: 404 });
    await writeRegistry(next);
    return { sourceId: id, deleted: true, persisted: true };
};

const allowedKnowledgePath = relative => {
    const value = String(relative || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const allowed = value.startsWith('10-Shared/') || value.startsWith('20-Agents/') || value.startsWith('25-Projects/');
    if (!allowed || !value.toLowerCase().endsWith('.md')) throw Object.assign(new Error('Retention directives may only target curated knowledge Markdown.'), { statusCode: 400 });
    const absolute = path.resolve(getVaultPath(), value);
    const root = path.resolve(getVaultPath());
    if (!absolute.startsWith(`${root}${path.sep}`)) throw Object.assign(new Error('Knowledge path escapes the vault.'), { statusCode: 400 });
    return { relative: value, absolute };
};

const readDirectives = async () => {
    try { return decodeBlock(await fs.readFile(full(DIRECTIVES), 'utf8'), 'retention-directives'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};
const writeDirectives = async directives => {
    const target = full(DIRECTIVES);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const content = `---\ntitle: "Retention Directives"\nscope: "runtime"\ntags: ["retention", "knowledge"]\n---\n\n# Retention Directives\n\nNora-approved knowledge maintenance instructions for Iris.\n\n${directives.map(item => `- ${item.directiveId} — ${item.action} ${item.path} — ${item.status}`).join('\n') || '_No directives._'}\n\n${directiveBlock(directives)}\n`;
    await fs.writeFile(target, content, 'utf8');
};

export const createRetentionDirective = async ({ path: notePath, action = 'archive', reason = '' } = {}) => {
    const target = allowedKnowledgePath(notePath);
    if (!['archive', 'delete'].includes(action)) throw Object.assign(new Error('Retention action must be archive or delete.'), { statusCode: 400 });
    const directives = await readDirectives();
    const directive = {
        directiveId: randomUUID(), path: target.relative, action,
        reason: String(reason || '').trim().slice(0, 2000), status: 'approved',
        createdBy: 'nora', createdAt: now(), executedAt: null,
    };
    directives.unshift(directive);
    await writeDirectives(directives.slice(0, 500));
    return directive;
};

export const executeRetentionDirective = async directiveId => {
    const directives = await readDirectives();
    const index = directives.findIndex(item => item.directiveId === directiveId);
    if (index === -1) throw Object.assign(new Error('Retention directive not found.'), { statusCode: 404 });
    const directive = directives[index];
    if (directive.createdBy !== 'nora' || directive.status !== 'approved') throw Object.assign(new Error('Retention directive is not approved for execution.'), { statusCode: 403 });
    const target = allowedKnowledgePath(directive.path);
    if (directive.action === 'delete') {
        await fs.rm(target.absolute, { force: true });
    } else {
        const archive = path.join(getVaultPath(), '90-System', 'Archive', 'Knowledge', target.relative);
        await fs.mkdir(path.dirname(archive), { recursive: true });
        try { await fs.rename(target.absolute, archive); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    directives[index] = { ...directive, status: 'executed', executedAt: now() };
    await writeDirectives(directives);
    invalidateIndex();
    return directives[index];
};

export const scanKnowledgeRetention = async () => {
    await ensureVault();
    const roots = ['10-Shared', '20-Agents', '25-Projects'];
    const candidates = [];
    const nowMs = Date.now();
    const walk = async directory => {
        let entries = [];
        try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) await walk(absolute);
            else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
                try {
                    const raw = await fs.readFile(absolute, 'utf8');
                    const parsed = parseFrontmatter(raw).data;
                    const relative = path.relative(getVaultPath(), absolute).split(path.sep).join('/');
                    const expiresAt = parsed.expiresAt || parsed.expires || null;
                    const status = String(parsed.status || '').toLowerCase();
                    if (['stale', 'superseded', 'retiring'].includes(status) || (expiresAt && new Date(expiresAt).getTime() <= nowMs)) {
                        candidates.push({ path: relative, title: parsed.title || entry.name.replace(/\.md$/i, ''), status: status || 'expired', expiresAt });
                    }
                } catch {}
            }
        }
    };
    for (const root of roots) await walk(full(root));
    return { candidates, count: candidates.length };
};

export const knowledgeLifecycleStatus = async () => ({
    persistentSources: (await readRegistry()).length,
    sessionSources: sessionSources.size,
    sessionTtlMs,
    registryPath: REGISTRY,
});
