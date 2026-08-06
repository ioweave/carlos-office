import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AGENT_NAMES, ensureVault, getVaultPath, invalidateIndex, parseFrontmatter, slugify, toUnixPath } from './memoryCore.mjs';

const DIR = {
    agents: '90-System/Runtime/Agents',
    conversations: '30-Conversations/Threads',
    jobs: '40-Jobs',
};
const locks = new Map();
const full = relative => path.join(getVaultPath(), relative);
const iso = value => new Date(value || Date.now()).toISOString();
const clean = value => String(value ?? '').replace(/<!--\s*\/?carlos-office-[\s\S]*?-->/gi, '').trim();
const yaml = data => ['---', ...Object.entries(data).map(([key, value]) => `${key}: ${JSON.stringify(value ?? '')}`), '---', ''].join('\n');

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

const write = async (relative, content) => {
    const target = full(relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, target);
    invalidateIndex();
};
const read = async relative => {
    try { return await fs.readFile(full(relative), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
const files = async folder => {
    await ensureOfficeStore();
    return (await fs.readdir(full(folder), { withFileTypes: true }))
        .filter(item => item.isFile() && item.name.toLowerCase().endsWith('.md'))
        .map(item => `${folder}/${item.name}`);
};

export const ensureOfficeStore = async () => {
    await ensureVault();
    await Promise.all(Object.values(DIR).map(folder => fs.mkdir(full(folder), { recursive: true })));
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
const conversation = value => ({
    conversationId: String(value.conversationId),
    agentId: String(value.agentId || 'nora'),
    title: String(value.title || 'New conversation'),
    messages: Array.isArray(value.messages) ? value.messages : [],
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
});
const conversationFile = id => `${DIR.conversations}/${id}.md`;
const messageMarkdown = message => {
    const name = message.role === 'assistant' ? 'Assistant' : message.role === 'tool' ? 'Tool' : 'Carlos';
    const tools = message.toolEvents?.length ? `\n\n<details><summary>Tool activity</summary>\n\n\`\`\`json\n${JSON.stringify(message.toolEvents, null, 2)}\n\`\`\`\n\n</details>` : '';
    return `## ${name} · ${iso(message.createdAt)}\n\n${clean(message.content)}${tools}`;
};
const conversationMarkdown = value => `${yaml({
    type: 'conversation', conversationId: value.conversationId, agentId: value.agentId,
    title: value.title, messageCount: value.messages.length, createdAt: value.createdAt, updatedAt: value.updatedAt,
})}# ${value.title}

> Agent: **${AGENT_NAMES[value.agentId] || value.agentId}**  
> Updated: ${value.updatedAt}

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
export const listConversations = async ({ limit = 50 } = {}) => {
    const result = [];
    for (const relative of await files(DIR.conversations)) {
        try {
            const data = parseFrontmatter(await read(relative)).data;
            result.push({
                conversationId: data.conversationId || path.basename(relative, '.md'), agentId: data.agentId || 'nora',
                title: data.title || path.basename(relative, '.md'), messageCount: Number(data.messageCount || 0),
                createdAt: iso(data.createdAt), updatedAt: iso(data.updatedAt), path: toUnixPath(relative),
            });
        } catch (error) { console.error('[store] Could not read conversation:', error.message); }
    }
    return result.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, Math.min(Number(limit) || 50, 500));
};

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
const job = value => ({
    jobId: String(value.jobId || randomUUID()),
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
    result: String(value.result || ''),
    qcVerdict: String(value.qcVerdict || ''),
    qcScore: Math.max(0, Math.min(Number(value.qcScore || 0), 100)),
    qcFeedback: String(value.qcFeedback || ''),
    lastError: String(value.lastError || ''),
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
    path: String(value.path || ''),
});
const jobMarkdown = value => {
    const criteriaList = value.acceptanceCriteria.length
        ? value.acceptanceCriteria.map(item => `- ${item}`).join('\n')
        : '_No explicit criteria supplied._';
    const attempts = value.attempts.length
        ? value.attempts.map(item => `### Iteration ${item.iteration}

- **Worker model:** ${item.workerModel?.provider || 'unknown'} · ${item.workerModel?.model || 'unknown'}
- **Vera verdict:** ${item.qcVerdict}
- **QC score:** ${item.qcScore}/100
- **QC model:** ${item.qcModel?.provider || 'unknown'} · ${item.qcModel?.model || 'unknown'}

#### Worker output

${clean(item.workerOutput)}

#### Vera assessment

${clean(item.qcSummary)}

${item.missing.length ? `**Missing:** ${item.missing.join('; ')}` : ''}

${clean(item.qcFeedback)}`).join('\n\n---\n\n')
        : '_No iterations have run yet._';

    return `${yaml({
        type: 'agent-job', jobId: value.jobId, createdBy: value.createdBy, assignedAgent: value.assignedAgent,
        qcAgent: value.qcAgent, title: value.title, priority: value.priority, status: value.status,
        currentIteration: value.currentIteration, maxIterations: value.maxIterations,
        qcVerdict: value.qcVerdict, qcScore: value.qcScore,
        createdAt: value.createdAt, updatedAt: value.updatedAt,
    })}# ${value.title}

## Instructions

${clean(value.instructions)}

## Expected result

${clean(value.expectedResult) || '_Not specified._'}

## Acceptance criteria

${criteriaList}

## Current result

${clean(value.result) || '_Not completed yet._'}

## QC status

- **Vera verdict:** ${value.qcVerdict || 'pending'}
- **QC score:** ${value.qcScore || 0}/100
- **Iteration:** ${value.currentIteration}/${value.maxIterations}

${clean(value.qcFeedback)}
${value.lastError ? `\n\n**Last error:** ${clean(value.lastError)}` : ''}

## Iteration history

${attempts}

${block('job', value)}
`;
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
    return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, Math.min(Number(limit) || 100, 500));
};
