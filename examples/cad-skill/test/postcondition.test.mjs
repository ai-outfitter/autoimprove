import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyImprovementOutput } from '../src/postcondition.mjs';

test('fails closed when the maintenance agent produces no run artifacts', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'autoimprove-cad-postcondition-'));
  const repositoryRoot = join(sandbox, 'repository');
  const stateRoot = join(sandbox, 'state');
  const metricsDir = join(sandbox, 'metrics');
  const skillDir = join(
    repositoryRoot,
    '.agents',
    'agents',
    'cad',
    'skills',
    'generate-replicad-cad',
  );

  try {
    await mkdir(skillDir, { recursive: true });
    await mkdir(metricsDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '# Fixture\n');

    await assert.rejects(
      verifyImprovementOutput({
        runId: 'missing-artifacts',
        repositoryRoot,
        stateRoot,
        metricsDir,
      }),
      /is missing/u,
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
