import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getProjectRoot } from './projectFiles.mjs';

const execFileAsync = promisify(execFile);
const blockedSegments = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);
const writableExtensions = new Set([
    '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.md', '.scss', '.css', '.html',
    '.yml', '.yaml', '.toml', '.txt', '.sh', '.ps1', '.xml', '.svg', '.sql', '.graphql',
]);
const safeScriptPattern = /^(?:test(?::.*)?|lint(?::.*)?|check(?::.*)?|typecheck(?::.*)?|verify(?::.*)?|validate(?::.*)?|build(?::.*)?|format:check)$/i;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const normalize = value => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
const isSecretEnvPath = part => part === '.env' || (part.startsWith('.env.') && part !== '.env.example');

const safePath = value => {
    const relative = normalize(value);
    if (!relative) throw Object.assign(new Error('Project file path is required.'), { statusCode: 400 });
    const parts = relative.split('/').filter(Boolean);
    if (parts.some(part => blockedSegments.has(part) || isSecretEnvPath(part))) {
        throw Object.assign(new Error('That project path is restricted.'), { statusCode: 403 });
    }
    const absolute = path.resolve(getProjectRoot(), relative);
    const root = path.resolve(getProjectRoot());
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
        throw Object.assign(new Error('Project path escapes the repository root.'), { statusCode: 400 });
    }
    if (!writableExtensions.has(path.extname(absolute).toLowerCase())) {
        throw Object.assign(new Error('Agents may only write recognized text/source files.'), { statusCode: 400 });
    }
    return { absolute, relative };
};

