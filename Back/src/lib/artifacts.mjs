import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getVaultPath, toUnixPath } from './memoryCore.mjs';
import { readOfficeFile } from './officeFiles.mjs';
import { readProjectFile } from './projectFiles.mjs';

const MAX_PREVIEW_BYTES = Math.max(1_000_000, Number(process.env.ARTIFACT_PREVIEW_MAX_BYTES || 12_000_000));
const browserCaptureRoot = '90-System/Runtime/BrowserCaptures';
const textExtensions = new Set([
    '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.html', '.htm', '.css', '.scss', '.less',
    '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.yml', '.yaml', '.toml', '.xml', '.svg', '.sql', '.graphql',
    '.sh', '.ps1', '.py', '.java', '.go', '.rs', '.rb', '.php', '.c', '.h', '.cpp', '.hpp',
]);
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

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
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.pdf': 'application/pdf',
}[ext(filePath)] || 'text/plain');

const previewKindFor = filePath => {
    const extension = ext(filePath);
    if (imageExtensions.has(extension)) return 'image';
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
    return {
        artifactId: idFor(`${source}|${agentId}|${normalizedPath}`),
        source,
        agentId: String(agentId || ''),
        path: normalizedPath,
        name,
        title: safeTitle(title, name),
        size: Math.max(0, Number(size || 0)),
        mimeType: mimeType || mimeTypeFor(normalizedPath),
        previewKind: previewKind || previewKindFor(normalizedPath),
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

export const publishArtifact = async (agentId, { source = 'workspace', path: filePath, title = '' } = {}) => {
    const normalizedSource = String(source || 'workspace').toLowerCase();
    let meta;
    if (normalizedSource === 'workspace') {
        const record = await readOfficeFile(agentId, { path: filePath, maxChars: 1_000 });
        meta = artifact({ source: 'workspace', path: record.path, agentId, title });
    } else if (normalizedSource === 'project') {
        if (agentId !== 'dex') throw Object.assign(new Error('Only Dex may publish project-source artifacts.'), { statusCode: 403 });
        const record = await readProjectFile({ path: filePath, maxChars: 1_000 });
        meta = artifact({ source: 'project', path: record.path, agentId, title });
    } else if (normalizedSource === 'browser-capture') {
        const target = assertBrowserCapture(filePath);
        const stat = await fs.stat(target.absolute);
        meta = artifact({ source: 'browser-capture', path: target.relative, agentId, title, size: stat.size, previewKind: 'image' });
    } else {
        throw Object.assign(new Error('Artifact source must be workspace, project, or browser-capture.'), { statusCode: 400 });
    }
    return meta;
};

export const readArtifact = async ({ source, path: filePath, agentId = 'nora' } = {}) => {
    const normalizedSource = String(source || '').toLowerCase();
    if (!filePath) throw Object.assign(new Error('Artifact path is required.'), { statusCode: 400 });

    if (normalizedSource === 'workspace') {
        const record = await readOfficeFile(agentId, { path: filePath, maxChars: 500_000 });
        const meta = artifact({ source: 'workspace', path: record.path, agentId });
        return { ...meta, content: record.content, encoding: 'utf8', truncated: record.truncated };
    }
    if (normalizedSource === 'project') {
        const record = await readProjectFile({ path: filePath, maxChars: 100_000 });
        const meta = artifact({ source: 'project', path: record.path, agentId: 'dex' });
        return { ...meta, content: record.content, encoding: 'utf8', truncated: record.truncated };
    }
    if (normalizedSource === 'browser-capture') {
        const target = assertBrowserCapture(filePath);
        const stat = await fs.stat(target.absolute);
        if (stat.size > MAX_PREVIEW_BYTES) throw Object.assign(new Error('Artifact is too large to preview.'), { statusCode: 413 });
        const data = await fs.readFile(target.absolute);
        const meta = artifact({ source: 'browser-capture', path: toUnixPath(target.relative), agentId, size: stat.size, previewKind: 'image' });
        return { ...meta, data: data.toString('base64'), encoding: 'base64', truncated: false };
    }
    throw Object.assign(new Error('Unsupported artifact source.'), { statusCode: 400 });
};
