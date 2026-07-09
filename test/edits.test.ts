import { describe, expect, it } from 'vitest';
import { applyEdits, type SkillEdit } from '../src/index.js';

const SKILL = `# Skill

## Guidelines
- Read the task carefully.
- Write tests first.

## Notes
Keep answers short.
`;

describe('applyEdits', () => {
  it('appends with add when no anchor is given', () => {
    const result = applyEdits(SKILL, [{ op: 'add', text: '- New rule.' }]);
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.skill.trimEnd().endsWith('- New rule.')).toBe(true);
    expect(result.skill).toContain('Keep answers short.');
  });

  it('inserts after an exact anchor with add', () => {
    const result = applyEdits(SKILL, [
      { op: 'add', target: '- Read the task carefully.', text: '- Check edge cases.' },
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.skill).toContain('- Read the task carefully.\n- Check edge cases.\n- Write tests first.');
  });

  it('skips add when the anchor is missing', () => {
    const result = applyEdits(SKILL, [
      { op: 'add', target: 'no such anchor', text: '- Check edge cases.' },
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped[0]?.reason).toMatch(/anchor not found/);
    expect(result.skill).toBe(SKILL);
  });

  it('skips add when the text already exists', () => {
    const result = applyEdits(SKILL, [{ op: 'add', text: '- Write tests first.' }]);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped[0]?.reason).toMatch(/already present/);
  });

  it('deletes exact existing text', () => {
    const result = applyEdits(SKILL, [{ op: 'delete', target: '- Write tests first.\n' }]);
    expect(result.applied).toHaveLength(1);
    expect(result.skill).not.toContain('Write tests first');
    expect(result.skill).toContain('- Read the task carefully.');
  });

  it('skips delete when the target does not match', () => {
    const result = applyEdits(SKILL, [{ op: 'delete', target: 'not in the skill' }]);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped[0]?.reason).toMatch(/not found/);
    expect(result.skill).toBe(SKILL);
  });

  it('replaces exact existing text', () => {
    const result = applyEdits(SKILL, [
      { op: 'replace', target: 'Keep answers short.', text: 'Keep answers short and cite sources.' },
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.skill).toContain('Keep answers short and cite sources.');
  });

  it('skips replace when the target does not match', () => {
    const result = applyEdits(SKILL, [
      { op: 'replace', target: 'missing text', text: 'anything' },
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.skill).toBe(SKILL);
  });

  it('skips edits with missing required fields and no-op replaces', () => {
    const edits: SkillEdit[] = [
      { op: 'add' },
      { op: 'delete' },
      { op: 'replace', target: 'Keep answers short.' },
      { op: 'replace', target: 'Keep answers short.', text: 'Keep answers short.' },
    ];
    const result = applyEdits(SKILL, edits);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(4);
    expect(result.skill).toBe(SKILL);
  });

  it('applies edits sequentially so later edits see earlier results', () => {
    const result = applyEdits(SKILL, [
      { op: 'add', text: '- Temporary rule.' },
      { op: 'replace', target: '- Temporary rule.', text: '- Final rule.' },
    ]);
    expect(result.applied).toHaveLength(2);
    expect(result.skill).toContain('- Final rule.');
    expect(result.skill).not.toContain('- Temporary rule.');
  });
});
