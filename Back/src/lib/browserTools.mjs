import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getVaultPath, toUnixPath } from './memoryCore.mjs';

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const configuredOrigins = new Set(
    String(process.env.PLAYWRIGHT_ALLOWED_ORIGINS || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean),
);
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

const loadPlaywright = async () => {
    try {
        return await import('playwright');
    } catch {
        throw Object.assign(new Error(
            'Playwright is not installed. Run "npm install" and then "npm run playwright:install" inside Back.',
        ), { statusCode: 503 });
    }
};

const allowedUrl = value => {
    let url;
    try { url = new URL(String(value || '')); }
    catch { throw Object.assign(new Error('A valid HTTP or HTTPS URL is required.'), { statusCode: 400 }); }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw Object.assign(new Error('Playwright tools accept only HTTP and HTTPS URLs.'), { statusCode: 400 });
    }
    if (!loopbackHosts.has(url.hostname) && !configuredOrigins.has(url.origin)) {
        throw Object.assign(new Error(
            `Origin ${url.origin} is not allowed. Localhost is allowed by default; add other exact origins to PLAYWRIGHT_ALLOWED_ORIGINS.`,
        ), { statusCode: 403 });
    }
    return url.toString();
};

const viewport = input => ({
    width: Math.max(320, Math.min(Number(input?.width || DEFAULT_VIEWPORT.width), 2560)),
    height: Math.max(320, Math.min(Number(input?.height || DEFAULT_VIEWPORT.height), 1600)),
});

const capturePath = async (page, label = 'page') => {
    const directory = path.join(getVaultPath(), '90-System', 'Runtime', 'BrowserCaptures');
    await fs.mkdir(directory, { recursive: true });
    const safe = String(label || 'page').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page';
    const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${safe}.png`;
    const absolute = path.join(directory, filename);
    await page.screenshot({ path: absolute, fullPage: true });
    return toUnixPath(path.relative(getVaultPath(), absolute));
};

const snapshot = async (page, maxChars = 24_000) => {
    const result = await page.evaluate(() => {
        const visible = element => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const text = document.body?.innerText || '';
        const elements = selector => [...document.querySelectorAll(selector)]
            .filter(visible)
            .slice(0, 120)
            .map(element => ({
                tag: element.tagName.toLowerCase(),
                text: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().slice(0, 300),
                id: element.id || '',
                role: element.getAttribute('role') || '',
                ariaLabel: element.getAttribute('aria-label') || '',
                disabled: Boolean(element.disabled),
            }));
        const unlabeledControls = [...document.querySelectorAll('button,input,select,textarea')]
            .filter(visible)
            .filter(element => {
                const id = element.id;
                const labelled = element.getAttribute('aria-label')
                    || element.getAttribute('aria-labelledby')
                    || element.getAttribute('title')
                    || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`))
                    || element.closest('label');
                return !labelled && !(element.tagName === 'BUTTON' && (element.innerText || '').trim());
            })
            .slice(0, 100)
            .map(element => ({
                tag: element.tagName.toLowerCase(),
                type: element.getAttribute('type') || '',
                className: element.className || '',
            }));
        return {
            title: document.title,
            url: location.href,
            text,
            headings: elements('h1,h2,h3,h4,h5,h6'),
            buttons: elements('button,[role="button"]'),
            links: elements('a[href]'),
            inputs: elements('input,textarea,select'),
            dialogs: elements('[role="dialog"],dialog'),
            viewport: { width: window.innerWidth, height: window.innerHeight },
            document: {
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
                scrollHeight: document.documentElement.scrollHeight,
                clientHeight: document.documentElement.clientHeight,
            },
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            unlabeledControls,
        };
    });
    return {
        ...result,
        text: String(result.text || '').slice(0, Math.max(1_000, Math.min(Number(maxChars) || 24_000, 100_000))),
        textTruncated: String(result.text || '').length > maxChars,
    };
};

