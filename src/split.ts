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
