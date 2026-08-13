import { createHash } from 'node:crypto';
import {
    deleteConversation as deleteStoredConversation,
    deleteConversationAttachments,
    getConversation as getStoredConversation,
    hydrateConversationMessages,
    listConversations as listStoredConversations,
    readConversationAttachment as readStoredConversationAttachment,
    saveConversation,
    saveConversationAttachments,
    updateConversation as updateStoredConversation,
} from './officeStore.mjs';
import { indexConversation, removeConversationFromSearch } from './conversationSearch.mjs';
import { createPersistentMap } from './operationalStore.mjs';
import { OFFICE_PLATFORM_CONFIG } from '../platform.config.mjs';

const contextCheckpoints = createPersistentMap('conversation-context-checkpoints-v1');

const plainMessageText = item => {
    const value = item?.content || '';
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return String(value || '');
    return value.filter(part => part?.type === 'text').map(part => part.text || '').join('\n');
};

const estimatedTokens = messages => Math.ceil((messages || []).reduce((total, item) => {
    const attachmentCharacters = (item.attachments || []).reduce((sum, attachment) => (
        /^(text\/|application\/(json|xml|javascript|x-javascript|yaml|x-yaml|csv))/i.test(String(attachment.mimeType || ''))
            ? sum + Math.min(Number(attachment.size) || 0, 80_000)
            : sum + 80
    ), 0);
    return total + plainMessageText(item).length + attachmentCharacters + 24;
}, 0) / 4);

const checkpointFingerprint = messages => createHash('sha256').update(JSON.stringify((messages || []).map(item => ({
    messageId: item.messageId || '',
    role: item.role || '',
    content: plainMessageText(item),
    editedAt: item.editedAt || '',
    attachments: (item.attachments || []).map(attachment => [attachment.attachmentId, attachment.name, attachment.size]),
})))).digest('hex');

const checkpointSummary = (messages, maxChars) => {
    const values = (messages || []).filter(item => ['user', 'assistant'].includes(item.role));
    if (!values.length) return 'No earlier conversational messages were retained in this checkpoint.';
    const selectedIndexes = new Set();
    values.slice(0, 8).forEach((_, index) => selectedIndexes.add(index));
    values.slice(-32).forEach((_, index) => selectedIndexes.add(values.length - Math.min(32, values.length) + index));
    const middleSlots = Math.min(16, Math.max(0, values.length - selectedIndexes.size));
    for (let index = 1; index <= middleSlots; index += 1) {
        selectedIndexes.add(Math.floor(index * (values.length - 1) / (middleSlots + 1)));
    }
    const selected = [...selectedIndexes].sort((a, b) => a - b).map(index => values[index]);
    const perMessage = Math.max(120, Math.min(1_200, Math.floor((maxChars - 500) / Math.max(1, selected.length))));
    const lines = selected.map(item => {
        const normalized = plainMessageText(item).replace(/\s+/g, ' ').trim();
        const clipped = normalized.length > perMessage ? `${normalized.slice(0, perMessage - 1)}…` : normalized;
        return `- ${item.role === 'user' ? 'Carlos' : 'Nora'} [${item.messageId || 'unidentified'}]: ${clipped || '(empty message)'}`;
    });
    const omitted = Math.max(0, values.length - selected.length);
    const header = [
        'INTERNAL CONVERSATION CHECKPOINT',
        `This compact checkpoint represents ${values.length} earlier messages${omitted ? `; ${omitted} low-salience messages are not reproduced verbatim` : ''}.`,
        'Use it as historical context. The recent messages following it are authoritative if they conflict with this checkpoint.',
    ];
    return [...header, ...lines].join('\n').slice(0, maxChars);
};

