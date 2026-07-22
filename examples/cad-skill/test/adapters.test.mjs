import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { verifyModel } from '../src/adapters.mjs';
import { evaluateCadTask } from '../src/cadtestbench.mjs';

const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK_ROOT = join(tmpdir(), 'autoimprove-cad-skill-tests');

const box = (id, name, dimensions, center) => ({
  id,
  kind: 'model',
  parts: [{ name, primitive: 'box', dimensions, center }],
});
const cube = (id, name, size, center) => ({
  id,
  kind: 'model',
  parts: [{ name, primitive: 'cube', size, center }],
});
const sphere = (id, name, radius, center) => ({
  id,
  kind: 'model',
  parts: [{ name, primitive: 'sphere', radius, center }],
});
const taskFor = (id, kind, evaluationSpecs) => ({
  id,
  description: id,
  payload: { kind, publicSpec: evaluationSpecs[0], evaluationSpecs },
});

const verifySource = async (task, source, { fixture = false } = {}) => {
  await mkdir(WORK_ROOT, { recursive: true });
  const workDir = await mkdtemp(join(WORK_ROOT, 'probe-'));
  try {
    await symlink(
      join(EXAMPLE_DIR, 'node_modules'),
      join(workDir, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    if (fixture) {
      await copyFile(join(EXAMPLE_DIR, 'fixtures', 'replicad', 'model.mjs'), join(workDir, 'model.mjs'));
    } else {
      await writeFile(join(workDir, 'model.mjs'), source);
    }
    const verified = await verifyModel(task, workDir, { timeoutMs: 120_000 });
    return { verified, evaluation: evaluateCadTask(task, verified.result) };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
};

test('measures golden box, sphere, and named assembly probes with native B-reps', {
  timeout: 120_000,
}, async () => {
  const official = {
    ...box('official-00003247', 'prism', [0.3, 0.7, 0.3], [0, 0, 0]),
    source: { sample_id: '00003247' },
  };
  const orb = sphere('hidden-sphere', 'orb', 3.25, [-2, 4, 1]);
  const assembly = {
    id: 'hidden-assembly',
    kind: 'assembly',
    parts: [
      { name: 'base', primitive: 'cube', size: 6, center: [0, 0, 0] },
      { name: 'orb', primitive: 'sphere', radius: 2, center: [9, 0, 0] },
    ],
  };
  const task = taskFor('golden-mixed', 'assembly', [official, orb, assembly]);
  const { verified, evaluation } = await verifySource(task, '', { fixture: true });

  assert.equal(verified.result.executed, true, verified.logs);
  assert.equal(evaluation.hard, 1, evaluation.failReason);
  assert.equal(evaluation.probes.length, 3);
  assert.equal(evaluation.probes[0].checks.length, 13);
  assert.equal(verified.result.probes[0].parts[0].brepValid, true);
  assert.equal(verified.result.probes[0].parts[0].brepIou, 1);
  assert.equal(verified.result.probes[1].parts[0].meshValid, true);
  assert.equal(verified.result.probes[2].pairs[0].intersectionVolume, 0);
  assert.equal(verified.result.probes[2].pairs[0].overlapRatio, 0);
});

test('rejects a cube masquerading as a sphere despite copied metadata', {
  timeout: 120_000,
}, async () => {
  const task = taskFor('wrong-primitive', 'model', [sphere('sphere-probe', 'orb', 3, [0, 0, 0])]);
  const { verified, evaluation } = await verifySource(task, `
import { makeBox } from 'replicad';
export function build(spec) {
  const requested = spec.parts[0];
  const shape = makeBox([-3, -3, -3], [3, 3, 3]);
  return { parts: [{ ...requested, shape }], preview: shape.clone() };
}
`);

  assert.equal(verified.result.executed, true, verified.logs);
  assert.equal(evaluation.hard, 0);
  assert.equal(
    evaluation.checks.find((check) => check.cadtestId === 'geometry-type')?.passed,
    false,
  );
  assert.equal(evaluation.probes[0].invalid, false);
  assert.notEqual(verified.result.probes[0].parts[0].brepIou, 1);
  assert.equal(verified.result.probes[0].preview.partAgreementIou, 1);
});

test('rejects an official model that appends a valid extra output part', {
  timeout: 120_000,
}, async () => {
  const official = {
    ...box('official-00003247', 'prism', [0.3, 0.7, 0.3], [0, 0, 0]),
    source: { sample_id: '00003247' },
  };
  const task = taskFor('extra-part', 'model', [official]);
  const { verified, evaluation } = await verifySource(task, `
import { makeBox, makeCompound, makeSphere } from 'replicad';
export function build(spec) {
  const requested = spec.parts[0];
  const shape = makeBox([-0.15, -0.35, -0.15], [0.15, 0.35, 0.15]);
  const extra = makeSphere(0.1).translate([2, 0, 0]);
  const parts = [
    { ...requested, shape },
    { name: 'unrequested-extra', primitive: 'sphere', shape: extra },
  ];
  return { parts, preview: makeCompound(parts.map((part) => part.shape.clone())) };
}
`);

  assert.equal(verified.result.executed, true, verified.logs);
  assert.equal(verified.result.probes[0].parts.every((part) => part.brepValid), true);
  assert.equal(verified.result.probes[0].preview.partAgreementIou, 1);
  assert.equal(evaluation.hard, 0);
  assert.equal(evaluation.probes[0].invalid, true);
  assert.match(evaluation.probes[0].failReason, /output part count 2 does not match expected count 1/);
});

test('rejects a valid arbitrary preview that does not represent the output parts', {
  timeout: 120_000,
}, async () => {
  const task = taskFor('arbitrary-preview', 'model', [
    cube('cube-probe', 'block', 4, [0, 0, 0]),
  ]);
  const { verified, evaluation } = await verifySource(task, `
import { makeBox } from 'replicad';
export function build(spec) {
  const shape = makeBox([-2, -2, -2], [2, 2, 2]);
  const preview = makeBox([0, 0, 0], [4, 4, 4]);
  return { parts: [{ ...spec.parts[0], shape }], preview };
}
`);

  const preview = verified.result.probes[0].preview;
  assert.equal(verified.result.executed, true, verified.logs);
  assert.equal(preview.brepValid, true);
  assert.equal(preview.solidCount, 1);
  assert.equal(preview.meshValid, true);
  assert.equal(Number.isFinite(preview.partAgreementIou), true);
  assert.ok(preview.partAgreementIou < 0.99);
  assert.equal(evaluation.hard, 0);
  assert.equal(evaluation.probes[0].invalid, true);
  assert.match(evaluation.probes[0].failReason, /preview does not agree with output parts/);
});

test('rejects moved geometry even when candidate center metadata is copied', {
  timeout: 120_000,
}, async () => {
  const task = taskFor('wrong-placement', 'model', [cube('cube-probe', 'block', 4, [7, -2, 3])]);
  const { evaluation } = await verifySource(task, `
import { makeBox } from 'replicad';
export function build(spec) {
  const requested = spec.parts[0];
  const shape = makeBox([-2, -2, -2], [2, 2, 2]);
  return { parts: [{ ...requested, shape }], preview: shape.clone() };
}
`);

  assert.equal(evaluation.hard, 0);
  assert.equal(evaluation.checks.find((check) => check.cadtestId === 'bounds')?.passed, false);
  assert.equal(evaluation.checks.find((check) => check.cadtestId === 'center-of-mass')?.passed, false);
});

test('hidden parameter probes reject a hardcoded public example', {
  timeout: 120_000,
}, async () => {
  const visible = cube('visible-cube', 'block', 2, [0, 0, 0]);
  const hidden = cube('hidden-cube', 'block', 3, [5, -1, 2]);
  const task = taskFor('hardcoded', 'model', [visible, hidden]);
  const { evaluation } = await verifySource(task, `
import { makeBox } from 'replicad';
export function build(spec) {
  const shape = makeBox([-1, -1, -1], [1, 1, 1]);
  return { parts: [{ ...spec.parts[0], shape }], preview: shape.clone() };
}
`);

  assert.equal(evaluation.hard, 0);
  assert.equal(evaluation.probes[0].hard, 1);
  assert.equal(evaluation.probes[1].hard, 0);
});

test('removes evaluator-only probes before importing candidate code', {
  timeout: 120_000,
}, async () => {
  const task = taskFor('runtime-probe-secrecy', 'model', [
    cube('hidden-cube', 'block', 3, [5, -1, 2]),
  ]);
  const { verified, evaluation } = await verifySource(task, `
import { readFileSync } from 'node:fs';
import { makeBox, makeSphere } from 'replicad';

let evaluatorFileWasReadable = true;
try {
  readFileSync(process.argv[3], 'utf8');
} catch (error) {
  if (error?.code === 'ENOENT') evaluatorFileWasReadable = false;
  else throw error;
}

export function build(spec) {
  if (evaluatorFileWasReadable) {
    const shape = makeSphere(1);
    return { parts: [{ ...spec.parts[0], shape }], preview: shape.clone() };
  }
  const part = spec.parts[0];
  const half = part.size / 2;
  const min = part.center.map((value) => value - half);
  const max = part.center.map((value) => value + half);
  const shape = makeBox(min, max);
  return { parts: [{ ...part, shape }], preview: shape.clone() };
}
`);

  assert.equal(verified.result.executed, true, verified.logs);
  assert.equal(evaluation.hard, 1, evaluation.failReason);
});

test('rejects reused overlapping geometry in a named assembly', {
  timeout: 120_000,
}, async () => {
  const spec = {
    id: 'assembly-probe',
    kind: 'assembly',
    parts: [
      { name: 'left', primitive: 'cube', size: 4, center: [-5, 0, 0] },
      { name: 'right', primitive: 'cube', size: 4, center: [5, 0, 0] },
    ],
  };
  const task = taskFor('overlap', 'assembly', [spec]);
  const { verified, evaluation } = await verifySource(task, `
import { makeBox, makeCompound } from 'replicad';
export function build(spec) {
  const shape = makeBox([-2, -2, -2], [2, 2, 2]);
  const parts = spec.parts.map((part) => ({ ...part, shape: shape.clone() }));
  return { parts, preview: makeCompound(parts.map((part) => part.shape.clone())) };
}
`);

  assert.equal(evaluation.hard, 0);
  assert.ok(verified.result.probes[0].pairs[0].intersectionVolume > 0);
  assert.equal(
    evaluation.checks.find((check) => check.cadtestId === 'assembly:pair-relations')?.passed,
    false,
  );
});

test('blocks candidate writes outside the isolated task workspace', {
  timeout: 120_000,
}, async () => {
  const task = taskFor('permission', 'model', [cube('cube-probe', 'block', 2, [0, 0, 0])]);
  const { verified, evaluation } = await verifySource(task, `
import { writeFileSync } from 'node:fs';
writeFileSync('../candidate-escape.txt', 'escape');
export function build() { return { parts: [], preview: null }; }
`);

  assert.equal(verified.result.executed, false);
  assert.equal(evaluation.hard, 0);
  assert.match(verified.result.probes[0].error, /restricted|permission|access/i);
});
