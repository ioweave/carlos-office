import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_ROOT = path.resolve(process.cwd(), '..');
const projectRoot = path.resolve(process.env.PROJECT_ROOT || DEFAULT_ROOT);
const blockedSegments = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.env']);
const textExtensions = new Set([
    '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.md', '.scss', '.css', '.html',
    '.yml', '.yaml', '.toml', '.txt', '.sh', '.ps1', '.xml', '.svg', '.sql', '.graphql',
]);

const normalizeRelative = value => String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

const safeProjectPath = value => {
    const relative = normalizeRelative(value);
    const parts = relative.split('/').filter(Boolean);
    if (parts.some(part => blockedSegments.has(part) || part.startsWith('.env'))) {
        throw Object.assign(new Error('That project path is not available to agents.'), { statusCode: 403 });
    }
    const absolute = path.resolve(projectRoot, relative || '.');
    if (absolute !== projectRoot && !absolute.startsWith(`${projectRoot}${path.sep}`)) {
        throw Object.assign(new Error('Project path escapes the repository root.'), { statusCode: 400 });
    }
    return { absolute, relative };
};

const isReadableText = filePath => textExtensions.has(path.extname(filePath).toLowerCase());

export const getProjectRoot = () => projectRoot;

export const listProjectFiles = async ({ folder = 'Front/src', limit = 200 } = {}) => {
    const { absolute, relative } = safeProjectPath(folder);
    const max = Math.max(1, Math.min(Number(limit) || 200, 1000));
    const result = [];

    const walk = async current => {
        if (result.length >= max) return;
        let entries;
        try { entries = await fs.readdir(current, { withFileTypes: true }); }
        catch (error) {
            if (error.code === 'ENOENT') throw Object.assign(new Error('Project folder not found.'), { statusCode: 404 });
            throw error;
        }
        for (const entry of entries) {
            if (result.length >= max) break;
            if (blockedSegments.has(entry.name) || entry.name.startsWith('.env')) continue;
            const target = path.join(current, entry.name);
            if (entry.isDirectory()) await walk(target);
            else if (entry.isFile() && isReadableText(target)) {
                const stat = await fs.stat(target);
                result.push({
                    path: path.relative(projectRoot, target).split(path.sep).join('/'),
                    size: stat.size,
                    modifiedAt: stat.mtime.toISOString(),
                });
            }
        }
    };

    await walk(absolute);
    return {
        root: projectRoot,
        folder: relative || '.',
        files: result.sort((a, b) => a.path.localeCompare(b.path)),
        truncated: result.length >= max,
    };
};

export const readProjectFile = async ({ path: filePath, maxChars = 30_000 } = {}) => {
    const { absolute, relative } = safeProjectPath(filePath);
    if (!relative || !isReadableText(absolute)) {
        throw Object.assign(new Error('A readable project text file is required.'), { statusCode: 400 });
    }
    let content;
    try { content = await fs.readFile(absolute, 'utf8'); }
    catch (error) {
        if (error.code === 'ENOENT') throw Object.assign(new Error('Project file not found.'), { statusCode: 404 });
        throw error;
    }
    const limit = Math.max(1_000, Math.min(Number(maxChars) || 30_000, 100_000));
    return {
        path: relative,
        content: content.slice(0, limit),
        truncated: content.length > limit,
        totalChars: content.length,
    };
};

export const searchProjectFiles = async ({ query, folder = 'Front/src', limit = 20 } = {}) => {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) throw Object.assign(new Error('Project search query is required.'), { statusCode: 400 });
    const listing = await listProjectFiles({ folder, limit: 1000 });
    const result = [];
    const max = Math.max(1, Math.min(Number(limit) || 20, 100));

    for (const item of listing.files) {
        if (result.length >= max) break;
        try {
            const content = await fs.readFile(path.resolve(projectRoot, item.path), 'utf8');
            const index = content.toLowerCase().indexOf(needle);
            if (index === -1) continue;
            const start = Math.max(0, index - 220);
            result.push({
                path: item.path,
                excerpt: `${start > 0 ? '…' : ''}${content.slice(start, start + 800)}${start + 800 < content.length ? '…' : ''}`,
            });
        } catch {}
    }

    return { query, folder: listing.folder, matches: result };
};
