const normalize = value => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
const extension = value => {
    const match = normalize(value).toLowerCase().match(/(\.[a-z0-9]+)$/);
    return match?.[1] || '';
};
const nameOf = value => normalize(value).split('/').filter(Boolean).at(-1) || 'artifact';

const meta = ({ source, path, agentId = '', title = '', size = 0, mimeType = '', previewKind = '' }) => {
    const normalizedPath = normalize(path);
    if (!normalizedPath) return null;
    const ext = extension(normalizedPath);
    const name = nameOf(normalizedPath);
    const inferredMime = ({
        '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
        '.jsonl': 'application/jsonl', '.csv': 'text/csv', '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
        '.scss': 'text/x-scss', '.js': 'text/javascript', '.jsx': 'text/jsx', '.mjs': 'text/javascript', '.ts': 'text/typescript',
        '.tsx': 'text/tsx', '.yml': 'text/yaml', '.yaml': 'text/yaml', '.toml': 'text/toml', '.xml': 'application/xml',
        '.svg': 'image/svg+xml', '.sql': 'text/sql', '.graphql': 'text/graphql', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
    }[ext] || 'text/plain');
    const inferredKind = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)
        ? 'image'
        : ext === '.pdf'
            ? 'pdf'
            : ['.md', '.markdown'].includes(ext)
                ? 'markdown'
                : ['.html', '.htm', '.svg'].includes(ext)
                    ? 'html'
                    : ['.json', '.jsonl'].includes(ext)
                        ? 'json'
                        : 'code';
    return {
        artifactId: `${source}:${agentId}:${normalizedPath}`,
        source,
        agentId,
        path: normalizedPath,
        name,
        title: String(title || name),
        size: Number(size || 0),
        mimeType: mimeType || inferredMime,
        previewKind: previewKind || inferredKind,
    };
};

const fromEvent = (event, fallbackAgentId) => {
    if (!event || event.failed) return [];
    const result = event.result || {};
    if (event.name === 'office_file_write' && result.path) {
        return [meta({ source: 'workspace', path: result.path, agentId: fallbackAgentId, size: result.size })].filter(Boolean);
    }
    if (event.name === 'project_write_file' && result.path) {
        return [meta({ source: 'project', path: result.path, agentId: 'dex', size: result.bytes })].filter(Boolean);
    }
    if (['playwright_inspect_page', 'playwright_check_page', 'playwright_interact'].includes(event.name) && result.screenshotPath) {
        return [meta({ source: 'browser-capture', path: result.screenshotPath, agentId: fallbackAgentId, title: 'Browser capture', mimeType: 'image/png', previewKind: 'image' })].filter(Boolean);
    }
    const declared = Array.isArray(result.artifacts) ? result.artifacts : [];
    return declared.map(item => meta({ ...item, agentId: item.agentId || fallbackAgentId })).filter(Boolean);
};

export const artifactsForMessage = (message, fallbackAgentId = 'nora') => {
    const direct = Array.isArray(message?.artifacts) ? message.artifacts.map(item => meta({ ...item, agentId: item.agentId || fallbackAgentId })) : [];
    const discovered = (message?.toolEvents || []).flatMap(event => fromEvent(event, fallbackAgentId));
    const unique = new Map();
    [...direct, ...discovered].filter(Boolean).forEach(item => unique.set(item.artifactId, item));
    return [...unique.values()];
};

export const artifactsForConversation = (messages = [], fallbackAgentId = 'nora') => {
    const unique = new Map();
    messages.forEach(message => artifactsForMessage(message, fallbackAgentId).forEach(item => unique.set(item.artifactId, item)));
    return [...unique.values()];
};
