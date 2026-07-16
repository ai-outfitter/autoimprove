import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyModel } from './adapters.mjs';
import { runCommand } from './command-client.mjs';
import { scoreCadResult } from './scorer.mjs';

const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK_ROOT = join(tmpdir(), 'autoimprove-cad-skill');
const DEPENDENCIES = join(EXAMPLE_DIR, 'node_modules');

const safeName = (value) => value.replaceAll(/[^a-zA-Z0-9_.-]/gu, '-');

const taskPrompt = (task, skill) => {
  const filename = task.payload.backend === 'anchorscad' ? 'model.py' : 'model.mjs';
  return `You are solving one CAD coding task in an isolated working directory.

<skill>
${skill}
</skill>

<task>
${JSON.stringify(task.payload, null, 2)}
</task>

Write the complete solution to ${filename} in the current directory. Follow the
skill's build(spec) contract exactly. Use the selected CAD backend itself. Do
not install dependencies, modify task.json, or only describe the code in your
final response. The evaluator will import the file and call build(spec).`;
};

const checkSummary = (checks) => checks.map((check) =>
  `${check.passed ? 'PASS' : 'FAIL'} ${check.id}: expected ${JSON.stringify(check.expected)}, actual ${JSON.stringify(check.actual)}`
).join('\n');

export function createCadRunner({
  targetCommand,
  keepWorkDirs = process.env.CAD_KEEP_WORKDIRS === '1',
  targetTimeoutMs = 300_000,
  verifierTimeoutMs = 90_000,
} = {}) {
  if (!Array.isArray(targetCommand) || targetCommand.length === 0) {
    throw new Error('createCadRunner requires targetCommand');
  }

  return async (task, skill) => {
    await mkdir(WORK_ROOT, { recursive: true });
    const workDir = await mkdtemp(join(WORK_ROOT, `${safeName(task.id)}-`));
    const modelPath = join(
      workDir,
      task.payload.backend === 'anchorscad' ? 'model.py' : 'model.mjs',
    );

    try {
      await writeFile(join(workDir, 'task.json'), `${JSON.stringify(task.payload, null, 2)}\n`);
      let agent = { stdout: '', stderr: '' };
      let targetError;
      try {
        agent = await runCommand(targetCommand, taskPrompt(task, skill), {
          cwd: workDir,
          timeoutMs: targetTimeoutMs,
        });
      } catch (error) {
        targetError = error;
      }
      if (task.payload.backend !== 'anchorscad') {
        // Add runtime packages only after generation so target agents cannot
        // follow the dependency link back into the repository and fixtures.
        await symlink(
          DEPENDENCIES,
          join(workDir, 'node_modules'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      }
      const verified = await verifyModel(task, workDir, { timeoutMs: verifierTimeoutMs });
      const scored = scoreCadResult(task, verified.result);
      const source = await readFile(modelPath, 'utf8').catch(() => '<model file missing>');
      const trajectory = [
        `task: ${task.description}`,
        `payload: ${JSON.stringify(task.payload)}`,
        `target executable: ${targetCommand[0]}`,
        targetError ? `target failure:\n${targetError.message}` : '',
        `target stdout:\n${agent.stdout || '<empty>'}`,
        agent.stderr ? `target stderr:\n${agent.stderr}` : '',
        `candidate source:\n${source}`,
        `backend verifier:\n${verified.logs || '<no logs>'}`,
        `score checks:\n${checkSummary(scored.checks)}`,
        keepWorkDirs ? `kept work directory: ${workDir}` : '',
      ].filter(Boolean).join('\n\n');

      return {
        id: task.id,
        hard: scored.hard,
        soft: scored.soft,
        trajectory,
        ...(scored.failReason ? { failReason: scored.failReason } : {}),
      };
    } finally {
      if (!keepWorkDirs) await rm(workDir, { recursive: true, force: true });
    }
  };
}
