/**
 * All optimizer prompts, embedded as TypeScript template constants.
 *
 * Self-containment is a design principle here: prompts live in code, in this
 * one file, so the published package can never ship with a missing or empty
 * prompts directory. Do not move these to loose files.
 */

import type { RolloutResult } from './types.js';
import type { SkillEdit } from './edits.js';

/** An edit the validation gate rejected, kept as negative context. */
export interface RejectedEdit {
  edit: SkillEdit;
  step: number;
  reason: string;
}

export const OPTIMIZER_SYSTEM = `You are a skill optimizer. A "skill" is a markdown document that guides a frozen AI agent through tasks. You improve the skill by proposing small, precise edits grounded in evidence from task trajectories. You never rewrite the whole document. You respond with strict JSON only, no prose, no code fences.`;

const EDIT_SCHEMA = `Respond with ONLY a JSON array of edit objects, no other text. Each edit object has:
- "op": "add" | "delete" | "replace"
- "target": for "delete"/"replace", text copied EXACTLY (character for character) from the current skill; for "add", an optional exact anchor to insert after (omit to append at the end)
- "text": the new text, for "add"/"replace"
- "rationale": one short sentence explaining the edit

Rules:
- "target" must be an exact substring of the current skill or the edit will be discarded.
- Keep edits small and specific. Prefer adding or refining a single guideline over restructuring.
- Do not propose edits whose text is already in the skill.
- If no edit is warranted, respond with an empty array: []`;

const MAX_TRAJECTORY_CHARS = 4000;

function truncate(text: string, max = MAX_TRAJECTORY_CHARS): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 20) / 2);
  return `${text.slice(0, half)}\n...[truncated]...\n${text.slice(text.length - half)}`;
}

function renderResult(r: RolloutResult): string {
  const lines = [`### Task ${r.id} (hard=${r.hard}, soft=${r.soft.toFixed(3)})`];
  if (r.taskDescription) lines.push(`Task: ${r.taskDescription}`);
  if (r.failReason) lines.push(`Failure reason: ${r.failReason}`);
  if (r.error) lines.push(`INFRASTRUCTURE ERROR (score is not meaningful): ${r.error}`);
  lines.push('Trajectory:');
  lines.push('```');
  lines.push(truncate(r.trajectory || '(empty trajectory)'));
  lines.push('```');
  return lines.join('\n');
}

function renderRejected(rejected: readonly RejectedEdit[]): string {
  if (rejected.length === 0) return '';
  const items = rejected
    .map(
      (r) =>
        `- step ${r.step}, rejected because ${r.reason}: ${JSON.stringify(r.edit)}`,
    )
    .join('\n');
  return `\n## Previously rejected edits\nThese edits were tried before and failed held-out validation. Do NOT re-propose them or close variants of them:\n${items}\n`;
}

/** Prompt for one reflection minibatch (failures or successes). */
export function reflectPrompt(options: {
  skill: string;
  results: readonly RolloutResult[];
  kind: 'failure' | 'success';
  rejected?: readonly RejectedEdit[];
}): string {
  const { skill, results, kind } = options;
  const rejected = options.rejected ?? [];
  const framing =
    kind === 'failure'
      ? `The trajectories below are FAILURES under the current skill. Analyze what guidance the skill lacked or got wrong, and propose edits that would prevent these failures.`
      : `The trajectories below are SUCCESSES under the current skill. Analyze what worked, and propose edits that make the winning behavior explicit or remove guidance the successes contradict. Only propose an edit if it clearly generalizes; otherwise return [].`;

  return `## Current skill
\`\`\`markdown
${skill}
\`\`\`

## Task ${kind === 'failure' ? 'failures' : 'successes'}
${framing}

${results.map(renderResult).join('\n\n')}
${renderRejected(rejected)}
## Your response
${EDIT_SCHEMA}`;
}

/** Prompt to merge duplicate or conflicting proposed edits into a clean set. */
export function mergePrompt(options: {
  skill: string;
  edits: readonly SkillEdit[];
}): string {
  return `## Current skill
\`\`\`markdown
${options.skill}
\`\`\`

## Proposed edits
Multiple analyses proposed the edits below. Merge them: combine duplicates and near-duplicates into a single edit, resolve conflicts (two edits touching the same text) by keeping the better-justified one, and drop edits invalidated by another edit in the set. Do not invent new edits.

${JSON.stringify(options.edits, null, 2)}

## Your response
${EDIT_SCHEMA}`;
}

/** Prompt to rank merged edits and keep at most `budget`. */
export function selectPrompt(options: {
  skill: string;
  edits: readonly SkillEdit[];
  budget: number;
}): string {
  return `## Current skill
\`\`\`markdown
${options.skill}
\`\`\`

## Candidate edits
Rank the edits below by expected improvement to task success, best first, and return AT MOST ${options.budget} of them. Return only edits from this list, unchanged. Do not invent new edits.

${JSON.stringify(options.edits, null, 2)}

## Your response
${EDIT_SCHEMA}`;
}
