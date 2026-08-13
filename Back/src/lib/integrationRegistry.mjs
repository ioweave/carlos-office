import { createPersistentMap } from './operationalStore.mjs';
import { OFFICE_PLATFORM_CONFIG } from '../platform.config.mjs';

const integrationSettings = createPersistentMap('integration-settings-v1');
const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const credentialReference = value => /^(?:env|vault|keychain|secret):[A-Za-z0-9_.\/-]+$/.test(String(value || '').trim());

const configured = envName => !envName || Boolean(String(process.env[envName] || '').trim());
const present = (...names) => names.every(name => Boolean(String(process.env[name] || '').trim()));

const channelDirectionStatus = channel => {
    if (channel.id === 'telegram') return {
        inboundConfigured: present('TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_CHAT_IDS'),
        outboundConfigured: present('TELEGRAM_BOT_TOKEN'),
    };
    if (channel.id === 'whatsapp') return {
        inboundConfigured: present('WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_ALLOWED_NUMBERS'),
        outboundConfigured: present('WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'),
    };
    if (channel.id === 'email') return {
        inboundConfigured: present('EMAIL_INBOUND_SECRET', 'EMAIL_ALLOWED_SENDERS'),
        outboundConfigured: present('EMAIL_WEBHOOK_URL'),
    };
    if (channel.id === 'webhook') return {
        inboundConfigured: present('OFFICE_WEBHOOK_SECRET', 'OFFICE_WEBHOOK_ALLOWED_SOURCES'),
        outboundConfigured: present('OFFICE_WEBHOOK_URL'),
    };
    return { inboundConfigured: false, outboundConfigured: configured(channel.credentialEnv) };
};

export const listProviderIntegrations = () => OFFICE_PLATFORM_CONFIG.providers.map(provider => {
    const settings = integrationSettings.get(`provider:${provider.id}`) || {};
    return {
        ...provider,
        enabled: settings.enabled ?? (provider.id === 'ollama'),
        configured: provider.local || configured(provider.credentialEnv),
        baseUrl: settings.baseUrl || process.env[`${provider.id.toUpperCase().replaceAll('-', '_')}_BASE_URL`] || provider.baseUrl,
        credentialStored: Boolean(settings.credentialRef),
        credentialRef: credentialReference(settings.credentialRef) ? String(settings.credentialRef) : '',
        updatedAt: settings.updatedAt || '',
        models: OFFICE_PLATFORM_CONFIG.modelOptions.filter(model => model.provider === provider.id),
    };
});

export const listChannelIntegrations = () => OFFICE_PLATFORM_CONFIG.channels.map(channel => {
    const settings = integrationSettings.get(`channel:${channel.id}`) || {};
    const directions = channelDirectionStatus(channel);
    return {
        ...channel,
        enabled: settings.enabled ?? ['telegram', 'whatsapp', 'email'].includes(channel.id),
        ...directions,
        configured: Boolean((channel.inbound && directions.inboundConfigured) || (channel.outbound && directions.outboundConfigured)),
        credentialStored: Boolean(settings.credentialRef),
        credentialRef: credentialReference(settings.credentialRef) ? String(settings.credentialRef) : '',
        destinationHint: String(settings.destinationHint || ''),
        updatedAt: settings.updatedAt || '',
    };
});

export const updateIntegration = ({ kind, id, enabled, baseUrl, destinationHint, credentialRef }) => {
    const catalog = kind === 'provider' ? OFFICE_PLATFORM_CONFIG.providers : kind === 'channel' ? OFFICE_PLATFORM_CONFIG.channels : [];
    if (!catalog.some(item => item.id === id)) throw Object.assign(new Error('Unknown integration.'), { statusCode: 404 });
    const key = `${kind}:${id}`;
    const current = integrationSettings.get(key) || {};
    if (credentialRef !== undefined && String(credentialRef || '').trim() && !credentialReference(credentialRef)) {
        throw Object.assign(new Error('Credentials must be stored outside Carlos Office and referenced as env:, vault:, keychain:, or secret:.'), { statusCode: 400 });
    }
    const next = {
        ...current,
        ...(enabled === undefined ? {} : { enabled: Boolean(enabled) }),
        ...(baseUrl === undefined ? {} : { baseUrl: String(baseUrl || '').trim() }),
        ...(destinationHint === undefined ? {} : { destinationHint: String(destinationHint || '').trim().slice(0, 240) }),
        ...(credentialRef === undefined ? {} : { credentialRef: String(credentialRef || '').trim().slice(0, 240) }),
        updatedAt: now(),
    };
    integrationSettings.set(key, next);
    return clone(kind === 'provider'
        ? listProviderIntegrations().find(item => item.id === id)
        : listChannelIntegrations().find(item => item.id === id));
};

export const integrationEnabled = (kind, id, direction = '') => {
    const record = (kind === 'provider' ? listProviderIntegrations() : listChannelIntegrations()).find(item => item.id === id);
    if (!record?.enabled) return false;
    if (kind === 'channel' && direction === 'inbound') return Boolean(record.inbound && record.inboundConfigured);
    if (kind === 'channel' && direction === 'outbound') return Boolean(record.outbound && record.outboundConfigured);
    return Boolean(record.configured);
};

export const integrationStatus = () => ({ providers: listProviderIntegrations(), channels: listChannelIntegrations() });
