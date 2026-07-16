import { execFile } from 'node:child_process';
import { access, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JS_VERIFIER = join(EXAMPLE_DIR, 'scripts', 'verify-js-model.mjs');
const PYTHON_VERIFIER = join(EXAMPLE_DIR, 'scripts', 'verify-anchorscad.py');
const DEPENDENCIES = join(EXAMPLE_DIR, 'node_modules');
const RESULT_PREFIX = 'AUTOIMPROVE_CAD_RESULT=';

const verifierResult = (stdout) => {
  const resultLines = stdout.split(/\r?\n/u).filter((line) => line.startsWith(RESULT_PREFIX));
  if (resultLines.length !== 1) {
    throw new Error(`adapter verifier printed ${resultLines.length} tagged results; expected exactly one`);
  }
  const parsed = JSON.parse(resultLines[0].slice(RESULT_PREFIX.length));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('adapter verifier tagged an invalid result');
  }
  return parsed;
};

const pythonExecutable = () => process.platform === 'win32'
  ? join(EXAMPLE_DIR, '.venv', 'Scripts', 'python.exe')
  : join(EXAMPLE_DIR, '.venv', 'bin', 'python');

const cleanVerifierEnv = (workDir) => Object.fromEntries(
  [
    ['PATH', process.env.PATH],
    ['SystemRoot', process.env.SystemRoot],
    ['WINDIR', process.env.WINDIR],
    ['HOME', workDir],
    ['TMPDIR', workDir],
    ['TEMP', workDir],
    ['TMP', workDir],
    ['PYTHONDONTWRITEBYTECODE', '1'],
    ['PYTHONNOUSERSITE', '1'],
  ].filter(([, value]) => typeof value === 'string'),
);

export async function assertBackendDependencies(backends) {
  for (const backend of backends) {
    if (backend === 'anchorscad') {
      const python = pythonExecutable();
      await access(python).catch(() => {
        throw new Error('AnchorSCAD environment missing; run `npm run setup:python` in examples/cad-skill');
      });
      await execFileAsync(python, ['-c', 'import anchorscad'], { timeout: 30_000 });
      continue;
    }

    const packageName = {
      replicad: 'replicad',
      opentscad: '@tscad/modeling',
      'scad-js': 'scad-js',
    }[backend];
    if (!packageName) throw new Error(`Unknown backend: ${backend}`);
    await import(packageName).catch((error) => {
      throw new Error(`Dependency ${packageName} is unavailable; run npm ci in examples/cad-skill`, {
        cause: error,
      });
    });
  }
}

export async function verifyModel(task, workDir, { timeoutMs = 90_000 } = {}) {
  const resolvedWorkDir = await realpath(workDir);
  const backend = task.payload.backend;
  const modelPath = join(resolvedWorkDir, backend === 'anchorscad' ? 'model.py' : 'model.mjs');
  const taskPath = join(resolvedWorkDir, 'task.json');
  const artifactPath = join(
    resolvedWorkDir,
    backend === 'anchorscad' || backend === 'scad-js' ? 'preview.scad' : 'preview.mesh.json',
  );

  const python = pythonExecutable();
  const command = backend === 'anchorscad' ? python : process.execPath;
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const permissionFlag = nodeMajor >= 23 ? '--permission' : '--experimental-permission';
  const args = backend === 'anchorscad'
    ? ['-I', PYTHON_VERIFIER, modelPath, taskPath, artifactPath]
    : [
        permissionFlag,
        `--allow-fs-read=${JS_VERIFIER}`,
        `--allow-fs-read=${resolvedWorkDir}`,
        `--allow-fs-read=${DEPENDENCIES}`,
        `--allow-fs-write=${resolvedWorkDir}`,
        JS_VERIFIER,
        backend,
        modelPath,
        taskPath,
        artifactPath,
      ];

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: resolvedWorkDir,
      env: cleanVerifierEnv(resolvedWorkDir),
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    const result = verifierResult(stdout);
    return { result, logs: [stdout, stderr].filter(Boolean).join('\n') };
  } catch (error) {
    const source = await readFile(modelPath, 'utf8').catch(() => '');
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    return {
      result: {
        executed: false,
        artifact: '',
        parts: [],
        combinedBounds: null,
      },
      logs: [error?.message, stdout, stderr, source && `model source:\n${source}`]
        .filter(Boolean)
        .join('\n'),
    };
  }
}
