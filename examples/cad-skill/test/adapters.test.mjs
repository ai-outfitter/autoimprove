import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { verifyModel } from '../src/adapters.mjs';
import { scoreCadResult } from '../src/scorer.mjs';
import { BACKEND_IDS, tasks } from '../src/tasks.mjs';

const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK_ROOT = join(tmpdir(), 'autoimprove-cad-skill-tests');
const pythonPath = process.platform === 'win32'
  ? join(EXAMPLE_DIR, '.venv', 'Scripts', 'python.exe')
  : join(EXAMPLE_DIR, '.venv', 'bin', 'python');
const hasAnchorScad = await access(pythonPath).then(() => true).catch(() => false);

const taskById = (id) => {
  const task = tasks.find((candidate) => candidate.id === id);
  assert.ok(task, `missing task ${id}`);
  return task;
};

const verifySource = async (task, source) => {
  await mkdir(WORK_ROOT, { recursive: true });
  const workDir = await mkdtemp(join(WORK_ROOT, `negative-${task.payload.backend}-`));
  try {
    const filename = task.payload.backend === 'anchorscad' ? 'model.py' : 'model.mjs';
    if (task.payload.backend !== 'anchorscad') {
      await symlink(
        join(EXAMPLE_DIR, 'node_modules'),
        join(workDir, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    await writeFile(join(workDir, filename), source);
    await writeFile(join(workDir, 'task.json'), `${JSON.stringify(task.payload, null, 2)}\n`);
    return await verifyModel(task, workDir, { timeoutMs: 120_000 });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
};

for (const backend of BACKEND_IDS) {
  test(`verifies the golden ${backend} cube+sphere assembly`, {
    skip: backend === 'anchorscad' && !hasAnchorScad
      ? 'run npm run setup:python to exercise AnchorSCAD'
      : false,
    timeout: 120_000,
  }, async () => {
    const task = tasks.find((candidate) =>
      candidate.id === `${backend}-train-assembly-10-5`
    );
    assert.ok(task);
    await mkdir(WORK_ROOT, { recursive: true });
    const workDir = await mkdtemp(join(WORK_ROOT, `fixture-${backend}-`));

    try {
      const filename = backend === 'anchorscad' ? 'model.py' : 'model.mjs';
      if (backend !== 'anchorscad') {
        await symlink(
          join(EXAMPLE_DIR, 'node_modules'),
          join(workDir, 'node_modules'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      }
      await copyFile(join(EXAMPLE_DIR, 'fixtures', backend, filename), join(workDir, filename));
      await writeFile(join(workDir, 'task.json'), `${JSON.stringify(task.payload, null, 2)}\n`);
      const verified = await verifyModel(task, workDir, { timeoutMs: 120_000 });
      const score = scoreCadResult(task, verified.result);
      assert.equal(score.hard, 1, `${score.failReason ?? ''}\n${verified.logs}`);
      assert.equal(score.soft, 1);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
}

test('rejects a scad-js preview that omits an assembly part', async () => {
  const task = taskById('scad-js-train-assembly-10-5');
  const verified = await verifySource(task, `
import { cube, sphere } from 'scad-js';
const makeShape = (part) => part.primitive === 'cube'
  ? cube(part.size).translate(part.center)
  : sphere(part.radius).translate(part.center);
export function build(spec) {
  const parts = spec.parts.map((part) => ({ ...part, shape: makeShape(part) }));
  return { parts, preview: parts[0].shape };
}
`);

  assert.equal(verified.result.executed, false);
  assert.match(verified.logs, /preview must contain exactly 2 separate part/);
});

test('rejects a TSCAD cube masquerading as a sphere through native volume', async () => {
  const task = taskById('opentscad-test-sphere-7');
  const verified = await verifySource(task, `
import { defineModel } from '@tscad/modeling';
import { cube } from '@tscad/modeling/primitives';
export function build(spec) {
  const parts = spec.parts.map((part) => ({
    ...part,
    shape: cube({ size: part.radius * 2, center: part.center }),
  }));
  const definition = defineModel({ model: () => parts.map((part) => part.shape) });
  return { parts, preview: definition.model({}) };
}
`);
  const score = scoreCadResult(task, verified.result);

  assert.equal(verified.result.executed, true, verified.logs);
  assert.equal(score.hard, 0);
  assert.match(score.failReason, /part-volumes/);
});

test('blocks AnchorSCAD candidate writes outside the task workspace', {
  skip: hasAnchorScad ? false : 'run npm run setup:python to exercise AnchorSCAD',
}, async () => {
  const task = taskById('anchorscad-train-cube-10');
  const verified = await verifySource(task, `
from pathlib import Path
Path('../candidate-escape.txt').write_text('escape')
def build(spec):
    return {'parts': [], 'preview': None}
`);

  assert.equal(verified.result.executed, false);
  assert.match(verified.logs, /candidate file access blocked/);
});

test('blocks JavaScript candidate writes outside the task workspace', async () => {
  const task = taskById('scad-js-train-cube-10');
  const verified = await verifySource(task, `
import { writeFileSync } from 'node:fs';
writeFileSync('../candidate-escape.txt', 'escape');
export function build() {
  return { parts: [], preview: null };
}
`);

  assert.equal(verified.result.executed, false);
  assert.match(verified.logs, /Access to this API has been restricted|permission/i);
});
