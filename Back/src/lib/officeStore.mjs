import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
    AGENT_NAMES,
    ensureVault,
    getVaultPath,
    invalidateIndex,
    parseFrontmatter,
    slugify,
    toUnixPath,
} from './memoryCore.mjs';

const DIR = {
    agents: '90-System/Runtime/Agents',
    conversations: '30-Conversations/Threads',
    attachments: '30-Conversations/Attachments',
    jobs: '40-Jobs',
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

const write = async (relative, content) => {
    const target = assertVaultPath(relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, target);
    invalidateIndex();
};

const writeBinary = async (relative, content) => {
    const target = assertVaultPath(relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, content);
    await fs.rename(temporary, target);
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
    enabled: Boolean(value.enabled ?? defaults.enabled ?? true),
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
    role: ['user', 'assistant', 'tool'].includes(value?.role) ? value.role : 'user',
    content: String(value?.content || ''),
    attachments: Array.isArray(value?.attachments) ? value.attachments.map(attachment) : [],
    toolEvents: Array.isArray(value?.toolEvents) ? value.toolEvents : [],
    memoryRefs: Array.isArray(value?.memoryRefs) ? value.memoryRefs : [],
    model: value?.model || null,
    error: Boolean(value?.error),
    createdAt: iso(value?.createdAt),
});

const conversation = value => ({
    conversationId: safeId(value.conversationId),
    agentId: String(value.agentId || 'nora'),
    title: String(value.title || 'New conversation').trim().slice(0, 120) || 'New conversation',
    messages: Array.isArray(value.messages) ? value.messages.map(message) : [],
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

export const listConversations = async ({ limit = 50 } = {}) => {
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
                createdAt: iso(data.createdAt),
                updatedAt: iso(data.updatedAt),
                path: toUnixPath(relative),
            });
        } catch (error) { console.error('[store] Could not read conversation:', error.message); }
    }
    return result.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
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

const criteria = value => {
    const source = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
    return source.map(item => String(item).replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean).slice(0, 30);
};

const attempt = value => ({
    iteration: Math.max(1, Number(value?.iteration || 1)),
    workerOutput: String(value?.workerOutput || ''),
    workerModel: value?.workerModel || null,
    qcVerdict: ['pass', 'revise'].includes(value?.qcVerdict) ? value.qcVerdict : 'revise',
    qcScore: Math.max(0, Math.min(Number(value?.qcScore || 0), 100)),
    qcSummary: String(value?.qcSummary || ''),
    qcFeedback: String(value?.qcFeedback || ''),
    missing: criteria(value?.missing || []),
    qcModel: value?.qcModel || null,
    createdAt: iso(value?.createdAt),
});

const jobMessage = value => ({
    messageId: safeId(value?.messageId || randomUUID()),
    from: String(value?.from || 'nora'),
    to: String(value?.to || ''),
    type: String(value?.type || 'message'),
    content: String(value?.content || ''),
    iteration: Math.max(0, Number(value?.iteration || 0)),
    createdAt: iso(value?.createdAt),
});

const job = value => ({
    jobId: safeId(value.jobId || randomUUID()),
    createdBy: String(value.createdBy || 'nora'),
    assignedAgent: String(value.assignedAgent || 'marco'),
    qcAgent: 'vera',
    title: String(value.title || 'Untitled job'),
    instructions: String(value.instructions || ''),
    expectedResult: String(value.expectedResult || ''),
    acceptanceCriteria: criteria(value.acceptanceCriteria || []),
    priority: ['low', 'normal', 'high'].includes(value.priority) ? value.priority : 'normal',
    status: String(value.status || 'queued'),
    maxIterations: Math.max(1, Math.min(Number(value.maxIterations || 4), 8)),
    currentIteration: Math.max(0, Number(value.currentIteration || 0)),
    attempts: Array.isArray(value.attempts) ? value.attempts.map(attempt) : [],
    messages: Array.isArray(value.messages) ? value.messages.map(jobMessage) : [],
    result: String(value.result || ''),
    qcVerdict: String(value.qcVerdict || ''),
    qcScore: Math.max(0, Math.min(Number(value.qcScore || 0), 100)),
    qcFeedback: String(value.qcFeedback || ''),
    lastError: String(value.lastError || ''),
    workflowId: optionalId(value.workflowId),
    conversationId: optionalId(value.conversationId),
    requestId: optionalId(value.requestId),
    workflowTitle: String(value.workflowTitle || '').trim().slice(0, 140),
    workflowStage: String(value.workflowStage || '').trim().slice(0, 40),
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
    path: String(value.path || ''),
});

