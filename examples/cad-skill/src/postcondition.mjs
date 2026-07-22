import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { aggregateCadEvaluations, CADTESTBENCH_PROVENANCE } from './cadtestbench.mjs';
import { metricDelta, promotionDecision } from './metrics.mjs';
import { splitIds, taskManifest, tasks } from './tasks.mjs';

const RECORD_KEYS = [
  'schemaVersion',
  'runId',
  'timestamp',
  'benchmark',
  'taskManifestSha256',
  'trialsPerTask',
  'runtime',
  'skills',
  'promotion',
  'training',
  'baseline',
  'candidate',
  'delta',
];

const FILE_LIMITS = {
  summary: 64 * 1024 * 1024,
  latest: 2 * 1024 * 1024,
  history: 20 * 1024 * 1024,
  skill: 512 * 1024,
};

const TEST_TASKS = splitIds.test.map((id) => tasks.find((task) => task.id === id));
if (TEST_TASKS.some((task) => !task)) {
  throw new Error('CAD test split references a missing task');
}

const fail = (message) => {
  throw new Error(`CAD improvement postcondition failed: ${message}`);
};

const assertCondition = (condition, message) => {
  if (!condition) fail(message);
};

const isObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value);

const assertObject = (value, label) => {
  assertCondition(isObject(value), `${label} must be an object`);
};

const assertFinite = (value, label, { minimum, maximum, integer = false } = {}) => {
  assertCondition(Number.isFinite(value), `${label} must be finite`);
  if (integer) assertCondition(Number.isSafeInteger(value), `${label} must be a safe integer`);
  if (minimum !== undefined) assertCondition(value >= minimum, `${label} must be >= ${minimum}`);
  if (maximum !== undefined) assertCondition(value <= maximum, `${label} must be <= ${maximum}`);
};

const assertDeepEqual = (actual, expected, message) => {
  assertCondition(isDeepStrictEqual(actual, expected), message);
};

const assertSha256 = (value, label) => {
  assertCondition(/^[a-f0-9]{64}$/u.test(value), `${label} must be a lowercase SHA-256 digest`);
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const readRegularFile = async (path, label, maximumSize) => {
  let status;
  try {
    status = await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`${label} is missing at ${path}`);
    throw error;
  }
  assertCondition(status.isFile() && !status.isSymbolicLink(), `${label} must be a regular file`);
  assertCondition(status.size > 0, `${label} must not be empty`);
  assertCondition(status.size <= maximumSize, `${label} exceeds the ${maximumSize}-byte publish limit`);
  return readFile(path, 'utf8');
};

