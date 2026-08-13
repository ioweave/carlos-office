import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'carlos-office-extensions-'));
process.env.PROJECT_ROOT = root;
process.env.CARLOS_EXTERNAL_PROJECTS_ROOT = path.join(root, 'external');

const skills = await import('../src/lib/skillRegistry.mjs');
const external = await import('../src/lib/externalProjects.mjs');

try {
    assert.deepEqual(skills.parseGitHubSkillSource('https://github.com/alchaincyf/huashu-design'), {
        repository: 'https://github.com/alchaincyf/huashu-design.git', ref: '', folder: '.',
    }, 'Repository-root GitHub skills must be installable without inventing a subfolder.');
    assert.deepEqual(skills.parseGitHubSkillSource('https://github.com/owner/repo/tree/main/skills/example'), {
        repository: 'https://github.com/owner/repo.git', ref: 'main', folder: 'skills/example',
    });
    const source = path.join(root, 'incoming', 'test-skill');
    await fs.mkdir(path.join(source, 'references'), { recursive: true });
    await fs.writeFile(path.join(source, 'SKILL.md'), `---
name: test-skill
description: Use this skill to verify progressive skill ingestion.
allowed-tools: [artifact_read]
---

# Test skill

Read the supplied evidence and return a concise result.
`, 'utf8');
    await fs.writeFile(path.join(source, 'references', 'evidence.md'), '# Evidence\n', 'utf8');

    const installed = await skills.installSkill({ source });
    assert.equal(installed.name, 'test-skill');
    assert.equal((await skills.listSkills()).length, 1);
    const activated = await skills.readSkill('test-skill');
    assert.deepEqual(activated.allowedTools, ['artifact_read']);
    assert.match(activated.body, /concise result/);
    assert.match(activated.descriptorHash, /^[0-9a-f]{64}$/, 'Canonical quoted descriptor hashes must be recognized by the registry verifier.');
    assert.equal(activated.resourceCount, 1);
    const inventory = await skills.readSkillResource('test-skill', { query: 'evidence', limit: 5 });
    assert.equal(inventory.total, 1, 'Every agent-facing registry must support compact resource discovery.');
    const evidence = await skills.readSkillResource('test-skill', { originalPath: 'references/evidence.md' });
    assert.match(evidence.content, /Evidence/);
    const manifestPath = path.join(root, 'Back', 'skills', 'test-skill', 'SKILL.md.json');
    const tamperedManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    tamperedManifest.resources[0].originalPath = 'references/altered.md';
    await fs.writeFile(manifestPath, JSON.stringify(tamperedManifest, null, 2));
    await assert.rejects(() => skills.readSkillResource('test-skill', { originalPath: 'references/altered.md' }), /tree hash mismatch/i, 'Manifest metadata tampering must fail closed.');
    await assert.rejects(() => skills.installSkill({ source }), /already installed/i);
    await assert.rejects(() => skills.removeSkill({ name: 'test-skill' }), /confirm=true/i);
    assert.equal((await skills.removeSkill({ name: 'test-skill', confirm: true })).removed, true);

    const media = path.join(process.env.CARLOS_EXTERNAL_PROJECTS_ROOT, 'openmontage', 'projects', 'smoke', 'renders', 'final.mp4');
    await fs.mkdir(path.dirname(media), { recursive: true });
    await fs.writeFile(media, Buffer.from('fake-media'));
    const artifact = await external.resolveExternalProjectArtifact('openmontage/projects/smoke/renders/final.mp4');
    assert.equal(artifact.source, 'external-project');
    assert.equal(artifact.size, 10);
    await assert.rejects(() => external.readExternalProjectFile({ path: 'openmontage/.env' }), /restricted/i);

    const normalized = external.normalizeOpenMontageArgs('video_compose', {
        operation: 'remotion_render',
        output_path: 'projects/smoke/renders/final.mp4',
        edit_decisions: {
            duration_seconds: '2',
            cuts: { item: { id: 'card', source: {}, text: 'Carlos Office â€” Ready', in_seconds: '0', out_seconds: '2' } },
        },
    });
    assert.equal(normalized.edit_decisions.cuts.length, 1, 'Native tagged item wrappers must normalize to one cut.');
    assert.equal(normalized.edit_decisions.cuts[0].source, '', 'An empty native source object must retain the approved empty-source contract.');
    assert.equal(normalized.edit_decisions.cuts[0].text, 'Carlos Office — Ready', 'Common UTF-8 mojibake must be repaired before rendering.');
    assert.equal(normalized.edit_decisions.cuts[0].out_seconds, 2, 'Native tagged numeric strings must be coerced.');

    console.log('Skill ingestion and managed external-project contract passed.');
    console.log(`Disposable root: ${root}`);
} finally {
    await fs.rm(root, { recursive: true, force: true });
}
