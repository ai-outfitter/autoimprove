import type { Logger, RolloutResult, Task, TaskRunner } from './types.js';
import { defaultLogger } from './types.js';

export interface RolloutOptions {
  tasks: readonly Task[];
  skill: string;
  runner: TaskRunner;
  workDir?: string;
  signal?: AbortSignal;
  logger?: Logger;
  /** Parallel task executions. Default 1 (fully sequential, deterministic order of execution). */
  concurrency?: number;
}

/**
 * Run a batch of tasks under a skill. A runner rejection is retried once;
 * a second rejection produces a result scored {hard: 0, soft: 0} with a
 * visible `error` field and a logger warning. An infrastructure failure is
 * never silently averaged in as a genuine zero. Results are returned in
 * task order.
 */
export async function runRollout(options: RolloutOptions): Promise<RolloutResult[]> {
  const { tasks, skill, runner } = options;
  const logger = options.logger ?? defaultLogger;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  const ctx = {
    ...(options.workDir !== undefined ? { workDir: options.workDir } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };

  const results: RolloutResult[] = new Array(tasks.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const index = next++;
      const task = tasks[index] as Task;
      results[index] = await runOne(task);
    }
  }

  async function runOne(task: Task): Promise<RolloutResult> {
    let firstError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await runner(task, skill, ctx);
        return sanitize(task, raw, logger);
      } catch (err) {
        if (attempt === 0) {
          firstError = err;
          logger.debug(`task ${task.id}: runner failed, retrying once (${message(err)})`);
        } else {
          const msg = `first attempt: ${message(firstError)}; retry: ${message(err)}`;
          logger.warn(
            `task ${task.id}: runner failed after retry; scoring {hard: 0, soft: 0} with error field set. ${msg}`,
          );
          return {
            id: task.id,
            hard: 0,
            soft: 0,
            trajectory: '',
            error: msg,
            ...(task.description !== undefined ? { taskDescription: task.description } : {}),
          };
        }
      }
    }
    // Unreachable, but satisfies the compiler.
    throw new Error('unreachable');
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function sanitize(task: Task, raw: RolloutResult, logger: Logger): RolloutResult {
  const result: RolloutResult = { ...raw, id: raw.id || task.id };
  if (result.hard !== 0 && result.hard !== 1) {
    logger.warn(`task ${task.id}: runner returned non-binary hard=${String(result.hard)}; coercing`);
    result.hard = (result.hard as number) >= 1 ? 1 : 0;
  }
  if (!Number.isFinite(result.soft)) {
    logger.warn(`task ${task.id}: runner returned non-finite soft score; clamping to 0`);
    result.soft = 0;
  } else if (result.soft < 0 || result.soft > 1) {
    logger.warn(`task ${task.id}: runner returned soft=${result.soft} outside [0,1]; clamping`);
    result.soft = Math.min(1, Math.max(0, result.soft));
  }
  return result;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
