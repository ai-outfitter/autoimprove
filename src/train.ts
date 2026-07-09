import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  Logger,
  Metric,
  ModelClient,
  Task,
  TaskRunner,
  TokenUsage,
} from './types.js';
import { defaultLogger, meanScore } from './types.js';
import { mulberry32, seededShuffle } from './prng.js';
import { splitTasks } from './split.js';
import { constantScheduler, type EditBudgetScheduler } from './schedulers.js';
import { applyEdits } from './edits.js';
import type { RejectedEdit } from './prompts.js';
import { reflect, mergeEdits, selectEdits } from './reflect.js';
import { runRollout } from './rollout.js';
import { gate } from './gate.js';

export type StepOutcome = 'accept' | 'reject' | 'skip';

export interface StepRecord {
  step: number;
  epoch: number;
  batchTaskIds: string[];
  outcome: StepOutcome;
  /** Present for skips and rejects. */
  reason?: string;
  editBudget: number;
  proposedEdits: number;
  selectedEdits: number;
  appliedEdits: number;
  /** Mean metric over the training batch under the current skill. */
  trainScore: number;
  /** Candidate score on the validation split (accept/reject steps only). */
  valScore?: number;
  /** Baseline (current skill) validation score the gate compared against. */
  baselineScore?: number;
}

export interface TrainState {
  version: 1;
  seed: number;
  /** Number of completed steps; the loop resumes here. */
  step: number;
  currentSkill: string;
  /** Current skill's score on the validation split. */
  currentScore: number;
  bestSkill: string;
  bestScore: number;
  bestStep: number;
  rejected: RejectedEdit[];
  records: StepRecord[];
  usage: TokenUsage;
}

export interface TrainSummary {
  steps: number;
  accepts: number;
  rejects: number;
  skips: number;
  bestSkill: string;
  bestScore: number;
  bestStep: number;
  finalSkill: string;
  finalScore: number;
  usage: TokenUsage;
  records: StepRecord[];
  /** Task ids per split. The test split is never touched by the loop. */
  split: { train: string[]; val: string[]; test: string[] };
  /** True if the run stopped early via AbortSignal. */
  aborted: boolean;
}

export interface TrainOptions {
  /** Initial skill markdown: the trainable parameter. */
  skill: string;
  tasks: readonly Task[];
  runner: TaskRunner;
  /** Optimizer model used for reflect/merge/select. */
  model: ModelClient;
  /** Passes over the training split. Default 1. */
  epochs?: number;
  /** Training tasks per step. Default 4. */
  batchSize?: number;
  /** Seed for splits and per-epoch shuffles. Default 42. */
  seed?: number;
  /** "train:val:test". Default "5:2:3". */
  splitRatio?: string;
  /** Edit budget per step ("textual learning rate"). Default constant 4. */
  scheduler?: EditBudgetScheduler;
  /** Gate metric. Default 'soft'. */
  metric?: Metric;
  /** JSON state file for resumable runs. Written after every step. */
  stateFile?: string;
  /** Max rejected edits kept as negative context. Default 20. */
  rejectedBufferSize?: number;
  workDir?: string;
  logger?: Logger;
  signal?: AbortSignal;
  /** Parallel task executions inside a rollout. Default 1. */
  concurrency?: number;
  /** maxTokens for optimizer calls. */
  maxTokens?: number;
}

/**
 * The SkillOpt-style training loop. Treats the skill markdown as the
 * trainable parameter of a frozen agent: rollout a training batch, reflect
 * on failures and successes, propose bounded edits, merge and select within
 * the step's edit budget, then accept the candidate only if it strictly
 * improves the held-out validation score. Resumable via `stateFile`.
 */
