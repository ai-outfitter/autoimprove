import { spawn } from 'node:child_process';

export const DEFAULT_TARGET_COMMAND = Object.freeze([
  'codex',
  'exec',
  '--ephemeral',
  '--skip-git-repo-check',
  '--sandbox',
  'workspace-write',
  '--color',
  'never',
  '-',
]);

export const DEFAULT_OPTIMIZER_COMMAND = Object.freeze([
  'codex',
  'exec',
  '--ephemeral',
  '--skip-git-repo-check',
  '--sandbox',
  'read-only',
  '--color',
  'never',
  '-',
]);

export function commandFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return [...fallback];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be a JSON array of command arguments`, { cause: error });
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== 'string')) {
    throw new Error(`${name} must be a nonempty JSON array of strings`);
  }
  return parsed;
}

export function runCommand(command, prompt, { cwd, timeoutMs = 300_000 } = {}) {
  return new Promise((resolve, reject) => {
    const detached = process.platform !== 'win32';
    const child = spawn(command[0], command.slice(1), {
      cwd,
      detached,
      env: { ...process.env, ...(cwd ? { PWD: cwd, OLDPWD: '' } : {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let terminationError = '';
    let forceTimer;
    let rejectTimer;

    const stopProcess = (signal) => {
      if (!child.pid) return;
      try {
        if (detached) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if (error?.code !== 'ESRCH') terminationError = error?.message ?? String(error);
      }
    };

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      clearTimeout(rejectTimer);
      callback();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      stopProcess('SIGTERM');
      forceTimer = setTimeout(() => {
        stopProcess('SIGKILL');
        rejectTimer = setTimeout(() => {
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
          finish(() => reject(new Error(
            `${command[0]} timed out after ${timeoutMs}ms and did not close after SIGKILL${terminationError ? `: ${terminationError}` : ''}`,
          )));
        }, 1_000);
      }, 1_000);
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      finish(() => reject(new Error(`failed to launch ${command[0]}: ${error.message}`, { cause: error })));
    });
    child.once('close', (code, signal) => {
      if (code === 0 && !timedOut) {
        finish(() => resolve({ stdout, stderr }));
        return;
      }
      const reason = timedOut
        ? `timed out after ${timeoutMs}ms`
        : `exited ${code ?? `from signal ${signal}`}`;
      finish(() => reject(new Error(
        `${command[0]} ${reason}\n${[stdout, stderr].filter(Boolean).join('\n')}`,
      )));
    });

    child.stdin.end(prompt);
  });
}

export function createCommandModelClient(command, { cwd, timeoutMs } = {}) {
  return {
    async complete({ system, prompt }) {
      const input = [
        system ? `<system-instructions>\n${system}\n</system-instructions>` : '',
        `<request>\n${prompt}\n</request>`,
        'Return only the requested completion.',
      ].filter(Boolean).join('\n\n');
      const { stdout } = await runCommand(command, input, { cwd, timeoutMs });
      return { text: stdout };
    },
  };
}
