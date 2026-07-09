/**
 * autoimprove: an embeddable SkillOpt-style skill-training loop.
 *
 * High-level entry point is `train()`; the lower-level pieces (reflect,
 * applyEdits, gate, splitTasks, schedulers, rollout) are exported so hosts
 * can compose custom loops.
 */

export type {
  Task,
  RolloutResult,
  RunnerContext,
  TaskRunner,
  ModelRequest,
  ModelResponse,
  ModelClient,
  TokenUsage,
  Logger,
  Metric,
} from './types.js';
export { defaultLogger, meanScore } from './types.js';

export type { EditOp, SkillEdit, SkippedEdit, ApplyResult } from './edits.js';
export { applyEdits } from './edits.js';

export { extractFirstJson, parseEditsResponse } from './json.js';

export { mulberry32, seededShuffle } from './prng.js';

export type { TaskSplit } from './split.js';
export { splitTasks } from './split.js';

export type { EditBudgetScheduler } from './schedulers.js';
export {
  constantScheduler,
  cosineScheduler,
  DEFAULT_EDIT_BUDGET,
  MIN_EDIT_BUDGET,
} from './schedulers.js';

export type { RejectedEdit } from './prompts.js';
export {
  OPTIMIZER_SYSTEM,
  reflectPrompt,
  mergePrompt,
  selectPrompt,
} from './prompts.js';

export type { RolloutOptions } from './rollout.js';
export { runRollout } from './rollout.js';

export type { ReflectOptions, MergeSelectOptions } from './reflect.js';
export { reflect, mergeEdits, selectEdits } from './reflect.js';

export type { GateOptions, GateResult } from './gate.js';
export { gate } from './gate.js';

export type {
  TrainOptions,
  TrainSummary,
  TrainState,
  StepRecord,
  StepOutcome,
} from './train.js';
export { train } from './train.js';

export type { CompatClientOptions } from './clients.js';
export { OpenAICompatClient, AnthropicCompatClient } from './clients.js';
