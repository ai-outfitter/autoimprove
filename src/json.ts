import type { SkillEdit, EditOp } from './edits.js';

/**
 * Defensive JSON extraction. Optimizer models are instructed to return
 * strict JSON but frequently wrap it in prose or code fences. These helpers
 * pull the first parseable JSON value out of free text and never throw.
 */

/**
 * Find and parse the first balanced JSON array or object in `text`.
 * Returns undefined if nothing parseable is found.
 */
export function extractFirstJson(text: string): unknown {
  for (let start = 0; start < text.length; start++) {
    const ch = text[start];
    if (ch !== '{' && ch !== '[') continue;
    const end = findBalancedEnd(text, start);
    if (end === -1) continue;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Balanced but invalid (e.g. brackets in prose); keep scanning.
    }
  }
  return undefined;
}

/** Index of the character that closes the JSON value opening at `start`, or -1. */
function findBalancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const VALID_OPS: ReadonlySet<string> = new Set(['add', 'delete', 'replace']);

/**
 * Parse an optimizer response into a list of valid SkillEdits.
 * Accepts a bare array or an object with an `edits` array; tolerates
 * surrounding prose; drops malformed items. Never throws; invalid input
 * yields an empty list.
 */
export function parseEditsResponse(text: string): SkillEdit[] {
  const value = extractFirstJson(text);
  let items: unknown[];
  if (Array.isArray(value)) {
    items = value;
  } else if (value !== null && typeof value === 'object' && Array.isArray((value as { edits?: unknown }).edits)) {
    items = (value as { edits: unknown[] }).edits;
  } else {
    return [];
  }

  const edits: SkillEdit[] = [];
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const op = typeof raw['op'] === 'string' ? raw['op'] : undefined;
    if (op === undefined || !VALID_OPS.has(op)) continue;
    const edit: SkillEdit = { op: op as EditOp };
    if (typeof raw['target'] === 'string') edit.target = raw['target'];
    if (typeof raw['text'] === 'string') edit.text = raw['text'];
    if (typeof raw['rationale'] === 'string') edit.rationale = raw['rationale'];
    edits.push(edit);
  }
  return edits;
}
