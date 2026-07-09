/**
 * Core interfaces. The library is built around two user-supplied pieces:
 * a `ModelClient` (the optimizer model) and a `TaskRunner` (the agent
 * harness plus scorer). Everything else composes around them.
 */

/** A training task. The library only reads `id` and `description`. */
export interface Task {
  /** Stable unique identifier. Used for splits, records, and state. */
  id: string;
  /** Optional human-readable description, surfaced to the optimizer model. */
  description?: string;
  /** Arbitrary payload for the runner. The library never inspects it. */
  payload?: unknown;
}

/** Result of running one task under a skill. Produced by the `TaskRunner`. */
export interface RolloutResult {
  /** Task id this result belongs to. */
  id: string;
  /** Hard pass/fail signal. */
  hard: 0 | 1;
  /** Soft score in [0, 1]. */
  soft: number;
  /** Trajectory text (transcript, log, diff...) used for reflection. */
  trajectory: string;
  /** Optional short failure reason, surfaced to the optimizer. */
  failReason?: string;
  /** Optional task description override, surfaced to the optimizer. */
  taskDescription?: string;
  /**
   * Set by the library when the runner threw after a retry. A result with
   * `error` scored {hard: 0, soft: 0} is an infrastructure failure, not a
   * genuine zero. Hosts should check for it before trusting aggregates.
   */
  error?: string;
}

/** Context handed to the runner for each task execution. */
export interface RunnerContext {
  workDir?: string;
  signal?: AbortSignal;
}

/**
 * User-supplied agent harness. Runs one task under the given skill text and
 * returns a scored result. The library never shells out itself.
 */
export type TaskRunner = (
  task: Task,
  skill: string,
  ctx: RunnerContext,
) => Promise<RolloutResult>;

export interface ModelRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ModelResponse {
  text: string;
  usage?: TokenUsage;
}

/** Minimal model interface. Swap providers by swapping this object. */
export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/** Injectable logger. Defaults to console. */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  debug?(message: string): void;
}

/** Console-backed default logger. `debug` is a no-op. */
export const defaultLogger: Logger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  debug: () => {},
};

/** Which score the gate and records use. */
export type Metric = 'soft' | 'hard';

/** Mean of the chosen metric over a batch of results. Empty batch scores 0. */
export function meanScore(results: readonly RolloutResult[], metric: Metric): number {
  if (results.length === 0) return 0;
  let sum = 0;
  for (const r of results) sum += metric === 'hard' ? r.hard : r.soft;
  return sum / results.length;
}
