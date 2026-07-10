import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CliIo } from '../src/cli/main.js';

/** Io mock capturing stdout/stderr lines for assertions. */
export function captureIo(): CliIo & { outs: string[]; errs: string[]; all(): string } {
  const outs: string[] = [];
  const errs: string[] = [];
  return {
    outs,
    errs,
    all: () => [...outs, ...errs].join('\n'),
    out: (line: string) => outs.push(line),
    err: (line: string) => errs.push(line),
  };
}

export function tasksJsonl(n: number): string {
  return (
    Array.from({ length: n }, (_, i) =>
      JSON.stringify({ id: `t${i + 1}`, description: `task ${i + 1}`, payload: { n: i + 1 } }),
    ).join('\n') + '\n'
  );
}

export interface Fixture {
  dir: string;
  configPath: string;
  config: Record<string, unknown>;
  /** Rewrite the config file after mutating `config`. */
  save(): Promise<void>;
}

/**
 * Write a valid baseline fixture (skill.md, tasks.jsonl, config.json) into
 * a fresh temp dir, then apply `mutate` to the config and save it. The
 * default runner/model commands are inert `cat` templates that satisfy
 * validation but are never meant to run in validation tests.
 */
export async function setupFixture(
  mutate?: (config: Record<string, unknown>) => void,
  options: { taskCount?: number; skillText?: string } = {},
): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), 'autoimprove-cli-test-'));
  await writeFile(join(dir, 'skill.md'), options.skillText ?? '# Seed skill\n\nBe helpful.\n', 'utf8');
  await writeFile(join(dir, 'tasks.jsonl'), tasksJsonl(options.taskCount ?? 10), 'utf8');
  const config: Record<string, unknown> = {
    skill: 'skill.md',
    tasks: 'tasks.jsonl',
    runner: { command: 'cat {{SKILL_FILE}}' },
    model: { provider: 'command', command: 'cat {{PROMPT_FILE}}' },
    train: { batchSize: 4 },
  };
  mutate?.(config);
  const configPath = join(dir, 'config.json');
  const save = async (): Promise<void> => {
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  };
  await save();
  return { dir, configPath, config, save };
}
