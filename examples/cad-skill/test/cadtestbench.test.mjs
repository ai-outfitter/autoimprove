import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateCadEvaluations,
  evaluateCadTask,
} from '../src/cadtestbench.mjs';

const officialSpec = {
  id: 'official-00003247',
  source: { sample_id: '00003247' },
  kind: 'model',
  parts: [{
    name: 'prism',
    primitive: 'box',
    dimensions: [0.3, 0.7, 0.3],
    center: [0, 0, 0],
  }],
};

const officialObservation = ({ executed = true } = {}) => ({
  executed,
  probes: [{
    specId: officialSpec.id,
    executed,
    parts: [{
      name: 'prism',
      brepValid: executed,
      solidCount: 1,
      bounds: { min: [-0.15, -0.35, -0.15], max: [0.15, 0.35, 0.15] },
      volume: 0.063,
      area: 0.78,
      centerOfMass: [0, 0, 0],
      faceTypes: { PLANE: 6 },
      edgeTypes: { LINE: 12 },
      faceCount: 6,
      edgeCount: 12,
      vertexCount: 8,
      brepIou: 1,
      meshValid: executed,
    }],
    preview: {
      brepValid: executed,
      solidCount: 1,
      meshValid: executed,
      partAgreementIou: executed ? 1 : null,
    },
    pairs: [],
    ...(executed ? {} : { error: 'invalid fixture' }),
  }],
});

const cubeSpec = {
  id: 'cube-probe',
  kind: 'model',
  parts: [{ name: 'cube', primitive: 'cube', size: 2, center: [1, 2, 3] }],
};

const cubeObservation = ({ volume = 8, executed = true } = {}) => ({
  executed,
  probes: [{
    specId: cubeSpec.id,
    executed,
    parts: [{
      name: 'cube',
      primitive: 'cube',
      brepValid: executed,
      solidCount: 1,
      bounds: { min: [0, 1, 2], max: [2, 3, 4] },
      volume,
      area: 24,
      centerOfMass: [1, 2, 3],
      faceTypes: { PLANE: 6 },
      edgeTypes: { LINE: 12 },
      faceCount: 6,
      edgeCount: 12,
      vertexCount: 8,
      brepIou: volume === 8 ? 1 : 0.5,
      meshValid: executed,
    }],
    preview: {
      brepValid: executed,
      solidCount: 1,
      meshValid: executed,
      partAgreementIou: executed ? 1 : null,
    },
    pairs: [],
    ...(executed ? {} : { error: 'invalid fixture' }),
  }],
});

const taskFor = (spec) => ({
  id: `task-${spec.id}`,
  payload: { kind: spec.kind, publicSpec: spec, evaluationSpecs: [spec] },
});

test('ports all 13 predicates for official CADTestBench sample 00003247', () => {
  const evaluation = evaluateCadTask(taskFor(officialSpec), officialObservation());
  const probe = evaluation.probes[0];

  assert.equal(evaluation.hard, 1);
  assert.equal(evaluation.soft, 1);
  assert.equal(probe.official, true);
  assert.equal(probe.checks.length, 13);
  assert.ok(probe.checks.every((check) => check.passed));
  assert.equal(evaluation.metrics.pr, 100);
  assert.equal(evaluation.metrics.rs, 100);
});

test('fails an entire requirement group when one linked CADTest fails', () => {
  const evaluation = evaluateCadTask(taskFor(cubeSpec), cubeObservation({ volume: 6 }));
  const probe = evaluation.probes[0];

  assert.equal(evaluation.hard, 0);
  assert.ok(evaluation.soft > 0 && evaluation.soft < 1);
  assert.equal(probe.checks.find((check) => check.cadtestId === 'volume')?.passed, false);
  assert.equal(
    probe.requirements.find((requirement) => requirement.requirementId === 'mass-properties')?.passed,
    false,
  );
});

test('rejects an otherwise valid part when its output name changes', () => {
  const observation = cubeObservation();
  observation.probes[0].parts[0].name = 'renamed-behind-the-evaluator';
  const evaluation = evaluateCadTask(taskFor(cubeSpec), observation);

  assert.equal(evaluation.hard, 0);
  assert.equal(evaluation.probes[0].invalid, true);
  assert.match(evaluation.probes[0].failReason, /part names/);
});

test('requires the preview to be a valid, meshed one-solid representation of the part', () => {
  const cases = [
    ['B-rep validity', (preview) => { preview.brepValid = false; }, /validated B-rep/],
    ['solid count', (preview) => { preview.solidCount = 2; }, /preview solid count/],
    ['mesh validity', (preview) => { preview.meshValid = false; }, /valid mesh/],
    ['part agreement', (preview) => { preview.partAgreementIou = 0.5; }, /agree with output parts/],
  ];

  for (const [label, mutate, expectedReason] of cases) {
    const observation = cubeObservation();
    mutate(observation.probes[0].preview);
    const evaluation = evaluateCadTask(taskFor(cubeSpec), observation);
    assert.equal(evaluation.probes[0].invalid, true, label);
    assert.match(evaluation.probes[0].failReason, expectedReason, label);
  }
});

test('invalid executions receive zero rather than disappearing from metrics', () => {
  const valid = evaluateCadTask(taskFor(cubeSpec), cubeObservation());
  const invalid = evaluateCadTask(taskFor(officialSpec), officialObservation({ executed: false }));
  const aggregate = aggregateCadEvaluations([
    { ...valid, slice: 'model' },
    { ...invalid, slice: 'assembly' },
  ]);

  assert.equal(aggregate.count, 2);
  assert.equal(aggregate.pr, 50);
  assert.equal(aggregate.invalidSamplePercentage, 50);
  assert.equal(aggregate.slices.model.pr, 100);
  assert.equal(aggregate.slices.assembly.pr, 0);
});
