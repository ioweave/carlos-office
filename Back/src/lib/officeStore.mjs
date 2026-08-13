import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
    AGENT_NAMES,
    ensureVault,
    getVaultPath,
    invalidateIndex,
    parseFrontmatter,
    toUnixPath,
} from './memoryCore.mjs';

const DIR = {
    agents: '90-System/Runtime/Agents',
    conversations: '30-Conversations/Threads',
    attachments: '30-Conversations/Attachments',
};
const locks = new Map();
const full = relative => path.join(getVaultPath(), relative);
const iso = value => new Date(value || Date.now()).toISOString();
const clean = value => String(value ?? '').replace(/<!--\s*\/?carlos-office-[\s\S]*?-->/gi, '').trim();
const yaml = data => ['---', ...Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value ?? '')}`), '---', ''].join('\n');
const MAX_ATTACHMENT_BYTES = Math.max(1_000_000, Number(process.env.MAX_ATTACHMENT_BYTES || 8_388_608));
const MAX_ATTACHMENTS_TOTAL_BYTES = Math.max(MAX_ATTACHMENT_BYTES, Number(process.env.MAX_ATTACHMENTS_TOTAL_BYTES || 20_971_520));
const MAX_TEXT_ATTACHMENT_CHARS = Math.max(4_000, Number(process.env.MAX_TEXT_ATTACHMENT_CHARS || 200_000));

const locked = async (key, action) => {
    const previous = locks.get(key) || Promise.resolve();
    let release;
    const next = new Promise(resolve => { release = resolve; });
    const chain = previous.then(() => next);
    locks.set(key, chain);
    await previous;
    try { return await action(); }
    finally {
        release();
        if (locks.get(key) === chain) locks.delete(key);
    }
};

const safeId = value => {
    const id = String(value || '').trim();
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) {
        throw Object.assign(new Error('Invalid local record identifier.'), { statusCode: 400 });
    }
    return id;
};
const optionalId = value => String(value || '').trim() ? safeId(value) : '';

const safeFilename = value => {
    const raw = path.basename(String(value || 'attachment'));
    const sanitized = raw.normalize('NFKC').replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/\s+/g, ' ').trim();
    return (sanitized || 'attachment').slice(0, 140);
};

const assertVaultPath = relative => {
    const root = path.resolve(getVaultPath());
    const absolute = path.resolve(root, String(relative || ''));
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
        throw Object.assign(new Error('Stored path escapes the Obsidian vault.'), { statusCode: 400 });
    }
    return absolute;
};

const renameReplacing = async (temporary, target) => {
    const retryable = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);
    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            await fs.rename(temporary, target);
            return;
        } catch (error) {
            lastError = error;
            if (!retryable.has(error.code) || attempt === 4) throw error;
            await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
        }
    }
    throw lastError;
};

const write = async (relative, content) => {
    const target = assertVaultPath(relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
        await fs.writeFile(temporary, content, 'utf8');
        await renameReplacing(temporary, target);
    } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
    }
    invalidateIndex();
};

const writeBinary = async (relative, content) => {
    const target = assertVaultPath(relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
        await fs.writeFile(temporary, content);
        await renameReplacing(temporary, target);
    } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
    }
};

const read = async relative => {
    try { return await fs.readFile(assertVaultPath(relative), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};

const files = async folder => {
    await ensureOfficeStore();
    return (await fs.readdir(assertVaultPath(folder), { withFileTypes: true }))
        .filter(item => item.isFile() && item.name.toLowerCase().endsWith('.md'))
        .map(item => `${folder}/${item.name}`);
};

export const ensureOfficeStore = async () => {
    await ensureVault();
    await Promise.all(Object.values(DIR).map(folder => fs.mkdir(assertVaultPath(folder), { recursive: true })));
    return getVaultPath();
};

const fallback = (value = {}, defaults = {}) => ({
    enabled: Boolean(value.enabled ?? defaults.enabled ?? false),
    provider: String(value.provider ?? defaults.provider ?? 'openai'),
    model: String(value.model ?? defaults.model ?? ''),
    baseUrl: String(value.baseUrl ?? defaults.baseUrl ?? 'https://api.openai.com/v1'),
});

const agentConfig = (agentId, value = {}, defaults = {}) => ({
    agentId,
    name: String(value.name ?? defaults.name ?? AGENT_NAMES[agentId] ?? agentId),
    role: String(value.role ?? defaults.role ?? ''),
    provider: String(value.provider ?? defaults.provider ?? 'ollama'),
    model: String(value.model ?? defaults.model ?? process.env.OLLAMA_MODEL ?? 'minimax-m3:cloud'),
    baseUrl: String(value.baseUrl ?? defaults.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'),
    temperature: Number(value.temperature ?? defaults.temperature ?? 0.2),
    maxToolRounds: Math.max(0, Math.min(Number(value.maxToolRounds ?? defaults.maxToolRounds ?? 4), 12)),
    maxInstances: Math.max(1, Math.min(Number(value.maxInstances ?? defaults.maxInstances ?? 1), 20)),
    capabilities: [...new Set((Array.isArray(value.capabilities) ? value.capabilities : defaults.capabilities || []).map(String).filter(Boolean))],
    toolGrants: [...new Set((Array.isArray(value.toolGrants) ? value.toolGrants : defaults.toolGrants || []).map(String).filter(Boolean))],
    timeouts: value.timeouts && typeof value.timeouts === 'object' ? value.timeouts : (defaults.timeouts || {}),
    qualityPolicy: value.qualityPolicy && typeof value.qualityPolicy === 'object' ? value.qualityPolicy : (defaults.qualityPolicy || { normalThreshold: 90, finalThreshold: 95 }),
    enabled: Boolean(value.enabled ?? defaults.enabled ?? true),
    modelPolicy: {
        mode: ['fixed', 'adaptive'].includes(value.modelPolicy?.mode) ? value.modelPolicy.mode : (defaults.modelPolicy?.mode || 'fixed'),
        defaultModelOptionId: String(value.modelPolicy?.defaultModelOptionId ?? defaults.modelPolicy?.defaultModelOptionId ?? ''),
        allowedModelOptionIds: Array.isArray(value.modelPolicy?.allowedModelOptionIds)
            ? [...new Set(value.modelPolicy.allowedModelOptionIds.map(String))]
            : [...(defaults.modelPolicy?.allowedModelOptionIds || [])],
        preferredCapabilities: Array.isArray(value.modelPolicy?.preferredCapabilities)
            ? [...new Set(value.modelPolicy.preferredCapabilities.map(String))]
            : [...(defaults.modelPolicy?.preferredCapabilities || [])],
    },
    fallback: fallback(value.fallback, defaults.fallback),
    configVersion: Number(value.configVersion ?? defaults.configVersion ?? 1),
    createdAt: iso(value.createdAt ?? defaults.createdAt),
    updatedAt: iso(value.updatedAt),
});
const agentFile = agentId => `${DIR.agents}/${AGENT_NAMES[agentId] || agentId}.md`;
const agentMarkdown = config => `${yaml({ type: 'agent-config', ...config })}# ${config.name} runtime configuration

