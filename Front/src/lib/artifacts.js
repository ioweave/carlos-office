const normalize = value => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
const extension = value => {
    const match = normalize(value).toLowerCase().match(/(\.[a-z0-9]+)$/);
    return match?.[1] || '';
};
const nameOf = value => normalize(value).split('/').filter(Boolean).at(-1) || 'artifact';

const mimeFor = ext => ({
    '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
    '.jsonl': 'application/jsonl', '.csv': 'text/csv', '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
    '.scss': 'text/x-scss', '.js': 'text/javascript', '.jsx': 'text/jsx', '.mjs': 'text/javascript', '.ts': 'text/typescript',
    '.tsx': 'text/tsx', '.yml': 'text/yaml', '.yaml': 'text/yaml', '.toml': 'text/toml', '.xml': 'application/xml',
    '.svg': 'image/svg+xml', '.sql': 'text/sql', '.graphql': 'text/graphql', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.pdf': 'application/pdf',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.wave': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.weba': 'audio/webm',
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
    '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
}[ext] || 'application/octet-stream');

const kindFor = (ext, mimeType) => {
    const mime = String(mimeType || '').toLowerCase();
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('image/') && mime !== 'image/svg+xml') return 'image';
    if (mime === 'application/pdf') return 'pdf';
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(ext)) return 'image';
    if (['.mp3', '.wav', '.wave', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.weba'].includes(ext)) return 'audio';
    if (['.mp4', '.m4v', '.webm', '.mov', '.ogv', '.avi', '.mkv'].includes(ext)) return 'video';
    if (ext === '.pdf') return 'pdf';
    if (['.md', '.markdown'].includes(ext)) return 'markdown';
    if (['.html', '.htm', '.svg'].includes(ext)) return 'html';
    if (['.json', '.jsonl'].includes(ext)) return 'json';
    return 'code';
};

const meta = ({ source, path, agentId = '', title = '', size = 0, mimeType = '', previewKind = '' }) => {
    const normalizedPath = normalize(path);
    if (!normalizedPath) return null;
    const ext = extension(normalizedPath);
    const name = nameOf(normalizedPath);
    const inferredMime = mimeType || mimeFor(ext);
    return {
        artifactId: `${source}:${agentId}:${normalizedPath}`,
        source,
        agentId,
        path: normalizedPath,
        name,
        title: String(title || name),
        size: Number(size || 0),
        mimeType: inferredMime,
        previewKind: previewKind || kindFor(ext, inferredMime),
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
