// PINNED REQUIREMENT TESTS. Tests below marked with a HARD REQUIREMENT
// comment validate docs/requirements/AIMP-001-core-loop.md. To change one,
// amend AIMP-001 FIRST, then update the test in the same change.
import { describe, expect, it } from 'vitest';
import { gate, type TaskRunner } from '../src/index.js';
import { collectLogger, makeTasks, okResult } from './helpers.js';

function constantRunner(soft: number): TaskRunner {
  return async (task) => okResult(task.id, soft);
}

describe('gate', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.3.1, AIMP-001.3.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('accepts only on strict improvement', async () => {
    const result = await gate({
      candidateSkill: 'candidate',
      valTasks: makeTasks(4),
      runner: constantRunner(0.75),
      baselineScore: 0.5,
      logger: collectLogger(),
    });
    expect(result.accepted).toBe(true);
    expect(result.candidateScore).toBeCloseTo(0.75);
    expect(result.baselineScore).toBe(0.5);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.3.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects a tie', async () => {
    const result = await gate({
      candidateSkill: 'candidate',
      valTasks: makeTasks(4),
      runner: constantRunner(0.5),
      baselineScore: 0.5,
      logger: collectLogger(),
    });
    expect(result.accepted).toBe(false);
    expect(result.candidateScore).toBeCloseTo(0.5);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.3.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects a regression', async () => {
    const result = await gate({
      candidateSkill: 'candidate',
      valTasks: makeTasks(4),
      runner: constantRunner(0.3),
      baselineScore: 0.5,
      logger: collectLogger(),
    });
    expect(result.accepted).toBe(false);
  });

  it('gates on the hard metric when requested', async () => {
    // soft 0.6 => hard 1, so hard mean is 1.0
    const result = await gate({
      candidateSkill: 'candidate',
      valTasks: makeTasks(2),
      runner: constantRunner(0.6),
      baselineScore: 0.5,
      metric: 'hard',
      logger: collectLogger(),
    });
    expect(result.candidateScore).toBe(1);
    expect(result.accepted).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.1.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('returns the validation results and warns about infrastructure errors', async () => {
    const runner: TaskRunner = async (task) => {
      if (task.id === 't1') throw new Error('boom');
      return okResult(task.id, 0.9);
    };
    const logger = collectLogger();
    const result = await gate({
      candidateSkill: 'candidate',
      valTasks: makeTasks(2),
      runner,
      baselineScore: 0.1,
      logger,
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.error).toContain('boom');
    expect(logger.warns.some((w) => w.includes('infrastructure errors'))).toBe(true);
    // (0 + 0.9) / 2 = 0.45 > 0.1, still accepted; the zero is visible, not silent.
    expect(result.candidateScore).toBeCloseTo(0.45);
  });
});