const jobMarkdown = value => {
    const criteriaList = value.acceptanceCriteria.length
        ? value.acceptanceCriteria.map(item => `- ${item}`).join('\n')
        : '_No explicit criteria supplied._';
    const attempts = value.attempts.length
        ? value.attempts.map(item => `### Iteration ${item.iteration}\n\n- **Worker model:** ${item.workerModel?.provider || 'unknown'} · ${item.workerModel?.model || 'unknown'}\n- **Vera verdict:** ${item.qcVerdict}\n- **QC score:** ${item.qcScore}/100\n- **QC model:** ${item.qcModel?.provider || 'unknown'} · ${item.qcModel?.model || 'unknown'}\n\n#### Worker output\n\n${clean(item.workerOutput)}\n\n#### Vera assessment\n\n${clean(item.qcSummary)}\n\n${item.missing.length ? `**Missing:** ${item.missing.join('; ')}` : ''}\n\n${clean(item.qcFeedback)}`).join('\n\n---\n\n')
        : '_No iterations have run yet._';
    const messages = value.messages.length
        ? value.messages.map(item => `### ${AGENT_NAMES[item.from] || item.from} → ${AGENT_NAMES[item.to] || item.to || 'Office'}\n\n- **Type:** ${item.type}\n- **Iteration:** ${item.iteration || '—'}\n- **Time:** ${item.createdAt}\n\n${clean(item.content)}`).join('\n\n---\n\n')
        : '_No inter-agent messages yet._';

    return `${yaml({
        type: 'agent-job',
        jobId: value.jobId,
        createdBy: value.createdBy,
        assignedAgent: value.assignedAgent,
        qcAgent: value.qcAgent,
        title: value.title,
        priority: value.priority,
        status: value.status,
        currentIteration: value.currentIteration,
        maxIterations: value.maxIterations,
        qcVerdict: value.qcVerdict,
        qcScore: value.qcScore,
        workflowId: value.workflowId,
        conversationId: value.conversationId,
        requestId: value.requestId,
        workflowStage: value.workflowStage,
        messageCount: value.messages.length,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
    })}# ${value.title}\n\n## Instructions\n\n${clean(value.instructions)}\n\n## Expected result\n\n${clean(value.expectedResult) || '_Not specified._'}\n\n## Acceptance criteria\n\n${criteriaList}\n\n## Current result\n\n${clean(value.result) || '_Not completed yet._'}\n\n## QC status\n\n- **Vera verdict:** ${value.qcVerdict || 'pending'}\n- **QC score:** ${value.qcScore || 0}/100\n- **Iteration:** ${value.currentIteration}/${value.maxIterations}\n\n${clean(value.qcFeedback)}\n${value.lastError ? `\n\n**Last error:** ${clean(value.lastError)}` : ''}\n\n## Agent communication\n\n${messages}\n\n## Iteration history\n\n${attempts}\n\n${block('job', value)}\n`;
};

const findJobRecord = async jobId => {
    for (const relative of await files(DIR.jobs)) {
        const raw = await read(relative);
        const stored = unblock(raw, 'job');
        const parsed = stored || parseFrontmatter(raw).data;
        if (String(parsed.jobId || '') === String(jobId)) return { relative, raw, stored: parsed };
    }
    return null;
};

export const createJob = async value => {
    await ensureOfficeStore();
    const item = job(value);
    if (!item.messages.length) {
        item.messages.push(jobMessage({
            from: item.createdBy,
            to: item.assignedAgent,
            type: 'assignment',
            content: [
                item.instructions,
                `Expected result: ${item.expectedResult || 'Not specified.'}`,
                `Acceptance criteria: ${item.acceptanceCriteria.join('; ') || 'Not specified.'}`,
            ].join('\n\n'),
            iteration: 0,
        }));
    }
    const relative = `${DIR.jobs}/${item.createdAt.slice(0, 10)}-${slugify(item.title)}-${item.jobId.slice(0, 8)}.md`;
    item.path = relative;
    await write(relative, jobMarkdown(item));
    return item;
};

export const getJob = async jobId => {
    await ensureOfficeStore();
    const record = await findJobRecord(jobId);
    return record ? job({ ...record.stored, path: record.relative }) : null;
};

export const saveJob = async value => {
    const item = job({ ...value, updatedAt: new Date().toISOString() });
    return locked(`job:${item.jobId}`, async () => {
        const existing = item.path ? { relative: item.path } : await findJobRecord(item.jobId);
        const relative = existing?.relative
            || `${DIR.jobs}/${item.createdAt.slice(0, 10)}-${slugify(item.title)}-${item.jobId.slice(0, 8)}.md`;
        item.path = relative;
        await write(relative, jobMarkdown(item));
        return item;
    });
};

export const updateJob = async (jobId, update = {}) => locked(`job:${jobId}`, async () => {
    const current = await getJob(jobId);
    if (!current) throw Object.assign(new Error('Job not found.'), { statusCode: 404 });
    const item = job({
        ...current,
        ...update,
        attempts: update.attempts === undefined ? current.attempts : update.attempts,
        messages: update.messages === undefined ? current.messages : update.messages,
        acceptanceCriteria: update.acceptanceCriteria === undefined ? current.acceptanceCriteria : update.acceptanceCriteria,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
        path: current.path,
    });
    await write(item.path, jobMarkdown(item));
    return item;
});

export const listJobs = async ({ limit = 100 } = {}) => {
    const result = [];
    for (const relative of await files(DIR.jobs)) {
        try {
            const raw = await read(relative);
            const parsed = parseFrontmatter(raw);
            const instructions = parsed.body.match(/## Instructions\s+([\s\S]*?)(?:\n## Expected result|$)/)?.[1]?.trim() || '';
            result.push(job({ ...(unblock(raw, 'job') || { ...parsed.data, instructions }), path: toUnixPath(relative) }));
        } catch (error) { console.error('[store] Could not read job:', error.message); }
    }
    return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, Math.min(Number(limit) || 100, 500));
};
