// PINNED REQUIREMENT TESTS. Tests below marked with a HARD REQUIREMENT
// comment validate docs/requirements/AIMP-002-cli.md. To change one,
// amend AIMP-002 FIRST, then update the test in the same change.
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/main.js';
import type { TrainSummary } from '../src/index.js';
import { captureIo, setupFixture } from './cli-helpers.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('cli command surface', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.1.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects any command other than train with usage and exit 2', async () => {
    for (const argv of [['init'], ['serve', '--config', 'x.json'], []]) {
      const io = captureIo();
      expect(await runCli(argv, io)).toBe(2);
      expect(io.errs.join('\n')).toContain('Usage: autoimprove train');
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.1.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects unknown flags and requires --config, with exit 2', async () => {
    const unknownFlag = captureIo();
    expect(await runCli(['train', '--config', 'x.json', '--fast'], unknownFlag)).toBe(2);

    const noConfig = captureIo();
    expect(await runCli(['train'], noConfig)).toBe(2);
    expect(noConfig.errs.join('\n')).toContain('--config');
  });

  it('prints usage with --help and exits 0', async () => {
    const io = captureIo();
    expect(await runCli(['--help'], io)).toBe(0);
    expect(io.outs.join('\n')).toContain('--dry-run');
  });
});

