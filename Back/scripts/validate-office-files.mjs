import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'carlos-office-files-'));
process.env.OFFICE_SCRATCH_ROOT = workspace;

const { listOfficeFiles, readOfficeFile, writeOfficeFile } = await import('../src/lib/officeFiles.mjs');

try {
    const plan = await writeOfficeFile('dex', { path: 'Dex/plan.md', content: '# Plan' });
    assert.equal(plan.path, 'Dex/plan.md');
    assert.match((await readOfficeFile('dex', { path: 'Dex/plan.md' })).content, /Plan/);

    const canonical = await writeOfficeFile('iris', { path: 'Iris/research.md', content: '# Research' });
    assert.equal(canonical.path, 'Iris/research.md');
    assert.deepEqual((await listOfficeFiles('iris', { folder: 'Iris' })).files.map(item => item.path), ['Iris/research.md']);

    await assert.rejects(() => writeOfficeFile('dex', { path: 'Iris/not-allowed.md', content: 'No' }), error => error.statusCode === 403);
    assert.equal((await readOfficeFile('dex', { path: '60-Workspace/Dex/plan.md' })).path, 'Dex/plan.md', 'Legacy vault-prefixed paths remain readable during migration.');
    console.log('Office scratch-file path contract passed.');
} finally {
    await fs.rm(workspace, { recursive: true, force: true });
}
