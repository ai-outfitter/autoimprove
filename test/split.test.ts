// PINNED REQUIREMENT TESTS. Tests below marked with a HARD REQUIREMENT
// comment validate docs/requirements/AIMP-001-core-loop.md. To change one,
// amend AIMP-001 FIRST, then update the test in the same change.
import { describe, expect, it } from 'vitest';
import { overrideSplit, splitTasks } from '../src/index.js';
import { makeTasks } from './helpers.js';

describe('splitTasks', () => {
  it('splits 10 tasks 5:2:3 into 5/2/3', () => {
    const split = splitTasks(makeTasks(10), '5:2:3', 42);
    expect(split.train).toHaveLength(5);
    expect(split.val).toHaveLength(2);
    expect(split.test).toHaveLength(3);
  });

  it('is exhaustive and disjoint', () => {
    const tasks = makeTasks(23);
    const split = splitTasks(tasks, '5:2:3', 7);
    const all = [...split.train, ...split.val, ...split.test].map((t) => t.id);
    expect(all).toHaveLength(23);
    expect(new Set(all).size).toBe(23);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.5.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('is deterministic for a given seed', () => {
    const tasks = makeTasks(20);
    const a = splitTasks(tasks, '5:2:3', 123);
    const b = splitTasks(tasks, '5:2:3', 123);
    expect(a.train.map((t) => t.id)).toEqual(b.train.map((t) => t.id));
    expect(a.val.map((t) => t.id)).toEqual(b.val.map((t) => t.id));
    expect(a.test.map((t) => t.id)).toEqual(b.test.map((t) => t.id));
  });

  it('produces different assignments for different seeds', () => {
    const tasks = makeTasks(50);
    const a = splitTasks(tasks, '5:2:3', 1);
    const b = splitTasks(tasks, '5:2:3', 2);
    expect(a.train.map((t) => t.id)).not.toEqual(b.train.map((t) => t.id));
  });

  it('does not mutate the input array', () => {
    const tasks = makeTasks(10);
    const ids = tasks.map((t) => t.id);
    splitTasks(tasks, '5:2:3', 9);
    expect(tasks.map((t) => t.id)).toEqual(ids);
  });

  it('supports other ratios', () => {
    const split = splitTasks(makeTasks(10), '8:2:0', 42);
    expect(split.train).toHaveLength(8);
    expect(split.val).toHaveLength(2);
    expect(split.test).toHaveLength(0);
  });

  it('rejects malformed ratios', () => {
    expect(() => splitTasks(makeTasks(10), '5:2', 42)).toThrow(/Invalid split ratio/);
    expect(() => splitTasks(makeTasks(10), 'a:b:c', 42)).toThrow(/Invalid split ratio/);
    expect(() => splitTasks(makeTasks(10), '0:0:0', 42)).toThrow(/sum to zero/);
  });
});

describe('overrideSplit', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.5.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('honors an explicit override verbatim: exact membership and order', () => {
    const tasks = makeTasks(10);
    const split = overrideSplit(tasks, {
      train: ['t7', 't2', 't9'],
      val: ['t4', 't1'],
      test: ['t10', 't3'],
    });
    expect(split.train.map((t) => t.id)).toEqual(['t7', 't2', 't9']);
    expect(split.val.map((t) => t.id)).toEqual(['t4', 't1']);
    expect(split.test.map((t) => t.id)).toEqual(['t10', 't3']);
    // Resolved to the actual task objects, not synthesized stand-ins.
    expect(split.train[0]).toBe(tasks[6]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.5.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('throws when the override lists an id with no matching task', () => {
    expect(() =>
      overrideSplit(makeTasks(5), { train: ['t1', 'nope'], val: ['t2'], test: [] }),
    ).toThrow(/lists task id "nope" but no such task/);
    expect(() =>
      overrideSplit(makeTasks(5), { train: ['t1'], val: ['t2'], test: ['t9'] }),
    ).toThrow(/\(test\) lists task id "t9"/);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.5.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('throws when an id appears more than once across the override', () => {
    expect(() =>
      overrideSplit(makeTasks(5), { train: ['t1', 't2'], val: ['t1'], test: [] }),
    ).toThrow(/"t1" more than once/);
  });

  it('allows tasks that are not listed anywhere (excluded from the run)', () => {
    const split = overrideSplit(makeTasks(6), { train: ['t1'], val: ['t2'], test: ['t3'] });
    const all = [...split.train, ...split.val, ...split.test].map((t) => t.id);
    expect(all).toEqual(['t1', 't2', 't3']);
  });
});
