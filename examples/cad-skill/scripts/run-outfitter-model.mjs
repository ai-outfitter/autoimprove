#!/usr/bin/env node

import { spawn } from 'node:child_process';

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;

if (!prompt.trim()) {
  console.error('run-outfitter-model requires a prompt on stdin');
  process.exit(2);
}

const executable = process.env.OUTFITTER_BIN || 'outfitter';
const harness = process.env.OUTFITTER_HARNESS || 'pi';
const child = spawn(
  executable,
  ['run', 'cad', '--harness', harness, '--', '--print', '--no-session', prompt],
  { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'inherit', 'inherit'] },
);

child.once('error', (error) => {
  console.error(`failed to launch ${executable}: ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`${executable} exited from signal ${signal}`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
