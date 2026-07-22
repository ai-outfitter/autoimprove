#!/usr/bin/env node

import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { constantScheduler, train } from '../../../dist/index.js';

import { assertCadDependencies } from './adapters.mjs';
import { CADTESTBENCH_PROVENANCE } from './cadtestbench.mjs';
import {
  DEFAULT_OPTIMIZER_COMMAND,
  DEFAULT_TARGET_COMMAND,
  commandFromEnv,
  createCommandModelClient,
} from './command-client.mjs';
import { evaluateRepeated, metricDelta, promotionDecision } from './metrics.mjs';
import { createCadRunner } from './runner.mjs';
import { splitIds, taskManifest, tasks } from './tasks.mjs';

const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = resolve(
  process.env.CAD_REPOSITORY_ROOT || resolve(EXAMPLE_DIR, '..', '..'),
);
const AGENTS_DIR = join(REPOSITORY_ROOT, '.agents');
const SKILL_PATH = join(
  AGENTS_DIR, 'agents', 'cad', 'skills', 'generate-replicad-cad', 'SKILL.md',
);
const STATE_ROOT = resolve(process.env.CAD_STATE_ROOT || join(EXAMPLE_DIR, '.autoimprove'));
const METRICS_DIR = resolve(process.env.CAD_METRICS_DIR || join(EXAMPLE_DIR, 'metrics'));
const HISTORY_PATH = join(METRICS_DIR, 'history.jsonl');
const LATEST_PATH = join(METRICS_DIR, 'latest.json');

const rawArgs = process.argv.slice(2);
const options = {
  dryRun: false,
  resume: false,
  keepWorkDirs: false,
  trials: Number(process.env.CAD_EVAL_TRIALS || 3),
  runId: process.env.CAD_RUN_ID || new Date().toISOString().replaceAll(/[-:.]/gu, ''),
};

for (let index = 0; index < rawArgs.length; index++) {
  const arg = rawArgs[index];
  if (arg === '--dry-run') options.dryRun = true;
  else if (arg === '--resume') options.resume = true;
  else if (arg === '--keep-workdirs') options.keepWorkDirs = true;
  else if (arg === '--trials' || arg === '--run-id') {
    const value = rawArgs[++index];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    if (arg === '--trials') options.trials = Number(value);
    else options.runId = value;
  } else {
    throw new Error(`unknown option: ${arg}`);
  }
}

if (!Number.isSafeInteger(options.trials) || options.trials < 1) {
  throw new Error('--trials must be a positive integer');
}
if (!/^[a-zA-Z0-9_.-]+$/u.test(options.runId)) {
  throw new Error('--run-id may contain only letters, digits, dot, underscore, and hyphen');
}

const RUN_DIR = join(STATE_ROOT, options.runId);
const STATE_FILE = join(RUN_DIR, 'state.json');
const BASELINE_PATH = join(RUN_DIR, 'baseline.md');
const CANDIDATE_PATH = join(RUN_DIR, 'candidate.md');
const SUMMARY_PATH = join(RUN_DIR, 'summary.json');

const taskCounts = Object.fromEntries(
  Object.entries(splitIds).map(([split, ids]) => [split, ids.length]),
);
console.log('Replicad CAD skill self-improvement plan');
console.log(`profile: cad (Outfitter v1)`);
console.log(`split: ${taskCounts.train} train / ${taskCounts.val} validation / ${taskCounts.test} test`);
console.log(`evaluation: ${options.trials} held-out trial(s) per task with hidden parameter probes`);
console.log(`run: ${options.runId}${options.resume ? ' (resume)' : ''}`);

if (options.dryRun) process.exit(0);

if (options.resume) {
  await access(RUN_DIR).catch(() => {
    throw new Error(`cannot resume missing run directory ${RUN_DIR}`);
  });
} else {
  await access(RUN_DIR).then(() => {
    throw new Error(`run directory already exists at ${RUN_DIR}; choose another --run-id or pass --resume`);
  }).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}

await assertCadDependencies();
await mkdir(RUN_DIR, { recursive: true });

const seedSkill = options.resume
  ? await readFile(BASELINE_PATH, 'utf8').catch(() => {
      throw new Error(`cannot resume without the frozen baseline at ${BASELINE_PATH}`);
    })
  : await readFile(SKILL_PATH, 'utf8');
if (!options.resume) await writeFile(BASELINE_PATH, seedSkill);
const targetCommand = commandFromEnv('CAD_TARGET_COMMAND_JSON', DEFAULT_TARGET_COMMAND);
const optimizerCommand = commandFromEnv('CAD_OPTIMIZER_COMMAND_JSON', DEFAULT_OPTIMIZER_COMMAND);
const runner = createCadRunner({
  targetCommand,
  keepWorkDirs: options.keepWorkDirs,
});
const optimizerWorkDir = await mkdtemp(join(tmpdir(), 'autoimprove-cad-optimizer-'));

