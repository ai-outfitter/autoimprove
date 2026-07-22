import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyModel } from './adapters.mjs';
import { evaluateCadTask } from './cadtestbench.mjs';
import { runCommand } from './command-client.mjs';

const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = resolve(
  process.env.CAD_REPOSITORY_ROOT || resolve(EXAMPLE_DIR, '..', '..'),
);
const SOURCE_AGENTS = join(REPOSITORY_ROOT, '.agents');
const WORK_ROOT = join(tmpdir(), 'autoimprove-cad-skill');
const DEPENDENCIES = join(EXAMPLE_DIR, 'node_modules');
const CANDIDATE_SKILL = join(
  'agents', 'cad', 'skills', 'generate-replicad-cad', 'SKILL.md',
);

const safeName = (value) => value.replaceAll(/[^a-zA-Z0-9_.-]/gu, '-');

const taskPrompt = (task) => `Use $generate-replicad-cad to solve one CAD coding task.

The public example is:

${JSON.stringify(task.payload.publicSpec, null, 2)}

Write the complete solution to model.mjs in the current directory. Export
build(spec) exactly as the skill requires. Implement the contract generically
from the supplied spec; evaluation will reuse this module with unseen parameter
values. Do not inspect the repository or evaluation infrastructure. Do not
install dependencies, modify task.json, or merely describe code.`;

const checkSummary = (probes = []) => probes.flatMap((probe) =>
  (probe.checks ?? []).map((check) =>
    `${check.passed ? 'PASS' : 'FAIL'} ${probe.specId}/${check.cadtestId}: ${check.description}`
  )
).join('\n');

export function createCadRunner({
  targetCommand,
  keepWorkDirs = process.env.CAD_KEEP_WORKDIRS === '1',
  targetTimeoutMs = 300_000,
  verifierTimeoutMs = 120_000,
} = {}) {
  if (!Array.isArray(targetCommand) || targetCommand.length === 0) {
    throw new Error('createCadRunner requires targetCommand');
  }

  return async (task, skill) => {
    await mkdir(WORK_ROOT, { recursive: true });
    const workDir = await mkdtemp(join(WORK_ROOT, `${safeName(task.id)}-`));
    const modelPath = join(workDir, 'model.mjs');

    try {
      await cp(SOURCE_AGENTS, join(workDir, '.agents'), { recursive: true });
      await writeFile(join(workDir, '.agents', CANDIDATE_SKILL), skill);
      await writeFile(join(workDir, 'task.json'), `${JSON.stringify({
        id: task.id,
        publicSpec: task.payload.publicSpec,
      }, null, 2)}\n`);

      let agent = { stdout: '', stderr: '' };
      let targetError;
      try {
        agent = await runCommand(targetCommand, taskPrompt(task), {
          cwd: workDir,
          timeoutMs: targetTimeoutMs,
        });
      } catch (error) {
        targetError = error;
      }

      // Candidate generation cannot traverse this link while it is writing
      // source. The verifier receives the runtime only after generation ends.
      await symlink(
        DEPENDENCIES,
        join(workDir, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const verified = await verifyModel(task, workDir, { timeoutMs: verifierTimeoutMs });
      const cadEvaluation = evaluateCadTask(task, verified.result);
      const source = await readFile(modelPath, 'utf8').catch(() => '<model file missing>');
      const trajectory = [
        `task: ${task.description}`,
        `public spec: ${JSON.stringify(task.payload.publicSpec)}`,
        `hidden probes: ${task.payload.evaluationSpecs.length}`,
        `target executable: ${targetCommand[0]}`,
        targetError ? `target failure:\n${targetError.message}` : '',
        `target stdout:\n${agent.stdout || '<empty>'}`,
        agent.stderr ? `target stderr:\n${agent.stderr}` : '',
        `candidate source:\n${source}`,
        `Replicad verifier:\n${verified.logs || '<no logs>'}`,
        `CADTests:\n${checkSummary(cadEvaluation.probes) || '<none>'}`,
        `metrics: ${JSON.stringify(cadEvaluation.metrics)}`,
        keepWorkDirs ? `kept work directory: ${workDir}` : '',
      ].filter(Boolean).join('\n\n');

      return {
        id: task.id,
        hard: cadEvaluation.hard,
        soft: cadEvaluation.soft,
        trajectory,
        cadEvaluation,
        ...(cadEvaluation.failReason ? { failReason: cadEvaluation.failReason } : {}),
      };
    } finally {
      if (!keepWorkDirs) await rm(workDir, { recursive: true, force: true });
    }
  };
}
