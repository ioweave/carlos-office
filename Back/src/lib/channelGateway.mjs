import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { enqueueOperationalWork, getOperationalDatabase } from './operationalStore.mjs';
import { integrationEnabled } from './integrationRegistry.mjs';
import { evaluateAuthorization, getAuthorizationRequest } from './authorizationManager.mjs';

const database = getOperationalDatabase();
database.exec(`
    CREATE TABLE IF NOT EXISTS channel_bindings (
        conversation_id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        destination TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS channel_inbound (
        channel TEXT NOT NULL,
        message_id TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        PRIMARY KEY (channel, message_id)
    );
    CREATE TABLE IF NOT EXISTS gateway_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );
`);

const allowed = (name, value) => new Set(String(process.env[name] || '').split(',').map(item => item.trim()).filter(Boolean)).has(String(value));
const conversationIdFor = (channel, destination) => `channel-${channel}-${createHash('sha256').update(`${channel}:${destination}`).digest('hex').slice(0, 32)}`;
const gatewayState = key => database.prepare('SELECT value FROM gateway_state WHERE key = ?').get(key)?.value || '';
const setGatewayState = (key, value) => database.prepare(`
    INSERT INTO gateway_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`).run(key, String(value), Date.now());
const markInbound = (channel, messageId) => {
    const result = database.prepare('INSERT OR IGNORE INTO channel_inbound (channel, message_id, received_at) VALUES (?, ?, ?)')
        .run(channel, String(messageId), Date.now());
    return Number(result.changes || 0) > 0;
};

export const bindConversationDelivery = (conversationId, { channel = 'none', destination = '' } = {}) => {
    if (!conversationId || channel === 'none') return { bound: false };
    if (!['telegram', 'whatsapp', 'email', 'slack', 'discord', 'webhook'].includes(channel)) throw Object.assign(new Error('Unsupported delivery channel.'), { statusCode: 400 });
    database.prepare(`
        INSERT INTO channel_bindings (conversation_id, channel, destination, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET channel = excluded.channel,
            destination = excluded.destination, updated_at = excluded.updated_at
    `).run(String(conversationId), channel, String(destination), Date.now());
    return { bound: true, conversationId, channel, destination: String(destination) };
};
export const deliveryForConversation = conversationId => {
    const row = database.prepare('SELECT channel, destination FROM channel_bindings WHERE conversation_id = ?').get(String(conversationId || ''));
    return row ? { channel: row.channel, destination: row.destination } : null;
};

export const purgeChannelConversation = conversationId => {
    const id = String(conversationId || '');
    const binding = database.prepare('SELECT channel, destination FROM channel_bindings WHERE conversation_id = ?').get(id);
    database.prepare('DELETE FROM channel_bindings WHERE conversation_id = ?').run(id);
    if (binding) database.prepare('DELETE FROM channel_inbound WHERE channel = ? AND message_id LIKE ?').run(binding.channel, `${binding.destination}:%`);
    return { conversationId: id, bindingDeleted: Boolean(binding) };
};

export const queueOutboundForConversation = (conversationId, text, { dedupeKey = '' } = {}) => {
    const delivery = deliveryForConversation(conversationId);
    if (!delivery || !String(text || '').trim()) return { queued: false, reason: 'no-delivery-binding' };
    const content = String(text).trim();
    const key = dedupeKey || `delivery:${conversationId}:${createHash('sha256').update(content).digest('hex')}`;
    const authorization = evaluateAuthorization({
        agentId: 'nora', scope: 'external-message', action: `Send ${delivery.channel} message`,
        details: { delivery, text: content.slice(0, 20_000) },
        context: { dedupeKey: key, conversationId: String(conversationId) },
    });
    if (authorization.decision === 'deny') return { queued: false, denied: true, reason: 'authorization-denied' };
    if (authorization.decision === 'ask') return { queued: false, waitingAuthorization: true, authorizationRequest: authorization.request };
    return enqueueOperationalWork({
        kind: 'channel-delivery',
        payload: { ...delivery, conversationId, text: content },
        dedupeKey: key,
        priority: 0,
        maxAttempts: 8,
    });
};

