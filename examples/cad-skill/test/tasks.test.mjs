import assert from 'node:assert/strict';
import test from 'node:test';

import { BACKEND_IDS, splitIds, splitOverride, tasks } from '../src/tasks.mjs';

test('builds eight tasks per backend with complete held-out coverage', () => {
  assert.deepEqual(BACKEND_IDS, ['anchorscad', 'replicad', 'opentscad', 'scad-js']);
  assert.equal(tasks.length, 32);
  assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length);

  for (const backend of BACKEND_IDS) {
    const backendTasks = tasks.filter((task) => task.payload.backend === backend);
    assert.equal(backendTasks.length, 8);
    assert.equal(splitIds.train.filter((id) => id.startsWith(`${backend}-`)).length, 3);
    assert.equal(splitIds.val.filter((id) => id.startsWith(`${backend}-`)).length, 2);
    assert.equal(splitIds.test.filter((id) => id.startsWith(`${backend}-`)).length, 3);
    assert.deepEqual(
      new Set(backendTasks.filter((task) => task.id.includes('-test-')).map((task) => task.payload.kind)),
      new Set(['cube', 'sphere', 'assembly']),
    );
  }

  assert.equal(splitIds.train.length, 12);
  assert.equal(splitIds.val.length, 8);
  assert.equal(splitIds.test.length, 12);
  assert.equal(splitOverride, splitIds);

  const assigned = [...splitIds.train, ...splitIds.val, ...splitIds.test];
  assert.equal(new Set(assigned).size, tasks.length);
  assert.deepEqual(new Set(assigned), new Set(tasks.map((task) => task.id)));
});

test('uses the requested dimensions, centers, names, and primitives', () => {
  const taskFor = (suffix) => {
    const task = tasks.find((candidate) => candidate.id === `replicad-${suffix}`);
    assert.ok(task, `missing task replicad-${suffix}`);
    return task;
  };

  assert.deepEqual(taskFor('train-cube-10').payload.parts, [
    { name: 'cube', primitive: 'cube', center: [0, 0, 0], size: 10 },
  ]);
  assert.deepEqual(taskFor('train-sphere-5').payload.parts, [
    { name: 'sphere', primitive: 'sphere', center: [0, 0, 0], radius: 5 },
  ]);
  assert.deepEqual(taskFor('train-assembly-10-5').payload.parts, [
    { name: 'base', primitive: 'cube', center: [0, 0, 0], size: 10 },
    { name: 'orb', primitive: 'sphere', center: [18, 0, 0], radius: 5 },
  ]);
  assert.deepEqual(taskFor('val-cube-12').payload.parts, [
    { name: 'cube', primitive: 'cube', center: [0, 0, 0], size: 12 },
  ]);
  assert.deepEqual(taskFor('val-assembly-8-4').payload.parts, [
    { name: 'base', primitive: 'cube', center: [0, 0, 0], size: 8 },
    { name: 'orb', primitive: 'sphere', center: [14, 0, 0], radius: 4 },
  ]);
  assert.deepEqual(taskFor('test-sphere-7').payload.parts, [
    { name: 'sphere', primitive: 'sphere', center: [0, 0, 0], radius: 7 },
  ]);
  assert.deepEqual(taskFor('test-cube-14').payload.parts, [
    { name: 'cube', primitive: 'cube', center: [0, 0, 0], size: 14 },
  ]);
  assert.deepEqual(taskFor('test-assembly-6-3').payload.parts, [
    { name: 'base', primitive: 'cube', center: [0, 0, 0], size: 6 },
    { name: 'orb', primitive: 'sphere', center: [11, 0, 0], radius: 3 },
  ]);
});
