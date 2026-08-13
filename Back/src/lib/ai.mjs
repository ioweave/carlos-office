import axios from 'axios';
import { randomUUID } from 'node:crypto';

const envKeyForProvider = provider => ({
    openai: process.env.OPENAI_API_KEY,
    'openai-compatible': process.env.OPENAI_COMPATIBLE_API_KEY || process.env.OPENAI_API_KEY,
    claude: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
}[provider]);

const cleanBaseUrl = value => String(value || '').replace(/\/$/, '');
const defaultTimeout = () => Math.max(15_000, Number(process.env.AI_REQUEST_TIMEOUT_MS || 120_000));

const minimaxSeparator = /\]<\]minimax\[>\[/g;
const decodeXml = value => String(value || '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

const taggedScalar = value => {
    const text = decodeXml(value).trim();
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null') return null;
    if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return Number(text);
    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
        try { return JSON.parse(text); } catch { /* preserve it as text */ }
    }
    return text;
};

const taggedValue = value => {
    const source = String(value || '').trim();
    const matches = [...source.matchAll(/<([A-Za-z_][\w-]*)>([\s\S]*?)<\/\1>/g)];
    if (!matches.length) return taggedScalar(source);
    const remainder = source.replace(/<([A-Za-z_][\w-]*)>[\s\S]*?<\/\1>/g, '').trim();
    if (remainder) return taggedScalar(source);
    const entries = matches.map(match => [match[1], taggedValue(match[2])]);
    if (entries.every(([key]) => key === 'item')) return entries.map(([, item]) => item);
    return entries.reduce((result, [key, item]) => {
        if (result[key] === undefined) result[key] = item;
        else result[key] = Array.isArray(result[key]) ? [...result[key], item] : [result[key], item];
        return result;
    }, {});
};

// MiniMax's OpenAI-compatible endpoint occasionally emits its native tagged
// tool syntax in message.content. Normalize it at the provider boundary so no
// internal invocation markup can leak into chat messages or saved artifacts.
export const normalizeTaggedToolCalls = message => {
    const rawContent = typeof message?.content === 'string' ? message.content : '';
    const normalizedContent = rawContent.replace(minimaxSeparator, '');
    const structured = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    if (structured.length || !/<tool_call>/i.test(normalizedContent)) {
        return { content: normalizedContent, toolCalls: structured };
    }
    const marker = normalizedContent.search(/<tool_call>/i);
    const toolRegion = normalizedContent.slice(marker);
    const invokes = [...toolRegion.matchAll(/<invoke\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/invoke>/gi)];
    const toolCalls = invokes.map(match => ({
        id: `call_${randomUUID().replaceAll('-', '')}`,
        type: 'function',
        function: {
            name: match[1].trim(),
            arguments: JSON.stringify(taggedValue(match[2])),
        },
    }));
    return {
        content: normalizedContent.slice(0, marker).trim(),
        toolCalls,
    };
};

const callOpenAICompatible = async (config, messages, tools, options = {}) => {
    const isOllama = config.provider === 'ollama';
    const baseUrl = cleanBaseUrl(config.baseUrl || (isOllama
        ? `${process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'}/v1`
        : 'https://api.openai.com/v1'));
    const normalizedBaseUrl = isOllama && !baseUrl.endsWith('/v1') ? `${baseUrl}/v1` : baseUrl;
    const apiKey = isOllama ? 'ollama' : (envKeyForProvider(config.provider) || '');
    if (!isOllama && !apiKey) {
        throw Object.assign(
            new Error(`${config.provider === 'openai-compatible' ? 'OPENAI_COMPATIBLE_API_KEY' : 'OPENAI_API_KEY'} is not configured.`),
            { statusCode: 503 },
        );
    }

    const payload = {
        model: config.model,
        messages,
        temperature: config.temperature ?? 0.2,
        stream: false,
    };
    if (tools?.length) payload.tools = tools;

    const response = await axios.post(`${normalizedBaseUrl}/chat/completions`, payload, {
        timeout: Math.max(15_000, Number(options.timeoutMs || config.timeoutMs || defaultTimeout())),
        signal: options.signal,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
    });

    const message = response.data?.choices?.[0]?.message;
    if (!message) throw new Error('The model returned no message.');
    return { ...normalizeTaggedToolCalls(message), rawMessage: message };
};

const callClaude = async (config, messages, tools, options = {}) => {
    const apiKey = envKeyForProvider('claude');
    if (!apiKey) throw Object.assign(new Error('ANTHROPIC_API_KEY is not configured.'), { statusCode: 503 });
    const system = messages.filter(item => item.role === 'system').map(item => item.content).join('\n\n');
    const conversation = messages.filter(item => ['user', 'assistant'].includes(item.role)).map(item => ({
        role: item.role,
        content: item.content || '',
    }));

    const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: config.model,
        max_tokens: 4096,
        temperature: config.temperature ?? 0.2,
        system,
        messages: conversation,
    }, {
        timeout: Math.max(15_000, Number(options.timeoutMs || config.timeoutMs || defaultTimeout())),
        signal: options.signal,
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
    });

    return {
        content: response.data?.content?.map(item => item.text || '').join('\n') || '',
        toolCalls: [],
        rawMessage: response.data,
    };
};

const callGemini = async (config, messages, tools, options = {}) => {
    const apiKey = envKeyForProvider('gemini');
    if (!apiKey) throw Object.assign(new Error('GOOGLE_GENERATIVE_AI_API_KEY is not configured.'), { statusCode: 503 });
    const prompt = messages.map(item => `${item.role.toUpperCase()}: ${item.content || ''}`).join('\n\n');
    const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
        { contents: [{ parts: [{ text: prompt }] }] },
        {
            timeout: Math.max(15_000, Number(options.timeoutMs || config.timeoutMs || defaultTimeout())),
            signal: options.signal,
            headers: { 'x-goog-api-key': apiKey },
        },
    );

    return {
        content: response.data?.candidates?.[0]?.content?.parts?.map(item => item.text || '').join('\n') || '',
        toolCalls: [],
        rawMessage: response.data,
    };
};

export const providerSupportsTools = provider => ['ollama', 'openai', 'openai-compatible'].includes(provider);

export const callAI = async (config, messages, tools = [], options = {}) => {
    const handlers = {
        ollama: callOpenAICompatible,
        openai: callOpenAICompatible,
        'openai-compatible': callOpenAICompatible,
        claude: callClaude,
        gemini: callGemini,
    };

    const handler = handlers[config.provider];
    if (!handler) throw Object.assign(new Error(`Unknown AI provider: ${config.provider}`), { statusCode: 400 });
    return handler(config, messages, providerSupportsTools(config.provider) ? tools : [], options);
};
