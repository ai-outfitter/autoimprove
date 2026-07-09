import type { Logger, Metric, RolloutResult, Task, TaskRunner } from './types.js';
import { defaultLogger, meanScore } from './types.js';
import { runRollout } from './rollout.js';

export interface GateOptions {
  candidateSkill: string;
  valTasks: readonly Task[];
  runner: TaskRunner;
  /** Score the current skill achieved on the same validation split. */
  baselineScore: number;
  /** Which score to gate on. Default 'soft'. */
  metric?: Metric;
  workDir?: string;
  signal?: AbortSignal;
  logger?: Logger;
  concurrency?: number;
}

export interface GateResult {
  /** True only if the candidate STRICTLY improved on the baseline. */
  accepted: boolean;
  candidateScore: number;
  baselineScore: number;
  results: RolloutResult[];
}

/**
 * Validation gate: evaluate the candidate skill on the held-out validation
 * split and accept only on strict improvement (candidate > baseline). Ties
 * and regressions are rejected.
 */
export async function gate(options: GateOptions): Promise<GateResult> {
  const logger = options.logger ?? defaultLogger;
  const metric = options.metric ?? 'soft';
  const results = await runRollout({
    tasks: options.valTasks,
    skill: options.candidateSkill,
    runner: options.runner,
    ...(options.workDir !== undefined ? { workDir: options.workDir } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
    logger,
  });
  const errored = results.filter((r) => r.error !== undefined).length;
  if (errored > 0) {
    logger.warn(
      `gate: ${errored}/${results.length} validation task(s) hit infrastructure errors; their zero scores are included in the gate metric`,
    );
  }
  const candidateScore = meanScore(results, metric);
  return {
    accepted: candidateScore > options.baselineScore,
    candidateScore,
    baselineScore: options.baselineScore,
    results,
  };
}
