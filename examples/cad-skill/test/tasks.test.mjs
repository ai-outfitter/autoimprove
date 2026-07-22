import assert from 'node:assert/strict';
import test from 'node:test';

import { BACKEND_IDS, splitIds, splitOverride, tasks } from '../src/tasks.mjs';

test('builds a balanced Replicad-only train/validation/test corpus', () => {
  assert.deepEqual(BACKEND_IDS, ['replicad']);
  assert.equal(tasks.length, 16);
  assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length);
  assert.deepEqual(
    Object.fromEntries(Object.entries(splitIds).map(([split, ids]) => [split, ids.length])),
    { train: 6, val: 4, test: 6 },
  );
  assert.equal(splitOverride, splitIds);

  for (const split of ['train', 'val', 'test']) {
    const splitTasks = tasks.filter((task) => splitIds[split].includes(task.id));
    assert.deepEqual(new Set(splitTasks.map((task) => task.payload.kind)), new Set(['model', 'assembly']));
  }

  const assigned = [...splitIds.train, ...splitIds.val, ...splitIds.test];
  assert.equal(new Set(assigned).size, tasks.length);
  assert.deepEqual(new Set(assigned), new Set(tasks.map((task) => task.id)));
});

test('keeps public examples separate from hidden parametric probes', () => {
  for (const task of tasks) {
    assert.equal(task.payload.backend, 'replicad');
    assert.ok(task.payload.publicSpec);
    assert.ok(task.payload.evaluationSpecs.length >= 1);
    assert.equal(
      task.payload.evaluationSpecs.some((spec) => spec.id === task.payload.publicSpec.id),
      false,
    );
    for (const spec of [task.payload.publicSpec, ...task.payload.evaluationSpecs]) {
      assert.equal(spec.kind, task.payload.kind);
      assert.ok(spec.parts.length >= (spec.kind === 'assembly' ? 2 : 1));
      assert.equal(new Set(spec.parts.map((part) => part.name)).size, spec.parts.length);
      assert.ok(spec.parts.every((part) => ['box', 'cube', 'sphere'].includes(part.primitive)));
    }
  }
});

test('holds out the official CADTestBench prism and richer named assemblies', () => {
  const official = tasks.find((task) => task.id === 'replicad-test-cadtestbench-00003247');
  assert.ok(official);
  assert.deepEqual(official.payload.evaluationSpecs[0].parts, [{
    name: 'prism',
    primitive: 'box',
    center: [0, 0, 0],
    dimensions: [0.3, 0.7, 0.3],
  }]);
  assert.equal(official.payload.evaluationSpecs[0].source.sampleId, '00003247');

  const threePart = tasks.find((task) => task.id === 'replicad-test-assembly-three-part');
  assert.ok(threePart);
  assert.ok(threePart.payload.evaluationSpecs.every((spec) => spec.parts.length === 3));
  assert.ok(
    threePart.payload.evaluationSpecs.some((spec) =>
      spec.parts.filter((part) => part.primitive === 'sphere').length === 2
    ),
  );

  const clearance = tasks.find((task) => task.id === 'replicad-val-assembly-clearance');
  const tangent = clearance.payload.evaluationSpecs[1];
  const [frame, insert] = tangent.parts;
  assert.equal(frame.center[1] + frame.size / 2, insert.center[1] - insert.radius);
});
