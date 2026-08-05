import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
    AGENT_NAMES, MEMORY_TIME_ZONE, availableCreatePath, ensureVault, getVaultPath,
    invalidateIndex, makeFrontmatter, normalizeAgent, parseFrontmatter, readMemory,
    safeAbsolutePath, slugify, toUnixPath,
} from './memoryCore.mjs';

let journalQueue = Promise.resolve();

export const writeMemory = async ({
    agentId = 'nora', title, content, scope = 'agent', tags = [], source = '',
    path: notePath = '', mode = 'create',
} = {}) => {
    const normalizedAgent = normalizeAgent(agentId);
    const agentName = AGENT_NAMES[normalizedAgent];
    const cleanTitle = String(title || '').trim();
    const cleanContent = String(content || '').trim();
    if (!cleanTitle || !cleanContent) throw Object.assign(new Error('Memory title and content are required.'), { statusCode: 400 });
    if (!['create', 'append', 'replace'].includes(mode)) throw Object.assign(new Error('Invalid memory write mode.'), { statusCode: 400 });

    await ensureVault();
    let actualScope = ['shared', 'agent', 'inbox'].includes(scope) ? scope : 'agent';
    if (actualScope === 'shared' && normalizedAgent !== 'nora') actualScope = 'inbox';
    const folder = actualScope === 'shared' ? '10-Shared' : actualScope === 'inbox'
        ? '00-Inbox' : `20-Agents/${agentName}`;
    let absolutePath = notePath ? safeAbsolutePath(notePath)
        : path.join(getVaultPath(), folder, `${slugify(cleanTitle)}.md`);
    if (!notePath && mode === 'create') absolutePath = await availableCreatePath(absolutePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    let existing = '';
    try { existing = await fs.readFile(absolutePath, 'utf8'); } catch {}
    if (notePath && mode === 'create' && existing) throw Object.assign(
        new Error('Use append or replace when a memory path already exists.'), { statusCode: 409 });
    const parsed = parseFrontmatter(existing);
    const relativePath = toUnixPath(path.relative(getVaultPath(), absolutePath));
    if (relativePath.startsWith('10-Shared/')) actualScope = 'shared';
    else if (relativePath.startsWith('00-Inbox/')) actualScope = 'inbox';
    else if (relativePath.startsWith('20-Agents/')) actualScope = 'agent';
    else if (parsed.data.scope) actualScope = parsed.data.scope;
    if (normalizedAgent !== 'nora' && relativePath.startsWith('10-Shared/')) throw Object.assign(
        new Error('Only Nora may replace curated shared memory. Workers can submit notes to the inbox.'), { statusCode: 403 });

    const now = new Date().toISOString();
    const output = existing && mode === 'append'
        ? `${existing.trimEnd()}\n\n## Update — ${now}\n\n${cleanContent}\n`
        : `${makeFrontmatter({
            id: parsed.data.id || crypto.randomUUID(), title: cleanTitle, scope: actualScope,
            agent: parsed.data.agent || agentName, tags, source,
            created: parsed.data.created || now, updated: now,
        })}# ${cleanTitle}\n\n${cleanContent}\n`;
    const temporary = `${absolutePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, output, 'utf8');
    await fs.rename(temporary, absolutePath);
    invalidateIndex();
    return readMemory({ path: toUnixPath(path.relative(getVaultPath(), absolutePath)) });
};

const localParts = date => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: MEMORY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));

export const appendConversationJournal = async ({ conversationId, agentId, userMessage, assistantMessage }) => {
    journalQueue = journalQueue.then(async () => {
        await ensureVault();
        const now = new Date();
        const parts = localParts(now);
        const day = `${parts.year}-${parts.month}-${parts.day}`;
        const time = `${parts.hour}:${parts.minute}:${parts.second}`;
        const agentName = AGENT_NAMES[normalizeAgent(agentId)];
        const absolutePath = path.join(getVaultPath(), '30-Conversations', `${day}.md`);
        let existing = '';
        try { existing = await fs.readFile(absolutePath, 'utf8'); } catch {}
        if (!existing) existing = `${makeFrontmatter({
            id: crypto.randomUUID(), title: `Conversations ${day}`, scope: 'conversations',
            agent: 'Carlos Office', tags: ['conversation-journal'], source: 'carlos-office',
            created: now.toISOString(), updated: now.toISOString(),
        })}# Conversations — ${day}\n`;
        const entry = `\n## ${time} — ${agentName}\n\n**Conversation:** \`${conversationId}\`\n\n### Carlos\n\n${String(userMessage || '').slice(0, 50_000)}\n\n### ${agentName}\n\n${String(assistantMessage || '').slice(0, 50_000)}\n`;
        await fs.writeFile(absolutePath, `${existing.trimEnd()}\n${entry}`, 'utf8');
        invalidateIndex();
        return toUnixPath(path.relative(getVaultPath(), absolutePath));
    }).catch(error => {
        console.error('[memory] Could not append conversation journal:', error.message);
        return null;
    });
    return journalQueue;
};
