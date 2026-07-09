/**
 * Bounded patches over the skill markdown. Edits are the only mechanism by
 * which the optimizer changes the skill, and each is checked against the
 * current text before applying: delete/replace must match exact existing
 * text; add appends, or inserts after an exact anchor.
 */

export type EditOp = 'add' | 'delete' | 'replace';

export interface SkillEdit {
  op: EditOp;
  /**
   * Exact existing text. Required for delete/replace (the text to remove or
   * replace); optional for add (an anchor to insert after; omitted = append).
   */
  target?: string;
  /** New text. Required for add/replace. */
  text?: string;
  /** Optimizer's short justification. Informational only. */
  rationale?: string;
}

export interface SkippedEdit {
  edit: SkillEdit;
  reason: string;
}

export interface ApplyResult {
  /** The skill text after applying all edits that could be applied. */
  skill: string;
  applied: SkillEdit[];
  skipped: SkippedEdit[];
}

/**
 * Apply edits in order against the evolving text. Edits that cannot be
 * applied (missing fields, no exact match, no-ops) are skipped with a
 * reason, never thrown.
 */
export function applyEdits(skill: string, edits: readonly SkillEdit[]): ApplyResult {
  let out = skill;
  const applied: SkillEdit[] = [];
  const skipped: SkippedEdit[] = [];

  for (const edit of edits) {
    switch (edit.op) {
      case 'add': {
        if (!edit.text) {
          skipped.push({ edit, reason: 'add requires text' });
          break;
        }
        if (out.includes(edit.text)) {
          skipped.push({ edit, reason: 'text already present in skill' });
          break;
        }
        if (edit.target !== undefined && edit.target !== '') {
          const idx = out.indexOf(edit.target);
          if (idx === -1) {
            skipped.push({ edit, reason: 'anchor not found in skill' });
            break;
          }
          const insertAt = idx + edit.target.length;
          out = `${out.slice(0, insertAt)}\n${edit.text}${out.slice(insertAt)}`;
        } else {
          out = `${out.replace(/\s+$/, '')}\n\n${edit.text}\n`;
        }
        applied.push(edit);
        break;
      }
      case 'delete': {
        if (!edit.target) {
          skipped.push({ edit, reason: 'delete requires target' });
          break;
        }
        const idx = out.indexOf(edit.target);
        if (idx === -1) {
          skipped.push({ edit, reason: 'target not found in skill' });
          break;
        }
        out = out.slice(0, idx) + out.slice(idx + edit.target.length);
        applied.push(edit);
        break;
      }
      case 'replace': {
        if (!edit.target) {
          skipped.push({ edit, reason: 'replace requires target' });
          break;
        }
        if (edit.text === undefined) {
          skipped.push({ edit, reason: 'replace requires text' });
          break;
        }
        if (edit.target === edit.text) {
          skipped.push({ edit, reason: 'replace is a no-op' });
          break;
        }
        const idx = out.indexOf(edit.target);
        if (idx === -1) {
          skipped.push({ edit, reason: 'target not found in skill' });
          break;
        }
        out = out.slice(0, idx) + edit.text + out.slice(idx + edit.target.length);
        applied.push(edit);
        break;
      }
      default:
        skipped.push({ edit, reason: `unknown op "${String((edit as SkillEdit).op)}"` });
    }
  }

  return { skill: out, applied, skipped };
}
