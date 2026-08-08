import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getVaultPath, toUnixPath } from './memoryCore.mjs';
import { readOfficeFile, resolveOfficeFile } from './officeFiles.mjs';
import { readProjectFile, resolveProjectFile } from './projectFiles.mjs';

const MAX_PREVIEW_BYTES = Math.max(1_000_000, Number(process.env.ARTIFACT_PREVIEW_MAX_BYTES || 12_000_000));
const MAX_STREAM_BYTES = Math.max(MAX_PREVIEW_BYTES, Number(process.env.ARTIFACT_STREAM_MAX_BYTES || 1_073_741_824));
const browserCaptureRoot = '90-System/Runtime/BrowserCaptures';
const textExtensions = new Set([
    '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.html', '.htm', '.css', '.scss', '.less',
    '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.yml', '.yaml', '.toml', '.xml', '.svg', '.sql', '.graphql',
    '.sh', '.ps1', '.py', '.java', '.go', '.rs', '.rb', '.php', '.c', '.h', '.cpp', '.hpp',
]);
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const audioExtensions = new Set(['.mp3', '.wav', '.wave', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.weba']);
const videoExtensions = new Set(['.mp4', '.m4v', '.webm', '.mov', '.ogv', '.avi', '.mkv']);
const streamExtensions = new Set([...imageExtensions, ...audioExtensions, ...videoExtensions, '.pdf']);
const streamKinds = new Set(['image', 'pdf', 'audio', 'video']);

const normalize = value => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
const basename = value => path.posix.basename(normalize(value)) || 'artifact';
const ext = value => path.posix.extname(normalize(value)).toLowerCase();
const idFor = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
const safeTitle = (value, fallback) => String(value || fallback || 'Artifact').trim().slice(0, 160) || 'Artifact';

const mimeTypeFor = filePath => ({
    '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
    '.jsonl': 'application/jsonl', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.html': 'text/html',
    '.htm': 'text/html', '.css': 'text/css', '.scss': 'text/x-scss', '.less': 'text/x-less', '.js': 'text/javascript',
    '.jsx': 'text/jsx', '.mjs': 'text/javascript', '.cjs': 'text/javascript', '.ts': 'text/typescript', '.tsx': 'text/tsx',
    '.yml': 'text/yaml', '.yaml': 'text/yaml', '.toml': 'text/toml', '.xml': 'application/xml', '.svg': 'image/svg+xml',
    '.sql': 'text/sql', '.graphql': 'text/graphql', '.sh': 'text/x-shellscript', '.ps1': 'text/x-powershell', '.py': 'text/x-python',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
    '.pdf': 'application/pdf',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.wave': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.weba': 'audio/webm',
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
    '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
}[ext(filePath)] || 'application/octet-stream');

const previewKindFor = (filePath, mimeType = '') => {
    const normalizedMime = String(mimeType || '').toLowerCase();
    if (normalizedMime.startsWith('audio/')) return 'audio';
    if (normalizedMime.startsWith('video/')) return 'video';
    if (normalizedMime.startsWith('image/') && normalizedMime !== 'image/svg+xml') return 'image';
    if (normalizedMime === 'application/pdf') return 'pdf';

    const extension = ext(filePath);
    if (imageExtensions.has(extension)) return 'image';
    if (audioExtensions.has(extension)) return 'audio';
    if (videoExtensions.has(extension)) return 'video';
    if (extension === '.pdf') return 'pdf';
    if (['.md', '.markdown'].includes(extension)) return 'markdown';
    if (['.html', '.htm', '.svg'].includes(extension)) return 'html';
    if (['.json', '.jsonl'].includes(extension)) return 'json';
    if (textExtensions.has(extension)) return 'code';
    return 'text';
};

const artifact = ({ source, path: filePath, agentId = '', title = '', size = 0, mimeType = '', previewKind = '' }) => {
    const normalizedPath = normalize(filePath);
    if (!normalizedPath) return null;
    const name = basename(normalizedPath);
    const resolvedMimeType = mimeType || mimeTypeFor(normalizedPath);
    return {
        artifactId: idFor(`${source}|${agentId}|${normalizedPath}`),
        source,
        agentId: String(agentId || ''),
        path: normalizedPath,
        name,
        title: safeTitle(title, name),
        size: Math.max(0, Number(size || 0)),
        mimeType: resolvedMimeType,
        previewKind: previewKind || previewKindFor(normalizedPath, resolvedMimeType),
    };
};

const eventArtifacts = (event, agentId) => {
    if (!event || event.failed) return [];
    const result = event.result || {};
    if (event.name === 'office_file_write' && result.path) {
        return [artifact({ source: 'workspace', path: result.path, agentId, size: result.size, title: result.title })].filter(Boolean);
    }
    if (event.name === 'project_write_file' && result.path) {
        return [artifact({ source: 'project', path: result.path, agentId: 'dex', size: result.bytes, title: result.title })].filter(Boolean);
    }
    if (event.name === 'artifact_publish' && result.artifactId) return [result];
    if (['playwright_inspect_page', 'playwright_check_page', 'playwright_interact'].includes(event.name) && result.screenshotPath) {
        return [artifact({ source: 'browser-capture', path: result.screenshotPath, agentId, mimeType: 'image/png', previewKind: 'image', title: 'Browser capture' })].filter(Boolean);
    }
    const declared = Array.isArray(result.artifacts) ? result.artifacts : [];
    return declared.map(item => artifact({ ...item, agentId: item.agentId || agentId })).filter(Boolean);
};

export const mergeArtifacts = (...groups) => {
    const byId = new Map();
    groups.flatMap(group => Array.isArray(group) ? group : []).forEach(item => {
        if (!item?.artifactId || !item?.path) return;
        byId.set(item.artifactId, { ...item });
    });
    return [...byId.values()].slice(0, 100);
};

export const extractArtifacts = (toolEvents = [], { agentId = '' } = {}) => mergeArtifacts(
    toolEvents.flatMap(event => eventArtifacts(event, agentId)),
);

const assertBrowserCapture = filePath => {
    const relative = normalize(filePath);
    if (!relative.startsWith(`${browserCaptureRoot}/`)) {
        throw Object.assign(new Error('Only Carlos Office browser captures may be previewed from the runtime vault.'), { statusCode: 403 });
    }
    if (!imageExtensions.has(ext(relative))) {
        throw Object.assign(new Error('Browser capture preview supports image files only.'), { statusCode: 400 });
    }
    const root = path.resolve(getVaultPath());
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(`${root}${path.sep}`)) {
        throw Object.assign(new Error('Artifact path escapes the Carlos Office vault.'), { statusCode: 400 });
    }
    return { relative, absolute };
};

const resolveArtifactTarget = async ({ source, path: filePath, agentId = 'nora' } = {}) => {
    const normalizedSource = String(source || '').toLowerCase();
    if (!filePath) throw Object.assign(new Error('Artifact path is required.'), { statusCode: 400 });

    if (normalizedSource === 'workspace') {
        const target = await resolveOfficeFile(agentId, { path: filePath });
        return { ...target, source: 'workspace', agentId };
    }
    if (normalizedSource === 'project') {
        const target = await resolveProjectFile({ path: filePath });
        if (!streamExtensions.has(ext(target.path)) && !textExtensions.has(ext(target.path))) {
            throw Object.assign(new Error('That project artifact type is not previewable.'), { statusCode: 400 });
        }
        return { ...target, source: 'project', agentId: 'dex' };
    }
    if (normalizedSource === 'browser-capture') {
        const target = assertBrowserCapture(filePath);
        const stat = await fs.stat(target.absolute);
        return { path: toUnixPath(target.relative), absolute: target.absolute, size: stat.size, modifiedAt: stat.mtime.toISOString(), source: 'browser-capture', agentId };
    }
    throw Object.assign(new Error('Unsupported artifact source.'), { statusCode: 400 });
};

export const publishArtifact = async (agentId, { source = 'workspace', path: filePath, title = '' } = {}) => {
    const normalizedSource = String(source || 'workspace').toLowerCase();
    const target = await resolveArtifactTarget({ source: normalizedSource, path: filePath, agentId });
    return artifact({ source: target.source, path: target.path, agentId: target.agentId, title, size: target.size });
};

export const readArtifact = async ({ source, path: filePath, agentId = 'nora' } = {}) => {
    const normalizedSource = String(source || '').toLowerCase();
    const target = await resolveArtifactTarget({ source: normalizedSource, path: filePath, agentId });
    const meta = artifact({ source: target.source, path: target.path, agentId: target.agentId, size: target.size });

    if (streamKinds.has(meta.previewKind)) {
        return { ...meta, encoding: 'stream', stream: true, truncated: false };
    }
    if (normalizedSource === 'workspace') {
        const record = await readOfficeFile(agentId, { path: target.path, maxChars: 500_000 });
        return { ...meta, content: record.content, encoding: 'utf8', truncated: record.truncated };
    }
    if (normalizedSource === 'project') {
        const record = await readProjectFile({ path: target.path, maxChars: 100_000 });
        return { ...meta, content: record.content, encoding: 'utf8', truncated: record.truncated };
    }
    throw Object.assign(new Error('This artifact type requires streaming.'), { statusCode: 400 });
};

const parseRange = (header, size) => {
    if (!header) return { start: 0, end: Math.max(0, size - 1), partial: false };
    const match = String(header).match(/^bytes=(\d*)-(\d*)$/i);
    if (!match) throw Object.assign(new Error('Unsupported media range request.'), { statusCode: 416 });
    let start;
    let end;
    if (!match[1] && match[2]) {
        const suffix = Math.max(1, Number(match[2]));
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = Number(match[1] || 0);
        end = match[2] ? Number(match[2]) : size - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
        throw Object.assign(new Error('Requested media range is outside the artifact.'), { statusCode: 416 });
    }
    return { start, end: Math.min(end, size - 1), partial: true };
};

export const streamArtifact = async ({ source, path: filePath, agentId = 'nora', range = '', download = false } = {}) => {
    const target = await resolveArtifactTarget({ source, path: filePath, agentId });
    const meta = artifact({ source: target.source, path: target.path, agentId: target.agentId, size: target.size });
    if (!streamKinds.has(meta.previewKind)) {
        throw Object.assign(new Error('Only image, PDF, audio, and video artifacts use the media stream endpoint.'), { statusCode: 400 });
    }
    if (target.size <= 0) throw Object.assign(new Error('Artifact is empty.'), { statusCode: 404 });
    if (target.size > MAX_STREAM_BYTES) {
        throw Object.assign(new Error(`Artifact exceeds the ${MAX_STREAM_BYTES}-byte streaming limit.`), { statusCode: 413 });
    }

    const requested = parseRange(range, target.size);
    const contentLength = requested.end - requested.start + 1;
    const disposition = download ? 'attachment' : 'inline';
    const headers = {
        'Content-Type': meta.mimeType,
        'Content-Length': String(contentLength),
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
    };
    if (requested.partial) headers['Content-Range'] = `bytes ${requested.start}-${requested.end}/${target.size}`;

    return {
        statusCode: requested.partial ? 206 : 200,
        headers,
        stream: createReadStream(target.absolute, { start: requested.start, end: requested.end }),
    };
};
