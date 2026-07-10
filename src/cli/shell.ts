import { execFile } from 'node:child_process';

/**
 * Shell-command plumbing for the CLI: placeholder substitution with
 * mandatory shell escaping, and a small `/bin/sh -c` executor with a
 * timeout. Values substituted into a template are ALWAYS single-quote
 * escaped so quotes, spaces, `$(...)`, and other metacharacters in task
 * payloads are passed literally, never interpreted (AIMP-002.5.1). Only
 * the user's own template text is interpreted by the shell.
 */

/** Single-quote a value for POSIX sh so it is passed literally. */
export function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

const PLACEHOLDER_PATTERN = /\{\{([A-Za-z0-9_]+)\}\}/g;

/** Placeholder names appearing in a command template, in order. */
export function templatePlaceholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)].map((m) => m[1] as string);
}

/**
 * Substitute `{{NAME}}` placeholders with shell-escaped values. Throws on
 * a placeholder with no value; config validation catches unknown
 * placeholders earlier with a named-field error.
 */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`unknown placeholder {{${name}}} in command template`);
    }
    return shellEscape(value);
  });
}

export interface ShellResult {
  /** Exit code; null when the process was killed (timeout/abort). */
  code: number | null;
  stdout: string;
  stderr: string;
  /** True when the command was killed by the timeout or an AbortSignal. */
  timedOut: boolean;
}

const MAX_BUFFER = 64 * 1024 * 1024;

/** Run a command via `/bin/sh -c` with a hard timeout. Never rejects. */
export function runShellCommand(
  command: string,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<ShellResult> {
  return new Promise((resolve) => {
    execFile(
      '/bin/sh',
      ['-c', command],
      {
        timeout: options.timeoutMs,
        maxBuffer: MAX_BUFFER,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr, timedOut: false });
          return;
        }
        const e = error as NodeJS.ErrnoException & { killed?: boolean };
        resolve({
          code: typeof e.code === 'number' ? e.code : null,
          stdout,
          stderr,
          timedOut: e.killed === true || e.code === 'ABORT_ERR',
        });
      },
    );
  });
}