Managed by Carlos Office and editable in Obsidian.

- **Role:** ${config.role}
- **Provider:** ${config.provider}
- **Model:** ${config.model}
- **Model selection:** ${config.modelPolicy.mode}
- **Enabled:** ${config.enabled ? 'yes' : 'no'}
`;

export const getAgentConfig = async (agentId, defaults) => {
    await ensureOfficeStore();
    const raw = await read(agentFile(agentId));
    if (raw) return agentConfig(agentId, parseFrontmatter(raw).data, defaults);
    const config = agentConfig(agentId, {}, defaults);
    await write(agentFile(agentId), agentMarkdown(config));
    return config;
};

export const saveAgentConfig = (agentId, update, defaults) => locked(agentFile(agentId), async () => {
    const current = await getAgentConfig(agentId, defaults);
    const config = agentConfig(agentId, {
        ...current,
        ...update,
        modelPolicy: update.modelPolicy === undefined ? current.modelPolicy : { ...current.modelPolicy, ...update.modelPolicy },
        fallback: update.fallback === undefined ? current.fallback : { ...current.fallback, ...update.fallback },
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
    }, defaults);
    await write(agentFile(agentId), agentMarkdown(config));
    return config;
});

export const listAgentConfigs = async (definitions, defaultConfig) => {
    const result = [];
    for (const id of Object.keys(definitions)) result.push(await getAgentConfig(id, defaultConfig(id)));
    return result;
};

const block = (name, value) => `<!-- carlos-office-${name}\n${Buffer.from(JSON.stringify(value)).toString('base64')}\n-->`;
const unblock = (raw, name) => {
    const found = String(raw || '').match(new RegExp(`<!-- carlos-office-${name}\\s+([A-Za-z0-9+/=\\s]+?)\\s+-->`));
    if (!found) return null;
    try { return JSON.parse(Buffer.from(found[1].replace(/\s+/g, ''), 'base64').toString()); }
    catch { return null; }
};

const attachment = value => ({
    attachmentId: safeId(value?.attachmentId || randomUUID()),
    name: safeFilename(value?.name || 'attachment'),
    mimeType: String(value?.mimeType || 'application/octet-stream').slice(0, 160),
    size: Math.max(0, Number(value?.size || 0)),
    path: toUnixPath(String(value?.path || '')),
    createdAt: iso(value?.createdAt),
});

const message = value => ({
    messageId: optionalId(value?.messageId),
    requestId: optionalId(value?.requestId),
    role: ['user', 'assistant', 'tool'].includes(value?.role) ? value.role : 'user',
    content: String(value?.content || ''),
    attachments: Array.isArray(value?.attachments) ? value.attachments.map(attachment) : [],
    artifacts: Array.isArray(value?.artifacts) ? value.artifacts.filter(item => item?.artifactId && item?.path).slice(0, 100) : [],
    toolEvents: Array.isArray(value?.toolEvents) ? value.toolEvents : [],
    memoryRefs: Array.isArray(value?.memoryRefs) ? value.memoryRefs : [],
    model: value?.model || null,
    error: Boolean(value?.error),
    jobIds: [...new Set((Array.isArray(value?.jobIds) ? value.jobIds : []).map(String).filter(Boolean))].slice(0, 20),
    activityMarker: String(value?.activityMarker || '').slice(0, 240),
    editedAt: value?.editedAt ? iso(value.editedAt) : '',
    createdAt: iso(value?.createdAt),
});

const conversation = value => ({
    conversationId: safeId(value.conversationId),
    agentId: String(value.agentId || 'nora'),
    title: String(value.title || 'New conversation').trim().slice(0, 120) || 'New conversation',
    messages: Array.isArray(value.messages) ? value.messages.map((item, index) => message({
        ...item,
        messageId: item?.messageId || `legacy-${index}-${new Date(item?.createdAt || 0).getTime() || 0}`,
    })) : [],
    archivedAt: value.archivedAt ? iso(value.archivedAt) : '',
    trashedAt: value.trashedAt ? iso(value.trashedAt) : '',
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
});
const conversationFile = id => `${DIR.conversations}/${safeId(id)}.md`;
const conversationAttachmentFolder = id => `${DIR.attachments}/${safeId(id)}`;
const attachmentCount = value => value.messages.reduce((sum, item) => sum + item.attachments.length, 0);

const messageMarkdown = item => {
    const name = item.role === 'assistant' ? 'Assistant' : item.role === 'tool' ? 'Tool' : 'Carlos';
    const tools = item.toolEvents?.length ? `\n\n<details><summary>Tool activity</summary>\n\n\`\`\`json\n${JSON.stringify(item.toolEvents, null, 2)}\n\`\`\`\n\n</details>` : '';
    const attachments = item.attachments?.length
        ? `\n\n**Attachments**\n${item.attachments.map(file => `- [${file.name}](../../${file.path}) — ${file.mimeType}, ${file.size} bytes`).join('\n')}`
        : '';
    return `## ${name} · ${iso(item.createdAt)}\n\n${clean(item.content)}${attachments}${tools}`;
};

