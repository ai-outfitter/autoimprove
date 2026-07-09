// PINNED REQUIREMENT TESTS. Tests below marked with a HARD REQUIREMENT
// comment validate docs/requirements/AIMP-001-core-loop.md. To change one,
// amend AIMP-001 FIRST, then update the test in the same change.
import { describe, expect, it } from 'vitest';
import {
  reflect,
  mergeEdits,
  selectEdits,
  type RolloutResult,
  type SkillEdit,
  type ModelClient,
} from '../src/index.js';
import { MockModelClient, collectLogger } from './helpers.js';

const SKILL = '# Skill\n\nDo the task.';

function results(): RolloutResult[] {
  return [
    { id: 'f1', hard: 0, soft: 0.2, trajectory: 'failed trajectory one', failReason: 'missed edge case' },
    { id: 'f2', hard: 0, soft: 0.1, trajectory: 'failed trajectory two' },
    { id: 's1', hard: 1, soft: 0.9, trajectory: 'successful trajectory' },
  ];
}

describe('reflect', () => {
  it('makes one call per non-empty minibatch and combines the edits', async () => {
    const model = new MockModelClient((request) =>
      request.prompt.includes('FAILURES')
        ? '[{"op": "add", "text": "from failures"}]'
        : '[{"op": "add", "text": "from successes"}]',
    );
    const edits = await reflect({ model, skill: SKILL, results: results(), logger: collectLogger() });
    expect(model.calls).toHaveLength(2);
    expect(edits.map((e) => e.text)).toEqual(['from failures', 'from successes']);
  });

  it('skips the success call when everything failed', async () => {
    const model = new MockModelClient(() => '[]');
    const only = results().filter((r) => r.hard === 0);
    await reflect({ model, skill: SKILL, results: only, logger: collectLogger() });
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]?.prompt).toContain('FAILURES');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.3.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('includes the rejected-edit buffer as negative context in prompts', async () => {
    const model = new MockModelClient(() => '[]');
    const rejectedEdit: SkillEdit = { op: 'add', text: 'try this rejected thing' };
    await reflect({
      model,
      skill: SKILL,
      results: results(),
      rejected: [
        { edit: rejectedEdit, step: 3, reason: 'validation soft score 0.4000 did not strictly improve on 0.5000' },
      ],
      logger: collectLogger(),
    });
    for (const call of model.calls) {
      expect(call.prompt).toContain('Previously rejected edits');
      expect(call.prompt).toContain('try this rejected thing');
      expect(call.prompt).toContain('did not strictly improve');
    }
  });

  it('surfaces trajectories, fail reasons, and skill text in the prompt', async () => {
    const model = new MockModelClient(() => '[]');
    await reflect({ model, skill: SKILL, results: results(), logger: collectLogger() });
    const failurePrompt = model.calls[0]?.prompt ?? '';
    expect(failurePrompt).toContain('Do the task.');
    expect(failurePrompt).toContain('failed trajectory one');
    expect(failurePrompt).toContain('missed edge case');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.6.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('returns no edits and warns when the model call fails', async () => {
    const model: ModelClient = {
      complete: async () => {
        throw new Error('model down');
      },
    };
    const logger = collectLogger();
    const edits = await reflect({ model, skill: SKILL, results: results(), logger });
    expect(edits).toEqual([]);
    expect(logger.warns.some((w) => w.includes('model down'))).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.6.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('treats an unparseable response as zero edits without throwing', async () => {
    const model = new MockModelClient(() => 'I refuse to answer in JSON.');
    const edits = await reflect({ model, skill: SKILL, results: results(), logger: collectLogger() });
    expect(edits).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.1.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('labels infrastructure-errored results in the reflection prompt', async () => {
    const model = new MockModelClient(() => '[]');
    const errored: RolloutResult = {
      id: 'e1',
      hard: 0,
      soft: 0,
      trajectory: '',
      error: 'runner exploded twice',
    };
    await reflect({ model, skill: SKILL, results: [errored], logger: collectLogger() });
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]?.prompt).toContain('INFRASTRUCTURE ERROR');
    expect(model.calls[0]?.prompt).toContain('runner exploded twice');
  });
});

describe('mergeEdits', () => {
  it('skips the model call when there is at most one edit', async () => {
    const model = new MockModelClient(() => '[]');
    const single: SkillEdit[] = [{ op: 'add', text: 'only one' }];
    expect(await mergeEdits({ model, skill: SKILL, edits: single, logger: collectLogger() })).toEqual(single);
    expect(model.calls).toHaveLength(0);
  });

  it('uses one model call to merge and returns the merged set', async () => {
    const model = new MockModelClient(() => '[{"op": "add", "text": "merged"}]');
    const edits: SkillEdit[] = [
      { op: 'add', text: 'dup a' },
      { op: 'add', text: 'dup b' },
    ];
    const merged = await mergeEdits({ model, skill: SKILL, edits, logger: collectLogger() });
    expect(model.calls).toHaveLength(1);
    expect(merged).toEqual([{ op: 'add', text: 'merged' }]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.6.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('falls back to the input edits when the response is unparseable', async () => {
    const model = new MockModelClient(() => 'not json');
    const edits: SkillEdit[] = [
      { op: 'add', text: 'a' },
      { op: 'add', text: 'b' },
    ];
    expect(await mergeEdits({ model, skill: SKILL, edits, logger: collectLogger() })).toEqual(edits);
  });
});

describe('selectEdits', () => {
  const four: SkillEdit[] = [
    { op: 'add', text: 'one' },
    { op: 'add', text: 'two' },
    { op: 'add', text: 'three' },
    { op: 'add', text: 'four' },
  ];

  it('skips the model call when the set already fits the budget', async () => {
    const model = new MockModelClient(() => '[]');
    const selected = await selectEdits({ model, skill: SKILL, edits: four, budget: 4, logger: collectLogger() });
    expect(selected).toEqual(four);
    expect(model.calls).toHaveLength(0);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.4.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('asks the model to rank and caps the result at the budget', async () => {
    const model = new MockModelClient(() =>
      JSON.stringify([
        { op: 'add', text: 'three' },
        { op: 'add', text: 'one' },
        { op: 'add', text: 'four' },
      ]),
    );
    const selected = await selectEdits({ model, skill: SKILL, edits: four, budget: 2, logger: collectLogger() });
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]?.prompt).toContain('AT MOST 2');
    expect(selected).toEqual([
      { op: 'add', text: 'three' },
      { op: 'add', text: 'one' },
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.4.4, AIMP-001.6.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('falls back to the first budget edits when the response is unparseable', async () => {
    const model = new MockModelClient(() => 'nope');
    const selected = await selectEdits({ model, skill: SKILL, edits: four, budget: 2, logger: collectLogger() });
    expect(selected).toEqual(four.slice(0, 2));
  });
});
