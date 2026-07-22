import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { verifyImprovementOutput } from '../src/postcondition.mjs';

const execFileAsync = promisify(execFile);
const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = resolve(EXAMPLE_DIR, '..', '..');
const TRAIN = join(EXAMPLE_DIR, 'src', 'train.mjs');
const TARGET = join(EXAMPLE_DIR, 'fixtures', 'training-target-agent.mjs');
const SKILL_RELATIVE = join(
  '.agents', 'agents', 'cad', 'skills', 'generate-replicad-cad', 'SKILL.md',
);

test('training command records metrics and promotes only through the held-out gate', {
  timeout: 180_000,
}, async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'autoimprove-cad-command-'));
  const isolatedRepository = join(sandbox, 'repository');
  const stateRoot = join(sandbox, 'state');
  const metricsDir = join(sandbox, 'metrics');
  await cp(join(REPOSITORY_ROOT, '.agents'), join(isolatedRepository, '.agents'), {
    recursive: true,
  });

  const optimizer = [
    process.execPath,
    '-e',
    `process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify([{ op: 'add', text: 'TRAINING_FIXTURE_READY' }])));`,
  ];

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [TRAIN, '--run-id', 'command-fixture', '--trials', '1'],
      {
        cwd: REPOSITORY_ROOT,
        env: {
          ...process.env,
          CAD_REPOSITORY_ROOT: isolatedRepository,
          CAD_STATE_ROOT: stateRoot,
          CAD_METRICS_DIR: metricsDir,
          CAD_TARGET_COMMAND_JSON: JSON.stringify([process.execPath, TARGET]),
          CAD_OPTIMIZER_COMMAND_JSON: JSON.stringify(optimizer),
        },
        timeout: 150_000,
        maxBuffer: 32 * 1024 * 1024,
      },
    );

    const latest = JSON.parse(await readFile(join(metricsDir, 'latest.json'), 'utf8'));
    const history = (await readFile(join(metricsDir, 'history.jsonl'), 'utf8')).trim().split('\n');
    const promotedSkill = await readFile(join(isolatedRepository, SKILL_RELATIVE), 'utf8');
    const rawSummary = JSON.parse(
      await readFile(join(stateRoot, 'command-fixture', 'summary.json'), 'utf8'),
    );

    assert.equal(latest.runId, 'command-fixture');
    assert.equal(latest.trialsPerTask, 1);
    assert.equal(latest.promotion.promoted, true);
    assert.equal(latest.baseline.rs, 0);
    assert.equal(latest.candidate.rs, 100);
    assert.equal(latest.candidate.slices.model.pr, 100);
    assert.equal(latest.candidate.slices.assembly.pr, 100);
    assert.equal(history.length, 1);
    assert.match(promotedSkill, /TRAINING_FIXTURE_READY/);
    assert.equal(rawSummary.promotion.promoted, true);
    assert.match(stdout, /promotion: accepted/);
    assert.equal(stderr, '');

    const verified = await verifyImprovementOutput({
      runId: 'command-fixture',
      repositoryRoot: isolatedRepository,
      stateRoot,
      metricsDir,
    });
    assert.equal(verified.promoted, true);

    await writeFile(
      join(stateRoot, 'command-fixture', 'summary.json'),
      `${JSON.stringify({
        ...rawSummary,
        baselineEvaluation: {
          ...rawSummary.baselineEvaluation,
          evaluations: rawSummary.baselineEvaluation.evaluations.slice(1),
        },
      }, null, 2)}\n`,
    );
    await assert.rejects(
      verifyImprovementOutput({
        runId: 'command-fixture',
        repositoryRoot: isolatedRepository,
        stateRoot,
        metricsDir,
      }),
      /must contain every held-out task for every trial/u,
    );
    await writeFile(
      join(stateRoot, 'command-fixture', 'summary.json'),
      `${JSON.stringify(rawSummary, null, 2)}\n`,
    );

    await writeFile(join(metricsDir, 'latest.json'), `${JSON.stringify({
      ...latest,
      promotion: { ...latest.promotion, promoted: false },
    }, null, 2)}\n`);
    await assert.rejects(
      verifyImprovementOutput({
        runId: 'command-fixture',
        repositoryRoot: isolatedRepository,
        stateRoot,
        metricsDir,
      }),
      /promotion must exactly match the deterministic promotion gate/u,
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
