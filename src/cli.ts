#!/usr/bin/env node
/**
 * Bin entry for the `autoimprove` CLI (package.json "bin"). All logic
 * lives in src/cli/main.ts so tests can drive it in-process.
 */
import { runCli } from './cli/main.js';

process.exitCode = await runCli(process.argv.slice(2));
