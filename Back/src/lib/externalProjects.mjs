import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getProjectRoot } from './projectFiles.mjs';
import { getExecutionContext } from './executionContext.mjs';

const execFileAsync = promisify(execFile);
const externalRoot = path.resolve(process.env.CARLOS_EXTERNAL_PROJECTS_ROOT || path.join(path.dirname(getProjectRoot()), 'Carlos Office External Projects'));
const openMontageRoot = path.join(externalRoot, 'openmontage');
const repository = 'https://github.com/calesthio/OpenMontage.git';
const textExtensions = new Set(['.md', '.txt', '.json', '.jsonl', '.yaml', '.yml', '.py', '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.toml', '.xml', '.svg', '.csv']);
const artifactExtensions = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mp3', '.wav', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.html', '.json', '.md']);

const externalCommandEnv = async () => {
    const extras = [String(process.env.FFMPEG_BIN || '').trim()].filter(Boolean);
    if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
        const packages = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
        try {
            const ffmpegPackage = (await fs.readdir(packages, { withFileTypes: true }))
                .find(entry => entry.isDirectory() && entry.name.startsWith('Gyan.FFmpeg_'));
            if (ffmpegPackage) {
                const root = path.join(packages, ffmpegPackage.name);
                const build = (await fs.readdir(root, { withFileTypes: true }))
                    .find(entry => entry.isDirectory() && /^ffmpeg-.*[-_]build$/i.test(entry.name));
                if (build) extras.push(path.join(root, build.name, 'bin'));
            }
        } catch {}
    }
    return { ...process.env, PATH: [...extras, String(process.env.PATH || '')].filter(Boolean).join(path.delimiter) };
};

const run = async (command, args, { cwd = externalRoot, timeoutMs = 120_000 } = {}) => {
    try {
        const invocation = process.platform === 'win32' && command === 'npm'
            ? { command: process.execPath, args: [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args] }
            : { command, args };
        const result = await execFileAsync(invocation.command, invocation.args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, shell: false, env: await externalCommandEnv() });
        return { exitCode: 0, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
    } catch (error) {
        throw Object.assign(new Error(String(error.stderr || error.message || 'External project command failed.').trim()), {
            statusCode: error.killed ? 408 : 500,
            command,
            exitCode: Number.isInteger(error.code) ? error.code : 1,
        });
    }
};

const exists = async target => {
    try { await fs.access(target); return true; } catch { return false; }
};

const pythonPath = () => process.platform === 'win32'
    ? path.join(openMontageRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(openMontageRoot, '.venv', 'bin', 'python');

const safeExternalPath = value => {
    const relative = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!relative || relative.split('/').some(part => !part || part === '.' || part === '..' || part === '.git' || part === '.env')) {
        throw Object.assign(new Error('External project path is invalid or restricted.'), { statusCode: 400 });
    }
    const absolute = path.resolve(externalRoot, relative);
    if (!absolute.startsWith(`${externalRoot}${path.sep}`)) throw Object.assign(new Error('External project path escapes its managed root.'), { statusCode: 400 });
    return { relative, absolute };
};

export const resolveExternalProjectArtifact = async filePath => {
    const target = safeExternalPath(filePath);
    if (!artifactExtensions.has(path.extname(target.absolute).toLowerCase())) throw Object.assign(new Error('External project artifact type is not previewable.'), { statusCode: 400 });
    const stat = await fs.stat(target.absolute);
    if (!stat.isFile()) throw Object.assign(new Error('External project artifact must be a file.'), { statusCode: 400 });
    return { ...target, path: target.relative, size: stat.size, modifiedAt: stat.mtime.toISOString(), source: 'external-project', agentId: 'luma' };
};

export const readExternalProjectFile = async ({ path: filePath, maxChars = 60_000 } = {}) => {
    const target = safeExternalPath(filePath);
    if (!textExtensions.has(path.extname(target.absolute).toLowerCase())) throw Object.assign(new Error('External project file is not readable text.'), { statusCode: 400 });
    const content = await fs.readFile(target.absolute, 'utf8');
    const limit = Math.max(1_000, Math.min(Number(maxChars) || 60_000, 200_000));
    return { path: target.relative, content: content.slice(0, limit), truncated: content.length > limit };
};

