import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanTags, ensureVault, getVaultPath, invalidateIndex, slugify } from './memoryCore.mjs';
import { listKnowledgeSources } from './knowledgeLifecycle.mjs';

const now = () => new Date().toISOString();
const safeProjectId = value => {
    const id = String(value || '').trim();
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw Object.assign(new Error('A safe projectId is required.'), { statusCode: 400 });
    return id;
};
const safeCategory = value => String(value || 'Reference').trim().replace(/[^A-Za-z0-9 _-]+/g, '').replace(/\s+/g, '-').slice(0, 80) || 'Reference';
const json = value => JSON.stringify(value ?? '');
const frontmatter = meta => [
    '---',
    `id: ${json(meta.id)}`,
    `title: ${json(meta.title)}`,
    `scope: ${json(meta.scope)}`,
    `lifecycle: ${json(meta.lifecycle)}`,
    `projectId: ${json(meta.projectId || '')}`,
    `sourceId: ${json(meta.sourceId || '')}`,
    `authority: ${json(meta.authority)}`,
    `status: ${json(meta.status)}`,
    `tags: ${JSON.stringify(cleanTags(meta.tags))}`,
    `source: ${json(meta.source || meta.sourceId || '')}`,
    `created: ${json(meta.created)}`,
    `updated: ${json(meta.updated)}`,
    `expiresAt: ${json(meta.expiresAt || '')}`,
    '---', '',
].join('\n');
const ensureInsideVault = relative => {
    const root = path.resolve(getVaultPath());
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(`${root}${path.sep}`)) throw Object.assign(new Error('Knowledge path escapes the vault.'), { statusCode: 400 });
    return absolute;
};
const writeAtomic = async (relative, content) => {
    const target = ensureInsideVault(relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, target);
    invalidateIndex();
};
const sourceFor = async sourceId => {
    const id = String(sourceId || '').trim();
    if (!id) return null;
    return (await listKnowledgeSources({})).find(item => item.sourceId === id) || null;
};

export const writeDerivedKnowledge = async ({
    agentId = 'iris', title, content, lifecycle = 'project', projectId = '', sourceId = '',
    authority = 'reference', category = 'Reference', tags = [], status = 'active', expiresAt = '',
} = {}) => {
    await ensureVault();
    const cleanTitle = String(title || '').trim().slice(0, 240);
    const cleanContent = String(content || '').trim();
    if (!cleanTitle || !cleanContent) throw Object.assign(new Error('Knowledge title and content are required.'), { statusCode: 400 });
    if (!['project', 'universal'].includes(lifecycle)) throw Object.assign(new Error('Derived persistent knowledge must be project or universal.'), { statusCode: 400 });
    if (!['authoritative', 'reference', 'historical', 'experimental'].includes(authority)) throw Object.assign(new Error('Invalid knowledge authority.'), { statusCode: 400 });
    if (!['active', 'stale', 'superseded', 'retiring'].includes(status)) throw Object.assign(new Error('Invalid knowledge status.'), { statusCode: 400 });

    const source = await sourceFor(sourceId);
    if (sourceId && !source) throw Object.assign(new Error('Knowledge source is not registered.'), { statusCode: 404 });
    if (source && source.lifecycle === 'session') throw Object.assign(new Error('Session sources cannot directly produce persistent knowledge. Promote/register the source scope first.'), { statusCode: 409 });

    let actualProjectId = '';
    let scope = 'shared';
    let relative;
    let proposal = false;
    if (lifecycle === 'project') {
        actualProjectId = safeProjectId(projectId || source?.projectId);
        if (source && (source.lifecycle !== 'project' || source.projectId !== actualProjectId)) {
            throw Object.assign(new Error('Source lifecycle/project does not match the requested project knowledge scope.'), { statusCode: 409 });
        }
        scope = `project:${actualProjectId}`;
        relative = `25-Projects/${actualProjectId}/Knowledge/${slugify(cleanTitle)}.md`;
    } else if (agentId === 'nora') {
        relative = `10-Shared/${safeCategory(category)}/${slugify(cleanTitle)}.md`;
    } else {
        proposal = true;
        scope = 'inbox';
        relative = `00-Inbox/Knowledge/${slugify(cleanTitle)}-${randomUUID().slice(0, 8)}.md`;
    }

    const created = now();
    const meta = {
        id: randomUUID(), title: cleanTitle, scope, lifecycle,
        projectId: actualProjectId, sourceId, authority,
        status: proposal ? 'proposed' : status,
        tags: [...tags, 'knowledge', lifecycle, ...(actualProjectId ? [actualProjectId] : [])],
        source: source?.name || sourceId, created, updated: created, expiresAt,
    };
    const body = `${frontmatter(meta)}# ${cleanTitle}\n\n${cleanContent}\n\n## Provenance\n\n- Source ID: ${sourceId || 'not registered'}\n- Source: ${source?.name || 'manual / not registered'}\n- Authority: ${authority}\n- Lifecycle: ${lifecycle}\n${actualProjectId ? `- Project: ${actualProjectId}\n` : ''}- Prepared by: ${agentId}\n`;
    await writeAtomic(relative, body);
    return { path: relative, title: cleanTitle, lifecycle, projectId: actualProjectId, authority, status: meta.status, proposal };
};

export const promoteKnowledgeProposal = async ({ path: proposalPath, category = 'Reference' } = {}) => {
    await ensureVault();
    const relative = String(proposalPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!relative.startsWith('00-Inbox/Knowledge/') || !relative.endsWith('.md')) {
        throw Object.assign(new Error('Only knowledge proposals from 00-Inbox/Knowledge may be promoted.'), { statusCode: 400 });
    }
    const source = ensureInsideVault(relative);
    let raw;
    try { raw = await fs.readFile(source, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') throw Object.assign(new Error('Knowledge proposal not found.'), { statusCode: 404 }); throw error; }
    const title = raw.match(/^title:\s*(.+)$/m)?.[1];
    let parsedTitle = path.basename(relative, '.md');
    if (title) {
        try { parsedTitle = JSON.parse(title); } catch { parsedTitle = title.replace(/^['"]|['"]$/g, ''); }
    }
    const targetRelative = `10-Shared/${safeCategory(category)}/${slugify(parsedTitle)}.md`;
    const updated = raw
        .replace(/^scope:\s*.*$/m, 'scope: "shared"')
        .replace(/^status:\s*.*$/m, 'status: "active"')
        .replace(/^updated:\s*.*$/m, `updated: ${json(now())}`);
    await writeAtomic(targetRelative, updated);
    await fs.rm(source, { force: true });
    invalidateIndex();
    return { path: targetRelative, promotedFrom: relative, title: parsedTitle, status: 'active' };
};