const conversationMarkdown = value => `${yaml({
    type: 'conversation',
    conversationId: value.conversationId,
    agentId: value.agentId,
    title: value.title,
    messageCount: value.messages.length,
    attachmentCount: attachmentCount(value),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    archivedAt: value.archivedAt || '',
    trashedAt: value.trashedAt || '',
})}# ${value.title}

> Agent: **${AGENT_NAMES[value.agentId] || value.agentId}**  
> Updated: ${value.updatedAt}  
> Source of truth: this individual Markdown file

${block('conversation', value)}

## Transcript

${value.messages.map(messageMarkdown).join('\n\n---\n\n')}
`;

export const getConversation = async id => {
    await ensureOfficeStore();
    const raw = await read(conversationFile(id));
    if (!raw) return null;
    return conversation(unblock(raw, 'conversation') || { ...parseFrontmatter(raw).data, messages: [] });
};

export const saveConversation = value => {
    const item = conversation({ ...value, updatedAt: new Date().toISOString() });
    return locked(conversationFile(item.conversationId), async () => {
        await write(conversationFile(item.conversationId), conversationMarkdown(item));
        return item;
    });
};

export const updateConversation = async (id, update = {}) => {
    const current = await getConversation(id);
    if (!current) throw Object.assign(new Error('Conversation not found.'), { statusCode: 404 });
    return saveConversation({
        ...current,
        title: update.title === undefined ? current.title : String(update.title || '').trim().slice(0, 120),
        agentId: update.agentId === undefined ? current.agentId : String(update.agentId || current.agentId),
        archivedAt: update.archivedAt === undefined ? current.archivedAt : update.archivedAt,
        trashedAt: update.trashedAt === undefined ? current.trashedAt : update.trashedAt,
        createdAt: current.createdAt,
    });
};

