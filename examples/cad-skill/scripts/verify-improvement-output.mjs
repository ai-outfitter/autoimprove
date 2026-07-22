#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyImprovementOutput } from '../src/postcondition.mjs';

const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = resolve(EXAMPLE_DIR, '..', '..');

const args = process.argv.slice(2);
let runId = process.env.CAD_RUN_ID;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] !== '--run-id') throw new Error(`unknown option: ${args[index]}`);
  runId = args[++index];
  if (!runId || runId.startsWith('--')) throw new Error('--run-id requires a value');
}
if (!runId) throw new Error('--run-id or CAD_RUN_ID is required');

const result = await verifyImprovementOutput({
  runId,
  repositoryRoot: process.env.CAD_REPOSITORY_ROOT || REPOSITORY_ROOT,
  stateRoot: process.env.CAD_STATE_ROOT || resolve(EXAMPLE_DIR, '.autoimprove'),
  metricsDir: process.env.CAD_METRICS_DIR || resolve(EXAMPLE_DIR, 'metrics'),
});

console.log(`verified CAD improvement artifacts for run ${result.runId}`);
console.log(`promotion: ${result.promoted ? 'accepted' : 'rejected'}`);
