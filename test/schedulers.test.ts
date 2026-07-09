import { describe, expect, it } from 'vitest';
import { constantScheduler, cosineScheduler } from '../src/index.js';

describe('constantScheduler', () => {
  it('defaults to 4 at every step', () => {
    const sched = constantScheduler();
    expect(sched(0, 10)).toBe(4);
    expect(sched(5, 10)).toBe(4);
    expect(sched(9, 10)).toBe(4);
  });

  it('uses a custom budget', () => {
    expect(constantScheduler(6)(3, 10)).toBe(6);
  });

  it('never returns less than 1', () => {
    expect(constantScheduler(0)(0, 10)).toBe(1);
  });
});

describe('cosineScheduler', () => {
  it('starts at the initial budget and decays to the minimum', () => {
    const sched = cosineScheduler(4, 2);
    expect(sched(0, 10)).toBe(4);
    expect(sched(9, 10)).toBe(2);
  });

  it('hits the midpoint halfway through', () => {
    const sched = cosineScheduler(8, 2);
    expect(sched(0, 11)).toBe(8);
    expect(sched(5, 11)).toBe(5); // 2 + 6 * 0.5
    expect(sched(10, 11)).toBe(2);
  });

  it('is non-increasing across the run', () => {
    const sched = cosineScheduler(4, 2);
    let prev = Number.POSITIVE_INFINITY;
    for (let step = 0; step < 20; step++) {
      const value = sched(step, 20);
      expect(value).toBeLessThanOrEqual(prev);
      prev = value;
    }
  });

  it('returns the initial budget when there is a single step', () => {
    expect(cosineScheduler(4, 2)(0, 1)).toBe(4);
  });

  it('clamps out-of-range steps', () => {
    const sched = cosineScheduler(4, 2);
    expect(sched(-3, 10)).toBe(4);
    expect(sched(99, 10)).toBe(2);
  });
});
