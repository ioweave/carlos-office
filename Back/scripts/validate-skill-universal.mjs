import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
    locateSkillDocument,
    normalizeUniversalSkill,
    persistUniversalSkill,
    readSkillResource,
} from '../src/lib/universalSkill.mjs';
import { parseSkillDocument } from '../src/lib/skillRegistry.mjs';

const execFileAsync = promisify(execFile);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fixtures = [
    { name: 'huashu-design', descriptorName: 'huashu-design', repository: 'https://github.com/alchaincyf/huashu-design', skillPath: 'SKILL.md' },
    { name: 'taste-skill', descriptorName: 'design-taste-frontend', repository: 'https://github.com/leonxlnx/taste-skill', skillPath: 'skills/taste-skill/SKILL.md' },
    { name: 'impeccable', descriptorName: 'impeccable', repository: 'https://github.com/pbakaus/impeccable', skillPath: '.agents/skills/impeccable/SKILL.md' },
    { name: 'caveman', descriptorName: 'caveman', repository: 'https://github.com/juliusbrussee/caveman', skillPath: 'skills/caveman/SKILL.md' },
];
const requiredSections = [
    'Purpose', 'Triggers', 'Non-triggers', 'Inputs', 'Outputs', 'Ordered workflow',
    'Tool contracts', 'Dependencies', 'Referenced resources', 'Constraints / safety',
    'Failure modes', 'Validation criteria', 'Agent applicability', 'Complete upstream instructions',
];

const clone = async (repository, target) => {
    await execFileAsync('git', ['clone', '--depth', '1', `${repository}.git`, target], {
        timeout: 180_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    });
    const [{ stdout: commitSha }, { stdout: commitDate }] = await Promise.all([
        execFileAsync('git', ['-C', target, 'rev-parse', 'HEAD'], { windowsHide: true }),
        execFileAsync('git', ['-C', target, 'show', '-s', '--format=%cI', 'HEAD'], { windowsHide: true }),
    ]);
    return { commitSha: commitSha.trim(), commitDate: commitDate.trim() };
};

const verifyDescriptor = normalized => {
    for (const section of requiredSections) assert.match(normalized.body, new RegExp(`^## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    assert.equal(sha256(normalized.body), normalized.descriptorHash, 'descriptor content hash must cover the canonical body exactly');
    assert.equal(normalized.manifest.contentHash.descriptor, normalized.descriptorHash);
    assert.equal(normalized.manifest.resources.length, normalized.resources.length);
    for (const resource of normalized.resources) assert.equal(sha256(resource.content), resource.sha256, `resource hash mismatch: ${resource.originalPath}`);
};

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'carlos-universal-skills-'));
const installedRoot = path.join(root, 'installed');
const results = [];

try {
    for (const fixture of fixtures) {
        console.error(`[universal-skills] validating ${fixture.name}`);
        const packageRoot = path.join(root, fixture.name);
        const provenance = await clone(fixture.repository, packageRoot);
        const located = await locateSkillDocument(packageRoot, { preferredName: fixture.name });
        assert.equal(path.relative(packageRoot, located).split(path.sep).join('/'), fixture.skillPath, `${fixture.name} canonical SKILL.md path changed`);
        const registryParsed = parseSkillDocument(await fs.readFile(located, 'utf8'));
        assert.equal(registryParsed.name, fixture.descriptorName, `${fixture.name} must pass the same parser used by live installation`);
        assert.ok(registryParsed.description.length > 8);
        const source = {
            kind: 'github', repository: fixture.repository, repositoryName: fixture.name,
            ref: provenance.commitSha, path: fixture.skillPath, fetchedAt: provenance.commitDate,
            upstreamUrl: `${fixture.repository}/blob/${provenance.commitSha}/${fixture.skillPath}`,
        };
        const options = { packageRoot, skillDocumentPath: located, source, provenance };
        const first = await normalizeUniversalSkill(options);
        const second = await normalizeUniversalSkill(options);
        verifyDescriptor(first);
        assert.equal(first.descriptor, second.descriptor, `${fixture.name} normalization must be byte-for-byte deterministic`);
        assert.equal(first.treeHash, second.treeHash);
        assert.equal(first.sourcesHash, second.sourcesHash);
        assert.equal(first.name, fixture.descriptorName);
        assert.ok(first.description.length > 8, `${fixture.name} description must be meaningfully preserved`);

        const target = path.join(installedRoot, first.name);
        await persistUniversalSkill({ skillRoot: target, normalized: first });
        if (first.resources.length) {
            const resource = first.resources[0];
            const inventory = await readSkillResource(installedRoot, first.name, { query: path.extname(resource.originalPath), limit: 5 });
            assert.ok(inventory.total >= 1, 'resource inventory must be searchable without entering model context wholesale');
            assert.ok(inventory.resources.length <= 5);
            const byHash = await readSkillResource(installedRoot, first.name, { sha256: resource.sha256, maxBytes: 97 });
            const byPath = await readSkillResource(installedRoot, first.name, { originalPath: resource.originalPath, maxBytes: 97 });
            assert.equal(byHash.content, byPath.content, 'resource lookup by hash and original path must agree');
        }
        results.push({
            name: first.name, repository: fixture.repository, commitSha: provenance.commitSha,
            skillPath: fixture.skillPath, license: first.license, descriptorHash: first.descriptorHash,
            sourcesHash: first.sourcesHash, treeHash: first.treeHash, resources: first.resources.length,
            bytes: first.totalBytes,
        });
    }

    const malformed = path.join(root, 'malformed');
    await fs.mkdir(malformed, { recursive: true });
    await fs.writeFile(path.join(malformed, 'SKILL.md'), '# Missing frontmatter\n');
    await assert.rejects(() => normalizeUniversalSkill({ packageRoot: malformed }), /frontmatter/i);

    const inert = path.join(root, 'inert-hooks');
    const marker = path.join(inert, 'hook-ran.txt');
    await fs.mkdir(inert, { recursive: true });
    await fs.writeFile(path.join(inert, 'SKILL.md'), '---\nname: inert-hooks\ndescription: >\n  Confirms that ingestion preserves declared commands as untrusted context\n  without executing package hooks.\n---\n# Workflow\n\n1. Inspect the resource.\n');
    await fs.writeFile(path.join(inert, 'package.json'), JSON.stringify({ scripts: { postinstall: `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '\\\\')}','bad')"` } }));
    const inertNormalized = await normalizeUniversalSkill({ packageRoot: inert });
    assert.match(inertNormalized.description, /without executing package hooks/);
    assert.equal(await fs.access(marker).then(() => true).catch(() => false), false, 'ingestion must not execute package hooks');
    assert.equal(inertNormalized.resources.some(item => item.originalPath === 'package.json'), true, 'untrusted operational metadata must remain inspectable');

    console.log(JSON.stringify({ schema: 'carlos-office.universal-skill-validation.v1', passed: true, results }, null, 2));
} finally {
    await fs.rm(root, { recursive: true, force: true });
}
