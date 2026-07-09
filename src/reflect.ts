import type { Logger, ModelClient, RolloutResult, TokenUsage } from './types.js';
import { defaultLogger } from './types.js';
import type { SkillEdit } from './edits.js';
import { parseEditsResponse } from './json.js';
import {
  OPTIMIZER_SYSTEM,
  mergePrompt,
  reflectPrompt,
  selectPrompt,
  type RejectedEdit,
} from './prompts.js';

export interface ReflectOptions {
  model: ModelClient;
  skill: string;
  results: readonly RolloutResult[];
  /** Rejected-edit buffer, included as negative context in every reflect call. */
  rejected?: readonly RejectedEdit[];
  maxTokens?: number;
  logger?: Logger;
  onUsage?: (usage: TokenUsage) => void;
}

/**
 * Reflection step: group results into a failure minibatch (hard = 0) and a
 * success minibatch (hard = 1), run one optimizer call per non-empty
 * minibatch, and return the combined proposed edits. Model errors and
 * unparseable responses degrade to zero edits for that minibatch; this
 * function never throws mid-loop.
 */
export async function reflect(options: ReflectOptions): Promise<SkillEdit[]> {
  const logger = options.logger ?? defaultLogger;
  const failures = options.results.filter((r) => r.hard === 0);
  const successes = options.results.filter((r) => r.hard === 1);

  const edits: SkillEdit[] = [];
  for (const [kind, batch] of [
    ['failure', failures],
    ['success', successes],
  ] as const) {
    if (batch.length === 0) continue;
    const prompt = reflectPrompt({
      skill: options.skill,
      results: batch,
      kind,
      rejected: options.rejected ?? [],
    });
    const batchEdits = await completeEdits(options, prompt, `reflect(${kind})`, logger);
    edits.push(...batchEdits);
  }
  return edits;
}

export interface MergeSelectOptions {
  model: ModelClient;
  skill: string;
  edits: readonly SkillEdit[];
  maxTokens?: number;
  logger?: Logger;
  onUsage?: (usage: TokenUsage) => void;
}

/**
 * Merge duplicate/conflicting proposed edits with one optimizer call.
 * Skips the call when there is at most one edit. On model error or
 * unparseable response, falls back to the input edits unchanged.
 */
export async function mergeEdits(options: MergeSelectOptions): Promise<SkillEdit[]> {
  const logger = options.logger ?? defaultLogger;
  if (options.edits.length <= 1) return [...options.edits];
  const prompt = mergePrompt({ skill: options.skill, edits: options.edits });
  const merged = await completeEdits(options, prompt, 'merge', logger, [...options.edits]);
  return merged.length > 0 ? merged : [...options.edits];
}

/**
 * Rank edits and keep at most `budget` (the current textual learning rate),
 * with one optimizer call. Skips the call when the set already fits the
 * budget. On model error or unparseable response, falls back to the first
 * `budget` edits.
 */
export async function selectEdits(
  options: MergeSelectOptions & { budget: number },
): Promise<SkillEdit[]> {
  const logger = options.logger ?? defaultLogger;
  const budget = Math.max(1, Math.floor(options.budget));
  if (options.edits.length <= budget) return [...options.edits];
  const prompt = selectPrompt({ skill: options.skill, edits: options.edits, budget });
  const fallback = options.edits.slice(0, budget);
  const selected = await completeEdits(options, prompt, 'select', logger, fallback);
  const chosen = selected.length > 0 ? selected : fallback;
  return chosen.slice(0, budget);
}

async function completeEdits(
  options: { model: ModelClient; maxTokens?: number; onUsage?: (usage: TokenUsage) => void },
  prompt: string,
  stage: string,
  logger: Logger,
  fallback: SkillEdit[] = [],
): Promise<SkillEdit[]> {
  try {
    const response = await options.model.complete({
      system: OPTIMIZER_SYSTEM,
      prompt,
      ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    });
    if (response.usage) options.onUsage?.(response.usage);
    const edits = parseEditsResponse(response.text);
    if (edits.length === 0 && response.text.trim() !== '[]') {
      logger.debug?.(`${stage}: no valid edits parsed from optimizer response`);
    }
    return edits;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`${stage}: optimizer call failed (${msg}); continuing with ${fallback.length} fallback edit(s)`);
    return fallback;
  }
}