const parseJson = (source, label) => {
  try {
    const value = JSON.parse(source);
    assertObject(value, label);
    return value;
  } catch (error) {
    if (error?.message?.startsWith('CAD improvement postcondition failed:')) throw error;
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const validateMetricSlice = (metrics, label, { requireInfrastructure = false } = {}) => {
  assertObject(metrics, label);
  assertFinite(metrics.count, `${label}.count`, { minimum: 1, integer: true });
  assertFinite(metrics.pr, `${label}.pr`, { minimum: 0, maximum: 100 });
  assertFinite(metrics.rs, `${label}.rs`, { minimum: 0, maximum: 100 });
  assertFinite(metrics.invalidSamplePercentage, `${label}.invalidSamplePercentage`, {
    minimum: 0,
    maximum: 100,
  });
  if (requireInfrastructure) {
    assertFinite(metrics.infrastructureFailureCount, `${label}.infrastructureFailureCount`, {
      minimum: 0,
      integer: true,
    });
  }
};

const validateMetrics = (metrics, label) => {
  validateMetricSlice(metrics, label, { requireInfrastructure: true });
  assertObject(metrics.slices, `${label}.slices`);
  for (const slice of ['model', 'assembly']) {
    validateMetricSlice(metrics.slices[slice], `${label}.slices.${slice}`);
  }
};

const validateEvidence = (evidence, recordedMetrics, label, trialsPerTask) => {
  assertObject(evidence, label);
  assertDeepEqual(evidence.metrics, recordedMetrics, `${label}.metrics must match the published metrics`);
  const expectedEvaluationCount = TEST_TASKS.length * trialsPerTask;
  assertCondition(
    Array.isArray(evidence.evaluations)
      && evidence.evaluations.length === expectedEvaluationCount,
    `${label}.evaluations must contain every held-out task for every trial`,
  );
  assertCondition(Array.isArray(evidence.rollouts) && evidence.rollouts.length === trialsPerTask,
    `${label}.rollouts must contain exactly trialsPerTask entries`);

  const expectedById = new Map(TEST_TASKS.map((task) => [task.id, task]));
  const seenEvaluations = new Set();
  const observedProbeCount = evidence.evaluations.reduce((count, evaluation, index) => {
    assertObject(evaluation, `${label}.evaluations[${index}]`);
    const task = expectedById.get(evaluation.taskId);
    assertCondition(task, `${label}.evaluations[${index}] has an unexpected taskId`);
    assertFinite(evaluation.trial, `${label}.evaluations[${index}].trial`, {
      minimum: 1,
      maximum: trialsPerTask,
      integer: true,
    });
    const evaluationKey = `${evaluation.trial}:${evaluation.taskId}`;
    assertCondition(!seenEvaluations.has(evaluationKey),
      `${label}.evaluations contains duplicate ${evaluationKey}`);
    seenEvaluations.add(evaluationKey);

    const expectedSpecIds = task.payload.evaluationSpecs.map((spec) => spec.id);
    assertCondition(
      Array.isArray(evaluation.probes)
        && evaluation.probes.length === expectedSpecIds.length,
      `${label}.evaluations[${index}].probes must represent every planned probe`,
    );
    assertDeepEqual(
      evaluation.probes.map((probe) => probe.specId),
      expectedSpecIds,
      `${label}.evaluations[${index}] probe ids do not match the held-out task`,
    );
    return count + evaluation.probes.length;
  }, 0);
  assertCondition(seenEvaluations.size === expectedEvaluationCount,
    `${label}.evaluations does not cover the complete held-out trial matrix`);
  assertCondition(observedProbeCount === recordedMetrics.count,
    `${label} has ${observedProbeCount} evidence probes but metrics.count is ${recordedMetrics.count}`);

  let infrastructureFailures = 0;
  let rolloutResultCount = 0;
  for (const [index, rollout] of evidence.rollouts.entries()) {
    assertObject(rollout, `${label}.rollouts[${index}]`);
    assertCondition(rollout.trial === index + 1,
      `${label}.rollouts must be ordered exactly once per trial`);
    assertCondition(
      Array.isArray(rollout.results) && rollout.results.length === TEST_TASKS.length,
      `${label}.rollouts[${index}].results must contain every held-out task`,
    );
    assertDeepEqual(
      rollout.results.map((result) => result.id).toSorted(),
      [...splitIds.test].toSorted(),
      `${label}.rollouts[${index}] task ids do not match the held-out split`,
    );
    rolloutResultCount += rollout.results.length;
    infrastructureFailures += rollout.results.filter((result) => result?.error).length;
  }
  assertCondition(rolloutResultCount === evidence.evaluations.length,
    `${label} rollout result count must match evaluation count`);
  assertCondition(infrastructureFailures === recordedMetrics.infrastructureFailureCount,
    `${label} infrastructure failure count does not match raw rollout evidence`);
  const recomputedMetrics = aggregateCadEvaluations(evidence.evaluations);
  recomputedMetrics.infrastructureFailureCount = infrastructureFailures;
  assertDeepEqual(recomputedMetrics, recordedMetrics,
    `${label} metrics must be recomputed from raw evaluation evidence`);
};

const validateRecord = (record, runId) => {
  assertObject(record, 'metrics/latest.json');
  assertDeepEqual(Object.keys(record).toSorted(), RECORD_KEYS.toSorted(),
    'metrics/latest.json has an unexpected schema-v1 top-level shape');
  assertCondition(record.schemaVersion === 1, 'schemaVersion must equal 1');
  assertCondition(record.runId === runId, `latest runId must equal ${runId}`);
  assertCondition(typeof record.timestamp === 'string' && Number.isFinite(Date.parse(record.timestamp)),
    'timestamp must be an ISO-compatible date string');
  assertDeepEqual(record.benchmark, CADTESTBENCH_PROVENANCE,
    'benchmark provenance must match the pinned CADTestBench source');
  assertSha256(record.taskManifestSha256, 'taskManifestSha256');
  assertCondition(record.taskManifestSha256 === sha256(JSON.stringify(taskManifest)),
    'taskManifestSha256 must match the current complete CAD task manifest');
  assertFinite(record.trialsPerTask, 'trialsPerTask', { minimum: 1, integer: true });
  assertObject(record.runtime, 'runtime');
  assertCondition(record.runtime.node === process.version,
    `runtime.node must match the validator runtime ${process.version}`);
  assertCondition(record.runtime.replicad === '0.23.1',
    'runtime.replicad must match the pinned dependency');
  assertCondition(record.runtime.replicadOpenCascadeJs === '0.23.0',
    'runtime.replicadOpenCascadeJs must match the pinned dependency');
  assertDeepEqual(record.runtime.outfitter, {
    version: '1.0.0',
    commit: 'b4ee211dbe84a8d462485e892c6a6c21cd83ae07',
  }, 'runtime.outfitter must identify the pinned Outfitter v1 release');
  assertObject(record.skills, 'skills');
  for (const name of ['baselineSha256', 'candidateSha256', 'promotedSha256']) {
    assertSha256(record.skills[name], `skills.${name}`);
  }
  assertObject(record.training, 'training');
  for (const name of ['steps', 'accepts', 'rejects', 'skips']) {
    assertFinite(record.training[name], `training.${name}`, { minimum: 0, integer: true });
  }
  validateMetrics(record.baseline, 'baseline');
  validateMetrics(record.candidate, 'candidate');
  assertCondition(record.baseline.count === record.candidate.count,
    'baseline and candidate must use the same planned-probe denominator');

  const candidateChanged = record.skills.baselineSha256 !== record.skills.candidateSha256;
  const expectedPromotion = promotionDecision(record.baseline, record.candidate, { candidateChanged });
  assertDeepEqual(record.promotion, expectedPromotion,
    'promotion must exactly match the deterministic promotion gate');
  assertDeepEqual(record.delta, metricDelta(record.baseline, record.candidate),
    'delta must be derived from baseline and candidate metrics');
  const expectedPromotedSha = record.promotion.promoted
    ? record.skills.candidateSha256
    : record.skills.baselineSha256;
  assertCondition(record.skills.promotedSha256 === expectedPromotedSha,
    'skills.promotedSha256 does not match the promotion decision');
};

/**
 * Verify that one workflow run produced a complete, internally consistent set
 * of artifacts before any tracked output is committed or pushed.
 */
export async function verifyImprovementOutput({
  runId,
  repositoryRoot,
  stateRoot,
  metricsDir,
}) {
  assertCondition(typeof runId === 'string' && /^[a-zA-Z0-9_.-]+$/u.test(runId),
    'runId may contain only letters, digits, dot, underscore, and hyphen');
  const root = resolve(repositoryRoot);
  const state = resolve(stateRoot);
  const metrics = resolve(metricsDir);
  const summaryPath = join(state, runId, 'summary.json');
  const baselineSkillPath = join(state, runId, 'baseline.md');
  const candidateSkillPath = join(state, runId, 'candidate.md');
  const latestPath = join(metrics, 'latest.json');
  const historyPath = join(metrics, 'history.jsonl');
  const skillPath = join(
    root,
    '.agents',
    'agents',
    'cad',
    'skills',
    'generate-replicad-cad',
    'SKILL.md',
  );

  const [
    summarySource,
    baselineSkillSource,
    candidateSkillSource,
    latestSource,
    historySource,
    skillSource,
  ] = await Promise.all([
    readRegularFile(summaryPath, 'run summary', FILE_LIMITS.summary),
    readRegularFile(baselineSkillPath, 'frozen baseline skill', FILE_LIMITS.skill),
    readRegularFile(candidateSkillPath, 'candidate skill', FILE_LIMITS.skill),
    readRegularFile(latestPath, 'latest metrics', FILE_LIMITS.latest),
    readRegularFile(historyPath, 'metrics history', FILE_LIMITS.history),
    readRegularFile(skillPath, 'canonical CAD skill', FILE_LIMITS.skill),
  ]);
  const summary = parseJson(summarySource, 'summary.json');
  const latest = parseJson(latestSource, 'metrics/latest.json');

  validateRecord(latest, runId);
  assertCondition(summary.runId === runId, `summary runId must equal ${runId}`);
  for (const key of RECORD_KEYS) {
    assertCondition(Object.hasOwn(summary, key), `summary.json is missing record field ${key}`);
  }
  const summaryRecord = Object.fromEntries(RECORD_KEYS.map((key) => [key, summary[key]]));
  assertDeepEqual(summaryRecord, latest,
    'summary.json aggregate record must exactly match metrics/latest.json');
  assertCondition(sha256(baselineSkillSource) === latest.skills.baselineSha256,
    'frozen baseline skill hash does not match the metrics record');
  assertCondition(sha256(candidateSkillSource) === latest.skills.candidateSha256,
    'candidate skill hash does not match the metrics record');
  assertCondition(Array.isArray(summary.trainingRecords),
    'summary.trainingRecords must be an array');
  assertCondition(summary.trainingRecords.length === latest.training.steps,
    'summary.trainingRecords length must match training.steps');
  const outcomeCounts = { accept: 0, reject: 0, skip: 0 };
  for (const [index, trainingRecord] of summary.trainingRecords.entries()) {
    assertObject(trainingRecord, `summary.trainingRecords[${index}]`);
    assertCondition(Object.hasOwn(outcomeCounts, trainingRecord.outcome),
      `summary.trainingRecords[${index}] has an unknown outcome`);
    outcomeCounts[trainingRecord.outcome] += 1;
  }
  assertCondition(outcomeCounts.accept === latest.training.accepts,
    'training accept count does not match trainingRecords');
  assertCondition(outcomeCounts.reject === latest.training.rejects,
    'training reject count does not match trainingRecords');
  assertCondition(outcomeCounts.skip === latest.training.skips,
    'training skip count does not match trainingRecords');
  validateEvidence(
    summary.baselineEvaluation,
    latest.baseline,
    'summary.baselineEvaluation',
    latest.trialsPerTask,
  );
  validateEvidence(
    summary.candidateEvaluation,
    latest.candidate,
    'summary.candidateEvaluation',
    latest.trialsPerTask,
  );

  const historyLines = historySource.split(/\r?\n/u).filter(Boolean);
  assertCondition(historyLines.length > 0, 'metrics/history.jsonl must contain a record');
  const history = historyLines.map((line, index) => parseJson(line, `history line ${index + 1}`));
  assertCondition(history.filter((record) => record.runId === runId).length === 1,
    'metrics history must contain exactly one record for the current runId');
  assertDeepEqual(history.at(-1), latest,
    'the current metrics record must be the final history entry');
  assertCondition(sha256(skillSource) === latest.skills.promotedSha256,
    'canonical CAD skill hash does not match the guarded promotion result');

  return {
    runId,
    promoted: latest.promotion.promoted,
    summaryPath,
    latestPath,
    historyPath,
  };
}
