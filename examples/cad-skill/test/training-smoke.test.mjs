import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { constantScheduler, train } from '../../../dist/index.js';

import { createCadRunner } from '../src/runner.mjs';
import { splitIds, tasks } from '../src/tasks.mjs';

const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetStub = resolve(EXAMPLE_DIR, 'fixtures', 'training-target-agent.mjs');
const selected = tasks.filter((task) => task.payload.backend === 'scad-js');
const selectedIds = new Set(selected.map((task) => task.id));
const splitOverride = {
  train: splitIds.train.filter((id) => selectedIds.has(id)),
  val: splitIds.val.filter((id) => selectedIds.has(id)),
  test: splitIds.test.filter((id) => selectedIds.has(id)),
};

test('autoimprove accepts a scorer-proven CAD skill improvement', { timeout: 60_000 }, async () => {
  const runner = createCadRunner({ targetCommand: [process.execPath, targetStub] });
  const optimizer = {
    async complete() {
      return {
        text: JSON.stringify([{
          op: 'add',
          text: 'TRAINING_FIXTURE_READY',
          rationale: 'The trajectories show the target needs the native primitive implementation.',
        }]),
      };
    },
  };

  const summary = await train({
    skill: '# CAD fixture skill\n\nFollow the model contract.\n',
    tasks: selected,
    splitOverride,
    runner,
    model: optimizer,
    epochs: 1,
    batchSize: splitOverride.train.length,
    scheduler: constantScheduler(1),
    concurrency: 2,
    logger: { info() {}, warn() {} },
  });

  assert.equal(summary.accepts, 1);
  assert.equal(summary.baselineScore, 0);
  assert.equal(summary.bestScore, 1);
  assert.match(summary.bestSkill, /TRAINING_FIXTURE_READY/);
});

test('scores a failed target command instead of aborting the rollout', async () => {
  const runner = createCadRunner({
    targetCommand: [process.execPath, '-e', 'process.exit(2)'],
  });
  const result = await runner(selected[0], '# CAD fixture skill');

  assert.equal(result.hard, 0);
  assert.equal(result.soft, 0);
  assert.match(result.failReason, /execution/);
  assert.match(result.trajectory, /target failure:/);
});