export const resumeAuthorizedOutbound = requestId => {
    const request = getAuthorizationRequest(requestId);
    if (!request || request.status !== 'approved' || request.scope !== 'external-message') return { resumed: false };
    const delivery = request.details?.delivery;
    const text = String(request.details?.text || '').trim();
    if (!delivery?.channel || !delivery?.destination || !text) return { resumed: false };
    const queued = enqueueOperationalWork({
        kind: 'channel-delivery', payload: { ...delivery, conversationId: request.context?.conversationId || '', text },
        dedupeKey: request.context?.dedupeKey || `authorized-delivery:${request.requestId}`, priority: 0, maxAttempts: 8,
    });
    return { resumed: true, ...queued };
};

const telegramRequest = async (method, body) => {
    const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!token) throw new Error('Telegram bot token is not configured.');
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(35_000),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram returned HTTP ${response.status}.`);
    return payload.result;
};
const chunks = (text, size = 3_900) => {
    const result = [];
    let remaining = String(text || '');
    while (remaining.length) {
        let end = Math.min(size, remaining.length);
        if (end < remaining.length) {
            const boundary = remaining.lastIndexOf('\n', end);
            if (boundary > size * 0.6) end = boundary;
        }
        result.push(remaining.slice(0, end));
        remaining = remaining.slice(end).replace(/^\n+/, '');
    }
    return result.length ? result : [''];
};
const sendTelegram = async (destination, text) => {
    const results = [];
    for (const part of chunks(text)) results.push(await telegramRequest('sendMessage', { chat_id: destination, text: part, disable_web_page_preview: true }));
    return { delivered: true, channel: 'telegram', messages: results.length };
};
const sendWhatsApp = async (destination, text) => {
    const token = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
    const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    if (!token || !phoneNumberId) throw new Error('WhatsApp Cloud credentials are not configured.');
    let count = 0;
    for (const part of chunks(text)) {
        const response = await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'}/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', to: destination, type: 'text', text: { body: part } }),
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`WhatsApp returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
        count += 1;
    }
    return { delivered: true, channel: 'whatsapp', messages: count };
};

