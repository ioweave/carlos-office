import axios from 'axios';

const envKeyForProvider = provider => ({
    openai: process.env.OPENAI_API_KEY,
    'openai-compatible': process.env.OPENAI_COMPATIBLE_API_KEY || process.env.OPENAI_API_KEY,
    claude: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
}[provider]);

const cleanBaseUrl = value => String(value || '').replace(/\/$/, '');

const callOpenAICompatible = async (config, messages, tools) => {
    const isOllama = config.provider === 'ollama';
    const baseUrl = cleanBaseUrl(config.baseUrl || (isOllama
        ? `${process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'}/v1`
        : 'https://api.openai.com/v1'));
    const normalizedBaseUrl = isOllama && !baseUrl.endsWith('/v1') ? `${baseUrl}/v1` : baseUrl;
    const apiKey = isOllama ? 'ollama' : (envKeyForProvider(config.provider) || '');
    if (!isOllama && !apiKey) throw Object.assign(new Error(`${config.provider === 'openai-compatible' ? 'OPENAI_COMPATIBLE_API_KEY' : 'OPENAI_API_KEY'} is not configured.`), { statusCode: 503 });

    const payload = {
        model: config.model,
        messages,
        temperature: config.temperature ?? 0.2,
        stream: false,
    };
    if (tools?.length) payload.tools = tools;

    const response = await axios.post(`${normalizedBaseUrl}/chat/completions`, payload, {
        timeout: 300000,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
    });

    const message = response.data?.choices?.[0]?.message;
    if (!message) throw new Error('The model returned no message.');
    return {
        content: message.content || '',
        toolCalls: message.tool_calls || [],
        rawMessage: message,
    };
};

const callClaude = async (config, messages) => {
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
        timeout: 300000,
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

const callGemini = async (config, messages) => {
    const apiKey = envKeyForProvider('gemini');
    if (!apiKey) throw Object.assign(new Error('GOOGLE_GENERATIVE_AI_API_KEY is not configured.'), { statusCode: 503 });
    const prompt = messages.map(item => `${item.role.toUpperCase()}: ${item.content || ''}`).join('\n\n');
    const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
        { contents: [{ parts: [{ text: prompt }] }] },
        { timeout: 300000, headers: { 'x-goog-api-key': apiKey } },
    );

    return {
        content: response.data?.candidates?.[0]?.content?.parts?.map(item => item.text || '').join('\n') || '',
        toolCalls: [],
        rawMessage: response.data,
    };
};

export const providerSupportsTools = provider => ['ollama', 'openai', 'openai-compatible'].includes(provider);

export const callAI = async (config, messages, tools = []) => {
    const handlers = {
        ollama: callOpenAICompatible,
        openai: callOpenAICompatible,
        'openai-compatible': callOpenAICompatible,
        claude: callClaude,
        gemini: callGemini,
    };

    const handler = handlers[config.provider];
    if (!handler) throw Object.assign(new Error(`Unknown AI provider: ${config.provider}`), { statusCode: 400 });
    return handler(config, messages, providerSupportsTools(config.provider) ? tools : []);
};
