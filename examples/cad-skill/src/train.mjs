#!/usr/bin/env node

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  constantScheduler,
  meanScore,
  runRollout,
  train,
} from '../../../dist/index.js';

import { assertBackendDependencies } from './adapters.mjs';
import {
  DEFAULT_OPTIMIZER_COMMAND,
  DEFAULT_TARGET_COMMAND,
  commandFromEnv,
  createCommandModelClient,
} from './command-client.mjs';
import { createCadRunner } from './runner.mjs';
import { BACKEND_IDS, splitIds, tasks } from './tasks.mjs';

const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_PATH = join(EXAMPLE_DIR, 'skill', 'generate-basic-cad', 'SKILL.md');
const TRAINED_SKILL_PATH = join(EXAMPLE_DIR, 'skill', 'generate-basic-cad', 'SKILL.trained.md');
const STATE_DIR = join(EXAMPLE_DIR, '.autoimprove');

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return args[index + 1];
};

const unknown = args.filter((arg, index) => {
  if (['--dry-run', '--resume', '--keep-workdirs'].includes(arg)) return false;
  if (arg === '--backends') return false;
  if (index > 0 && args[index - 1] === '--backends') return false;
  return arg.startsWith('--');
});
if (unknown.length > 0) throw new Error(`unknown option: ${unknown[0]}`);

const requestedBackends = valueAfter('--backends')?.split(',').filter(Boolean) ?? [...BACKEND_IDS];
if (requestedBackends.length === 0) throw new Error('--backends selected no backends');
for (const backend of requestedBackends) {
  if (!BACKEND_IDS.includes(backend)) {
    throw new Error(`unknown backend ${backend}; choose from ${BACKEND_IDS.join(', ')}`);
  }
}

const selected = tasks.filter((task) => requestedBackends.includes(task.payload.backend));
const selectedIds = new Set(selected.map((task) => task.id));
const splitOverride = {
  train: splitIds.train.filter((id) => selectedIds.has(id)),
  val: splitIds.val.filter((id) => selectedIds.has(id)),
  test: splitIds.test.filter((id) => selectedIds.has(id)),
};
const stateSuffix = requestedBackends.length === BACKEND_IDS.length
  ? ''
  : `-${requestedBackends.join('-')}`;
const stateFile = join(STATE_DIR, `state${stateSuffix}.json`);
const summaryFile = join(STATE_DIR, `summary${stateSuffix}.json`);

console.log('CAD skill training plan');
console.log(`backends: ${requestedBackends.join(', ')}`);
console.log(`split: ${splitOverride.train.length} train / ${splitOverride.val.length} val / ${splitOverride.test.length} test`);
console.log('training: 1 epoch, one all-backend batch, edit budget 4');
console.log('OpenTsCad resolution: @tscad/modeling (TSCAD)');

if (hasFlag('--dry-run')) process.exit(0);

if (!hasFlag('--resume')) {
  await access(stateFile).then(() => {
    throw new Error(`state already exists at ${stateFile}; pass --resume or remove it for a fresh run`);
  }).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}

await assertBackendDependencies(requestedBackends);
await mkdir(STATE_DIR, { recursive: true });

const seedSkill = await readFile(SKILL_PATH, 'utf8');
const targetCommand = commandFromEnv('CAD_TARGET_COMMAND_JSON', DEFAULT_TARGET_COMMAND);
const optimizerCommand = commandFromEnv('CAD_OPTIMIZER_COMMAND_JSON', DEFAULT_OPTIMIZER_COMMAND);
const runner = createCadRunner({
  targetCommand,
  keepWorkDirs: hasFlag('--keep-workdirs'),
});
const optimizerWorkDir = await mkdtemp(join(tmpdir(), 'autoimprove-cad-optimizer-'));

try {
  const optimizer = createCommandModelClient(optimizerCommand, {
    cwd: optimizerWorkDir,
    timeoutMs: 300_000,
  });

  const summary = await train({
    skill: seedSkill,
    tasks: selected,
    splitOverride,
    runner,
    model: optimizer,
    epochs: 1,
    batchSize: splitOverride.train.length,
    scheduler: constantScheduler(4),
    metric: 'soft',
    stateFile,
    concurrency: Math.min(4, selected.length),
    logger: {
      info: (message) => console.log(`[info] ${message}`),
      warn: (message) => console.warn(`[warn] ${message}`),
    },
  });

  const testTasks = selected.filter((task) => splitOverride.test.includes(task.id));
  const baselineTest = await runRollout({
    tasks: testTasks,
    skill: seedSkill,
    runner,
    concurrency: Math.min(4, testTasks.length),
  });
  const skillsDiffer = summary.bestSkill !== seedSkill;
  const trainedTest = skillsDiffer
    ? await runRollout({
        tasks: testTasks,
        skill: summary.bestSkill,
        runner,
        concurrency: Math.min(4, testTasks.length),
      })
    : baselineTest;
  const test = {
    metric: 'soft',
    baseline: meanScore(baselineTest, 'soft'),
    trained: meanScore(trainedTest, 'soft'),
    skillsDiffer,
    samplesPerSkill: 1,
    taskIds: testTasks.map((task) => task.id),
  };

  await writeFile(TRAINED_SKILL_PATH, summary.bestSkill);
  await writeFile(summaryFile, `${JSON.stringify({ ...summary, test }, null, 2)}\n`);

  console.log('\nCAD skill training complete');
  console.log(`validation: ${summary.baselineScore.toFixed(4)} -> ${summary.bestScore.toFixed(4)}`);
  console.log(`held-out single-sample score: ${test.baseline.toFixed(4)} -> ${test.trained.toFixed(4)}`);
  console.log(`accepted edits: ${summary.accepts}; rejected: ${summary.rejects}; skipped: ${summary.skips}`);
  console.log(`trained skill: ${TRAINED_SKILL_PATH}`);
  console.log(`summary: ${summaryFile}`);
} finally {
  await rm(optimizerWorkDir, { recursive: true, force: true });
}
