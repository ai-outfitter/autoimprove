#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const [backend, modelPath, taskPath, artifactPath] = process.argv.slice(2);
const RESULT_PREFIX = 'AUTOIMPROVE_CAD_RESULT=';
const verifierWrite = process.stdout.write.bind(process.stdout);

if (!backend || !modelPath || !taskPath || !artifactPath) {
  throw new Error('usage: verify-js-model.mjs <backend> <model> <task-json> <artifact>');
}

const { readFile } = await import('node:fs/promises');
const spec = JSON.parse(await readFile(taskPath, 'utf8'));

const isVector3 = (value) =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

const asBounds = (bounds) => ({ min: [...bounds[0]], max: [...bounds[1]] });

const closeNumber = (actual, expected, tolerance = 1e-6) =>
  Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance;

const closeBounds = (actual, expected) =>
  [0, 1, 2].every((axis) =>
    closeNumber(actual.min[axis], expected.min[axis]) &&
    closeNumber(actual.max[axis], expected.max[axis])
  );

const closeVolume = (actual, expected) =>
  closeNumber(actual, expected, Math.max(1e-6, Math.abs(expected) * 1e-6));

const sameMember = (actual, expected) =>
  closeBounds(actual.bounds, expected.bounds) &&
  (actual.volume === undefined || expected.volume === undefined ||
    closeVolume(actual.volume, expected.volume)) &&
  (actual.primitive === undefined || expected.primitive === undefined ||
    actual.primitive === expected.primitive);

const assertSamePreviewMembers = (actual, expected, label) => {
  if (actual.length !== expected.length) {
    throw new Error(`${label} must contain exactly ${expected.length} separate part(s)`);
  }
  const remaining = [...actual];
  for (const expectedMember of expected) {
    const index = remaining.findIndex((candidate) => sameMember(candidate, expectedMember));
    if (index === -1) throw new Error(`${label} does not contain the measured part geometry`);
    remaining.splice(index, 1);
  }
};

const mergeBounds = (bounds) => ({
  min: [0, 1, 2].map((axis) => Math.min(...bounds.map((box) => box.min[axis]))),
  max: [0, 1, 2].map((axis) => Math.max(...bounds.map((box) => box.max[axis]))),
});

const translatedBounds = (bounds, vector) => ({
  min: bounds.min.map((value, axis) => value + vector[axis]),
  max: bounds.max.map((value, axis) => value + vector[axis]),
});

const assertPartContract = (part, index) => {
  if (!part || typeof part !== 'object') throw new Error(`parts[${index}] must be an object`);
  if (typeof part.name !== 'string' || part.name.length === 0) {
    throw new Error(`parts[${index}].name must be a nonempty string`);
  }
  if (part.primitive !== 'cube' && part.primitive !== 'sphere') {
    throw new Error(`parts[${index}].primitive must be cube or sphere`);
  }
  if (!isVector3(part.center)) throw new Error(`parts[${index}].center must be a finite vec3`);
  if (part.primitive === 'cube' && !(Number.isFinite(part.size) && part.size > 0)) {
    throw new Error(`parts[${index}].size must be positive`);
  }
  if (part.primitive === 'sphere' && !(Number.isFinite(part.radius) && part.radius > 0)) {
    throw new Error(`parts[${index}].radius must be positive`);
  }
  if (!part.shape || typeof part.shape !== 'object') {
    throw new Error(`parts[${index}].shape must be a backend-native object`);
  }
};

const measureScadObject = (shape) => {
  if (!shape || typeof shape !== 'object') throw new Error('invalid scad-js shape');

  if (shape.type === 'cube') {
    const raw = shape.params?.size;
    const size = Array.isArray(raw) ? raw : [raw, raw, raw];
    if (!isVector3(size) || size.some((value) => value <= 0)) {
      throw new Error('invalid scad-js cube size');
    }
    const centered = shape.params?.center !== false;
    const bounds = centered
      ? { min: size.map((value) => -value / 2), max: size.map((value) => value / 2) }
      : { min: [0, 0, 0], max: size };
    return { bounds, components: [{ primitive: 'cube', size, bounds }] };
  }

  if (shape.type === 'sphere') {
    const radius = shape.params?.r;
    if (!(Number.isFinite(radius) && radius > 0)) throw new Error('invalid scad-js sphere radius');
    const bounds = { min: [-radius, -radius, -radius], max: [radius, radius, radius] };
    return { bounds, components: [{ primitive: 'sphere', radius, bounds }] };
  }

  if (shape.type === 'translate') {
    const vector = shape.params?.v;
    if (!isVector3(vector) || shape.children?.length !== 1) {
      throw new Error('scad-js verifier supports one-child translate nodes');
    }
    const child = measureScadObject(shape.children[0]);
    return {
      bounds: translatedBounds(child.bounds, vector),
      components: child.components.map((component) => ({
        ...component,
        bounds: translatedBounds(component.bounds, vector),
      })),
    };
  }

  if (shape.type === 'union') {
    if (!Array.isArray(shape.children) || shape.children.length === 0) {
      throw new Error('scad-js union preview must have children');
    }
    const children = shape.children.map(measureScadObject);
    return {
      bounds: mergeBounds(children.map((child) => child.bounds)),
      components: children.flatMap((child) => child.components),
    };
  }

  throw new Error(`unsupported scad-js node in basic example: ${String(shape.type)}`);
};