export const probeExternalProjectMedia = async ({ path: filePath } = {}) => {
    const target = safeExternalPath(filePath);
    if (!new Set(['.mp4', '.m4v', '.mov', '.webm', '.mp3', '.wav']).has(path.extname(target.absolute).toLowerCase())) {
        throw Object.assign(new Error('External media probe supports video and audio files only.'), { statusCode: 400 });
    }
    const stat = await fs.stat(target.absolute);
    if (!stat.isFile() || !stat.size) throw Object.assign(new Error('External media file is empty or missing.'), { statusCode: 404 });
    const result = await run('ffprobe', [
        '-v', 'error', '-show_entries', 'format=format_name,duration,size',
        '-show_entries', 'stream=index,codec_type,codec_name,width,height,duration',
        '-of', 'json', target.absolute,
    ], { cwd: externalRoot, timeoutMs: 60_000 });
    const probe = JSON.parse(result.stdout || '{}');
    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    const video = streams.find(stream => stream.codec_type === 'video') || null;
    return {
        path: target.relative,
        size: stat.size,
        durationSeconds: Number(probe.format?.duration || video?.duration || 0),
        width: Number(video?.width || 0),
        height: Number(video?.height || 0),
        hasVideo: Boolean(video),
        hasAudio: streams.some(stream => stream.codec_type === 'audio'),
        streams,
        format: probe.format || {},
    };
};

export const listExternalProjects = async () => {
    const installed = await exists(path.join(openMontageRoot, '.git'));
    let commit = '';
    if (installed) {
        try { commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: openMontageRoot, timeoutMs: 10_000 })).stdout.trim(); } catch {}
    }
    return [{ id: 'openmontage', name: 'OpenMontage', repository, installed, root: openMontageRoot, commit, dependenciesInstalled: await exists(pythonPath()) && await exists(path.join(openMontageRoot, 'remotion-composer', 'node_modules')) }];
};

export const installOpenMontage = async ({ installDependencies = false } = {}) => {
    await fs.mkdir(externalRoot, { recursive: true });
    if (!await exists(path.join(openMontageRoot, '.git'))) {
        if (await exists(openMontageRoot)) throw Object.assign(new Error('OpenMontage target exists but is not a Git repository.'), { statusCode: 409 });
        await run('git', ['clone', '--depth', '1', repository, openMontageRoot], { timeoutMs: 300_000 });
    }
    const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: openMontageRoot, timeoutMs: 10_000 })).stdout.trim();
    const installed = [];
    if (installDependencies) {
        if (!await exists(pythonPath())) {
            await run(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'venv', '.venv'], { cwd: openMontageRoot, timeoutMs: 180_000 });
        }
        await run(pythonPath(), ['-m', 'pip', 'install', '-r', 'requirements.txt'], { cwd: openMontageRoot, timeoutMs: 1_800_000 });
        installed.push('python');
        await run('npm', ['install'], { cwd: path.join(openMontageRoot, 'remotion-composer'), timeoutMs: 1_800_000 });
        installed.push('remotion');
    }
    return { id: 'openmontage', installed: true, dependenciesInstalled: installDependencies, root: openMontageRoot, repository, commit, installedComponents: installed };
};

const openMontagePython = async () => {
    if (!await exists(path.join(openMontageRoot, '.git'))) throw Object.assign(new Error('OpenMontage is not installed. Use external_project_install first.'), { statusCode: 409 });
    if (!await exists(pythonPath())) throw Object.assign(new Error('OpenMontage dependencies are not installed.'), { statusCode: 409 });
    return pythonPath();
};

const parseLastJson = output => {
    const source = String(output || '').trim();
    for (let index = source.lastIndexOf('\n'); index >= -1; index = source.lastIndexOf('\n', index - 1)) {
        const candidate = source.slice(index + 1).trim();
        if (!candidate) continue;
        try { return JSON.parse(candidate); } catch {}
    }
    throw Object.assign(new Error('OpenMontage returned no machine-readable result.'), { statusCode: 502 });
};

export const openMontagePreflight = async () => {
    const python = await openMontagePython();
    const script = "from tools.tool_registry import registry; import json; registry.discover(); print(json.dumps(registry.provider_menu_summary(), default=str, separators=(',', ':')))";
    const result = await run(python, ['-c', script], { cwd: openMontageRoot, timeoutMs: 180_000 });
    return { project: 'openmontage', ...(parseLastJson(result.stdout) || {}) };
};

const collectArtifactPaths = (value, result = new Set()) => {
    if (typeof value === 'string' && artifactExtensions.has(path.extname(value).toLowerCase())) result.add(value);
    else if (Array.isArray(value)) value.forEach(item => collectArtifactPaths(item, result));
    else if (value && typeof value === 'object') Object.values(value).forEach(item => collectArtifactPaths(item, result));
    return result;
};

