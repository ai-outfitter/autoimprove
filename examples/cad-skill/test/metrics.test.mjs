import assert from 'node:assert/strict';
import test from 'node:test';

import {
  failedEvaluation,
  metricDelta,
  promotionDecision,
} from '../src/metrics.mjs';

const vector = ({
  rs = 70,
  pr = 50,
  invalid = 0,
  modelPr = 50,
  assemblyPr = 50,
  infrastructure = 0,
} = {}) => ({
  rs,
  pr,
  invalidSamplePercentage: invalid,
  infrastructureFailureCount: infrastructure,
  slices: {
    model: { pr: modelPr, rs },
    assembly: { pr: assemblyPr, rs },
  },
});

test('promotes a changed skill when RS improves without protected regressions', () => {
  const decision = promotionDecision(
    vector(),
    vector({ rs: 75, pr: 50, modelPr: 60, assemblyPr: 50 }),
  );

  assert.equal(decision.promoted, true);
  assert.deepEqual(decision.reasons, []);
});

test('rejects an overall RS gain that regresses the assembly slice', () => {
  const decision = promotionDecision(
    vector({ assemblyPr: 50 }),
    vector({ rs: 80, pr: 55, modelPr: 70, assemblyPr: 40 }),
  );

  assert.equal(decision.promoted, false);
  assert.deepEqual(decision.reasons, ['assembly-pass-rate-nonregression']);
});

test('rejects an RS change smaller than the practical promotion margin', () => {
  const decision = promotionDecision(
    vector({ rs: 70 }),
    vector({ rs: 70.5 }),
  );

  assert.equal(decision.promoted, false);
  assert.deepEqual(decision.reasons, ['requirement-score-improved']);
  assert.equal(
    decision.checks.find((check) => check.id === 'requirement-score-improved').minimumGain,
    1,
  );
});

test('rejects unchanged candidates, increased invalidity, and infrastructure failures', () => {
  const decision = promotionDecision(
    vector(),
    vector({ rs: 80, invalid: 10, infrastructure: 1 }),
    { candidateChanged: false },
  );

  assert.equal(decision.promoted, false);
  assert.ok(decision.reasons.includes('candidate-changed'));
  assert.ok(decision.reasons.includes('no-infrastructure-failures'));
  assert.ok(decision.reasons.includes('invalidity-nonincreasing'));
});

test('reports signed metric and slice deltas', () => {
  const delta = metricDelta(
    vector({ rs: 70, pr: 50, modelPr: 60, assemblyPr: 40 }),
    vector({ rs: 75, pr: 55, modelPr: 60, assemblyPr: 50 }),
  );

  assert.equal(delta.rs, 5);
  assert.equal(delta.pr, 5);
  assert.equal(delta.slices.model.pr, 0);
  assert.equal(delta.slices.assembly.pr, 10);
});

test('counts every planned probe when a rollout fails before CAD evaluation', () => {
  const task = {
    id: 'two-probe-task',
    payload: {
      kind: 'model',
      publicSpec: {
        id: 'public',
        kind: 'model',
        parts: [{ name: 'cube', primitive: 'cube', size: 1 }],
      },
      evaluationSpecs: [
        {
          id: 'hidden-one',
          kind: 'model',
          parts: [{ name: 'cube', primitive: 'cube', size: 1 }],
        },
        {
          id: 'hidden-two',
          kind: 'model',
          parts: [{ name: 'cube', primitive: 'cube', size: 2 }],
        },
      ],
    },
  };

  const evaluation = failedEvaluation(task, 'target process exited early');

  assert.equal(evaluation.probes.length, 2);
  assert.deepEqual(evaluation.probes.map((probe) => probe.specId), [
    'hidden-one',
    'hidden-two',
  ]);
  assert.equal(evaluation.metrics.count, 2);
  assert.equal(evaluation.metrics.invalidCount, 2);
  assert.equal(evaluation.metrics.invalidSamplePercentage, 100);
});