export const deleteConversation = id => locked(`conversation:${safeId(id)}`, async () => {
    const current = await getConversation(id);
    if (!current) throw Object.assign(new Error('Conversation not found.'), { statusCode: 404 });
    await fs.rm(assertVaultPath(conversationFile(id)), { force: true });
    await fs.rm(assertVaultPath(conversationAttachmentFolder(id)), { recursive: true, force: true });
    invalidateIndex();
    return { conversationId: current.conversationId, deleted: true };
});

export const listConversations = async ({ limit = 50, trash = false, includeTrash = false } = {}) => {
    const result = [];
    for (const relative of await files(DIR.conversations)) {
        try {
            const data = parseFrontmatter(await read(relative)).data;
            result.push({
                conversationId: data.conversationId || path.basename(relative, '.md'),
                agentId: data.agentId || 'nora',
                title: data.title || path.basename(relative, '.md'),
                messageCount: Number(data.messageCount || 0),
                attachmentCount: Number(data.attachmentCount || 0),
                archivedAt: data.archivedAt ? iso(data.archivedAt) : '',
                trashedAt: data.trashedAt ? iso(data.trashedAt) : '',
                createdAt: iso(data.createdAt),
                updatedAt: iso(data.updatedAt),
                path: toUnixPath(relative),
            });
        } catch (error) { console.error('[store] Could not read conversation:', error.message); }
    }
    return result.filter(item => includeTrash || (trash ? Boolean(item.trashedAt) : !item.trashedAt)).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, Math.min(Number(limit) || 50, 500));
};