describe('cli dry run', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.3.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('makes zero runner and zero model invocations', async () => {
    const f = await setupFixture();
    const runnerSpy = join(f.dir, 'runner-spy.txt');
    const modelSpy = join(f.dir, 'model-spy.txt');
    f.config['runner'] = { command: `echo {{SKILL_FILE}} >> '${runnerSpy}'` };
    f.config['model'] = { provider: 'command', command: `echo {{PROMPT_FILE}} >> '${modelSpy}'` };
    await f.save();

    const io = captureIo();
    const code = await runCli(['train', '--config', f.configPath, '--dry-run'], io);
    expect(code).toBe(0);
    expect(existsSync(runnerSpy)).toBe(false);
    expect(existsSync(modelSpy)).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.3.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('prints the plan (tasks, split, steps, model, estimates) and exits 0', async () => {
    const f = await setupFixture();
    const io = captureIo();
    expect(await runCli(['train', '--config', f.configPath, '--dry-run'], io)).toBe(0);
    const out = io.outs.join('\n');
    expect(out).toContain('10 task(s)');
    expect(out).toContain('5 train / 2 val / 3 test');
    expect(out).toMatch(/2 step\(s\)/); // ceil(5 train / batch 4) = 2 steps
    expect(out).toContain('command: cat');
    expect(out).toMatch(/estimated:\s+<= \d+ runner invocation\(s\), <= \d+ optimizer call\(s\)/);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.2.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves relative config paths against the config file directory', async () => {
    const f = await setupFixture();
    const nested = join(f.dir, 'configs');
    await mkdir(nested, { recursive: true });
    const nestedConfig = join(nested, 'config.json');
    await writeFile(
      nestedConfig,
      JSON.stringify({ ...f.config, skill: '../skill.md', tasks: '../tasks.jsonl' }),
      'utf8',
    );
    const io = captureIo();
    expect(await runCli(['train', '--config', nestedConfig, '--dry-run'], io)).toBe(0);
    expect(io.outs.join('\n')).toContain(join(f.dir, 'skill.md'));
  });
});

describe('cli train end to end', () => {
  async function setupTrainableFixture() {
    const f = await setupFixture(undefined, {
      skillText: '# Seed skill\n\nBe helpful.\n',
    });
    // Runner: scores 0.9/hard 1 when the skill contains MAGIC, else 0.4/hard 0.
    const runnerScript = join(f.dir, 'runner.mjs');
    await writeFile(
      runnerScript,
      [
        `import { readFileSync } from 'node:fs';`,
        `const [, , skillFile, taskId] = process.argv;`,
        `const good = readFileSync(skillFile, 'utf8').includes('MAGIC');`,
        `console.log('noise before { the result');`,
        `console.log(JSON.stringify({`,
        `  hard: good ? 1 : 0,`,
        `  soft: good ? 0.9 : 0.4,`,
        `  trajectory: 'task ' + taskId + ' ran',`,
        `  ...(good ? {} : { failReason: 'skill lacks the magic rule' }),`,
        `}));`,
      ].join('\n'),
      'utf8',
    );
    // Model: always proposes the same known edit; reflect/merge/select all
    // parse the same JSON array shape.
    const modelScript = join(f.dir, 'model.mjs');
    await writeFile(
      modelScript,
      `console.log(JSON.stringify([{ op: 'add', text: 'MAGIC: always double-check the output.' }]));`,
      'utf8',
    );
    f.config['runner'] = { command: `node '${runnerScript}' {{SKILL_FILE}} {{TASK_ID}}` };
    f.config['model'] = { provider: 'command', command: `node '${modelScript}' {{PROMPT_FILE}}` };
    f.config['train'] = { epochs: 1, batchSize: 5, seed: 42, stateFile: 'state.json' };
    await f.save();
    return f;
  }

  it('runs the loop with command runner and command model, accepts the edit, and writes outputs', async () => {
    const f = await setupTrainableFixture();
    const io = captureIo();
    const code = await runCli(['train', '--config', f.configPath], io);
    expect(code).toBe(0);

    // The known edit was accepted and the trained skill written next to the seed.
    const trainedPath = join(f.dir, 'skill.trained.md');
    const trained = await readFile(trainedPath, 'utf8');
    expect(trained).toContain('MAGIC: always double-check the output.');

    // Summary JSON next to the state file, with the accept recorded.
    const summary = JSON.parse(await readFile(join(f.dir, 'state.summary.json'), 'utf8')) as TrainSummary;
    expect(summary.accepts).toBe(1);
    expect(summary.baselineScore).toBeCloseTo(0.4, 5);
    expect(summary.bestScore).toBeCloseTo(0.9, 5);
    expect(summary.records.every((r) => r.outcome !== 'reject')).toBe(true);

    // State file written; compact summary printed.
    expect(existsSync(join(f.dir, 'state.json'))).toBe(true);
    const out = io.outs.join('\n');
    expect(out).toContain('autoimprove train: complete');
    expect(out).toContain('1 accept');
    expect(out).toContain(trainedPath);
  }, 30_000);

  it('refuses to overwrite an existing state file without --resume, then resumes with it', async () => {
    const f = await setupTrainableFixture();
    expect(await runCli(['train', '--config', f.configPath], captureIo())).toBe(0);

    const refused = captureIo();
    expect(await runCli(['train', '--config', f.configPath], refused)).toBe(2);
    expect(refused.errs.join('\n')).toContain('--resume');

    const resumed = captureIo();
    expect(await runCli(['train', '--config', f.configPath, '--resume'], resumed)).toBe(0);
    expect(resumed.outs.join('\n')).toContain('resuming');
  }, 30_000);
});

describe('cli packaging', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.6.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('adds no runtime dependencies and ships as the package bin', () => {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(packageJson['dependencies']).toBeUndefined();
    expect(packageJson['peerDependencies']).toBeUndefined();
    expect(packageJson['bin']).toEqual({ autoimprove: './dist/cli.js' });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.6.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('cli modules import only node: built-ins and package-local modules', async () => {
    const files = [join(root, 'src', 'cli.ts')];
    for (const name of await readdir(join(root, 'src', 'cli'))) {
      files.push(join(root, 'src', 'cli', name));
    }
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/from '([^']+)'/g)) {
        const specifier = match[1] as string;
        expect(
          specifier.startsWith('node:') || specifier.startsWith('./') || specifier.startsWith('../'),
          `${file} imports "${specifier}"`,
        ).toBe(true);
      }
    }
  });
});
