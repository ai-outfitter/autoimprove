// PINNED REQUIREMENT TESTS. Tests below marked with a HARD REQUIREMENT
// comment validate docs/requirements/AIMP-001-core-loop.md. To change one,
// amend AIMP-001 FIRST, then update the test in the same change.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { train, type TaskRunner, type TrainState } from '../src/index.js';
import { MockModelClient, collectLogger, makeTasks } from './helpers.js';

const SKILL = '# Skill\n\nDo the task well.\n';
const MAGIC = 'Always double-check edge cases before answering.';

/** Runner whose scores improve when the skill contains the magic line. */
function magicRunner(counter?: { calls: number }): TaskRunner {
  return async (task, skill) => {
    if (counter) counter.calls++;
    const soft = skill.includes(MAGIC) ? 0.9 : 0.3;
    return {
      id: task.id,
      hard: soft > 0.5 ? 1 : 0,
      soft,
      trajectory: `agent transcript for ${task.id}`,
    };
  };
}

/** Model that proposes the magic edit until the skill contains it. */
function magicModel(): MockModelClient {
  return new MockModelClient((request) =>
    request.prompt.includes(MAGIC)
      ? '[]'
      : JSON.stringify([{ op: 'add', text: MAGIC, rationale: 'failures missed edge cases' }]),
  );
}

const baseOptions = {
  skill: SKILL,
  tasks: makeTasks(10),
  seed: 42,
  splitRatio: '5:2:3',
  batchSize: 5,
  epochs: 2,
} as const;

