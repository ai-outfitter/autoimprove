import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreCadResult } from '../src/scorer.mjs';
import { tasks } from '../src/tasks.mjs';

const taskById = (id) => {
  const task = tasks.find((candidate) => candidate.id === id);
  assert.ok(task, `missing task ${id}`);
  return task;
};

test('fully passes a normalized assembly with exact geometry and optional volumes', () => {
  const task = taskById('anchorscad-train-assembly-10-5');
  const result = scoreCadResult(task, {
    executed: true,
    artifact: 'assembly.step',
    // Adapter ordering is not semantically significant.
    parts: [
      {
        name: 'orb',
        primitive: 'sphere',
        center: [18, 0, 0],
        bounds: { min: [13, -5, -5], max: [23, 5, 5] },
        volume: (4 / 3) * Math.PI * 5 ** 3,
      },
      {
        name: 'base',
        primitive: 'cube',
        center: [0, 0, 0],
        bounds: { min: [-5, -5, -5], max: [5, 5, 5] },
        volume: 1_000,
      },
    ],
    combinedBounds: { min: [-5, -5, -5], max: [23, 5, 5] },
  });

  assert.equal(result.hard, 1);
  assert.equal(result.soft, 1);
  assert.equal(result.failReason, undefined);
  assert.ok(result.checks.every((check) => check.passed));
  assert.ok(result.checks.some((check) => check.id === 'part-volumes'));
});

test('does not require volume when an adapter cannot provide it', () => {
  const task = taskById('scad-js-val-cube-12');
  const result = scoreCadResult(task.payload, {
    executed: true,
    artifact: { path: 'cube.scad' },
    parts: [
      {
        name: 'cube',
        primitive: 'cube',
        center: [0, 0, 0],
        bounds: { min: [-6, -6, -6], max: [6, 6, 6] },
      },
    ],
    combinedBounds: { min: [-6, -6, -6], max: [6, 6, 6] },
  });

  assert.equal(result.hard, 1);
  assert.equal(result.soft, 1);
  assert.equal(result.checks.some((check) => check.id === 'part-volumes'), false);
});

test('returns partial credit and named failures for misplaced assembly geometry', () => {
  const task = taskById('opentscad-val-assembly-8-4');
  const result = scoreCadResult(task, {
    executed: true,
    artifact: 'assembly.scad',
    parts: [
      {
        name: 'base',
        primitive: 'cube',
        center: [0, 0, 0],
        bounds: { min: [-4, -4, -4], max: [4, 4, 4] },
      },
      {
        name: 'orb',
        primitive: 'sphere',
        center: [15, 0, 0],
        bounds: { min: [11, -4, -4], max: [19, 4, 4] },
      },
    ],
    combinedBounds: { min: [-4, -4, -4], max: [19, 4, 4] },
  });

  assert.equal(result.hard, 0);
  assert.ok(result.soft > 0 && result.soft < 1);
  assert.match(result.failReason, /part-centers/);
  assert.match(result.failReason, /part-bounds/);
  assert.match(result.failReason, /combined-bounds/);
  assert.equal(result.checks.find((check) => check.id === 'execution')?.passed, true);
  assert.equal(result.checks.find((check) => check.id === 'artifact')?.passed, true);
});

test('fails an inaccurate optional analytic volume without discarding other credit', () => {
  const task = taskById('replicad-test-sphere-7');
  const analytic = (4 / 3) * Math.PI * 7 ** 3;
  const result = scoreCadResult(task, {
    executed: true,
    artifact: new Uint8Array([1, 2, 3]),
    parts: [
      {
        name: 'sphere',
        primitive: 'sphere',
        center: [0, 0, 0],
        bounds: { min: [-7, -7, -7], max: [7, 7, 7] },
        volume: analytic * 0.8,
      },
    ],
    combinedBounds: { min: [-7, -7, -7], max: [7, 7, 7] },
  });

  assert.equal(result.hard, 0);
  assert.ok(result.soft > 0.8 && result.soft < 1);
  assert.match(result.failReason, /part-volumes/);
});
