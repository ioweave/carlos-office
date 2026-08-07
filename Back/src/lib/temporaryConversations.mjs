import { randomUUID } from 'node:crypto';

const conversations = new Map();
const attachments = new Map();
const ttlMs = Math.max(60_000, Number(process.env.TEMP_CONVERSATION_TTL_MS || 86_400_000));
const MAX_ATTACHMENT_BYTES = Math.max(1_000_000, Number(process.env.MAX_ATTACHMENT_BYTES || 8_388_608));
const MAX_ATTACHMENTS_TOTAL_BYTES = Math.max(MAX_ATTACHMENT_BYTES, Number(process.env.MAX_ATTACHMENTS_TOTAL_BYTES || 20_971_520));
const MAX_TEXT_ATTACHMENT_CHARS = Math.max(4_000, Number(process.env.MAX_TEXT_ATTACHMENT_CHARS || 200_000));

const clone = value => structuredClone(value);
const nowIso = () => new Date().toISOString();
const safeId = value => {
    const id = String(value || '').trim();
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw Object.assign(new Error('Invalid local record identifier.'), { statusCode: 400 });
    return id;
};
const safeFilename = value => {
    const raw = String(value || 'attachment').split(/[\\/]/).at(-1) || 'attachment';
    return (raw.normalize('NFKC').replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/\s+/g, ' ').trim() || 'attachment').slice(0, 140);
};
const decodeAttachment = input => {
    const source = String(input?.data || '');
    const base64 = source.includes(',') ? source.slice(source.indexOf(',') + 1) : source;
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) throw Object.assign(new Error(`Attachment ${input?.name || ''} is empty.`), { statusCode: 400 });
    if (buffer.length > MAX_ATTACHMENT_BYTES) throw Object.assign(new Error(`${input?.name || 'Attachment'} exceeds the ${MAX_ATTACHMENT_BYTES}-byte local limit.`), { statusCode: 413 });
    return buffer;
};
const isTextAttachment = mimeType => /^(text\/|application\/(json|xml|javascript|x-javascript|yaml|x-yaml|csv))/.test(String(mimeType || '').toLowerCase());
const isImageAttachment = mimeType => String(mimeType || '').toLowerCase().startsWith('image/');

export const cleanupTemporaryConversations = () => {
    const cutoff = Date.now() - ttlMs;
    let removed = 0;
    for (const [conversationId, entry] of conversations.entries()) {
        if (new Date(entry.updatedAt).getTime() >= cutoff) continue;
        conversations.delete(conversationId);
        attachments.delete(conversationId);
        removed += 1;
    }
    return removed;
};

export const getTemporaryConversation = conversationId => {
    cleanupTemporaryConversations();
    const value = conversations.get(safeId(conversationId));
    return value ? clone(value) : null;
};

export const saveTemporaryConversation = value => {
    cleanupTemporaryConversations();
    const conversationId = safeId(value.conversationId);
    const current = conversations.get(conversationId);
    const item = {
        conversationId,
        agentId: String(value.agentId || current?.agentId || 'nora'),
        title: String(value.title || current?.title || 'New conversation').trim().slice(0, 120) || 'New conversation',
        messages: Array.isArray(value.messages) ? clone(value.messages) : clone(current?.messages || []),
        createdAt: value.createdAt || current?.createdAt || nowIso(),
        updatedAt: nowIso(),
        persisted: false,
        storage: 'volatile',
    };
    conversations.set(conversationId, item);
    return clone(item);
};

export const updateTemporaryConversation = (conversationId, update = {}) => {
    const current = getTemporaryConversation(conversationId);
    if (!current) throw Object.assign(new Error('Temporary conversation not found.'), { statusCode: 404 });
    return saveTemporaryConversation({ ...current, ...update, conversationId: current.conversationId, createdAt: current.createdAt });
};

export const deleteTemporaryConversation = conversationId => {
    const id = safeId(conversationId);
    const existed = conversations.delete(id);
    attachments.delete(id);
    return { conversationId: id, deleted: existed, temporary: true };
};

export const saveTemporaryAttachments = (conversationId, values = []) => {
    const id = safeId(conversationId);
    const inputs = Array.isArray(values) ? values.slice(0, 8) : [];
    const bucket = attachments.get(id) || new Map();
    const saved = [];
    let totalBytes = 0;
    for (const input of inputs) {
        const buffer = decodeAttachment(input);
        totalBytes += buffer.length;
        if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) throw Object.assign(new Error(`Attachments exceed the ${MAX_ATTACHMENTS_TOTAL_BYTES}-byte total message limit.`), { statusCode: 413 });
        const item = {
            attachmentId: randomUUID(),
            name: safeFilename(input.name),
            mimeType: String(input.mimeType || 'application/octet-stream').slice(0, 160),
            size: buffer.length,
            createdAt: nowIso(),
            temporary: true,
        };
        bucket.set(item.attachmentId, { ...item, buffer });
        saved.push(item);
    }
    attachments.set(id, bucket);
    return saved;
};

export const readTemporaryAttachment = (conversationId, attachmentId) => {
    const item = attachments.get(safeId(conversationId))?.get(safeId(attachmentId));
    if (!item) throw Object.assign(new Error('Temporary attachment not found.'), { statusCode: 404 });
    return { attachmentId: item.attachmentId, name: item.name, mimeType: item.mimeType, size: item.size, createdAt: item.createdAt, temporary: true, data: item.buffer.toString('base64') };
};

export const hydrateTemporaryMessages = async (conversationId, messages = []) => {
    const bucket = attachments.get(safeId(conversationId)) || new Map();
    return Promise.all((messages || []).map(async item => {
        if (item.role !== 'user' || !item.attachments?.length) return item;
        const parts = [{ type: 'text', text: item.content || 'Review the attached files.' }];
        for (const file of item.attachments) {
            const stored = bucket.get(file.attachmentId);
            if (!stored) {
                parts.push({ type: 'text', text: `\n\nTemporary attachment is no longer available: ${file.name}.` });
                continue;
            }
            if (isImageAttachment(stored.mimeType)) {
                parts.push({ type: 'text', text: `Image attachment: ${stored.name} (${stored.mimeType}, ${stored.size} bytes).` });
                parts.push({ type: 'image_url', image_url: { url: `data:${stored.mimeType};base64,${stored.buffer.toString('base64')}` } });
            } else if (isTextAttachment(stored.mimeType)) {
                parts.push({ type: 'text', text: `\n\n--- Temporary attachment: ${stored.name} ---\n${stored.buffer.toString('utf8').slice(0, MAX_TEXT_ATTACHMENT_CHARS)}` });
            } else {
                parts.push({ type: 'text', text: `\n\nTemporary binary attachment available only for this session: ${stored.name} (${stored.mimeType}, ${stored.size} bytes).` });
            }
        }
        return { ...item, modelContent: parts };
    }));
};

export const materializeTemporaryAttachments = conversationId => {
    const id = safeId(conversationId);
    const bucket = attachments.get(id) || new Map();
    return [...bucket.values()].map(item => ({
        attachmentId: item.attachmentId,
        name: item.name,
        mimeType: item.mimeType,
        size: item.size,
        createdAt: item.createdAt,
        data: item.buffer.toString('base64'),
    }));
};

export const temporaryConversationStatus = () => ({
    count: conversations.size,
    attachmentConversations: attachments.size,
    ttlMs,
});
