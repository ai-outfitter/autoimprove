import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { constantScheduler, train } from '../../../dist/index.js';

import { createCadRunner } from '../src/runner.mjs';
import { splitIds, tasks } from '../src/tasks.mjs';

const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetStub = resolve(EXAMPLE_DIR, 'fixtures', 'training-target-agent.mjs');
const splitOverride = {
  train: [splitIds.train[0]],
  val: [splitIds.val[0]],
  test: [splitIds.test[0]],
};
const selectedIds = new Set(Object.values(splitOverride).flat());
const selected = tasks.filter((task) => selectedIds.has(task.id));

test('autoimprove accepts a CAD skill improvement through the Outfitter profile', {
  timeout: 120_000,
}, async () => {
  const runner = createCadRunner({ targetCommand: [process.execPath, targetStub] });
  const optimizer = {
    async complete() {
      return {
        text: JSON.stringify([{
          op: 'add',
          text: 'TRAINING_FIXTURE_READY',
          rationale: 'The trajectories show the target needs the generic Replicad implementation.',
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
    batchSize: 1,
    scheduler: constantScheduler(1),
    concurrency: 1,
    logger: { info() {}, warn() {} },
  });

  assert.equal(summary.accepts, 1);
  assert.equal(summary.baselineScore, 0);
  assert.equal(summary.bestScore, 1);
  assert.match(summary.bestSkill, /TRAINING_FIXTURE_READY/);
});

test('scores a failed target command instead of aborting the rollout', {
  timeout: 60_000,
}, async () => {
  const runner = createCadRunner({
    targetCommand: [process.execPath, '-e', 'process.exit(2)'],
  });
  const result = await runner(selected[0], '# CAD fixture skill');

  assert.equal(result.hard, 0);
  assert.equal(result.soft, 0);
  assert.match(result.failReason, /verification|probe|CADTest|execute/i);
  assert.match(result.trajectory, /target failure:/);
});