const hasNativeItemWrapper = value => {
    if (Array.isArray(value)) return value.some(hasNativeItemWrapper);
    if (!value || typeof value !== 'object') return false;
    const keys = Object.keys(value);
    return (keys.length === 1 && keys[0] === 'item') || Object.values(value).some(hasNativeItemWrapper);
};

const normalizeNativeTaggedValue = (value, coerceScalars = false) => {
    if (Array.isArray(value)) return value.map(item => normalizeNativeTaggedValue(item, coerceScalars));
    if (value && typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 1 && keys[0] === 'item') {
            const items = Array.isArray(value.item) ? value.item : [value.item];
            return items.map(item => normalizeNativeTaggedValue(item, true));
        }
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeNativeTaggedValue(item, coerceScalars)]));
    }
    if (typeof value !== 'string') return value;
    value = value
        .replaceAll('\u00e2\u20ac\u201d', '\u2014')
        .replaceAll('\u00e2\u20ac\u201c', '\u2013')
        .replaceAll('\u00c3\u00d7', '\u00d7')
        .replaceAll('\u00c2\u00a0', '\u00a0');
    if (/[ÃÂâ]/.test(value)) {
        const repaired = Buffer.from(value, 'latin1').toString('utf8');
        if (!repaired.includes('\uFFFD')) value = repaired;
    }
    if (!coerceScalars) return value;
    const text = value.trim();
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null') return null;
    if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return Number(text);
    return value;
};

export const normalizeOpenMontageArgs = (toolName, input = {}) => {
    const tagged = hasNativeItemWrapper(input);
    const normalized = normalizeNativeTaggedValue(input, tagged);
    if (toolName !== 'video_compose' || normalized.operation !== 'remotion_render') return normalized;
    const edit = normalized.edit_decisions || {};
    const rawCuts = edit.cuts || edit.scenes;
    if (!rawCuts) return normalized;
    const cuts = (Array.isArray(rawCuts) ? rawCuts : [rawCuts]).map((scene, index) => ({
        ...scene,
        id: String(scene?.id || `scene-${index + 1}`),
        source: typeof scene?.source === 'string' ? scene.source : '',
        in_seconds: Number(scene?.in_seconds ?? scene?.start_seconds ?? 0),
        out_seconds: Number(scene?.out_seconds ?? scene?.end_seconds ?? edit.duration_seconds ?? 1),
    }));
    return {
        ...normalized,
        edit_decisions: {
            ...edit,
            scenes: undefined,
            cuts,
        },
    };
};

const artifactRecords = async data => {
    const records = [];
    for (const candidate of collectArtifactPaths(data)) {
        const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(openMontageRoot, candidate);
        if (absolute !== openMontageRoot && !absolute.startsWith(`${openMontageRoot}${path.sep}`)) continue;
        try {
            const stat = await fs.stat(absolute);
            if (!stat.isFile()) continue;
            const relative = path.relative(externalRoot, absolute).split(path.sep).join('/');
            records.push({ source: 'external-project', path: relative, agentId: 'luma', title: path.basename(absolute), size: stat.size });
        } catch {}
    }
    return records.slice(0, 50);
};

const enforceVideoOutputContract = async (toolName, args, response) => {
    if (toolName !== 'video_compose' || args.operation !== 'remotion_render' || !response?.success) return null;
    const output = String(args.output_path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!output) return null;
    const absolute = path.resolve(openMontageRoot, output);
    if (!absolute.startsWith(`${openMontageRoot}${path.sep}`) || !await exists(absolute)) return null;
    const edit = args.edit_decisions || {};
    const width = Number(edit.width || 0);
    const height = Number(edit.height || 0);
    const duration = Number(edit.duration_seconds || 0);
    const noAudio = edit.audio === undefined
        || edit.audio === null
        || (edit.audio && Object.values(edit.audio).every(value => value == null || value === false));
    if (!(width > 0 && height > 0) && !(duration > 0) && !noAudio) return null;
    const temporary = `${absolute}.${Date.now()}.normalized.mp4`;
    const backup = `${absolute}.${Date.now()}.original.mp4`;
    const ffmpegArgs = ['-y', '-i', absolute];
    if (duration > 0) ffmpegArgs.push('-t', String(duration));
    if (width > 0 && height > 0) ffmpegArgs.push('-vf', `scale=${Math.round(width)}:${Math.round(height)}`);
    if (noAudio) ffmpegArgs.push('-an');
    ffmpegArgs.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-movflags', '+faststart');
    if (!noAudio) ffmpegArgs.push('-c:a', 'aac');
    ffmpegArgs.push(temporary);
    await run('ffmpeg', ffmpegArgs, { cwd: openMontageRoot, timeoutMs: 300_000 });
    try {
        await fs.rename(absolute, backup);
        await fs.rename(temporary, absolute);
        await fs.rm(backup, { force: true });
    } catch (error) {
        if (!await exists(absolute) && await exists(backup)) await fs.rename(backup, absolute).catch(() => {});
        throw error;
    } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
    }
    return { width, height, durationSeconds: duration, audioRemoved: noAudio };
};