export async function train(options: TrainOptions): Promise<TrainSummary> {
  const logger = options.logger ?? defaultLogger;
  const seed = options.seed ?? 42;
  const epochs = Math.max(1, Math.floor(options.epochs ?? 1));
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 4));
  const metric = options.metric ?? 'soft';
  const scheduler = options.scheduler ?? constantScheduler();
  const rejectedBufferSize = Math.max(0, options.rejectedBufferSize ?? 20);

  const split = splitTasks(options.tasks, options.splitRatio ?? '5:2:3', seed);
  if (split.train.length === 0) {
    throw new Error(
      `Training split is empty (${options.tasks.length} tasks, ratio "${options.splitRatio ?? '5:2:3'}"); provide more tasks or adjust the ratio`,
    );
  }
  if (split.val.length === 0) {
    throw new Error(
      `Validation split is empty (${options.tasks.length} tasks, ratio "${options.splitRatio ?? '5:2:3'}"); the gate needs held-out tasks`,
    );
  }

  const stepsPerEpoch = Math.ceil(split.train.length / batchSize);
  const totalSteps = epochs * stepsPerEpoch;

  // --- State: fresh or resumed ---------------------------------------------
  let state = await loadState(options.stateFile, logger);
  if (state !== undefined && state.seed !== seed) {
    throw new Error(
      `State file was written with seed ${state.seed} but this run uses seed ${seed}; splits would silently diverge. Delete the state file or match the seed.`,
    );
  }

  // Token usage accounting: wrap the model so every optimizer call is counted.
  const usage: TokenUsage = state?.usage ?? { promptTokens: 0, completionTokens: 0 };
  const addUsage = (u: TokenUsage): void => {
    usage.promptTokens += u.promptTokens;
    usage.completionTokens += u.completionTokens;
  };

  const rolloutBase = {
    runner: options.runner,
    ...(options.workDir !== undefined ? { workDir: options.workDir } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
    logger,
  };

  if (state === undefined) {
    logger.info(
      `train: ${split.train.length} train / ${split.val.length} val / ${split.test.length} test tasks, ${totalSteps} step(s); evaluating baseline`,
    );
    const baselineResults = await runRollout({ ...rolloutBase, tasks: split.val, skill: options.skill });
    const baselineScore = meanScore(baselineResults, metric);
    logger.info(`train: baseline validation ${metric} score ${baselineScore.toFixed(4)}`);
    state = {
      version: 1,
      seed,
      step: 0,
      currentSkill: options.skill,
      currentScore: baselineScore,
      bestSkill: options.skill,
      bestScore: baselineScore,
      bestStep: 0,
      rejected: [],
      records: [],
      usage,
    };
    await saveState(options.stateFile, state);
  } else {
    state.usage = usage;
    logger.info(
      `train: resuming from step ${state.step}/${totalSteps} (current ${metric} score ${state.currentScore.toFixed(4)})`,
    );
  }

  // --- Loop -----------------------------------------------------------------
  let aborted = false;
  let stepIndex = 0;

  outer: for (let epoch = 0; epoch < epochs; epoch++) {
    // Per-epoch deterministic shuffle so resumed runs replay the same order.
    const order = seededShuffle(split.train, mulberry32(seed + epoch + 1));
    for (let b = 0; b < stepsPerEpoch; b++, stepIndex++) {
      if (stepIndex < state.step) continue; // already completed (resume)
      if (options.signal?.aborted) {
        aborted = true;
        logger.warn(`train: aborted before step ${stepIndex}; state saved, rerun to resume`);
        break outer;
      }

      const batch = order.slice(b * batchSize, (b + 1) * batchSize);
      const editBudget = scheduler(stepIndex, totalSteps);

      // 1. Rollout the training batch under the current skill.
      const results = await runRollout({ ...rolloutBase, tasks: batch, skill: state.currentSkill });
      const trainScore = meanScore(results, metric);

      const base: Omit<StepRecord, 'outcome'> = {
        step: stepIndex,
        epoch,
        batchTaskIds: batch.map((t) => t.id),
        editBudget,
        proposedEdits: 0,
        selectedEdits: 0,
        appliedEdits: 0,
        trainScore,
      };

      // 2. Reflect on failure/success minibatches (rejected buffer as negative context).
      const proposed = await reflect({
        model: options.model,
        skill: state.currentSkill,
        results,
        rejected: state.rejected,
        ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
        logger,
        onUsage: addUsage,
      });
      base.proposedEdits = proposed.length;
      if (proposed.length === 0) {
        await finishStep(state, { ...base, outcome: 'skip', reason: 'no edits proposed' }, options.stateFile, logger);
        continue;
      }

      // 3. Merge duplicates/conflicts, then rank and keep within the budget.
      const merged = await mergeEdits({
        model: options.model,
        skill: state.currentSkill,
        edits: proposed,
        ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
        logger,
        onUsage: addUsage,
      });
      const selected = await selectEdits({
        model: options.model,
        skill: state.currentSkill,
        edits: merged,
        budget: editBudget,
        ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
        logger,
        onUsage: addUsage,
      });
      base.selectedEdits = selected.length;

      // 4. Apply the bounded patch to produce a candidate skill.
      const patch = applyEdits(state.currentSkill, selected);
      base.appliedEdits = patch.applied.length;
      for (const s of patch.skipped) {
        logger.debug(`step ${stepIndex}: skipped edit (${s.reason}): ${JSON.stringify(s.edit)}`);
      }
      if (patch.applied.length === 0 || patch.skill === state.currentSkill) {
        await finishStep(
          state,
          { ...base, outcome: 'skip', reason: 'no edits applied cleanly' },
          options.stateFile,
          logger,
        );
        continue;
      }

      // 5. Validation gate: strict improvement on the held-out split.
      const gateResult = await gate({
        candidateSkill: patch.skill,
        valTasks: split.val,
        runner: options.runner,
        baselineScore: state.currentScore,
        metric,
        ...(options.workDir !== undefined ? { workDir: options.workDir } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
        logger,
      });

      if (gateResult.accepted) {
        state.currentSkill = patch.skill;
        state.currentScore = gateResult.candidateScore;
        if (gateResult.candidateScore > state.bestScore) {
          state.bestSkill = patch.skill;
          state.bestScore = gateResult.candidateScore;
          state.bestStep = stepIndex + 1;
        }
        logger.info(
          `step ${stepIndex}: ACCEPT (${gateResult.baselineScore.toFixed(4)} -> ${gateResult.candidateScore.toFixed(4)}, ${patch.applied.length} edit(s))`,
        );
        await finishStep(
          state,
          {
            ...base,
            outcome: 'accept',
            valScore: gateResult.candidateScore,
            baselineScore: gateResult.baselineScore,
          },
          options.stateFile,
          logger,
        );
      } else {
        const reason = `validation ${metric} score ${gateResult.candidateScore.toFixed(4)} did not strictly improve on ${gateResult.baselineScore.toFixed(4)}`;
        for (const edit of patch.applied) {
          state.rejected.push({ edit, step: stepIndex, reason });
        }
        if (rejectedBufferSize > 0 && state.rejected.length > rejectedBufferSize) {
          state.rejected = state.rejected.slice(state.rejected.length - rejectedBufferSize);
        }
        logger.info(`step ${stepIndex}: REJECT (${reason})`);
        await finishStep(
          state,
          {
            ...base,
            outcome: 'reject',
            reason,
            valScore: gateResult.candidateScore,
            baselineScore: gateResult.baselineScore,
          },
          options.stateFile,
          logger,
        );
      }
    }
  }

  // --- Summary ---------------------------------------------------------------
  const counts = { accept: 0, reject: 0, skip: 0 };
  for (const r of state.records) counts[r.outcome]++;
  const summary: TrainSummary = {
    steps: state.records.length,
    accepts: counts.accept,
    rejects: counts.reject,
    skips: counts.skip,
    bestSkill: state.bestSkill,
    bestScore: state.bestScore,
    bestStep: state.bestStep,
    finalSkill: state.currentSkill,
    finalScore: state.currentScore,
    usage: { ...usage },
    records: state.records,
    split: {
      train: split.train.map((t) => t.id),
      val: split.val.map((t) => t.id),
      test: split.test.map((t) => t.id),
    },
    aborted,
  };
  logger.info(
    `train: done. ${summary.accepts} accept(s), ${summary.rejects} reject(s), ${summary.skips} skip(s); best ${metric} score ${summary.bestScore.toFixed(4)} at step ${summary.bestStep}; tokens ${usage.promptTokens}+${usage.completionTokens}`,
  );
  return summary;
}

async function finishStep(
  state: TrainState,
  record: StepRecord,
  stateFile: string | undefined,
  logger: Logger,
): Promise<void> {
  state.records.push(record);
  state.step = record.step + 1;
  await saveState(stateFile, state);
  logger.debug(`step ${record.step}: ${record.outcome}${record.reason ? ` (${record.reason})` : ''}`);
}

async function loadState(
  stateFile: string | undefined,
  logger: Logger,
): Promise<TrainState | undefined> {
  if (stateFile === undefined) return undefined;
  let text: string;
  try {
    text = await readFile(stateFile, 'utf8');
  } catch {
    return undefined; // no state yet: fresh run
  }
  try {
    const parsed = JSON.parse(text) as TrainState;
    if (parsed.version !== 1 || typeof parsed.step !== 'number' || typeof parsed.currentSkill !== 'string') {
      logger.warn(`train: state file ${stateFile} has unexpected shape; starting fresh`);
      return undefined;
    }
    return parsed;
  } catch {
    logger.warn(`train: state file ${stateFile} is not valid JSON; starting fresh`);
    return undefined;
  }
}

async function saveState(stateFile: string | undefined, state: TrainState): Promise<void> {
  if (stateFile === undefined) return;
  await mkdir(dirname(stateFile), { recursive: true });
  const tmp = `${stateFile}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await rename(tmp, stateFile);
}
