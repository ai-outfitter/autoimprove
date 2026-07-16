import assert from 'node:assert/strict';
import test from 'node:test';

import { runCommand } from '../src/command-client.mjs';

test('escalates a timed-out command that ignores SIGTERM', { timeout: 5_000 }, async () => {
  const started = Date.now();
  await assert.rejects(
    runCommand(
      [
        process.execPath,
        '-e',
        'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)',
      ],
      '',
      { timeoutMs: 50 },
    ),
    /timed out after 50ms/,
  );
  assert.ok(Date.now() - started < 3_000);
});
