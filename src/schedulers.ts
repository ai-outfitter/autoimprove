/**
 * Textual learning rate: how many edits may be applied per step.
 * Schedulers map (step, totalSteps) to an integer edit budget.
 */
export type EditBudgetScheduler = (step: number, totalSteps: number) => number;

export const DEFAULT_EDIT_BUDGET = 4;
export const MIN_EDIT_BUDGET = 2;

/** Same budget at every step (default 4). */
export function constantScheduler(budget: number = DEFAULT_EDIT_BUDGET): EditBudgetScheduler {
  const b = Math.max(1, Math.round(budget));
  return () => b;
}

/**
 * Cosine decay from `initial` (default 4) down to `min` (default 2) over the
 * run: large early edits, small late refinements.
 */
export function cosineScheduler(
  initial: number = DEFAULT_EDIT_BUDGET,
  min: number = MIN_EDIT_BUDGET,
): EditBudgetScheduler {
  return (step, totalSteps) => {
    if (totalSteps <= 1) return Math.max(1, Math.round(initial));
    const clamped = Math.min(Math.max(step, 0), totalSteps - 1);
    const t = clamped / (totalSteps - 1);
    const value = min + (initial - min) * 0.5 * (1 + Math.cos(Math.PI * t));
    return Math.max(1, Math.round(value));
  };
}
