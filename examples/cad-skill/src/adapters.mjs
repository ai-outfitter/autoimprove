import { execFile } from 'node:child_process';
import { access, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERIFIER = join(EXAMPLE_DIR, 'scripts', 'verify-replicad-model.mjs');
const DEPENDENCIES = join(EXAMPLE_DIR, 'node_modules');

const cleanVerifierEnv = (workDir) => Object.fromEntries(
  [
    ['PATH', process.env.PATH],
    ['SystemRoot', process.env.SystemRoot],
    ['WINDIR', process.env.WINDIR],
    ['HOME', workDir],
    ['TMPDIR', workDir],
    ['TEMP', workDir],
    ['TMP', workDir],
  ].filter(([, value]) => typeof value === 'string'),
);

export async function assertCadDependencies() {
  await access(VERIFIER);
  for (const dependency of ['replicad', 'replicad-opencascadejs']) {
    await import(dependency).catch((error) => {
      throw new Error(`Dependency ${dependency} is unavailable; run npm ci in examples/cad-skill`, {
        cause: error,
      });
    });
  }
}

const failedResult = (task, message) => ({
  executed: false,
  error: message,
  probes: (task.payload?.evaluationSpecs ?? []).map((spec, index) => ({
    specId: spec.id ?? spec.specId ?? `probe-${index + 1}`,
    executed: false,
    error: message,
    parts: [],
    preview: null,
    pairs: [],
  })),
});

export async function verifyModel(task, workDir, { timeoutMs = 90_000 } = {}) {
  const resolvedWorkDir = await realpath(workDir);
  const modelPath = join(resolvedWorkDir, 'model.mjs');
  const cadtestsPath = join(resolvedWorkDir, 'cadtests.json');
  const resultPath = join(resolvedWorkDir, 'verification.json');
  const artifactPath = join(resolvedWorkDir, 'preview.mesh.json');

  await writeFile(cadtestsPath, `${JSON.stringify({
    taskId: task.id,
    evaluationSpecs: task.payload?.evaluationSpecs ?? [],
  }, null, 2)}\n`);

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const permissionFlag = nodeMajor >= 23 ? '--permission' : '--experimental-permission';
  const args = [
    permissionFlag,
    `--allow-fs-read=${VERIFIER}`,
    `--allow-fs-read=${resolvedWorkDir}`,
    `--allow-fs-read=${DEPENDENCIES}`,
    `--allow-fs-write=${resolvedWorkDir}`,
    VERIFIER,
    modelPath,
    cadtestsPath,
    resultPath,
    artifactPath,
  ];

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd: resolvedWorkDir,
      env: cleanVerifierEnv(resolvedWorkDir),
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    return { result, logs: [stdout, stderr].filter(Boolean).join('\n') };
  } catch (error) {
    const source = await readFile(modelPath, 'utf8').catch(() => '');
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    const message = [error?.message, stdout, stderr].filter(Boolean).join('\n');
    return {
      result: failedResult(task, message),
      logs: [message, source && `model source:\n${source}`].filter(Boolean).join('\n'),
    };
  }
}