const executionReceiptPath = args => {
    const output = String(args?.output_path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const match = output.match(/^projects\/([^/]+)\//i);
    const project = String(match?.[1] || '_carlos-office').replace(/[^a-z0-9._-]+/gi, '-');
    const context = getExecutionContext();
    const jobId = String(context.jobId || 'direct').replace(/[^a-z0-9._-]+/gi, '-');
    return `projects/${project}/artifacts/carlos-office-execution-${jobId}.json`;
};

const persistExecutionReceipt = async ({ approved, toolName, args, response = null, outputContract = null, error = '' }) => {
    const context = getExecutionContext();
    const relative = executionReceiptPath(args);
    const absolute = path.resolve(openMontageRoot, relative);
    if (!absolute.startsWith(`${openMontageRoot}${path.sep}`)) throw Object.assign(new Error('Execution receipt path escapes OpenMontage.'), { statusCode: 400 });
    let previous = null;
    try { previous = JSON.parse(await fs.readFile(absolute, 'utf8')); } catch {}
    const now = new Date().toISOString();
    const receipt = {
        schema: 'carlos-office.openmontage-execution.v1',
        jobId: String(context.jobId || ''),
        requestId: String(context.requestId || ''),
        workflowId: String(context.workflowId || ''),
        invocationCount: Math.max(0, Number(previous?.invocationCount || 0)) + 1,
        approved: approved === true,
        toolName,
        args,
        success: response?.success === true && !error,
        error: String(error || response?.error || ''),
        outputContract,
        createdAt: previous?.createdAt || now,
        updatedAt: now,
    };
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, absolute);
    return { relative, receipt };
};

export const executeOpenMontageTool = async ({ toolName, args = {}, approved = false } = {}) => {
    if (!approved) throw Object.assign(new Error('OpenMontage execution requires approved=true after the production choice and cost implications are shown to Carlos.'), { statusCode: 403 });
    const name = String(toolName || '').trim();
    if (!/^[a-z][a-z0-9_]{1,80}$/.test(name)) throw Object.assign(new Error('OpenMontage tool name is invalid.'), { statusCode: 400 });
    const python = await openMontagePython();
    const requestPath = path.join(os.tmpdir(), `carlos-openmontage-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    const script = "import json,sys; from tools.tool_registry import registry; payload=json.load(open(sys.argv[1],encoding='utf-8')); registry.discover(); tool=registry._tools.get(payload['tool']);\nif tool is None: raise SystemExit('Unknown OpenMontage tool: '+payload['tool']);\nr=tool.execute(payload.get('args') or {}); print(json.dumps({'success':bool(r.success),'data':r.data,'error':r.error},default=str,separators=(',',':')))";
    const normalizedArgs = normalizeOpenMontageArgs(name, args);
    try {
        await fs.writeFile(requestPath, JSON.stringify({ tool: name, args: normalizedArgs }), 'utf8');
        const result = await run(python, ['-c', script, requestPath], { cwd: openMontageRoot, timeoutMs: Number(process.env.OPENMONTAGE_TOOL_TIMEOUT_MS || 1_800_000) });
        const response = parseLastJson(result.stdout);
        const outputContract = await enforceVideoOutputContract(name, normalizedArgs, response);
        const executionReceipt = await persistExecutionReceipt({ approved, toolName: name, args: normalizedArgs, response, outputContract });
        const data = { ...(response.data && typeof response.data === 'object' ? response.data : { result: response.data }), executionReceipt: executionReceipt.relative };
        return { ...response, data, toolName: name, normalizedArgs, outputContract, executionReceipt: executionReceipt.receipt, artifacts: await artifactRecords(data) };
    } catch (error) {
        await persistExecutionReceipt({ approved, toolName: name, args: normalizedArgs, error: error?.message || String(error) }).catch(() => {});
        throw error;
    } finally {
        await fs.rm(requestPath, { force: true }).catch(() => {});
    }
};

export const externalProjectsStatus = async () => ({ root: externalRoot, projects: await listExternalProjects() });