const decodeAttachment = input => {
    const source = String(input?.data || '');
    const base64 = source.includes(',') ? source.slice(source.indexOf(',') + 1) : source;
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) throw Object.assign(new Error(`Attachment ${input?.name || ''} is empty.`), { statusCode: 400 });
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
        throw Object.assign(new Error(`${input?.name || 'Attachment'} exceeds the ${MAX_ATTACHMENT_BYTES}-byte local limit.`), { statusCode: 413 });
    }
    return buffer;
};

export const saveConversationAttachments = async (conversationId, values = []) => {
    await ensureOfficeStore();
    const id = safeId(conversationId);
    const inputs = Array.isArray(values) ? values.slice(0, 8) : [];
    const saved = [];
    let totalBytes = 0;
    for (const input of inputs) {
        const buffer = decodeAttachment(input);
        totalBytes += buffer.length;
        if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
            throw Object.assign(new Error(`Attachments exceed the ${MAX_ATTACHMENTS_TOTAL_BYTES}-byte total message limit.`), { statusCode: 413 });
        }
        const item = attachment({
            attachmentId: randomUUID(),
            name: input.name,
            mimeType: input.mimeType,
            size: buffer.length,
            path: `${conversationAttachmentFolder(id)}/${randomUUID()}-${safeFilename(input.name)}`,
            createdAt: new Date().toISOString(),
        });
        await writeBinary(item.path, buffer);
        saved.push(item);
    }
    return saved;
};

export const readConversationAttachment = async (conversationId, attachmentId) => {
    const conversationRecord = await getConversation(conversationId);
    if (!conversationRecord) throw Object.assign(new Error('Conversation not found.'), { statusCode: 404 });
    const targetId = safeId(attachmentId);
    const item = conversationRecord.messages.flatMap(entry => entry.attachments)
        .find(entry => entry.attachmentId === targetId);
    if (!item) throw Object.assign(new Error('Attachment not found.'), { statusCode: 404 });
    const data = await fs.readFile(assertVaultPath(item.path));
    return { ...item, data: data.toString('base64') };
};

export const deleteConversationAttachments = async values => {
    let removed = 0;
    for (const item of Array.isArray(values) ? values : []) {
        if (!item?.path) continue;
        try {
            await fs.rm(assertVaultPath(item.path), { force: true });
            removed += 1;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    return { removed };
};

const isTextAttachment = mimeType => /^(text\/|application\/(json|xml|javascript|x-javascript|yaml|x-yaml|csv))/.test(String(mimeType || '').toLowerCase());
const isImageAttachment = mimeType => String(mimeType || '').toLowerCase().startsWith('image/');

export const hydrateConversationMessages = async messages => Promise.all((messages || []).map(async item => {
    const normalized = message(item);
    if (normalized.role !== 'user' || !normalized.attachments.length) return normalized;
    const parts = [{ type: 'text', text: normalized.content || 'Review the attached files.' }];
    for (const file of normalized.attachments) {
        try {
            const data = await fs.readFile(assertVaultPath(file.path));
            if (isImageAttachment(file.mimeType)) {
                parts.push({
                    type: 'text',
                    text: `Image attachment: ${file.name} (${file.mimeType}, ${file.size} bytes).`,
                });
                parts.push({
                    type: 'image_url',
                    image_url: { url: `data:${file.mimeType};base64,${data.toString('base64')}` },
                });
            } else if (isTextAttachment(file.mimeType)) {
                parts.push({
                    type: 'text',
                    text: `\n\n--- Attachment: ${file.name} ---\n${data.toString('utf8').slice(0, MAX_TEXT_ATTACHMENT_CHARS)}`,
                });
            } else {
                parts.push({
                    type: 'text',
                    text: `\n\nAttachment stored locally but not injected as model text: ${file.name} (${file.mimeType}, ${file.size} bytes).`,
                });
            }
        } catch (error) {
            parts.push({ type: 'text', text: `\n\nAttachment could not be read: ${file.name}. ${error.message}` });
        }
    }
    return { ...normalized, modelContent: parts };
}));
