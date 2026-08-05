import axios from 'axios';
import * as cheerio from 'cheerio';
import dns from 'node:dns/promises';
import net from 'node:net';

const blockedHostnames = new Set([
    'localhost',
    'metadata.google.internal',
    '169.254.169.254',
]);

const isPrivateIp = address => {
    if (address.startsWith('::ffff:')) return isPrivateIp(address.slice(7));
    if (!net.isIP(address)) return true;
    if (address === '::1') return true;
    if (address.startsWith('10.') || address.startsWith('127.') || address.startsWith('192.168.')) return true;
    if (address.startsWith('169.254.')) return true;
    if (address.startsWith('172.')) {
        const second = Number(address.split('.')[1]);
        if (second >= 16 && second <= 31) return true;
    }
    if (address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')) return true;
    return false;
};

const validateUrl = async rawUrl => {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('Only HTTP and HTTPS URLs are allowed.'), { statusCode: 400 });
    if (blockedHostnames.has(url.hostname) || url.hostname.endsWith('.local')) throw Object.assign(new Error('Private or local URLs are not allowed.'), { statusCode: 400 });

    const addresses = await dns.lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) {
        throw Object.assign(new Error('The URL resolves to a private or unsupported network address.'), { statusCode: 400 });
    }

    return url;
};

const requestWithSafeRedirects = async (rawUrl, redirectsLeft = 3) => {
    const url = await validateUrl(rawUrl);
    const response = await axios.get(url.toString(), {
        timeout: 20000,
        maxRedirects: 0,
        maxContentLength: 2_000_000,
        validateStatus: status => status >= 200 && status < 400,
        headers: {
            'User-Agent': 'CarlosOffice/0.1 (+local research assistant)',
            Accept: 'text/html,application/xhtml+xml,text/plain,application/json',
        },
        responseType: 'text',
    });

    if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (!location || redirectsLeft <= 0) throw new Error('Too many or invalid redirects.');
        return requestWithSafeRedirects(new URL(location, url).toString(), redirectsLeft - 1);
    }

    return { response, finalUrl: url.toString() };
};

export const fetchOnlineDocument = async ({ url, maxChars = 12000 }) => {
    const { response, finalUrl } = await requestWithSafeRedirects(url);
    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    const raw = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

    if (contentType.includes('application/json')) {
        return {
            url: finalUrl,
            title: finalUrl,
            contentType,
            text: raw.slice(0, maxChars),
        };
    }

    if (!contentType.includes('html')) {
        return {
            url: finalUrl,
            title: finalUrl,
            contentType,
            text: raw.replace(/\s+/g, ' ').trim().slice(0, maxChars),
        };
    }

    const $ = cheerio.load(raw);
    $('script, style, noscript, svg, nav, footer, form').remove();
    const title = $('title').first().text().trim() || $('h1').first().text().trim() || finalUrl;
    const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, maxChars);

    return { url: finalUrl, title, contentType, text };
};
