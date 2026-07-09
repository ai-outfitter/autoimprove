#!/usr/bin/env node
// Live end-to-end smoke: real model calls through the full train() loop.
//
// The task teaches a formatting rule the seed skill lacks: answers must be
// the input word reversed, uppercased, wrapped in square brackets. The seed
// skill only says "reverse the word", so baseline fails scoring and the
// optimizer must induce the uppercase+brackets rules from failure
// trajectories. Success = at least one gate-accepted edit and a val score
// jump.
//
// Uses the claude CLI for BOTH roles via a minimal ModelClient wrapper —
// which also exercises AIMP-001.7.2 (any object with complete() works).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { train } from '../dist/index.js';

const run = promisify(execFile);

const claudeClient = (model) => ({
  async complete({ system, prompt }) {
    const args = ['-p', prompt, '--model', model];
    if (system) args.push('--append-system-prompt', system);
    const { stdout } = await run('claude', args, { timeout: 240_000 });
    return { text: stdout };
  },
});

const WORDS = ['orbit', 'lantern', 'copper', 'meadow', 'signal', 'harbor',
               'velvet', 'quartz', 'ember', 'tundra', 'prism', 'falcon'];

const expected = (w) => `[${w.split('').reverse().join('').toUpperCase()}]`;

const tasks = WORDS.map((w) => ({ id: w, description: `word: ${w}`, payload: w }));

const target = claudeClient('claude-haiku-4-5-20251001');

const runner = async (task, skill) => {
  const { text } = await target.complete({
    system: skill,
    prompt: `The word is: ${task.payload}\nRespond with the transformed word only, nothing else.`,
  });
  const answer = text.trim();
  const want = expected(task.payload);
  const hard = answer === want ? 1 : 0;
  // soft: partial credit per property satisfied
  const rev = task.payload.split('').reverse().join('');
  let soft = 0;
  if (answer.toUpperCase().includes(rev.toUpperCase())) soft += 0.4;
  if (answer === answer.toUpperCase()) soft += 0.3;
  if (answer.startsWith('[') && answer.endsWith(']')) soft += 0.3;
  return {
    id: task.id,
    hard,
    soft,
    trajectory:
      `input: ${task.payload}\nagent answered: ${answer}\n` +
      `scoring: expected exact form ${want}; got ${answer}\n` +
      `properties: reversed=${soft >= 0.4}, uppercase=${answer === answer.toUpperCase()}, bracketed=${answer.startsWith('[') && answer.endsWith(']')}`,
    failReason: hard ? undefined : `expected ${want}, got ${answer}`,
  };
};

const summary = await train({
  skill: '# Word transform skill\n\nWhen given a word, respond with the word reversed.\n',
  tasks,
  runner,
  model: claudeClient('claude-opus-4-8'),
  epochs: 1,
  batchSize: 6,
  seed: 42,
  concurrency: 4,
  logger: { info: (m) => console.log('[info]', m), warn: (m) => console.warn('[warn]', m) },
});

console.log('\n=== SMOKE SUMMARY ===');
console.log('baseline:', summary.baselineScore, 'best:', summary.bestScore);
console.log('accepts:', summary.accepts, 'rejects:', summary.rejects, 'skips:', summary.skips);
console.log('best skill:\n', summary.bestSkill);
process.exit(summary.accepts >= 1 && summary.bestScore > summary.baselineScore ? 0 : 1);
