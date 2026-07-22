import { runRollout } from '../../../dist/index.js';

import { aggregateCadEvaluations, evaluateCadTask } from './cadtestbench.mjs';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
export const MINIMUM_RS_GAIN = 1;

export const failedEvaluation = (task, error) => {
  const failReason = error || 'rollout did not return a CAD evaluation';
  const specs = Array.isArray(task?.payload?.evaluationSpecs)
    && task.payload.evaluationSpecs.length > 0
    ? task.payload.evaluationSpecs
    : [task?.payload?.publicSpec ?? task?.payload ?? task];
  const probes = specs.map((spec, index) => ({
    specId: spec?.id ?? spec?.specId ?? `probe-${index + 1}`,
    executed: false,
    error: failReason,
    parts: [],
  }));
  const evaluation = evaluateCadTask(task, {
    executed: false,
    error: failReason,
    probes,
  });

  return {
    ...evaluation,
    taskId: task.id,
    slice: task.payload?.kind ?? 'unknown',
    failReason,
  };
};

export async function evaluateRepeated({
  tasks,
  skill,
  runner,
  trials,
  concurrency,
  logger,
}) {
  const evaluations = [];
  const rollouts = [];

  for (let trial = 1; trial <= trials; trial++) {
    const results = await runRollout({ tasks, skill, runner, concurrency, logger });
    rollouts.push({
      trial,
      results: results.map(({ trajectory: _trajectory, ...result }) => result),
    });
    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      const task = tasks[index];
      const evaluation = result.cadEvaluation ?? failedEvaluation(task, result.error);
      evaluations.push({
        ...evaluation,
        taskId: task.id,
        trial,
        slice: task.payload?.kind ?? evaluation.slice ?? 'unknown',
      });
    }
  }

  const metrics = aggregateCadEvaluations(evaluations);
  metrics.infrastructureFailureCount = rollouts.reduce(
    (count, rollout) => count + rollout.results.filter((result) => result.error).length,
    0,
  );

  return {
    metrics,
    evaluations,
    rollouts,
  };
}

const at = (metrics, path, fallback) => {
  let current = metrics;
  for (const segment of path) current = current?.[segment];
  return finite(current, fallback);
};

export function promotionDecision(
  baseline,
  candidate,
  { candidateChanged = true, minimumRsGain = MINIMUM_RS_GAIN } = {},
) {
  if (!Number.isFinite(minimumRsGain) || minimumRsGain <= 0) {
    throw new Error('minimumRsGain must be a positive finite number');
  }
  const checks = [
    {
      id: 'candidate-changed',
      passed: candidateChanged,
      baseline: false,
      candidate: candidateChanged,
    },
    {
      id: 'no-infrastructure-failures',
      passed: at(baseline, ['infrastructureFailureCount'], 0) === 0
        && at(candidate, ['infrastructureFailureCount'], 0) === 0,
      baseline: at(baseline, ['infrastructureFailureCount'], 0),
      candidate: at(candidate, ['infrastructureFailureCount'], 0),
    },
    {
      id: 'requirement-score-improved',
      passed: at(candidate, ['rs'], 0) - at(baseline, ['rs'], 0) >= minimumRsGain,
      baseline: at(baseline, ['rs'], 0),
      candidate: at(candidate, ['rs'], 0),
      minimumGain: minimumRsGain,
    },
    {
      id: 'pass-rate-nonregression',
      passed: at(candidate, ['pr'], 0) >= at(baseline, ['pr'], 0),
      baseline: at(baseline, ['pr'], 0),
      candidate: at(candidate, ['pr'], 0),
    },
    {
      id: 'invalidity-nonincreasing',
      passed: at(candidate, ['invalidSamplePercentage'], 100)
        <= at(baseline, ['invalidSamplePercentage'], 100),
      baseline: at(baseline, ['invalidSamplePercentage'], 100),
      candidate: at(candidate, ['invalidSamplePercentage'], 100),
    },
    {
      id: 'model-pass-rate-nonregression',
      passed: at(candidate, ['slices', 'model', 'pr'], 0)
        >= at(baseline, ['slices', 'model', 'pr'], 0),
      baseline: at(baseline, ['slices', 'model', 'pr'], 0),
      candidate: at(candidate, ['slices', 'model', 'pr'], 0),
    },
    {
      id: 'assembly-pass-rate-nonregression',
      passed: at(candidate, ['slices', 'assembly', 'pr'], 0)
        >= at(baseline, ['slices', 'assembly', 'pr'], 0),
      baseline: at(baseline, ['slices', 'assembly', 'pr'], 0),
      candidate: at(candidate, ['slices', 'assembly', 'pr'], 0),
    },
  ];

  return {
    promoted: checks.every((check) => check.passed),
    checks,
    reasons: checks.filter((check) => !check.passed).map((check) => check.id),
  };
}

export function metricDelta(baseline, candidate) {
  const delta = {};
  for (const key of [
    'pr',
    'rs',
    'invalidSamplePercentage',
    'brepValidPercentage',
    'meanBrepIou',
    'meanVolumeRelativeError',
    'meanBboxMaxError',
    'parametricTaskPassRate',
  ]) {
    if (Number.isFinite(baseline?.[key]) || Number.isFinite(candidate?.[key])) {
      delta[key] = finite(candidate?.[key]) - finite(baseline?.[key]);
    }
  }
  delta.slices = {};
  for (const slice of ['model', 'assembly']) {
    delta.slices[slice] = {};
    for (const key of ['pr', 'rs']) {
      delta.slices[slice][key] = finite(candidate?.slices?.[slice]?.[key])
        - finite(baseline?.slices?.[slice]?.[key]);
    }
  }
  return delta;
}
