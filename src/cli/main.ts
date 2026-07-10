import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

import { train } from '../train.js';
import { constantScheduler, cosineScheduler } from '../schedulers.js';
import type { Logger } from '../types.js';
import { ConfigError, loadCliConfig, type LoadedConfig, type ModelConfig } from './config.js';
import { createCommandRunner } from './runner.js';
import { createModelClient } from './model.js';

/**
 * The CLI is a thin shell around the library's `train()` loop: exactly one
 * command (`autoimprove train --config <path>`), no scaffolding, no plugin
 * system, zero runtime dependencies (AIMP-002.1, AIMP-002.6). Config
 * validation failures name the first bad field and exit 2; `--dry-run`
 * validates and prints the plan without invoking any runner or model
 * command; runtime failures exit 1.
 */

export const USAGE = [
  'Usage: autoimprove train --config <path> [--resume] [--dry-run]',
  '',
  '  --config <path>  JSON config file describing skill, tasks, runner, model, train',
  '  --resume         continue from an existing state file',
  '  --dry-run        validate the config and print the plan; runs nothing',
  '  -h, --help       show this help',
].join('\n');

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

const defaultIo: CliIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

/** Run the CLI. Returns the process exit code (0 ok, 1 runtime, 2 usage/config). */
export async function runCli(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  let args: ReturnType<typeof parseCliArgs>;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    io.err(`autoimprove: ${message(err)}`);
    io.err(USAGE);
    return 2;
  }

  if (args.values.help === true) {
    io.out(USAGE);
    return 0;
  }
  if (args.positionals.length !== 1 || args.positionals[0] !== 'train') {
    io.err('autoimprove: expected exactly one command: train');
    io.err(USAGE);
    return 2;
  }
  const configPath = args.values.config;
  if (configPath === undefined) {
    io.err('config error: --config: a config file path is required');
    io.err(USAGE);
    return 2;
  }

  let config: LoadedConfig;
  try {
    config = await loadCliConfig(configPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      io.err(`config error: ${err.field}: ${err.message}`);
      return 2;
    }
    io.err(`autoimprove: ${message(err)}`);
    return 1;
  }

  const dryRun = args.values['dry-run'] === true;
  const resume = args.values.resume === true;
  const stateExists = existsSync(config.train.stateFile);
  if (stateExists && !resume && !dryRun) {
    io.err(
      `autoimprove: state file ${config.train.stateFile} already exists; ` +
        'pass --resume to continue that run or delete the file to start fresh',
    );
    return 2;
  }

  if (dryRun) {
    printPlan(config, io, { resume, stateExists });
    return 0;
  }

  return runTrain(config, io);
}

function parseCliArgs(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      resume: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
}

// --- dry run --------------------------------------------------------------------

function printPlan(
  config: LoadedConfig,
  io: CliIo,
  status: { resume: boolean; stateExists: boolean },
): void {
  const { split, train: t } = config;
  const stepsPerEpoch = Math.ceil(split.train.length / t.batchSize);
  const totalSteps = t.epochs * stepsPerEpoch;
  // Upper bounds: baseline val rollout + per-step train batch + per-step gate val.
  const maxRunnerCalls =
    split.val.length + t.epochs * split.train.length + totalSteps * split.val.length;
  // Up to 4 optimizer calls per step: 2 reflect minibatches + merge + select.
  const maxModelCalls = totalSteps * 4;
  const splitDesc =
    t.splitOverride !== undefined
      ? 'explicit override'
      : `ratio ${t.splitRatio ?? '5:2:3'}, seed ${t.seed}`;
  const stateNote = status.stateExists
    ? status.resume
      ? ' (exists; run would resume)'
      : ' (exists; run would refuse without --resume)'
    : '';

  io.out('autoimprove train --dry-run: config is valid; no runner or model command was invoked');
  io.out(`  config:        ${config.configPath}`);
  io.out(`  skill:         ${config.skillPath}`);
  io.out(`  tasks:         ${config.tasks.length} task(s) from ${config.tasksPath}`);
  io.out(
    `  split:         ${split.train.length} train / ${split.val.length} val / ${split.test.length} test (${splitDesc})`,
  );
  io.out(
    `  plan:          ${t.epochs} epoch(s) x ${stepsPerEpoch} step(s)/epoch = ${totalSteps} step(s), batch size ${t.batchSize}, gate metric ${t.gateMetric}`,
  );
  io.out(
    `  scheduler:     ${t.scheduler} (edit budget ${t.editBudget}${t.scheduler === 'cosine' ? ` -> ${t.minEditBudget}` : ''})`,
  );
  io.out(`  model:         ${describeModel(config.model)}`);
  io.out(`  runner:        ${config.runner.command} (timeout ${config.runner.timeoutSeconds}s)`);
  io.out(`  estimated:     <= ${maxRunnerCalls} runner invocation(s), <= ${maxModelCalls} optimizer call(s)`);
  io.out(`  state file:    ${config.train.stateFile}${stateNote}`);
  io.out(`  trained skill: ${config.trainedSkillFile}`);
  io.out(`  summary:       ${config.summaryFile}`);
}

function describeModel(model: ModelConfig): string {
  if (model.provider === 'command') {
    return `command: ${model.command} (timeout ${model.timeoutSeconds}s)`;
  }
  return `${model.provider} ${model.model} via ${model.baseUrl}`;
}

// --- train ----------------------------------------------------------------------

async function runTrain(config: LoadedConfig, io: CliIo): Promise<number> {
  const t = config.train;
  const logger: Logger = {
    info: (m) => io.out(m),
    warn: (m) => io.err(m),
    debug: () => {},
  };
  try {
    const scheduler =
      t.scheduler === 'cosine'
        ? cosineScheduler(t.editBudget, t.minEditBudget)
        : constantScheduler(t.editBudget);
    const summary = await train({
      skill: config.skillText,
      tasks: config.tasks,
      runner: createCommandRunner(config.runner),
      model: createModelClient(config.model),
      epochs: t.epochs,
      batchSize: t.batchSize,
      seed: t.seed,
      ...(t.splitRatio !== undefined ? { splitRatio: t.splitRatio } : {}),
      ...(t.splitOverride !== undefined ? { splitOverride: t.splitOverride } : {}),
      scheduler,
      metric: t.gateMetric,
      stateFile: t.stateFile,
      concurrency: t.concurrency,
      logger,
    });

    await writeFile(config.trainedSkillFile, summary.bestSkill, 'utf8');
    await mkdir(dirname(config.summaryFile), { recursive: true });
    await writeFile(config.summaryFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

    io.out('');
    io.out('autoimprove train: complete');
    io.out(`  baseline (${t.gateMetric}): ${summary.baselineScore.toFixed(4)}`);
    io.out(`  best:            ${summary.bestScore.toFixed(4)} (step ${summary.bestStep})`);
    io.out(`  final:           ${summary.finalScore.toFixed(4)}`);
    io.out(
      `  steps:           ${summary.steps} (${summary.accepts} accept / ${summary.rejects} reject / ${summary.skips} skip)`,
    );
    io.out(`  trained skill:   ${config.trainedSkillFile}`);
    io.out(`  summary:         ${config.summaryFile}`);
    io.out(`  state:           ${t.stateFile}`);
    return summary.aborted ? 1 : 0;
  } catch (err) {
    io.err(`autoimprove: ${message(err)}`);
    return 1;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
