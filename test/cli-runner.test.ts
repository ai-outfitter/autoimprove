// PINNED REQUIREMENT TESTS. Tests below marked with a HARD REQUIREMENT
// comment validate docs/requirements/AIMP-002-cli.md. To change one,
// amend AIMP-002 FIRST, then update the test in the same change.
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createCommandRunner } from '../src/cli/runner.js';
import { runRollout } from '../src/index.js';
import { collectLogger } from './helpers.js';

const task = { id: 't1', description: 'first task' };

describe('createCommandRunner', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.4.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('parses the LAST JSON object on stdout, ignoring log noise', async () => {
    const runner = createCommandRunner({
      command: [
        `cat {{SKILL_FILE}} > /dev/null`,
        `echo 'log line { not json'`,
        `echo '{"hard": 0, "soft": 0.2, "trajectory": "early"}'`,
        `echo '{"hard": 1, "soft": 0.75, "trajectory": "final run", "failReason": "none"}'`,
      ].join(' && '),
      timeoutSeconds: 30,
    });
    const result = await runner(task, '# Skill', {});
    expect(result).toEqual({
      id: 't1',
      hard: 1,
      soft: 0.75,
      trajectory: 'final run',
      failReason: 'none',
    });
  });

  it('throws when the command exits non-zero', async () => {
    const runner = createCommandRunner({ command: 'cat {{SKILL_FILE}} > /dev/null && exit 7', timeoutSeconds: 30 });
    await expect(runner(task, '# Skill', {})).rejects.toThrow(/exited with code 7/);
  });

  it('throws when stdout contains no JSON object', async () => {
    const runner = createCommandRunner({ command: 'cat {{SKILL_FILE}} > /dev/null && echo done', timeoutSeconds: 30 });
    await expect(runner(task, '# Skill', {})).rejects.toThrow(/no JSON result object/);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.4.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('treats a result violating the shape (hard/soft/trajectory) as a runner failure', async () => {
    const badHard = createCommandRunner({
      command: `cat {{SKILL_FILE}} > /dev/null && echo '{"hard": 2, "soft": 0.5, "trajectory": "x"}'`,
      timeoutSeconds: 30,
    });
    await expect(badHard(task, '# Skill', {})).rejects.toThrow(/"hard" must be 0 or 1/);

    const badSoft = createCommandRunner({
      command: `cat {{SKILL_FILE}} > /dev/null && echo '{"hard": 1, "soft": "high", "trajectory": "x"}'`,
      timeoutSeconds: 30,
    });
    await expect(badSoft(task, '# Skill', {})).rejects.toThrow(/"soft" must be a finite number/);

    const noTrajectory = createCommandRunner({
      command: `cat {{SKILL_FILE}} > /dev/null && echo '{"hard": 1, "soft": 0.5}'`,
      timeoutSeconds: 30,
    });
    await expect(noTrajectory(task, '# Skill', {})).rejects.toThrow(/"trajectory" must be a string/);
  });

  it('kills the command after runner.timeoutSeconds', async () => {
    const runner = createCommandRunner({ command: 'cat {{SKILL_FILE}} > /dev/null && sleep 10', timeoutSeconds: 1 });
    await expect(runner(task, '# Skill', {})).rejects.toThrow(/timed out after 1s/);
  }, 15_000);

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.4.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('a failing command is contained by the library, not fatal to the run', async () => {
    const runner = createCommandRunner({ command: 'cat {{SKILL_FILE}} > /dev/null && exit 1', timeoutSeconds: 30 });
    const logger = collectLogger();
    const results = await runRollout({ tasks: [task], skill: '# Skill', runner, logger });
    expect(results).toHaveLength(1);
    const contained = results[0]!;
    expect(contained.hard).toBe(0);
    expect(contained.soft).toBe(0);
    expect(contained.error).toMatch(/exited with code 1/);
    expect(logger.warns.some((w) => w.includes('t1'))).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.5.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('passes payloads with quotes, spaces, and $() to the command literally', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'autoimprove-payload-'));
    const outFile = join(dir, 'payload.txt');
    const payload = { text: `quote " dollar $(whoami) 'single' back\`tick\` and ; semicolons` };
    const runner = createCommandRunner({
      command: `cat {{SKILL_FILE}} > /dev/null && printf '%s' {{TASK_PAYLOAD}} > '${outFile}' && echo '{"hard": 1, "soft": 1, "trajectory": "ok"}'`,
      timeoutSeconds: 30,
    });
    const result = await runner({ ...task, payload }, '# Skill', {});
    expect(result.hard).toBe(1);
    expect(await readFile(outFile, 'utf8')).toBe(JSON.stringify(payload));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.4.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('gives each invocation a fresh WORK_DIR containing the skill at SKILL_FILE', async () => {
    const runner = createCommandRunner({
      command: `grep -q 'UNIQUE MARKER' {{SKILL_FILE}} && printf '{"hard": 1, "soft": 1, "trajectory": "%s"}' {{WORK_DIR}}`,
      timeoutSeconds: 30,
    });
    const first = await runner(task, '# Skill with UNIQUE MARKER', {});
    const second = await runner(task, '# Skill with UNIQUE MARKER', {});
    expect(first.trajectory).not.toBe('');
    expect(first.trajectory).not.toBe(second.trajectory);
  });
});