const withPage = async ({ url, viewport: requestedViewport, waitMs = 500 }, action) => {
    const target = allowedUrl(url);
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: viewport(requestedViewport) });
    const targetOrigin = new URL(target).origin;
    await context.route('**/*', async route => {
        const requestUrl = route.request().url();
        if (/^(data:|blob:|about:)/.test(requestUrl)) return route.continue();
        try {
            const url = new URL(requestUrl);
            const permitted = url.origin === targetOrigin
                || loopbackHosts.has(url.hostname)
                || configuredOrigins.has(url.origin);
            return permitted ? route.continue() : route.abort('blockedbyclient');
        } catch {
            return route.abort('blockedbyclient');
        }
    });
    const page = await context.newPage();
    const diagnostics = {
        consoleErrors: [],
        pageErrors: [],
        failedRequests: [],
    };
    page.on('console', message => {
        if (message.type() === 'error') diagnostics.consoleErrors.push(message.text().slice(0, 1000));
    });
    page.on('pageerror', error => diagnostics.pageErrors.push(String(error.message || error).slice(0, 1000)));
    page.on('requestfailed', request => diagnostics.failedRequests.push({
        url: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText || 'request failed',
    }));

    try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        allowedUrl(page.url());
        if (waitMs) await page.waitForTimeout(Math.max(0, Math.min(Number(waitMs), 10_000)));
        return await action(page, diagnostics);
    } finally {
        await context.close();
        await browser.close();
    }
};

export const inspectPage = args => withPage(args, async (page, diagnostics) => ({
    ...(await snapshot(page, args.maxChars)),
    diagnostics,
    screenshotPath: args.screenshot === false ? '' : await capturePath(page, args.label || 'inspect'),
}));

export const checkPage = args => withPage(args, async (page, diagnostics) => {
    const state = await snapshot(page, args.maxChars);
    const checks = [
        {
            id: 'horizontal-overflow',
            passed: !state.horizontalOverflow,
            detail: state.horizontalOverflow
                ? `Document width ${state.document.scrollWidth}px exceeds viewport width ${state.document.clientWidth}px.`
                : 'No document-level horizontal overflow detected.',
        },
        {
            id: 'unlabeled-controls',
            passed: state.unlabeledControls.length === 0,
            detail: state.unlabeledControls.length
                ? `${state.unlabeledControls.length} visible controls appear to lack an accessible label.`
                : 'Visible controls have a text label or accessible name.',
        },
        {
            id: 'console-errors',
            passed: diagnostics.consoleErrors.length === 0 && diagnostics.pageErrors.length === 0,
            detail: diagnostics.consoleErrors.length || diagnostics.pageErrors.length
                ? `${diagnostics.consoleErrors.length} console errors and ${diagnostics.pageErrors.length} page errors captured.`
                : 'No console or uncaught page errors captured.',
        },
        {
            id: 'failed-requests',
            passed: diagnostics.failedRequests.length === 0,
            detail: diagnostics.failedRequests.length
                ? `${diagnostics.failedRequests.length} requests failed.`
                : 'No failed requests captured.',
        },
    ];
    return {
        title: state.title,
        url: state.url,
        viewport: state.viewport,
        checks,
        diagnostics,
        headings: state.headings,
        buttons: state.buttons,
        screenshotPath: args.screenshot === false ? '' : await capturePath(page, args.label || 'check'),
    };
});

const resolveLocator = (page, step) => {
    if (step.selector) return page.locator(step.selector).first();
    if (step.text) return page.getByText(step.text, { exact: Boolean(step.exact) }).first();
    throw Object.assign(new Error(`Step ${step.action} requires selector or text.`), { statusCode: 400 });
};

export const interactWithPage = args => withPage(args, async (page, diagnostics) => {
    const steps = Array.isArray(args.steps) ? args.steps.slice(0, 12) : [];
    const events = [];
    for (const [index, step] of steps.entries()) {
        const action = String(step.action || '').toLowerCase();
        try {
            if (action === 'wait') {
                await page.waitForTimeout(Math.max(0, Math.min(Number(step.ms || 500), 10_000)));
            } else {
                const locator = resolveLocator(page, step);
                await locator.waitFor({ state: 'visible', timeout: Math.max(1_000, Math.min(Number(step.timeoutMs || 10_000), 30_000)) });
                if (action === 'click') await locator.click();
                else if (action === 'fill') await locator.fill(String(step.value ?? ''));
                else if (action === 'press') await locator.press(String(step.key || 'Enter'));
                else if (action === 'select') await locator.selectOption(String(step.value ?? ''));
                else if (action === 'check') await locator.check();
                else if (action === 'uncheck') await locator.uncheck();
                else throw Object.assign(new Error(`Unsupported Playwright action: ${action}`), { statusCode: 400 });
            }
            events.push({ index, action, ok: true });
        } catch (error) {
            events.push({ index, action, ok: false, error: error.message });
            if (step.continueOnError !== true) throw error;
        }
    }
    if (args.waitAfterMs) await page.waitForTimeout(Math.max(0, Math.min(Number(args.waitAfterMs), 10_000)));
    return {
        events,
        state: await snapshot(page, args.maxChars),
        diagnostics,
        screenshotPath: args.screenshot === false ? '' : await capturePath(page, args.label || 'interaction'),
    };
});