let replicadApi;
if (backend === 'replicad') {
  const require = createRequire(import.meta.url);
  const ocModulePath = require.resolve('replicad-opencascadejs/src/replicad_single.js');
  const wasmPath = require.resolve('replicad-opencascadejs/src/replicad_single.wasm');
  // The published Emscripten module is ESM but still reads CommonJS globals.
  // Supply the two globals its Node branch expects before evaluating it.
  globalThis.require = require;
  globalThis.__dirname = dirname(ocModulePath);
  const [{ default: opencascade }, { setOC }] = await Promise.all([
    import('replicad-opencascadejs/src/replicad_single.js'),
    import('replicad'),
  ]);
  const oc = await opencascade({ locateFile: () => wasmPath });
  setOC(oc);
  replicadApi = await import('replicad');
}

const moduleUrl = `${pathToFileURL(modelPath).href}?verify=${process.pid}`;
const model = await import(moduleUrl);
if (typeof model.build !== 'function') throw new Error('model must export build(spec)');

const built = await model.build(spec);
if (!built || typeof built !== 'object' || !Array.isArray(built.parts)) {
  throw new Error('build(spec) must return { parts, preview }');
}
if (built.parts.length === 0) throw new Error('build(spec) returned no parts');
built.parts.forEach(assertPartContract);

let parts;
let combinedBounds;
let artifact;

if (backend === 'replicad') {
  if (!built.preview?.boundingBox || typeof built.preview.mesh !== 'function') {
    throw new Error('replicad preview must be a native shape or compound');
  }
  parts = built.parts.map((part) => ({
    name: part.name,
    primitive: part.primitive,
    center: part.center,
    bounds: asBounds(part.shape.boundingBox.bounds),
    volume: replicadApi.measureVolume(part.shape),
  }));
  const previewSolidCount = built.preview._listTopo?.('solid').length;
  if (previewSolidCount !== parts.length) {
    throw new Error(`replicad preview contains ${previewSolidCount ?? 0} solids, expected ${parts.length}`);
  }
  const previewVolume = replicadApi.measureVolume(built.preview);
  const partsVolume = parts.reduce((sum, part) => sum + part.volume, 0);
  if (!closeVolume(previewVolume, partsVolume)) {
    throw new Error('replicad preview volume does not match its separate parts');
  }
  combinedBounds = asBounds(built.preview.boundingBox.bounds);
  artifact = JSON.stringify(built.preview.mesh({ tolerance: 0.05, angularTolerance: 0.1 }));
  await writeFile(artifactPath, artifact);
} else if (backend === 'opentscad') {
  const { default: modeling } = await import('@jscad/modeling');
  const { measureBoundingBox, measureVolume } = modeling.measurements;
  const preview = Array.isArray(built.preview) ? built.preview : [built.preview];
  if (preview.length === 0 || preview.some((shape) => !shape)) {
    throw new Error('opentscad preview must contain at least one TSCAD solid');
  }
  const measuredParts = built.parts.map((part) => ({
    bounds: asBounds(measureBoundingBox(part.shape)),
    volume: measureVolume(part.shape),
  }));
  parts = built.parts.map((part, index) => ({
    name: part.name,
    primitive: part.primitive,
    center: part.center,
    ...measuredParts[index],
  }));
  const measuredPreview = preview.map((shape) => ({
    bounds: asBounds(measureBoundingBox(shape)),
    volume: measureVolume(shape),
  }));
  assertSamePreviewMembers(measuredPreview, measuredParts, 'opentscad preview');
  combinedBounds = mergeBounds(measuredPreview.map((measurement) => measurement.bounds));
  artifact = JSON.stringify(preview);
  await writeFile(artifactPath, artifact);
} else if (backend === 'scad-js') {
  if (typeof built.preview?.serialize !== 'function') {
    throw new Error('scad-js preview must be a serializable ScadObject');
  }
  const measuredParts = built.parts.map((part) => {
    const measured = measureScadObject(part.shape);
    if (measured.components.length !== 1) throw new Error(`${part.name} must contain one primitive`);
    return measured.components[0];
  });
  parts = built.parts.map((part, index) => {
    const measured = measuredParts[index];
    return {
      name: part.name,
      primitive: measured.primitive,
      center: part.center,
      bounds: measured.bounds,
    };
  });
  const measuredPreview = measureScadObject(built.preview);
  assertSamePreviewMembers(measuredPreview.components, measuredParts, 'scad-js preview');
  combinedBounds = measuredPreview.bounds;
  artifact = built.preview.serialize();
  if (artifact.trim().length === 0) throw new Error('scad-js serialized an empty preview');
  await writeFile(artifactPath, artifact);
} else {
  throw new Error(`unsupported JavaScript backend: ${backend}`);
}

verifierWrite(`${RESULT_PREFIX}${JSON.stringify({
  executed: true,
  artifact: { path: artifactPath, size: Buffer.byteLength(artifact) },
  parts,
  combinedBounds,
})}\n`);
