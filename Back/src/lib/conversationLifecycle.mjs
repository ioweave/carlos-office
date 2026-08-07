import {
    deleteConversation as deleteStoredConversation,
    getConversation as getStoredConversation,
    hydrateConversationMessages,
    listConversations as listStoredConversations,
    readConversationAttachment as readStoredConversationAttachment,
    saveConversation,
    saveConversationAttachments,
    updateConversation as updateStoredConversation,
} from './officeStore.mjs';
import {
    deleteTemporaryConversation,
    getTemporaryConversation,
    hydrateTemporaryMessages,
    materializeTemporaryAttachments,
    readTemporaryAttachment,
    saveTemporaryAttachments,
    saveTemporaryConversation,
    updateTemporaryConversation,
} from './temporaryConversations.mjs';

export const listSavedConversations = args => listStoredConversations(args);

export const getConversationRecord = async conversationId => {
    const temporary = getTemporaryConversation(conversationId);
    if (temporary) return temporary;
    const stored = await getStoredConversation(conversationId);
    return stored ? { ...stored, persisted: true, storage: 'obsidian' } : null;
};

export const saveConversationRecord = async (conversation, { persisted = false } = {}) => {
    if (persisted) return { ...(await saveConversation(conversation)), persisted: true, storage: 'obsidian' };
    return saveTemporaryConversation(conversation);
};

export const updateConversationRecord = async (conversationId, update) => {
    if (getTemporaryConversation(conversationId)) return updateTemporaryConversation(conversationId, update);
    return { ...(await updateStoredConversation(conversationId, update)), persisted: true, storage: 'obsidian' };
};

export const deleteConversationRecord = async conversationId => {
    if (getTemporaryConversation(conversationId)) return deleteTemporaryConversation(conversationId);
    return deleteStoredConversation(conversationId);
};

export const saveConversationRecordAttachments = async (conversationId, values, { persisted = false } = {}) => (
    persisted ? saveConversationAttachments(conversationId, values) : saveTemporaryAttachments(conversationId, values)
);

export const readConversationRecordAttachment = async (conversationId, attachmentId) => {
    if (getTemporaryConversation(conversationId)) return readTemporaryAttachment(conversationId, attachmentId);
    return readStoredConversationAttachment(conversationId, attachmentId);
};

export const hydrateConversationRecordMessages = async (conversationId, messages, { persisted = false } = {}) => (
    persisted ? hydrateConversationMessages(messages) : hydrateTemporaryMessages(conversationId, messages)
);

export const promoteConversation = async conversationId => {
    const temporary = getTemporaryConversation(conversationId);
    if (!temporary) {
        const stored = await getStoredConversation(conversationId);
        if (!stored) throw Object.assign(new Error('Conversation not found.'), { statusCode: 404 });
        return { ...stored, persisted: true, storage: 'obsidian', alreadySaved: true };
    }

    const rawAttachments = materializeTemporaryAttachments(conversationId);
    const savedAttachments = rawAttachments.length
        ? await saveConversationAttachments(conversationId, rawAttachments.map(item => ({
            name: item.name,
            mimeType: item.mimeType,
            data: item.data,
        })))
        : [];
    const savedByTemporaryId = new Map(rawAttachments.map((item, index) => [item.attachmentId, savedAttachments[index]]));

    const messages = temporary.messages.map(message => ({
        ...message,
        attachments: (message.attachments || []).map(file => savedByTemporaryId.get(file.attachmentId) || file),
    }));

    const saved = await saveConversation({
        ...temporary,
        messages,
        persisted: undefined,
        storage: undefined,
    });
    deleteTemporaryConversation(conversationId);
    return { ...saved, persisted: true, storage: 'obsidian', promoted: true };
};
