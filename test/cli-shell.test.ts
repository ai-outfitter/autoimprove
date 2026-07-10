// PINNED REQUIREMENT TESTS. Tests below marked with a HARD REQUIREMENT
// comment validate docs/requirements/AIMP-002-cli.md. To change one,
// amend AIMP-002 FIRST, then update the test in the same change.
import { describe, expect, it } from 'vitest';

import { renderTemplate, runShellCommand, shellEscape, templatePlaceholders } from '../src/cli/shell.js';
import { extractLastJsonObject } from '../src/json.js';

describe('shellEscape', () => {
  it('single-quotes values and escapes embedded single quotes', () => {
    expect(shellEscape('plain')).toBe("'plain'");
    expect(shellEscape("it's")).toBe(`'it'\\''s'`);
  });
});

describe('renderTemplate', () => {
  it('substitutes placeholders with shell-escaped values', () => {
    const rendered = renderTemplate('run {{A}} --id {{B}}', { A: '/tmp/x y', B: 'a"b' });
    expect(rendered).toBe(`run '/tmp/x y' --id 'a"b'`);
  });

  it('throws on a placeholder with no value', () => {
    expect(() => renderTemplate('run {{NOPE}}', {})).toThrow('unknown placeholder {{NOPE}}');
  });

  it('lists placeholders in a template', () => {
    expect(templatePlaceholders('a {{X}} b {{Y_2}} c')).toEqual(['X', 'Y_2']);
  });
});

describe('placeholder substitution through a real shell', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.5.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('passes quotes, spaces, and $() literally, never interpreted', async () => {
    const payload = `He said "hi" with 'quotes', spaces, $HOME, a backtick \` and $(echo pwned); rm -rf /tmp/nope`;
    const command = renderTemplate(`printf '%s' {{TASK_PAYLOAD}}`, { TASK_PAYLOAD: payload });
    const result = await runShellCommand(command, { timeoutMs: 10_000 });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(payload);
    // The $() stayed literal text: had the shell interpreted it, the output
    // would contain a bare "pwned" instead of the unexpanded "$(echo pwned)".
    expect(result.stdout).toContain('$(echo pwned)');
  });
});

describe('runShellCommand', () => {
  it('reports non-zero exit codes without rejecting', async () => {
    const result = await runShellCommand('exit 3', { timeoutMs: 10_000 });
    expect(result.code).toBe(3);
    expect(result.timedOut).toBe(false);
  });

  it('flags a timed-out command', async () => {
    const result = await runShellCommand('sleep 5', { timeoutMs: 100 });
    expect(result.timedOut).toBe(true);
  });
});

describe('extractLastJsonObject', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-002.4.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('returns the LAST balanced JSON object, ignoring surrounding text', () => {
    const stdout = [
      'log line with { unbalanced brace',
      '{"hard": 0, "soft": 0.1, "trajectory": "early"}',
      'more logs {not json}',
      '{"hard": 1, "soft": 0.9, "trajectory": "final", "nested": {"ok": true}}',
      'trailing noise',
    ].join('\n');
    expect(extractLastJsonObject(stdout)).toEqual({
      hard: 1,
      soft: 0.9,
      trajectory: 'final',
      nested: { ok: true },
    });
  });

  it('ignores arrays and primitives', () => {
    expect(extractLastJsonObject('{"a": 1} then [1, 2, 3] and true')).toEqual({ a: 1 });
  });

  it('returns undefined when no JSON object is present', () => {
    expect(extractLastJsonObject('no json here')).toBeUndefined();
    expect(extractLastJsonObject('{ almost json }')).toBeUndefined();
    expect(extractLastJsonObject('')).toBeUndefined();
  });
});
