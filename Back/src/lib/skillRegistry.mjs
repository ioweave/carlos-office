import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getProjectRoot } from './projectFiles.mjs';
import { defaultLicenseResolver, locateSkillDocument, normalizeUniversalSkill, persistUniversalSkill, readSkillResource as readUniversalSkillResource, verifySkillManifest } from './universalSkill.mjs';

const execFileAsync = promisify(execFile);
const skillsRoot = path.join(getProjectRoot(), 'Back', 'skills');
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const blockedNames = new Set(['.git', 'node_modules', '.venv', 'dist', 'build', 'coverage', '__pycache__']);
const maxFiles = Math.max(10, Number(process.env.SKILL_MAX_FILES || 5_000));
const maxBytes = Math.max(100_000, Number(process.env.SKILL_MAX_BYTES || 100_000_000));

const normalizeList = value => {
    const source = String(value || '').trim();
    if (!source) return [];
    const inline = source.startsWith('[') && source.endsWith(']') ? source.slice(1, -1) : source;
    return inline.split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
};

export const getSkillsRoot = () => skillsRoot;

export const parseSkillDocument = source => {
    const text = String(source || '').replace(/^\uFEFF/, '');
    const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/);
    if (!match) throw Object.assign(new Error('SKILL.md must begin with YAML frontmatter.'), { statusCode: 400 });
    const metadata = {};
    const lines = match[1].split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].trim() || /^\s*#/.test(lines[index])) continue;
        const entry = lines[index].match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
        if (!entry) continue;
        const [, key, rawValue] = entry;
        const marker = rawValue.trim();
        if (!['>', '>-', '|', '|-'].includes(marker)) {
            metadata[key] = marker.replace(/^['"]|['"]$/g, '');
            continue;
        }
        const continuation = [];
        while (index + 1 < lines.length && (/^\s+/.test(lines[index + 1]) || !lines[index + 1].trim())) {
            index += 1;
            continuation.push(lines[index].replace(/^\s+/, ''));
        }
        metadata[key] = marker.startsWith('>')
            ? continuation.map(line => line.trim()).filter(Boolean).join(' ')
            : continuation.join('\n').trim();
    }
    const name = String(metadata.name || '').trim();
    const description = String(metadata.description || '').trim();
    if (!namePattern.test(name)) throw Object.assign(new Error('Skill name must use lowercase hyphen-case.'), { statusCode: 400 });
    if (!description || description.length > 1_024) throw Object.assign(new Error('Skill description is required and must be at most 1024 characters.'), { statusCode: 400 });
    const body = match[2].trim();
    if (!body) throw Object.assign(new Error('SKILL.md must contain instructions after its frontmatter.'), { statusCode: 400 });
    return {
        name,
        description,
        license: String(metadata.license || ''),
        allowedTools: normalizeList(metadata['allowed-tools']),
        body,
    };
};

const safeSkillName = value => {
    const name = String(value || '').trim().toLowerCase();
    if (!namePattern.test(name)) throw Object.assign(new Error('Invalid skill name.'), { statusCode: 400 });
    return name;
};

const inspectTree = async root => {
    let files = 0;
    let bytes = 0;
    const walk = async current => {
        for (const entry of await fs.readdir(current, { withFileTypes: true })) {
            if (blockedNames.has(entry.name)) continue;
            if (entry.name === '_resources') continue;
            const target = path.join(current, entry.name);
            const stat = await fs.lstat(target);
            if (stat.isSymbolicLink()) throw Object.assign(new Error('Skill packages may not contain symbolic links.'), { statusCode: 400 });
            if (entry.isDirectory()) await walk(target);
            else if (entry.isFile()) {
                files += 1;
                bytes += stat.size;
                if (files > maxFiles || bytes > maxBytes) throw Object.assign(new Error('Skill package exceeds the configured size limit.'), { statusCode: 413 });
            }
        }
    };
    await walk(root);
    return { files, bytes };
};

export const parseGitHubSkillSource = value => {
    const source = String(value || '').trim().replace(/\/$/, '');
    const match = source.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+))?)?$/i);
    if (!match) return null;
    return {
        repository: `https://github.com/${match[1]}/${match[2]}.git`,
        ref: match[3] || '',
        folder: match[4] || '.',
    };
};

const allowedLocalRoots = () => [
    getProjectRoot(),
    path.join(os.homedir(), '.agents', 'skills'),
    path.join(os.homedir(), '.codex', 'skills'),
    ...String(process.env.SKILL_IMPORT_ROOTS || '').split(path.delimiter).filter(Boolean),
].map(item => path.resolve(item));