export const writeProjectFile = async ({ path: filePath, content, expectedSha256 = '', createOnly = false } = {}) => {
    const target = safePath(filePath);
    let previous = null;
    try { previous = await fs.readFile(target.absolute, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (createOnly && previous !== null) throw Object.assign(new Error('Project file already exists.'), { statusCode: 409 });
    if (expectedSha256 && previous !== null && hash(previous) !== expectedSha256) {
        throw Object.assign(new Error('Project file changed since it was read; refusing to overwrite stale content.'), { statusCode: 409 });
    }
    await fs.mkdir(path.dirname(target.absolute), { recursive: true });
    const next = String(content ?? '');
    const temporary = `${target.absolute}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, next, 'utf8');
    await fs.rename(temporary, target.absolute);
    return {
        path: target.relative,
        created: previous === null,
        previousSha256: previous === null ? null : hash(previous),
        sha256: hash(next),
        bytes: Buffer.byteLength(next),
    };
};

export const removeProjectFile = async ({ path: filePath } = {}) => {
    const target = safePath(filePath);
    await fs.rm(target.absolute, { force: true });
    return { path: target.relative, deleted: true };
};

const safeCwd = value => {
    const root = path.resolve(getProjectRoot());
    const absolute = path.resolve(root, normalize(value) || '.');
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
        throw Object.assign(new Error('Command working directory escapes the repository root.'), { statusCode: 400 });
    }
    return absolute;
};

const execute = async (command, args, cwd, timeoutMs) => {
    try {
        const result = await execFileAsync(command, args, {
            cwd,
            timeout: Math.max(1_000, Math.min(Number(timeoutMs) || 60_000, 180_000)),
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024,
            shell: false,
        });
        return { command, args, cwd, exitCode: 0, stdout: result.stdout || '', stderr: result.stderr || '' };
    } catch (error) {
        return {
            command, args, cwd,
            exitCode: Number.isInteger(error.code) ? error.code : 1,
            stdout: error.stdout || '', stderr: error.stderr || error.message,
            failed: true,
        };
    }
};

const npmInvocation = args => process.platform === 'win32'
    ? { command: process.execPath, args: [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args] }
    : { command: 'npm', args };

export const runProjectCheck = async ({
    agentId = 'dex', kind, cwd = '.', path: filePath = '', script = '', args = [], timeoutMs = 60_000,
} = {}) => {
    const directory = safeCwd(cwd);
    const extra = Array.isArray(args) ? args.map(item => String(item)).slice(0, 20) : [];
    if (kind === 'node-check') {
        const target = safePath(filePath);
        return execute(process.execPath, ['--check', target.absolute], directory, timeoutMs);
    }
    if (kind === 'git-status') return execute('git', ['status', '--short', '--branch'], directory, timeoutMs);
    if (kind === 'git-diff') return execute('git', ['diff', ...extra], directory, timeoutMs);
    if (kind === 'git-log') return execute('git', ['log', '--oneline', '--decorate', '-n', String(Math.min(Number(extra[0]) || 12, 50))], directory, timeoutMs);
    if (kind === 'git-show') return execute('git', ['show', '--stat', '--oneline', ...extra], directory, timeoutMs);
    if (kind === 'npm-script') {
        const packagePath = path.join(directory, 'package.json');
        const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
        if (!script || !packageJson.scripts?.[script]) {
            throw Object.assign(new Error(`Unknown npm script: ${script || '(missing)'}`), { statusCode: 400 });
        }
        const arbitraryAllowed = agentId === 'dex'
            && String(process.env.DEX_ALLOW_ARBITRARY_NPM_SCRIPTS || 'false').toLowerCase() === 'true';
        if (!safeScriptPattern.test(script) && !arbitraryAllowed) {
            throw Object.assign(new Error(`npm script ${script} is outside the default check/build allowlist.`), { statusCode: 403 });
        }
        if (/deploy|publish|release/i.test(script) && String(process.env.DEX_ALLOW_DEPLOY_COMMANDS || 'false').toLowerCase() !== 'true') {
            throw Object.assign(new Error('Deployment/release scripts are disabled for agents.'), { statusCode: 403 });
        }
        const invocation = npmInvocation(['run', script, '--', ...extra]);
        return execute(invocation.command, invocation.args, directory, timeoutMs);
    }
    if (kind === 'npm-install') {
        if (!['nora', 'dex'].includes(agentId)) {
            throw Object.assign(new Error('Only Nora or Dex may install project dependencies.'), { statusCode: 403 });
        }
        const invocation = npmInvocation(['install', ...extra]);
        return execute(invocation.command, invocation.args, directory, timeoutMs);
    }
    throw Object.assign(new Error(`Unsupported project check kind: ${kind}`), { statusCode: 400 });
};

export const publishProjectChanges = async ({ message, paths, remote = 'origin', branch = 'main' } = {}) => {
    const commitMessage = String(message || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
    if (!commitMessage) throw Object.assign(new Error('A concise commit message is required.'), { statusCode: 400 });
    if (remote !== 'origin' || branch !== 'main') {
        throw Object.assign(new Error('Agent publishing is restricted to origin/main.'), { statusCode: 403 });
    }
    const requested = [...new Set((Array.isArray(paths) ? paths : []).map(item => safePath(item).relative))].slice(0, 100);
    if (!requested.length) throw Object.assign(new Error('Explicit source paths are required; broad git add is not allowed.'), { statusCode: 400 });
    const root = path.resolve(getProjectRoot());
    const current = await execute('git', ['branch', '--show-current'], root, 30_000);
    const currentBranch = String(current.stdout || '').trim();
    if (current.failed || currentBranch !== branch) {
        throw Object.assign(new Error(`Publishing is restricted to the requested checked-out branch (${branch}); current branch is ${currentBranch || 'unknown'}.`), { statusCode: 409 });
    }
    const staged = await execute('git', ['add', '--', ...requested], root, 60_000);
    if (staged.failed) throw Object.assign(new Error(`Could not stage project changes: ${staged.stderr}`), { statusCode: 500 });
    const diff = await execute('git', ['diff', '--cached', '--name-only', '--', ...requested], root, 30_000);
    const stagedPaths = String(diff.stdout || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    if (!stagedPaths.length) return { published: false, reason: 'No changes to publish.', branch: currentBranch, paths: [] };
    const committed = await execute('git', ['commit', '-m', commitMessage, '--', ...requested], root, 120_000);
    if (committed.failed) throw Object.assign(new Error(`Could not commit project changes: ${committed.stderr}`), { statusCode: 500 });
    const pushed = await execute('git', ['push', remote, branch], root, 180_000);
    if (pushed.failed) throw Object.assign(new Error(`Commit was created locally but push failed: ${pushed.stderr}`), { statusCode: 502 });
    const revision = await execute('git', ['rev-parse', 'HEAD'], root, 30_000);
    return { published: true, branch: currentBranch, remote, commit: String(revision.stdout || '').trim(), paths: stagedPaths };
};
