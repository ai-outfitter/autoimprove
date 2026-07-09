import { describe, expect, it } from 'vitest';
import { splitTasks } from '../src/index.js';
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
