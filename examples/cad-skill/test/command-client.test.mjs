import assert from 'node:assert/strict';
import { delimiter } from 'node:path';
import test from 'node:test';

import {
  runCommand,
  sanitizedCommandEnvironment,
} from '../src/command-client.mjs';

test('scrubs checkout locators from nested model command environments', () => {
  const environment = sanitizedCommandEnvironment('/tmp/cad-task', {
    PATH: [
      '/repo/node_modules/.bin',
      '/runner/temp/outfitter-bin',
      '/usr/local/bin',
      '/repo/example/node_modules/.bin',
    ].join(delimiter),
    GITHUB_WORKSPACE: '/repo',
    RUNNER_WORKSPACE: '/runner',
    INIT_CWD: '/repo/examples/cad-skill',
    npm_package_json: '/repo/examples/cad-skill/package.json',
    CAD_REPOSITORY_ROOT: '/repo',
    CAD_TARGET_COMMAND_JSON: '["unsafe"]',
    NODE_PATH: '/repo/node_modules',
    OPENAI_API_KEY: 'model-provider-key',
    OUTFITTER_BIN: '/usr/local/bin/outfitter',
  });

  assert.equal(environment.PWD, '/tmp/cad-task');
  assert.equal(
    environment.PATH,
    ['/runner/temp/outfitter-bin', '/usr/local/bin'].join(delimiter),
  );
  assert.equal(environment.OPENAI_API_KEY, 'model-provider-key');
  assert.equal(environment.OUTFITTER_BIN, '/usr/local/bin/outfitter');
  assert.equal(environment.GITHUB_WORKSPACE, undefined);
  assert.equal(environment.RUNNER_WORKSPACE, undefined);
  assert.equal(environment.INIT_CWD, undefined);
  assert.equal(environment.npm_package_json, undefined);
  assert.equal(environment.CAD_REPOSITORY_ROOT, undefined);
  assert.equal(environment.CAD_TARGET_COMMAND_JSON, undefined);
  assert.equal(environment.NODE_PATH, undefined);
});

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