describe('train (end to end)', () => {
  it('improves the skill with exactly one accept when a known edit helps', async () => {
    const model = magicModel();
    const logger = collectLogger();
    const summary = await train({
      ...baseOptions,
      runner: magicRunner(),
      model,
      logger,
    });

    expect(summary.steps).toBe(2);
    expect(summary.accepts).toBe(1);
    expect(summary.rejects).toBe(0);
    expect(summary.skips).toBe(1);
    expect(summary.bestSkill).toContain(MAGIC);
    expect(summary.finalSkill).toContain(MAGIC);
    expect(summary.bestScore).toBeCloseTo(0.9);
    expect(summary.bestStep).toBe(1);
    expect(summary.split.train).toHaveLength(5);
    expect(summary.split.val).toHaveLength(2);
    expect(summary.split.test).toHaveLength(3);
    // Two optimizer calls (one reflect per step); usage accumulated from the client.
    expect(model.calls).toHaveLength(2);
    expect(summary.usage).toEqual({ promptTokens: 14, completionTokens: 6 });
    expect(summary.aborted).toBe(false);
    // Records carry outcomes in order.
    expect(summary.records.map((r) => r.outcome)).toEqual(['accept', 'skip']);
    expect(summary.records[0]?.valScore).toBeCloseTo(0.9);
    expect(summary.records[0]?.baselineScore).toBeCloseTo(0.3);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.5.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('never runs test-split tasks through the loop', async () => {
    const seen = new Set<string>();
    const counter = { calls: 0 };
    const base: TaskRunner = magicRunner(counter);
    const runner: TaskRunner = async (task, skill, ctx) => {
      seen.add(task.id);
      return base(task, skill, ctx);
    };
    const summary = await train({ ...baseOptions, runner, model: magicModel(), logger: collectLogger() });
    for (const testId of summary.split.test) {
      expect(seen.has(testId)).toBe(false);
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.3.5, AIMP-001.3.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('feeds rejected edits back into reflection as negative context', async () => {
    // Constant scores: no candidate can strictly improve, so every proposal is rejected.
    const runner: TaskRunner = async (task) => ({
      id: task.id,
      hard: 0,
      soft: 0.5,
      trajectory: `transcript ${task.id}`,
    });
    const model = new MockModelClient(() =>
      JSON.stringify([{ op: 'add', text: 'Rejected guidance line.' }]),
    );
    const summary = await train({ ...baseOptions, runner, model, logger: collectLogger() });

    expect(summary.accepts).toBe(0);
    expect(summary.rejects).toBe(2);
    expect(summary.finalSkill).toBe(SKILL);
    const laterReflect = model.calls.filter((c) => c.prompt.includes('Previously rejected edits'));
    expect(laterReflect.length).toBeGreaterThan(0);
    expect(laterReflect[0]?.prompt).toContain('Rejected guidance line.');
    expect(laterReflect[0]?.prompt).toContain('did not strictly improve');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.4.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('caps applied edits at the scheduler budget even when the optimizer over-returns', async () => {
    // Reflect proposes three edits; merge keeps all three; select misbehaves
    // and returns all three despite a budget of one. The library must still
    // cap the applied patch at the scheduler's budget.
    const threeEdits = JSON.stringify([
      { op: 'add', text: 'Rule one.' },
      { op: 'add', text: 'Rule two.' },
      { op: 'add', text: 'Rule three.' },
    ]);
    const model = new MockModelClient(() => threeEdits);
    const runner: TaskRunner = async (task) => ({
      id: task.id,
      hard: 0,
      soft: 0.5,
      trajectory: `transcript ${task.id}`,
    });
    const summary = await train({
      ...baseOptions,
      epochs: 1,
      scheduler: () => 1,
      runner,
      model,
      logger: collectLogger(),
    });

    expect(summary.records).toHaveLength(1);
    const record = summary.records[0]!;
    expect(record.editBudget).toBe(1);
    expect(record.proposedEdits).toBe(3);
    expect(record.selectedEdits).toBeLessThanOrEqual(record.editBudget);
    expect(record.appliedEdits).toBeLessThanOrEqual(record.editBudget);
    expect(record.appliedEdits).toBe(1);
  });

  it('throws when the ratio leaves the validation split empty', async () => {
    await expect(
      train({
        skill: SKILL,
        tasks: makeTasks(3),
        runner: magicRunner(),
        model: magicModel(),
        splitRatio: '5:2:3',
        logger: collectLogger(),
      }),
    ).rejects.toThrow(/Validation split is empty/);
  });
});

describe('train (resume from state)', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.5.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('writes state after every step and does no work when rerun after completion', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'autoimprove-'));
    const stateFile = join(dir, 'state.json');

    const first = await train({
      ...baseOptions,
      runner: magicRunner(),
      model: magicModel(),
      stateFile,
      logger: collectLogger(),
    });
    const state = JSON.parse(await readFile(stateFile, 'utf8')) as TrainState;
    expect(state.step).toBe(2);
    expect(state.bestSkill).toContain(MAGIC);

    const counter = { calls: 0 };
    const model = magicModel();
    const second = await train({
      ...baseOptions,
      runner: magicRunner(counter),
      model,
      stateFile,
      logger: collectLogger(),
    });
    expect(counter.calls).toBe(0);
    expect(model.calls).toHaveLength(0);
    expect(second.bestScore).toBe(first.bestScore);
    expect(second.accepts).toBe(first.accepts);
    expect(second.steps).toBe(first.steps);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.5.2, AIMP-001.5.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resumes mid-run from a partial state file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'autoimprove-'));
    const stateFile = join(dir, 'state.json');
    const improvedSkill = `${SKILL}\n${MAGIC}\n`;
    const partial: TrainState = {
      version: 1,
      seed: 42,
      step: 1,
      currentSkill: improvedSkill,
      currentScore: 0.9,
      bestSkill: improvedSkill,
      bestScore: 0.9,
      bestStep: 1,
      rejected: [],
      records: [
        {
          step: 0,
          epoch: 0,
          batchTaskIds: [],
          outcome: 'accept',
          editBudget: 4,
          proposedEdits: 1,
          selectedEdits: 1,
          appliedEdits: 1,
          trainScore: 0.3,
          valScore: 0.9,
          baselineScore: 0.3,
        },
      ],
      usage: { promptTokens: 5, completionTokens: 5 },
    };
    await writeFile(stateFile, JSON.stringify(partial), 'utf8');

    const counter = { calls: 0 };
    const model = magicModel();
    const summary = await train({
      ...baseOptions,
      runner: magicRunner(counter),
      model,
      stateFile,
      logger: collectLogger(),
    });

    // No baseline re-evaluation, step 0 skipped: only the step-1 batch of 5 runs.
    expect(counter.calls).toBe(5);
    expect(model.calls).toHaveLength(1); // one reflect that returns []
    expect(summary.steps).toBe(2);
    expect(summary.accepts).toBe(1);
    expect(summary.skips).toBe(1);
    expect(summary.bestScore).toBeCloseTo(0.9);
    // Usage accumulates on top of the resumed counters.
    expect(summary.usage).toEqual({ promptTokens: 12, completionTokens: 8 });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.5.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('refuses to resume with a different seed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'autoimprove-'));
    const stateFile = join(dir, 'state.json');
    await train({
      ...baseOptions,
      runner: magicRunner(),
      model: magicModel(),
      stateFile,
      logger: collectLogger(),
    });
    await expect(
      train({
        ...baseOptions,
        seed: 7,
        runner: magicRunner(),
        model: magicModel(),
        stateFile,
        logger: collectLogger(),
      }),
    ).rejects.toThrow(/seed/);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.5.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('starts fresh when the state file is corrupt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'autoimprove-'));
    const stateFile = join(dir, 'state.json');
    await writeFile(stateFile, 'not json{{{', 'utf8');
    const logger = collectLogger();
    const summary = await train({
      ...baseOptions,
      runner: magicRunner(),
      model: magicModel(),
      stateFile,
      logger,
    });
    expect(summary.accepts).toBe(1);
    expect(logger.warns.some((w) => w.includes('not valid JSON'))).toBe(true);
  });
});
