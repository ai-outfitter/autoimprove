import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RolloutResult, TaskRunner } from '../types.js';
import { extractLastJsonObject } from '../json.js';
import { renderTemplate, runShellCommand } from './shell.js';
import type { RunnerCommandConfig } from './config.js';

/**
 * Turn a `runner.command` shell template into a library `TaskRunner`.
 *
 * Contract (AIMP-002.4): each invocation gets a fresh work directory with
 * the current skill written to `{{SKILL_FILE}}` inside it; the command's
 * stdout must end with a JSON object `{"hard": 0|1, "soft": number,
 * "trajectory": string, "failReason"?: string}` — the LAST balanced JSON
 * object on stdout is parsed, so the command may log freely before it.
 * A non-zero exit, a timeout, or an unparseable/invalid result throws,
 * which the library contains per AIMP-001.1 (one retry, then a
 * `{hard: 0, soft: 0}` result with an `error` field).
 */
export function createCommandRunner(config: RunnerCommandConfig): TaskRunner {
  return async (task, skill, ctx) => {
    const workDir = await mkdtemp(join(tmpdir(), 'autoimprove-task-'));
    try {
      const skillFile = join(workDir, 'skill.md');
      await writeFile(skillFile, skill, 'utf8');
      const command = renderTemplate(config.command, {
        SKILL_FILE: skillFile,
        TASK_ID: task.id,
        TASK_PAYLOAD: task.payload === undefined ? '' : JSON.stringify(task.payload),
        WORK_DIR: workDir,
      });
      const result = await runShellCommand(command, {
        timeoutMs: config.timeoutSeconds * 1000,
        ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      });
      if (result.timedOut) {
        throw new Error(
          `runner command for task ${task.id} timed out after ${config.timeoutSeconds}s (or was aborted)`,
        );
      }
      if (result.code !== 0) {
        throw new Error(
          `runner command for task ${task.id} exited with code ${result.code ?? 'unknown'}${snippet(result.stderr)}`,
        );
      }
      return parseRunnerStdout(task.id, result.stdout);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  };
}

/** Parse the LAST JSON object on stdout into a RolloutResult. Throws on violations. */
export function parseRunnerStdout(taskId: string, stdout: string): RolloutResult {
  const value = extractLastJsonObject(stdout);
  if (value === undefined) {
    throw new Error(
      `runner command for task ${taskId} produced no JSON result object on stdout; ` +
        'stdout must end with {"hard": 0|1, "soft": number, "trajectory": string}',
    );
  }
  const hard = value['hard'];
  if (hard !== 0 && hard !== 1) {
    throw new Error(`runner result for task ${taskId}: "hard" must be 0 or 1, got ${JSON.stringify(hard)}`);
  }
  const soft = value['soft'];
  if (typeof soft !== 'number' || !Number.isFinite(soft)) {
    throw new Error(`runner result for task ${taskId}: "soft" must be a finite number, got ${JSON.stringify(soft)}`);
  }
  const trajectory = value['trajectory'];
  if (typeof trajectory !== 'string') {
    throw new Error(`runner result for task ${taskId}: "trajectory" must be a string`);
  }
  const result: RolloutResult = { id: taskId, hard, soft, trajectory };
  if (typeof value['failReason'] === 'string') result.failReason = value['failReason'];
  return result;
}

function snippet(stderr: string): string {
  const trimmed = stderr.trim();
  if (trimmed === '') return '';
  return `: ${trimmed.slice(-500)}`;
}
