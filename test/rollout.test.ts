import { describe, expect, it } from 'vitest';
import { runRollout, type Task, type TaskRunner } from '../src/index.js';
import { collectLogger, makeTasks, okResult } from './helpers.js';

describe('runRollout', () => {
  it('returns results in task order', async () => {
    const tasks = makeTasks(4);
    const runner: TaskRunner = async (task) => okResult(task.id, 0.8);
    const results = await runRollout({ tasks, skill: 's', runner, logger: collectLogger() });
    expect(results.map((r) => r.id)).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('retries a rejected task once and succeeds silently', async () => {
    const attempts = new Map<string, number>();
    const runner: TaskRunner = async (task) => {
      const n = (attempts.get(task.id) ?? 0) + 1;
      attempts.set(task.id, n);
      if (task.id === 't2' && n === 1) throw new Error('flaky infra');
      return okResult(task.id, 0.9);
    };
    const logger = collectLogger();
    const results = await runRollout({ tasks: makeTasks(3), skill: 's', runner, logger });
    expect(attempts.get('t2')).toBe(2);
    expect(results[1]).toMatchObject({ id: 't2', soft: 0.9 });
    expect(results[1]?.error).toBeUndefined();
    expect(logger.warns).toHaveLength(0);
  });

  it('scores {hard: 0, soft: 0} with a visible error field after two failures, and warns', async () => {
    const runner: TaskRunner = async (task) => {
      if (task.id === 't1') throw new Error('agent harness exploded');
      return okResult(task.id, 0.7);
    };
    const logger = collectLogger();
    const results = await runRollout({ tasks: makeTasks(2), skill: 's', runner, logger });
    expect(results[0]).toMatchObject({ id: 't1', hard: 0, soft: 0 });
    expect(results[0]?.error).toContain('agent harness exploded');
    expect(results[0]?.taskDescription).toBe('task number 1');
    expect(logger.warns.some((w) => w.includes('t1') && w.includes('error field'))).toBe(true);
  });

  it('clamps out-of-range scores and coerces non-binary hard values', async () => {
    const runner: TaskRunner = async (task: Task) => ({
      id: task.id,
      hard: 3 as unknown as 0 | 1,
      soft: 1.7,
      trajectory: 'x',
    });
    const logger = collectLogger();
    const results = await runRollout({ tasks: makeTasks(1), skill: 's', runner, logger });
    expect(results[0]).toMatchObject({ hard: 1, soft: 1 });
    expect(logger.warns.length).toBeGreaterThan(0);
  });

  it('respects a concurrency limit while preserving order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const runner: TaskRunner = async (task) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return okResult(task.id, 0.5);
    };
    const results = await runRollout({
      tasks: makeTasks(6),
      skill: 's',
      runner,
      concurrency: 2,
      logger: collectLogger(),
    });
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(results.map((r) => r.id)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6']);
  });
});
