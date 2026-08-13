import { createHash } from 'node:crypto';
import { AGENT_NAMES, getIndex, normalizeAgent, publicNote } from './memoryCore.mjs';
import {
    listSemanticDocuments,
    removeSemanticDocumentsExcept,
    upsertSemanticDocument,
} from './operationalStore.mjs';

const refreshMs = Math.max(60_000, Number(process.env.MEMORY_SEMANTIC_REFRESH_MS || 300_000));
const maxDocumentChars = Math.max(2_000, Number(process.env.MEMORY_SEMANTIC_DOCUMENT_CHARS || 12_000));
let refreshPromise = null;
let refreshedAt = 0;
let lastError = '';

const embeddingModel = () => String(
    process.env.MODEL_ROUTE_EMBEDDING_MODEL
    || process.env.MEMORY_EMBEDDING_MODEL
    || 'nomic-embed-text',
).trim();
const embeddingBaseUrl = () => String(
    process.env.MEMORY_EMBEDDING_BASE_URL
    || process.env.OLLAMA_BASE_URL
    || 'http://127.0.0.1:11434',
).replace(/\/$/, '');
const enabled = () => String(process.env.MEMORY_SEMANTIC_ENABLED || 'true').toLowerCase() !== 'false';
const fingerprint = value => createHash('sha256').update(value).digest('hex');
const projectIdFromPath = notePath => notePath.match(/^25-Projects\/([^/]+)\/Knowledge\//)?.[1] || '';

export const isGovernedKnowledgePath = notePath => (
    notePath.startsWith('10-Shared/')
    || /^20-Agents\/[^/]+\//.test(notePath)
    || /^25-Projects\/[^/]+\/Knowledge\//.test(notePath)
);

const embed = async input => {
    const response = await fetch(`${embeddingBaseUrl()}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: embeddingModel(), input }),
        signal: AbortSignal.timeout(Math.max(5_000, Number(process.env.MEMORY_EMBEDDING_TIMEOUT_MS || 30_000))),
    });
    if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}.`);
    const payload = await response.json();
    const vectors = Array.isArray(payload.embeddings) ? payload.embeddings : [];
    if (!Array.isArray(vectors[0]) || !vectors[0].length) throw new Error('Embedding provider returned no vector.');
    return vectors[0].map(Number);
};

const documentText = note => [
    note.title,
    note.tags?.length ? `Tags: ${note.tags.join(', ')}` : '',
    note.source ? `Source: ${note.source}` : '',
    note.body,
].filter(Boolean).join('\n').slice(0, maxDocumentChars);

export const syncSemanticIndex = async ({ force = false } = {}) => {
    if (!enabled()) return { enabled: false, indexed: 0, changed: 0, error: '' };
    if (!force && refreshedAt + refreshMs > Date.now()) {
        return { enabled: true, indexed: listSemanticDocuments().length, changed: 0, error: lastError };
    }
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
        const notes = (await getIndex()).filter(note => isGovernedKnowledgePath(note.path));
        const stored = new Map(listSemanticDocuments().map(item => [item.path, item]));
        let changed = 0;
        for (const note of notes) {
            const content = documentText(note);
            const nextFingerprint = fingerprint(`${note.path}\n${note.modifiedAt}\n${content}`);
            if (stored.get(note.path)?.fingerprint === nextFingerprint) continue;
            const vector = await embed(content);
            upsertSemanticDocument({
                path: note.path,
                fingerprint: nextFingerprint,
                title: note.title,
                scope: note.scope,
                agent: note.agent || '',
                projectId: projectIdFromPath(note.path),
                source: note.source || '',
                excerpt: content.replace(/\s+/g, ' ').slice(0, 1_200),
                vector,
            });
            changed += 1;
        }
        removeSemanticDocumentsExcept(notes.map(note => note.path));
        refreshedAt = Date.now();
        lastError = '';
        return { enabled: true, indexed: notes.length, changed, error: '' };
    })().catch(error => {
        lastError = String(error?.message || error).slice(0, 500);
        console.error('[memory] Semantic index refresh failed:', lastError);
        return { enabled: true, indexed: listSemanticDocuments().length, changed: 0, error: lastError };
    }).finally(() => { refreshPromise = null; });
    return refreshPromise;
};

const cosine = (left, right) => {
    if (!left.length || left.length !== right.length) return 0;
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
        dot += left[index] * right[index];
        leftNorm += left[index] ** 2;
        rightNorm += right[index] ** 2;
    }
    return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
};

const eligible = (document, agentId, projectId) => {
    if (document.path.startsWith('10-Shared/')) return true;
    const agentName = AGENT_NAMES[normalizeAgent(agentId)];
    if (document.path.startsWith(`20-Agents/${agentName}/`)) return true;
    return Boolean(projectId && document.path.startsWith(`25-Projects/${projectId}/Knowledge/`));
};

export const semanticSearchMemory = async ({ query, agentId = 'nora', projectId = '', limit = 8 } = {}) => {
    if (!enabled() || !String(query || '').trim()) return [];
    await syncSemanticIndex();
    const documents = listSemanticDocuments().filter(item => eligible(item, agentId, projectId));
    if (!documents.length) return [];
    let queryVector;
    try { queryVector = await embed(String(query).slice(0, 8_000)); }
    catch (error) {
        lastError = String(error?.message || error).slice(0, 500);
        return [];
    }
    const index = new Map((await getIndex()).map(note => [note.path, note]));
    return documents.map(document => ({ document, score: cosine(queryVector, document.vector) }))
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, Math.max(1, Math.min(Number(limit) || 8, 50)))
        .map(({ document, score }) => {
            const note = index.get(document.path);
            return {
                ...(note ? publicNote(note) : {
                    path: document.path,
                    title: document.title,
                    scope: document.scope,
                    agent: document.agent,
                    source: document.source,
                }),
                excerpt: document.excerpt,
                semanticScore: score,
            };
        });
};

export const semanticMemoryStatus = () => ({
    enabled: enabled(),
    model: embeddingModel(),
    baseUrl: embeddingBaseUrl(),
    indexed: listSemanticDocuments().length,
    refreshedAt: refreshedAt ? new Date(refreshedAt).toISOString() : null,
    error: lastError,
});

export const warmSemanticIndex = () => {
    if (!enabled()) return;
    setTimeout(() => { void syncSemanticIndex(); }, 250);
};