const prepareConversationContext = (conversationId, messages) => {
    const config = OFFICE_PLATFORM_CONFIG.context;
    const values = Array.isArray(messages) ? messages : [];
    const compressionAt = Math.floor(config.maxEstimatedTokens * config.compressionThreshold);
    if (estimatedTokens(values) <= compressionAt || values.length <= config.recentMessages) return values;

    const splitAt = Math.max(1, values.length - config.recentMessages);
    const older = values.slice(0, splitAt);
    const recent = values.slice(splitAt);
    const fingerprint = checkpointFingerprint(older);
    let checkpoint = contextCheckpoints.get(conversationId);
    if (!checkpoint || checkpoint.fingerprint !== fingerprint) {
        checkpoint = {
            conversationId,
            fingerprint,
            coveredMessageIds: older.map(item => item.messageId).filter(Boolean),
            coveredThrough: older.at(-1)?.createdAt || '',
            sourceMessages: older.length,
            estimatedSourceTokens: estimatedTokens(older),
            summary: checkpointSummary(older, config.summaryMaxChars),
            createdAt: new Date().toISOString(),
        };
        contextCheckpoints.set(conversationId, checkpoint);
    }
    return [{
        messageId: `checkpoint-${fingerprint.slice(0, 16)}`,
        role: 'assistant',
        content: checkpoint.summary,
        internal: true,
        createdAt: checkpoint.createdAt,
        attachments: [],
    }, ...recent];
};

const durableRecord = conversation => conversation && ({
    ...conversation,
    persisted: true,
    storage: 'obsidian',
    expiresAt: null,
});

export const conversationLifecycleStatus = () => ({
    persistedByDefault: true,
    storage: 'obsidian',
    context: {
        conversationScoped: OFFICE_PLATFORM_CONFIG.context.conversationScoped,
        compressionThreshold: OFFICE_PLATFORM_CONFIG.context.compressionThreshold,
        recentMessages: OFFICE_PLATFORM_CONFIG.context.recentMessages,
        checkpoints: contextCheckpoints.size,
    },
});

export const listSavedConversations = args => listStoredConversations(args);

export const listConversationRecords = async ({ limit = 50 } = {}) => {
    const bounded = Math.max(1, Math.min(Number(limit) || 50, 500));
    const saved = await listStoredConversations({ limit: bounded });
    return saved.map(durableRecord);
};

export const listConversationRecordsByLifecycle = async ({ limit = 50, trash = false, archived = false } = {}) => {
    const bounded = Math.max(1, Math.min(Number(limit) || 50, 500));
    return (await listStoredConversations({ limit: bounded, trash })).filter(item => trash ? true : archived ? Boolean(item.archivedAt) : !item.archivedAt).map(durableRecord);
};

export const getConversationRecord = async conversationId => {
    const stored = await getStoredConversation(conversationId);
    return stored ? durableRecord(stored) : null;
};

export const saveConversationRecord = async conversation => {
    const saved = durableRecord(await saveConversation(conversation));
    if (saved.trashedAt) removeConversationFromSearch(saved.conversationId);
    else indexConversation(saved);
    return saved;
};

export const updateConversationRecord = async (conversationId, update) => {
    const updated = durableRecord(await updateStoredConversation(conversationId, update));
    indexConversation(updated);
    return updated;
};

export const deleteConversationRecord = async conversationId => {
    const deleted = await deleteStoredConversation(conversationId);
    contextCheckpoints.delete(conversationId);
    removeConversationFromSearch(conversationId);
    return deleted;
};

export const trashConversationRecord = async conversationId => {
    const updated = durableRecord(await updateStoredConversation(conversationId, { trashedAt: new Date().toISOString() }));
    removeConversationFromSearch(conversationId);
    return updated;
};

export const restoreConversationRecord = async conversationId => {
    const updated = durableRecord(await updateStoredConversation(conversationId, { trashedAt: '', archivedAt: '' }));
    indexConversation(updated);
    return updated;
};
export const archiveConversationRecord = async conversationId => {
    const updated = durableRecord(await updateStoredConversation(conversationId, { archivedAt: new Date().toISOString() }));
    indexConversation(updated); return updated;
};

export const saveConversationRecordAttachments = (conversationId, values) => saveConversationAttachments(conversationId, values);

export const readConversationRecordAttachment = (conversationId, attachmentId) => readStoredConversationAttachment(conversationId, attachmentId);

export const deleteConversationRecordAttachments = values => deleteConversationAttachments(values);

export const invalidateConversationRecordContext = conversationId => contextCheckpoints.delete(conversationId);

export const hydrateConversationRecordMessages = (conversationId, messages) => (
    hydrateConversationMessages(prepareConversationContext(conversationId, messages))
);
