import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getVaultPath, toUnixPath } from './memoryCore.mjs';

const cleanAgent = value => String(value || 'nora').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'nora';
const root = () => path.resolve(process.env.OFFICE_WORKSPACE_ROOT || path.join(getVaultPath(), '60-Workspace'));
const normalize = value => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
const forbidden = new Set(['.env', '.git', 'node_modules']);

const assertPath = (agentId, relative, { write = false } = {}) => {
    const agent = cleanAgent(agentId);
    const requested = normalize(relative);
    const first = requested.split('/').filter(Boolean)[0] || agent;
    const allowedRoots = agent === 'nora' ? new Set(['Shared', 'Nora']) : new Set(['Shared', agent[0].toUpperCase() + agent.slice(1)]);
    if (!allowedRoots.has(first)) {
        throw Object.assign(new Error(`${agentId} may only access its own workspace folder and Shared.`), { statusCode: 403 });
    }
    if (write && first === 'Shared' && agent !== 'nora') {
        throw Object.assign(new Error('Only Nora may write directly to Shared workspace files.'), { statusCode: 403 });
    }
    const parts = requested.split('/').filter(Boolean);
    if (parts.some(part => forbidden.has(part) || part.startsWith('.env'))) {
        throw Object.assign(new Error('That workspace path is restricted.'), { statusCode: 403 });
    }
    const absolute = path.resolve(root(), requested || first);
    const base = root();
    if (absolute !== base && !absolute.startsWith(`${base}${path.sep}`)) {
        throw Object.assign(new Error('Workspace path escapes the office workspace root.'), { statusCode: 400 });
    }
    return { absolute, relative: toUnixPath(path.relative(base, absolute)) };
};

export const ensureOfficeWorkspace = async () => {
    const base = root();
    await fs.mkdir(base, { recursive: true });
    for (const folder of ['Shared', 'Nora', 'Marco', 'Luma', 'Dex', 'Iris', 'Vera']) {
        await fs.mkdir(path.join(base, folder), { recursive: true });
    }
    return base;
};

export const resolveOfficeFile = async (agentId, { path: filePath } = {}) => {
    await ensureOfficeWorkspace();
    const target = assertPath(agentId, filePath);
    try {
        const stat = await fs.stat(target.absolute);
        if (!stat.isFile()) throw Object.assign(new Error('Office workspace artifact must be a file.'), { statusCode: 400 });
        return {
            path: target.relative,
            absolute: target.absolute,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
        };
    } catch (error) {
        if (error.code === 'ENOENT') throw Object.assign(new Error('Office workspace file not found.'), { statusCode: 404 });
        throw error;
    }
};

export const listOfficeFiles = async (agentId, { folder, limit = 200 } = {}) => {
    await ensureOfficeWorkspace();
    const agentFolder = cleanAgent(agentId);
    const defaultFolder = agentFolder[0].toUpperCase() + agentFolder.slice(1);
    const target = assertPath(agentId, folder || defaultFolder);
    const max = Math.max(1, Math.min(Number(limit) || 200, 1000));
    const items = [];
    const walk = async current => {
        if (items.length >= max) return;
        let entries;
        try { entries = await fs.readdir(current, { withFileTypes: true }); }
        catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        for (const entry of entries) {
            if (items.length >= max) break;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (entry.isFile()) {
                const stat = await fs.stat(full);
                items.push({
                    path: toUnixPath(path.relative(root(), full)),
                    size: stat.size,
                    modifiedAt: stat.mtime.toISOString(),
                });
            }
        }
    };
    await walk(target.absolute);
    return { root: root(), folder: target.relative, files: items, truncated: items.length >= max };
};

export const readOfficeFile = async (agentId, { path: filePath, maxChars = 100_000 } = {}) => {
    const target = await resolveOfficeFile(agentId, { path: filePath });
    const content = await fs.readFile(target.absolute, 'utf8');
    const limit = Math.max(1_000, Math.min(Number(maxChars) || 100_000, 500_000));
    return { path: target.path, content: content.slice(0, limit), truncated: content.length > limit, size: target.size, modifiedAt: target.modifiedAt };
};

export const writeOfficeFile = async (agentId, { path: filePath, content = '', mode = 'replace' } = {}) => {
    await ensureOfficeWorkspace();
    const target = assertPath(agentId, filePath, { write: true });
    await fs.mkdir(path.dirname(target.absolute), { recursive: true });
    if (mode === 'append') await fs.appendFile(target.absolute, String(content), 'utf8');
    else await fs.writeFile(target.absolute, String(content), 'utf8');
    const stat = await fs.stat(target.absolute);
    return { path: target.relative, size: stat.size, modifiedAt: stat.mtime.toISOString(), mode };
};

export const archiveOfficeFile = async (agentId, { path: filePath } = {}) => {
    await ensureOfficeWorkspace();
    const target = assertPath(agentId, filePath, { write: true });
    const archive = path.join(root(), 'Archive', cleanAgent(agentId));
    await fs.mkdir(archive, { recursive: true });
    const destination = path.join(archive, `${Date.now()}-${path.basename(target.absolute)}`);
    await fs.rename(target.absolute, destination);
    return { archived: true, from: target.relative, to: toUnixPath(path.relative(root(), destination)) };
};