const logger = {
  info: (message) => console.log(`[info] ${message}`),
  warn: (message) => console.warn(`[warn] ${message}`),
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
try {
  await cp(AGENTS_DIR, join(optimizerWorkDir, '.agents'), { recursive: true });
  await writeFile(
    join(
      optimizerWorkDir,
      '.agents',
      'agents',
      'cad',
      'skills',
      'generate-replicad-cad',
      'SKILL.md',
    ),
    seedSkill,
  );
  const optimizer = createCommandModelClient(optimizerCommand, {
    cwd: optimizerWorkDir,
    timeoutMs: 300_000,
  });

  const training = await train({
    skill: seedSkill,
    tasks,
    splitOverride: splitIds,
    runner,
    model: optimizer,
    epochs: 1,
    batchSize: splitIds.train.length,
    scheduler: constantScheduler(4),
    metric: 'soft',
    stateFile: STATE_FILE,
    concurrency: Math.min(4, splitIds.train.length),
    logger,
  });

  const candidateSkill = training.bestSkill;
  await writeFile(CANDIDATE_PATH, candidateSkill);

  const testTasks = tasks.filter((task) => splitIds.test.includes(task.id));
  console.log('[info] evaluating incumbent on the held-out test split');
  const baseline = await evaluateRepeated({
    tasks: testTasks,
    skill: seedSkill,
    runner,
    trials: options.trials,
    concurrency: Math.min(4, testTasks.length),
    logger,
  });
  const candidateChanged = candidateSkill !== seedSkill;
  console.log('[info] evaluating candidate on the held-out test split');
  const candidate = candidateChanged
    ? await evaluateRepeated({
        tasks: testTasks,
        skill: candidateSkill,
        runner,
        trials: options.trials,
        concurrency: Math.min(4, testTasks.length),
        logger,
      })
    : baseline;

  const promotion = promotionDecision(baseline.metrics, candidate.metrics, { candidateChanged });
  if (promotion.promoted) {
    const temporarySkill = `${SKILL_PATH}.tmp`;
    await writeFile(temporarySkill, candidateSkill);
    await rename(temporarySkill, SKILL_PATH);
  }

  const packageJson = JSON.parse(await readFile(join(EXAMPLE_DIR, 'package.json'), 'utf8'));
  const record = {
    schemaVersion: 1,
    runId: options.runId,
    timestamp: new Date().toISOString(),
    benchmark: CADTESTBENCH_PROVENANCE,
    taskManifestSha256: sha256(JSON.stringify(taskManifest)),
    trialsPerTask: options.trials,
    runtime: {
      node: process.version,
      replicad: packageJson.dependencies.replicad,
      replicadOpenCascadeJs: packageJson.dependencies['replicad-opencascadejs'],
      outfitter: {
        version: '1.0.0',
        commit: 'b4ee211dbe84a8d462485e892c6a6c21cd83ae07',
      },
    },
    skills: {
      baselineSha256: sha256(seedSkill),
      candidateSha256: sha256(candidateSkill),
      promotedSha256: sha256(promotion.promoted ? candidateSkill : seedSkill),
    },
    promotion,
    training: {
      steps: training.steps,
      accepts: training.accepts,
      rejects: training.rejects,
      skips: training.skips,
      baselineValidationScore: training.baselineScore,
      bestValidationScore: training.bestScore,
      bestStep: training.bestStep,
      usage: training.usage,
    },
    baseline: baseline.metrics,
    candidate: candidate.metrics,
    delta: metricDelta(baseline.metrics, candidate.metrics),
  };

  await writeFile(SUMMARY_PATH, `${JSON.stringify({
    ...record,
    trainingRecords: training.records,
    baselineEvaluation: baseline,
    candidateEvaluation: candidate,
  }, null, 2)}\n`);
  await mkdir(METRICS_DIR, { recursive: true });
  const oldHistory = await readFile(HISTORY_PATH, 'utf8').catch(() => '');
  const retained = oldHistory
    .split(/\r?\n/u)
    .filter(Boolean)
    .filter((line) => {
      try {
        return JSON.parse(line).runId !== options.runId;
      } catch {
        return true;
      }
    });
  await writeFile(HISTORY_PATH, `${[...retained, JSON.stringify(record)].join('\n')}\n`);
  await writeFile(LATEST_PATH, `${JSON.stringify(record, null, 2)}\n`);

  console.log('\nCAD skill self-improvement complete');
  console.log(`held-out RS: ${baseline.metrics.rs.toFixed(2)} -> ${candidate.metrics.rs.toFixed(2)}`);
  console.log(`held-out PR: ${baseline.metrics.pr.toFixed(2)} -> ${candidate.metrics.pr.toFixed(2)}`);
  console.log(`promotion: ${promotion.promoted ? 'accepted' : `rejected (${promotion.reasons.join(', ')})`}`);
  console.log(`metrics: ${LATEST_PATH}`);
  console.log(`raw summary: ${SUMMARY_PATH}`);
} finally {
  await rm(optimizerWorkDir, { recursive: true, force: true });
}
