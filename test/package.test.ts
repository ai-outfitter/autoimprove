// PINNED REQUIREMENT TESTS. Tests below marked with a HARD REQUIREMENT
// comment validate docs/requirements/AIMP-001-core-loop.md. To change one,
// amend AIMP-001 FIRST, then update the test in the same change.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OPTIMIZER_SYSTEM, reflectPrompt, mergePrompt, selectPrompt } from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
  string,
  unknown
>;
const promptsSource = readFileSync(join(root, 'src', 'prompts.ts'), 'utf8');

describe('package self-containment', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.2.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('declares zero runtime dependencies', () => {
    expect(packageJson['dependencies']).toBeUndefined();
    expect(packageJson['peerDependencies']).toBeUndefined();
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.2.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('publishes only dist, README, and LICENSE', () => {
    expect(packageJson['files']).toEqual(['dist', 'README.md', 'LICENSE']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.2.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('embeds all optimizer prompts as TypeScript constants with no file loading', () => {
    // The prompts module must never read prompt text from disk.
    expect(promptsSource).not.toMatch(/node:fs|readFile|createReadStream/);
    expect(promptsSource).toContain('export const OPTIMIZER_SYSTEM = `');

    // The exported constants and builders work with no filesystem access.
    expect(typeof OPTIMIZER_SYSTEM).toBe('string');
    expect(OPTIMIZER_SYSTEM.length).toBeGreaterThan(0);
    const result = { id: 't1', hard: 0 as const, soft: 0.2, trajectory: 'transcript' };
    expect(reflectPrompt({ skill: '# S', results: [result], kind: 'failure' })).toContain('# S');
    expect(mergePrompt({ skill: '# S', edits: [{ op: 'add', text: 'x' }] })).toContain('# S');
    expect(
      selectPrompt({ skill: '# S', edits: [{ op: 'add', text: 'x' }], budget: 1 }),
    ).toContain('AT MOST 1');
  });
});