const resolveLocalSource = value => {
    const absolute = path.resolve(String(value || ''));
    if (!allowedLocalRoots().some(root => absolute === root || absolute.startsWith(`${root}${path.sep}`))) {
        throw Object.assign(new Error('Skill source is outside the approved import roots.'), { statusCode: 403 });
    }
    return absolute;
};

const readSkillAt = async folder => {
    const source = await fs.readFile(path.join(folder, 'SKILL.md'), 'utf8');
    return { ...parseSkillDocument(source), source, folder };
};

const readManifestAt = async folder => {
    try { return JSON.parse(await fs.readFile(path.join(folder, 'SKILL.md.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};

// Verify that an on-disk descriptor matches its declared content hash. Used
// after every install and on every skill_read to confirm immutability.
const verifyDescriptorHash = async folder => {
    let descriptor;
    try { descriptor = await fs.readFile(path.join(folder, 'SKILL.md'), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return { verified: true, present: false }; throw error; }
    const match = descriptor.match(/^---[\s\S]*?content_hash:\s*\n([\s\S]*?)\n---/);
    if (!match) return { verified: true, present: true };
    const declaredMatch = match[1].match(/descriptor:\s*["']?([0-9a-f]{64})["']?/);
    if (!declaredMatch) return { verified: true, present: true };
    const declared = declaredMatch[1];
    const body = descriptor.replace(/^---[\s\S]*?---\s*/, '');
    const { createHash } = await import('node:crypto');
    const computed = createHash('sha256').update(body).digest('hex');
    return { verified: declared === computed, declared, computed, present: true };
};

export const listSkills = async () => {
    await fs.mkdir(skillsRoot, { recursive: true });
    const result = [];
    for (const entry of await fs.readdir(skillsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        try {
            const record = await readSkillAt(path.join(skillsRoot, entry.name));
            const stat = await fs.stat(path.join(skillsRoot, entry.name, 'SKILL.md'));
            const integrity = await verifyDescriptorHash(path.join(skillsRoot, entry.name));
            const result1 = {
                name: record.name,
                description: record.description,
                license: record.license,
                allowedTools: record.allowedTools,
                path: `Back/skills/${entry.name}/SKILL.md`,
                modifiedAt: stat.mtime.toISOString(),
                descriptorHash: integrity.declared || null,
                hashVerified: Boolean(integrity.declared && integrity.verified),
            };
            result.push(result1);
        } catch (error) {
            result.push({ name: entry.name, invalid: true, error: error.message, path: `Back/skills/${entry.name}/SKILL.md` });
        }
    }
    return result.sort((left, right) => left.name.localeCompare(right.name));
};

export const readSkill = async name => {
    const id = safeSkillName(name);
    const target = path.join(skillsRoot, id);
    const record = await readSkillAt(target);
    const integrity = await verifyDescriptorHash(target);
    if (!integrity.verified) {
        throw Object.assign(new Error(`Descriptor hash mismatch for ${id}; refuse activation unless re-installed.`), { statusCode: 409 });
    }
    const manifest = await readManifestAt(target);
    if (manifest) {
        verifySkillManifest(manifest);
        if (manifest.contentHash?.descriptor !== integrity.declared) throw Object.assign(new Error(`Descriptor manifest mismatch for ${id}; refuse activation unless re-installed.`), { statusCode: 409 });
    }
    return {
        name: record.name,
        description: record.description,
        license: record.license,
        allowedTools: record.allowedTools,
        body: record.body,
        descriptor: record.source,
        path: `Back/skills/${id}/SKILL.md`,
        descriptorHash: integrity.declared,
        manifest: manifest ? { schema: manifest.schema, version: manifest.version, source: manifest.source, provenance: manifest.provenance, contentHash: manifest.contentHash } : null,
        resourceCount: manifest?.resources?.length || 0,
    };
};

export const readSkillResource = (name, options = {}) => readUniversalSkillResource(skillsRoot, safeSkillName(name), options);

// Universal ingestion entry point. Used by installSkill and by the validator
// to produce the canonical descriptor + manifest under the install root.
export const installSkill = async ({ source, replace = false, sourceMeta = {}, provenanceMeta = {}, licenseResolver } = {}) => {
    const remote = parseGitHubSkillSource(source);
    let temporary = '';
    let staging = '';
    try {
        let packageRoot;
        let skillDocumentPath;
        let provenance = { ...provenanceMeta };
        let normalizedSource = { ...sourceMeta };
        if (remote) {
            temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'carlos-skill-'));
            const cloneArgs = ['clone', '--depth', '1'];
            if (remote.ref) cloneArgs.push('--branch', remote.ref, '--single-branch');
            cloneArgs.push(remote.repository, temporary);
            await execFileAsync('git', cloneArgs, { timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
            const temporaryRoot = path.resolve(temporary);
            packageRoot = remote.folder === '.' ? temporaryRoot : path.resolve(temporaryRoot, remote.folder);
            if (packageRoot !== temporaryRoot && !packageRoot.startsWith(`${temporaryRoot}${path.sep}`)) throw Object.assign(new Error('GitHub skill path is invalid.'), { statusCode: 400 });
            const repositoryName = remote.repository.split('/').at(-1).replace(/\.git$/i, '');
            skillDocumentPath = await locateSkillDocument(packageRoot, { preferredName: repositoryName });
            const [{ stdout: commitSha }, { stdout: commitDate }] = await Promise.all([
                execFileAsync('git', ['-C', temporaryRoot, 'rev-parse', 'HEAD'], { windowsHide: true }),
                execFileAsync('git', ['-C', temporaryRoot, 'show', '-s', '--format=%cI', 'HEAD'], { windowsHide: true }),
            ]);
            provenance = { ...provenance, commitSha: String(commitSha).trim(), commitDate: String(commitDate).trim() };
            normalizedSource = {
                ...normalizedSource,
                kind: 'github',
                repository: remote.repository.replace(/\.git$/i, ''),
                repositoryName,
                ref: remote.ref || String(commitSha).trim(),
                path: path.relative(packageRoot, skillDocumentPath).split(path.sep).join('/'),
                fetchedAt: String(commitDate).trim(),
                upstreamUrl: `${remote.repository.replace(/\.git$/i, '')}/blob/${String(commitSha).trim()}/${path.relative(temporaryRoot, skillDocumentPath).split(path.sep).join('/')}`,
            };
        } else {
            packageRoot = resolveLocalSource(source);
            skillDocumentPath = await locateSkillDocument(packageRoot, { preferredName: path.basename(packageRoot) });
            normalizedSource = { kind: sourceMeta.kind || 'local', path: path.relative(packageRoot, skillDocumentPath).split(path.sep).join('/'), ...sourceMeta };
        }

        const sourceDocument = await fs.readFile(skillDocumentPath, 'utf8');
        const record = parseSkillDocument(sourceDocument);
        if (!replace && await exists(path.join(skillsRoot, record.name))) {
            throw Object.assign(new Error(`Skill ${record.name} is already installed.`), { statusCode: 409 });
        }
        const inventory = await inspectTree(packageRoot);
        const normalized = await normalizeUniversalSkill({
            packageRoot,
            skillDocumentPath,
            source: normalizedSource,
            provenance,
            licenseResolver: licenseResolver || defaultLicenseResolver,
        });

        const target = path.join(skillsRoot, normalized.name);
        staging = `${target}.install-${Date.now()}`;
        await fs.rm(staging, { recursive: true, force: true });
        await fs.mkdir(staging, { recursive: true });
        await persistUniversalSkill({ skillRoot: staging, normalized });
        const integrity = await verifyDescriptorHash(staging);
        if (!integrity.verified) {
            throw Object.assign(new Error('Canonical descriptor hash self-check failed after install.'), { statusCode: 500 });
        }
        if (replace) await fs.rm(target, { recursive: true, force: true });
        await fs.rename(staging, target);
        staging = '';

        return {
            installed: true,
            name: normalized.name,
            description: normalized.description,
            path: `Back/skills/${normalized.name}/SKILL.md`,
            manifestPath: `Back/skills/${normalized.name}/SKILL.md.json`,
            descriptorHash: integrity.declared,
            sourcesHash: normalized.sourcesHash,
            resources: normalized.resources.length,
            embeddedResources: normalized.resources.filter(item => item.embedded).length,
            license: normalized.license,
            version: normalized.version,
            ...inventory,
        };
    } finally {
        if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
        if (temporary) await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
};

const exists = async target => {
    try { await fs.access(target); return true; }
    catch { return false; }
};

export const removeSkill = async ({ name, confirm = false } = {}) => {
    if (!confirm) throw Object.assign(new Error('Skill removal requires confirm=true.'), { statusCode: 400 });
    const id = safeSkillName(name);
    const target = path.join(skillsRoot, id);
    try { await fs.access(path.join(target, 'SKILL.md')); }
    catch (error) { if (error.code === 'ENOENT') throw Object.assign(new Error('Skill not found.'), { statusCode: 404 }); throw error; }
    await fs.rm(target, { recursive: true, force: true });
    return { removed: true, name: id };
};

const learnedSidecar = folder => path.join(folder, '.carlos-learned.json');
const readLearnedSidecar = async folder => {
    try { return JSON.parse(await fs.readFile(learnedSidecar(folder), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};

export const createOrUpdateLearnedSkill = async ({ name, description, body, sourceJobId, sourceWorkflowId, evidence = [] } = {}) => {
    let id = safeSkillName(name);
    let target = path.join(skillsRoot, id);
    let provenance = await readLearnedSidecar(target);
    if (await exists(target) && provenance?.createdBy !== 'verified-job-review') {
        const { createHash } = await import('node:crypto');
        id = safeSkillName(`${id.slice(0, 48)}-${createHash('sha256').update(String(sourceJobId || sourceWorkflowId || Date.now())).digest('hex').slice(0, 8)}`);
        target = path.join(skillsRoot, id);
        provenance = await readLearnedSidecar(target);
    }
    const descriptor = [
        '---',
        `name: ${JSON.stringify(id)}`,
        `description: ${JSON.stringify(String(description || '').trim().slice(0, 1_024))}`,
        'license: "Carlos Office internal"',
        'allowed-tools: []',
        '---',
        '',
        String(body || '').trim(),
        '',
    ].join('\n');
    parseSkillDocument(descriptor);
    const nextProvenance = {
        schema: 'carlos-learned-skill/1.0',
        createdBy: 'verified-job-review',
        createdAt: provenance?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourceJobs: [...new Set([...(provenance?.sourceJobs || []), sourceJobId].filter(Boolean))].slice(-100),
        sourceWorkflows: [...new Set([...(provenance?.sourceWorkflows || []), sourceWorkflowId].filter(Boolean))].slice(-100),
        evidence: [...new Set([...(provenance?.evidence || []), ...(evidence || [])].map(String).filter(Boolean))].slice(-100),
    };
    await fs.mkdir(target, { recursive: true });
    const descriptorTemp = path.join(target, `.SKILL.${process.pid}.${Date.now()}.tmp`);
    const sidecarTemp = path.join(target, `.learned.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(descriptorTemp, descriptor, 'utf8');
    await fs.writeFile(sidecarTemp, `${JSON.stringify(nextProvenance, null, 2)}\n`, 'utf8');
    await fs.rename(descriptorTemp, path.join(target, 'SKILL.md'));
    await fs.rename(sidecarTemp, learnedSidecar(target));
    return { learned: true, name: id, path: `Back/skills/${id}/SKILL.md`, updated: Boolean(provenance), provenance: nextProvenance };
};

export const listLearnedSkills = async () => {
    await fs.mkdir(skillsRoot, { recursive: true });
    const records = [];
    for (const entry of await fs.readdir(skillsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const provenance = await readLearnedSidecar(path.join(skillsRoot, entry.name));
        if (provenance?.createdBy === 'verified-job-review') records.push({ name: entry.name, ...provenance });
    }
    return records;
};

export const purgeLearnedSkillProvenance = async jobId => {
    await fs.mkdir(skillsRoot, { recursive: true });
    let updated = 0;
    for (const entry of await fs.readdir(skillsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const folder = path.join(skillsRoot, entry.name);
        const provenance = await readLearnedSidecar(folder);
        if (provenance?.createdBy !== 'verified-job-review') continue;
        const sourceJobs = (provenance.sourceJobs || []).filter(value => value !== jobId);
        const sourceWorkflows = (provenance.sourceWorkflows || []).filter(value => value !== `job:${jobId}`);
        const evidence = (provenance.evidence || []).filter(value => value !== `job://${jobId}`);
        if (sourceJobs.length === (provenance.sourceJobs || []).length
            && sourceWorkflows.length === (provenance.sourceWorkflows || []).length
            && evidence.length === (provenance.evidence || []).length) continue;
        await fs.writeFile(learnedSidecar(folder), `${JSON.stringify({ ...provenance, sourceJobs, sourceWorkflows, evidence, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
        updated += 1;
    }
    return updated;
};

export const skillRegistryStatus = async () => {
    const skills = await listSkills();
    return { root: skillsRoot, installed: skills.filter(item => !item.invalid).length, invalid: skills.filter(item => item.invalid).length, learned: (await listLearnedSkills()).length };
};
