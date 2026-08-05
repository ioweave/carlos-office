import axios from 'axios';
import * as cheerio from 'cheerio';

const normalizeResult = item => ({
    title: item.title || item.name || '',
    url: item.url || item.href || '',
    snippet: item.snippet || item.description || item.content || '',
});

const searchSearxng = async (query, maxResults) => {
    const baseUrl = process.env.SEARXNG_URL;
    if (!baseUrl) throw new Error('SEARXNG_URL is not configured.');
    const response = await axios.get(`${baseUrl.replace(/\/$/, '')}/search`, {
        params: { q: query, format: 'json', language: 'en' },
        timeout: 20000,
    });
    return (response.data?.results || []).slice(0, maxResults).map(normalizeResult);
};

const searchBrave = async (query, maxResults) => {
    const key = process.env.BRAVE_SEARCH_API_KEY;
    if (!key) throw new Error('BRAVE_SEARCH_API_KEY is not configured.');
    const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        params: { q: query, count: maxResults },
        headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
        timeout: 20000,
    });
    return (response.data?.web?.results || []).slice(0, maxResults).map(normalizeResult);
};

const searchTavily = async (query, maxResults) => {
    const key = process.env.TAVILY_API_KEY;
    if (!key) throw new Error('TAVILY_API_KEY is not configured.');
    const response = await axios.post('https://api.tavily.com/search', {
        api_key: key,
        query,
        max_results: maxResults,
        search_depth: 'basic',
        include_answer: false,
    }, { timeout: 20000 });
    return (response.data?.results || []).slice(0, maxResults).map(normalizeResult);
};

const decodeDuckDuckGoUrl = href => {
    try {
        const url = new URL(href, 'https://duckduckgo.com');
        return url.searchParams.get('uddg') || url.toString();
    } catch {
        return href;
    }
};

const searchDuckDuckGo = async (query, maxResults) => {
    const response = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: query },
        headers: { 'User-Agent': 'Mozilla/5.0 CarlosOffice/0.1' },
        timeout: 20000,
    });
    const $ = cheerio.load(response.data);
    const results = [];

    $('.result').each((_, element) => {
        if (results.length >= maxResults) return false;
        const link = $(element).find('.result__a').first();
        const snippet = $(element).find('.result__snippet').first().text().trim();
        const href = link.attr('href');
        if (href) results.push({
            title: link.text().trim(),
            url: decodeDuckDuckGoUrl(href),
            snippet,
        });
        return undefined;
    });

    return results;
};

export const searchWeb = async ({ query, maxResults = 6 }) => {
    const provider = String(process.env.SEARCH_PROVIDER || 'auto').toLowerCase();
    const selected = provider === 'auto'
        ? (process.env.SEARXNG_URL ? 'searxng'
            : process.env.BRAVE_SEARCH_API_KEY ? 'brave'
                : process.env.TAVILY_API_KEY ? 'tavily'
                    : 'duckduckgo')
        : provider;

    const handlers = {
        searxng: searchSearxng,
        brave: searchBrave,
        tavily: searchTavily,
        duckduckgo: searchDuckDuckGo,
    };

    if (!handlers[selected]) throw Object.assign(new Error(`Unknown search provider: ${selected}`), { statusCode: 400 });
    const results = await handlers[selected](query, Math.min(Math.max(Number(maxResults) || 6, 1), 10));
    return { provider: selected, query, results };
};
