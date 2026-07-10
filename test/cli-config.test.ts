// PINNED REQUIREMENT TESTS. Tests below marked with a HARD REQUIREMENT
// comment validate docs/requirements/AIMP-002-cli.md. To change one,
// amend AIMP-002 FIRST, then update the test in the same change.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/main.js';
import { captureIo, setupFixture } from './cli-helpers.js';

/** Run `train --config` against the fixture and expect a named-field exit-2 error. */
async function expectConfigError(
  configPath: string,
  field: string,
  messagePart?: string,
): Promise<void> {
  const io = captureIo();
  const code = await runCli(['train', '--config', configPath], io);
  expect(code).toBe(2);
  const stderr = io.errs.join('\n');
  expect(stderr).toContain(`config error: ${field}:`);
  if (messagePart !== undefined) expect(stderr).toContain(messagePart);
}

describe('cli config validation', () => {
  it('fails with exit 2 when the config file does not exist', async () => {
    await expectConfigError('/nonexistent/autoimprove-config.json', 'config', 'cannot read');
  });

  it('fails with exit 2 when the config file is not valid JSON', async () => {
    const f = await setupFixture();
    await writeFile(f.configPath, '{ not json', 'utf8');
    await expectConfigError(f.configPath, 'config', 'not valid JSON');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.2.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('names the first invalid field and exits 2 (missing skill)', async () => {
    const f = await setupFixture((c) => {
      delete c['skill'];
    });
    await f.save();
    await expectConfigError(f.configPath, 'skill');
  });

  it('fails on a skill path that does not exist', async () => {
    const f = await setupFixture((c) => {
      c['skill'] = 'missing-skill.md';
    });
    await f.save();
    await expectConfigError(f.configPath, 'skill', 'cannot read skill file');
  });

  it('fails on a tasks path that does not exist', async () => {
    const f = await setupFixture((c) => {
      c['tasks'] = 'missing-tasks.jsonl';
    });
    await f.save();
    await expectConfigError(f.configPath, 'tasks', 'cannot read tasks file');
  });

  it('names the offending JSONL line for an unparseable task', async () => {
    const f = await setupFixture();
    await writeFile(join(f.dir, 'tasks.jsonl'), '{"id":"t1"}\nnot json\n', 'utf8');
    await expectConfigError(f.configPath, 'tasks', 'line 2');
  });

  it('rejects duplicate task ids', async () => {
    const f = await setupFixture();
    await writeFile(join(f.dir, 'tasks.jsonl'), '{"id":"t1"}\n{"id":"t1"}\n', 'utf8');
    await expectConfigError(f.configPath, 'tasks', 'duplicate task id "t1"');
  });

  it('rejects a tasks file with no tasks', async () => {
    const f = await setupFixture();
    await writeFile(join(f.dir, 'tasks.jsonl'), '\n\n', 'utf8');
    await expectConfigError(f.configPath, 'tasks', 'no tasks found');
  });

  it('rejects a task line whose id is missing', async () => {
    const f = await setupFixture();
    await writeFile(join(f.dir, 'tasks.jsonl'), '{"description":"no id"}\n', 'utf8');
    await expectConfigError(f.configPath, 'tasks', '"id" must be a non-empty string');
  });

  it('requires runner.command', async () => {
    const f = await setupFixture((c) => {
      c['runner'] = {};
    });
    await f.save();
    await expectConfigError(f.configPath, 'runner.command');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.5.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects a runner.command without the {{SKILL_FILE}} placeholder', async () => {
    const f = await setupFixture((c) => {
      c['runner'] = { command: 'run-task {{TASK_ID}}' };
    });
    await f.save();
    await expectConfigError(f.configPath, 'runner.command', '{{SKILL_FILE}}');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.5.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects an unknown placeholder in a command template with the field named', async () => {
    const f = await setupFixture((c) => {
      c['runner'] = { command: 'run-task {{SKILL_FILE}} {{TASK_FILE}}' };
    });
    await f.save();
    await expectConfigError(f.configPath, 'runner.command', 'unknown placeholder {{TASK_FILE}}');
  });

  it('rejects a non-positive runner.timeoutSeconds', async () => {
    const f = await setupFixture((c) => {
      c['runner'] = { command: 'cat {{SKILL_FILE}}', timeoutSeconds: 0 };
    });
    await f.save();
    await expectConfigError(f.configPath, 'runner.timeoutSeconds');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.2.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects an unknown model provider with the field named and exit 2', async () => {
    const f = await setupFixture((c) => {
      c['model'] = { provider: 'gemini', model: 'gemini-pro' };
    });
    await f.save();
    await expectConfigError(f.configPath, 'model.provider', 'unknown provider "gemini"');
  });

  it('requires model.model for the openai provider', async () => {
    const f = await setupFixture((c) => {
      c['model'] = { provider: 'openai' };
    });
    await f.save();
    await expectConfigError(f.configPath, 'model.model');
  });

  it('fails when the API key environment variable is not set', async () => {
    const f = await setupFixture((c) => {
      c['model'] = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        apiKeyEnv: 'AUTOIMPROVE_TEST_UNSET_KEY',
      };
    });
    await f.save();
    delete process.env['AUTOIMPROVE_TEST_UNSET_KEY'];
    await expectConfigError(
      f.configPath,
      'model.apiKeyEnv',
      'environment variable AUTOIMPROVE_TEST_UNSET_KEY is not set',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.5.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects a model.command without the {{PROMPT_FILE}} placeholder', async () => {
    const f = await setupFixture((c) => {
      c['model'] = { provider: 'command', command: 'claude -p "hello"' };
    });
    await f.save();
    await expectConfigError(f.configPath, 'model.command', '{{PROMPT_FILE}}');
  });

  it('rejects a bad train.gateMetric', async () => {
    const f = await setupFixture((c) => {
      c['train'] = { gateMetric: 'medium' };
    });
    await f.save();
    await expectConfigError(f.configPath, 'train.gateMetric');
  });

  it('rejects a bad train.scheduler', async () => {
    const f = await setupFixture((c) => {
      c['train'] = { scheduler: 'linear' };
    });
    await f.save();
    await expectConfigError(f.configPath, 'train.scheduler');
  });

  it('rejects non-positive train.epochs', async () => {
    const f = await setupFixture((c) => {
      c['train'] = { epochs: 0 };
    });
    await f.save();
    await expectConfigError(f.configPath, 'train.epochs', 'positive integer');
  });

  it('rejects train.minEditBudget above train.editBudget', async () => {
    const f = await setupFixture((c) => {
      c['train'] = { editBudget: 2, minEditBudget: 5 };
    });
    await f.save();
    await expectConfigError(f.configPath, 'train.minEditBudget');
  });

  it('rejects a splitOverride naming an unknown task id', async () => {
    const f = await setupFixture((c) => {
      c['train'] = {
        splitOverride: { train: ['t1', 'nope'], val: ['t2'], test: [] },
      };
    });
    await f.save();
    await expectConfigError(f.configPath, 'train.splitOverride', 'nope');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.2.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails validation (exit 2) when the split leaves no validation tasks', async () => {
    const f = await setupFixture((c) => {
      c['train'] = { splitRatio: '1:0:0' };
    });
    await f.save();
    await expectConfigError(f.configPath, 'train.splitRatio', 'validation split is empty');
  });

  it('rejects an unknown top-level config key', async () => {
    const f = await setupFixture((c) => {
      c['runnner'] = {};
    });
    await f.save();
    await expectConfigError(f.configPath, 'runnner', 'unknown config key');
  });
});