const sendWebhook = async (channel, destination, text) => {
    const defaultUrl = channel === 'slack' ? process.env.SLACK_WEBHOOK_URL
        : channel === 'discord' ? process.env.DISCORD_WEBHOOK_URL
            : channel === 'email' ? process.env.EMAIL_WEBHOOK_URL : process.env.OFFICE_WEBHOOK_URL;
    const url = String(destination || defaultUrl || '').trim();
    if (!url) throw new Error(`${channel} webhook is not configured.`);
    const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(channel === 'discord' ? { content: String(text).slice(0, 1_900) } : channel === 'email' ? { to: destination, text: String(text) } : { text: String(text) }),
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${channel} returned HTTP ${response.status}.`);
    return { delivered: true, channel, messages: 1 };
};

export const deliverOutbound = ({ channel, destination, text }) => {
    if (!integrationEnabled('channel', channel, 'outbound')) throw Object.assign(new Error(`${channel} outbound delivery is disabled or unconfigured.`), { statusCode: 409 });
    if (channel === 'telegram') return sendTelegram(destination, text);
    if (channel === 'whatsapp') return sendWhatsApp(destination, text);
    if (['email', 'slack', 'discord', 'webhook'].includes(channel)) return sendWebhook(channel, destination, text);
    throw Object.assign(new Error('Unsupported delivery channel.'), { statusCode: 400 });
};

export const enqueueInboundChannelMessage = ({ channel, messageId, destination, text }) => {
    if (!integrationEnabled('channel', channel, 'inbound')) throw Object.assign(new Error(`${channel} inbound delivery is disabled or unconfigured.`), { statusCode: 409 });
    const content = String(text || '').trim();
    const allowlistName = channel === 'telegram' ? 'TELEGRAM_ALLOWED_CHAT_IDS'
        : channel === 'whatsapp' ? 'WHATSAPP_ALLOWED_NUMBERS'
            : channel === 'email' ? 'EMAIL_ALLOWED_SENDERS' : 'OFFICE_WEBHOOK_ALLOWED_SOURCES';
    if (!allowed(allowlistName, destination)) throw Object.assign(new Error(`${channel} sender is not allowlisted.`), { statusCode: 403 });
    if (!content || !markInbound(channel, `${destination}:${messageId}`)) return { queued: false, duplicate: true };
    const conversationId = conversationIdFor(channel, destination);
    bindConversationDelivery(conversationId, { channel, destination });
    return enqueueOperationalWork({
        kind: 'channel-request',
        payload: { channel, destination: String(destination), conversationId, message: content, externalMessageId: String(messageId) },
        dedupeKey: `inbound:${channel}:${destination}:${messageId}`,
        priority: 0,
        maxAttempts: 5,
    });
};

export const receiveOfficeWebhook = ({ body, headers = {} }) => {
    const expected = String(process.env.OFFICE_WEBHOOK_SECRET || '');
    const supplied = String(headers['x-office-secret'] || '');
    if (!expected || expected.length !== supplied.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
        return { statusCode: 401, body: { error: 'Invalid office webhook secret.' } };
    }
    const source = String(body.source || '').trim();
    const message = String(body.message || '').trim();
    const messageId = String(body.messageId || createHash('sha256').update(`${source}:${message}:${Date.now()}`).digest('hex'));
    const result = enqueueInboundChannelMessage({ channel: 'webhook', messageId, destination: source, text: message });
    return { statusCode: result.queued ? 202 : 200, body: result };
};

export const receiveEmailWebhook = ({ body, headers = {} }) => {
    if (!integrationEnabled('channel', 'email', 'inbound')) return { statusCode: 409, body: { error: 'Email inbound delivery is disabled or unconfigured.' } };
    const expected = String(process.env.EMAIL_INBOUND_SECRET || '');
    const supplied = String(headers['x-email-secret'] || '');
    if (!expected || expected.length !== supplied.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return { statusCode: 401, body: { error: 'Invalid email webhook secret.' } };
    const sender = String(body.sender || body.from || '').trim();
    const messageId = String(body.messageId || body.id || '').trim();
    const content = [String(body.subject || '').trim(), String(body.text || body.message || '').trim()].filter(Boolean).join('\n\n');
    if (!sender || !messageId || !content) return { statusCode: 400, body: { error: 'sender, messageId, and text are required.' } };
    const result = enqueueInboundChannelMessage({ channel: 'email', messageId, destination: sender, text: content });
    return { statusCode: result.queued ? 202 : 200, body: result };
};

let telegramRunning = false;
let telegramLoopPromise = null;
const telegramLoop = async () => {
    let offset = Number(gatewayState('telegram-offset') || 0);
    while (telegramRunning) {
        try {
            const updates = await telegramRequest('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
            for (const update of updates || []) {
                offset = Math.max(offset, Number(update.update_id) + 1);
                setGatewayState('telegram-offset', offset);
                const message = update.message;
                if (!message?.text || message?.chat?.id === undefined) continue;
                try {
                    enqueueInboundChannelMessage({ channel: 'telegram', messageId: message.message_id, destination: message.chat.id, text: message.text });
                } catch (error) {
                    console.error('[gateway] Telegram message rejected:', error.message);
                }
            }
        } catch (error) {
            if (telegramRunning) console.error('[gateway] Telegram polling failed:', error.message);
            await new Promise(resolve => setTimeout(resolve, 3_000));
        }
    }
};
export const startChannelGateway = () => {
    const configured = integrationEnabled('channel', 'telegram', 'inbound');
    if (configured && !telegramRunning) {
        telegramRunning = true;
        telegramLoopPromise = telegramLoop();
    } else if (!configured && telegramRunning) telegramRunning = false;
    return channelGatewayStatus();
};
export const stopChannelGateway = async () => { telegramRunning = false; await Promise.race([telegramLoopPromise || Promise.resolve(), new Promise(resolve => setTimeout(resolve, 1_000))]); };

const validWhatsAppSignature = (rawBody, signature) => {
    const secret = String(process.env.WHATSAPP_APP_SECRET || '');
    if (!secret) return true;
    const supplied = String(signature || '').replace(/^sha256=/, '');
    const expected = createHmac('sha256', secret).update(String(rawBody || '')).digest('hex');
    if (supplied.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
};
export const verifyWhatsAppWebhook = query => {
    const expected = String(process.env.WHATSAPP_VERIFY_TOKEN || '');
    if (query['hub.mode'] !== 'subscribe' || !expected || query['hub.verify_token'] !== expected) return { statusCode: 403, body: { error: 'Webhook verification failed.' } };
    return { statusCode: 200, body: String(query['hub.challenge'] || ''), headers: { 'Content-Type': 'text/plain; charset=utf-8' }, raw: true };
};
export const receiveWhatsAppWebhook = ({ body, rawBody, headers = {} }) => {
    if (!integrationEnabled('channel', 'whatsapp', 'inbound')) return { statusCode: 409, body: { error: 'WhatsApp inbound delivery is disabled or unconfigured.' } };
    if (!validWhatsAppSignature(rawBody, headers['x-hub-signature-256'])) return { statusCode: 401, body: { error: 'Invalid webhook signature.' } };
    let accepted = 0;
    for (const entry of body?.entry || []) for (const change of entry.changes || []) for (const message of change.value?.messages || []) {
        if (message.type !== 'text' || !message.text?.body) continue;
        try {
            const result = enqueueInboundChannelMessage({ channel: 'whatsapp', messageId: message.id, destination: message.from, text: message.text.body });
            if (result.queued) accepted += 1;
        } catch (error) { console.error('[gateway] WhatsApp message rejected:', error.message); }
    }
    return { statusCode: 200, body: { received: true, accepted } };
};

export const channelGatewayStatus = () => ({
    telegram: { configured: Boolean(process.env.TELEGRAM_BOT_TOKEN), allowlistConfigured: Boolean(process.env.TELEGRAM_ALLOWED_CHAT_IDS), running: telegramRunning },
    whatsapp: { configured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID), webhookConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN), allowlistConfigured: Boolean(process.env.WHATSAPP_ALLOWED_NUMBERS) },
    email: { inboundConfigured: Boolean(process.env.EMAIL_INBOUND_SECRET && process.env.EMAIL_ALLOWED_SENDERS), outboundConfigured: Boolean(process.env.EMAIL_WEBHOOK_URL), adapter: 'webhook' },
    slack: { configured: Boolean(process.env.SLACK_WEBHOOK_URL), outbound: true },
    discord: { configured: Boolean(process.env.DISCORD_WEBHOOK_URL), outbound: true },
    webhook: {
        configured: Boolean(process.env.OFFICE_WEBHOOK_URL || (process.env.OFFICE_WEBHOOK_SECRET && process.env.OFFICE_WEBHOOK_ALLOWED_SOURCES)),
        inboundConfigured: Boolean(process.env.OFFICE_WEBHOOK_SECRET && process.env.OFFICE_WEBHOOK_ALLOWED_SOURCES),
        outboundConfigured: Boolean(process.env.OFFICE_WEBHOOK_URL),
    },
    bindings: Number(database.prepare('SELECT COUNT(*) AS count FROM channel_bindings').get().count),
});
