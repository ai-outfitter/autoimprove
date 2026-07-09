import type { Task } from './types.js';
import { mulberry32, seededShuffle } from './prng.js';

export interface TaskSplit {
  train: Task[];
  val: Task[];
  test: Task[];
}

/**
 * Split tasks into train/val/test by seeded shuffle. The ratio string is
 * "train:val:test" (default "5:2:3"). Deterministic for a given seed. The
 * test split is never touched by the training loop.
 */
export function splitTasks(
  tasks: readonly Task[],
  ratio = '5:2:3',
  seed = 42,
): TaskSplit {
  const parts = ratio.split(':').map((p) => Number(p.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) {
    throw new Error(`Invalid split ratio "${ratio}"; expected "train:val:test" like "5:2:3"`);
  }
  const [a, b] = parts as [number, number, number];
  const sum = parts.reduce((acc, p) => acc + p, 0);
  if (sum <= 0) {
    throw new Error(`Invalid split ratio "${ratio}"; parts sum to zero`);
  }
  const shuffled = seededShuffle(tasks, mulberry32(seed));
  const n = shuffled.length;
  const trainN = Math.floor((n * a) / sum);
  const valN = Math.floor((n * b) / sum);
  return {
    train: shuffled.slice(0, trainN),
    val: shuffled.slice(trainN, trainN + valN),
    test: shuffled.slice(trainN + valN),
  };
}

/** Explicit split membership by task id. Bypasses ratio splitting. */
export interface SplitOverride {
  train: string[];
  val: string[];
  test: string[];
}

/**
 * Resolve an explicit split override against the task list. The override is
 * honored verbatim: membership and order are exactly as given. Throws when
 * the override lists an id with no matching task (unknown or missing tasks
 * are never silently dropped or invented) or lists the same id more than
 * once. Tasks not listed anywhere are excluded from the run.
 */
export function overrideSplit(tasks: readonly Task[], override: SplitOverride): TaskSplit {
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  const seen = new Set<string>();
  const resolve = (ids: readonly string[], name: 'train' | 'val' | 'test'): Task[] =>
    ids.map((id) => {
      if (seen.has(id)) {
        throw new Error(`Split override lists task id "${id}" more than once`);
      }
      seen.add(id);
      const task = byId.get(id);
      if (task === undefined) {
        throw new Error(
          `Split override (${name}) lists task id "${id}" but no such task was provided`,
        );
      }
      return task;
    });
  return {
    train: resolve(override.train, 'train'),
    val: resolve(override.val, 'val'),
    test: resolve(override.test, 'test'),
  };
}
