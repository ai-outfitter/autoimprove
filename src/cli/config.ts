import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import type { Metric, Task } from '../types.js';
import type { SplitOverride, TaskSplit } from '../split.js';
import { overrideSplit, splitTasks } from '../split.js';
import { DEFAULT_EDIT_BUDGET, MIN_EDIT_BUDGET } from '../schedulers.js';
import { templatePlaceholders } from './shell.js';

/**
 * JSON config loading and validation for `autoimprove train`. Validation
 * is strict and ordered: the FIRST invalid field is named in a
 * `ConfigError` and the CLI exits 2 (AIMP-002.2.1). Relative paths
 * resolve against the config file's directory (AIMP-002.2.2).
 */

export class ConfigError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const RUNNER_PLACEHOLDERS = ['SKILL_FILE', 'TASK_ID', 'TASK_PAYLOAD', 'WORK_DIR'] as const;
export const MODEL_PLACEHOLDERS = ['PROMPT_FILE', 'SYSTEM_FILE'] as const;
export const DEFAULT_TIMEOUT_SECONDS = 900;
const DEFAULT_STATE_FILE = '.autoimprove/state.json';

export interface RunnerCommandConfig {
  command: string;
  timeoutSeconds: number;
}

export type ModelConfig =
  | { provider: 'openai' | 'anthropic'; baseUrl: string; apiKey: string; model: string }
  | { provider: 'command'; command: string; timeoutSeconds: number };

export interface TrainConfig {
  epochs: number;
  batchSize: number;
  seed: number;
  splitRatio?: string;
  splitOverride?: SplitOverride;
  gateMetric: Metric;
  editBudget: number;
  minEditBudget: number;
  scheduler: 'constant' | 'cosine';
  stateFile: string;
  concurrency: number;
}

export interface LoadedConfig {
  configPath: string;
  skillPath: string;
  skillText: string;
  tasksPath: string;
  tasks: Task[];
  runner: RunnerCommandConfig;
  model: ModelConfig;
  train: TrainConfig;
  /** Resolved split, computed at load time for validation and the dry-run plan. */
  split: TaskSplit;
  /** Best skill is written here on completion: `<skill name>.trained.md`. */
  trainedSkillFile: string;
  /** TrainSummary JSON is written here, next to the state file. */
  summaryFile: string;
}

export async function loadCliConfig(
  configPath: string,
  env: Record<string, string | undefined> = process.env,
): Promise<LoadedConfig> {
  const absConfig = resolve(configPath);
  let text: string;
  try {
    text = await readFile(absConfig, 'utf8');
  } catch {
    throw new ConfigError('config', `cannot read config file ${absConfig}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigError('config', `${absConfig} is not valid JSON: ${message(err)}`);
  }
  if (!isPlainObject(parsed)) {
    throw new ConfigError('config', `${absConfig} must contain a JSON object`);
  }
  rejectUnknownKeys(parsed, ['skill', 'tasks', 'runner', 'model', 'train'], '');
  const configDir = dirname(absConfig);

  // --- skill -----------------------------------------------------------------
  const skillRaw = parsed['skill'];
  if (typeof skillRaw !== 'string' || skillRaw === '') {
    throw new ConfigError('skill', 'must be a path to the seed skill markdown file');
  }
  const skillPath = resolveFrom(configDir, skillRaw);
  let skillText: string;
  try {
    skillText = await readFile(skillPath, 'utf8');
  } catch {
    throw new ConfigError('skill', `cannot read skill file ${skillPath}`);
  }

  // --- tasks -----------------------------------------------------------------
  const tasksRaw = parsed['tasks'];
  if (typeof tasksRaw !== 'string' || tasksRaw === '') {
    throw new ConfigError('tasks', 'must be a path to a JSONL task file');
  }
  const tasksPath = resolveFrom(configDir, tasksRaw);
  let tasksText: string;
  try {
    tasksText = await readFile(tasksPath, 'utf8');
  } catch {
    throw new ConfigError('tasks', `cannot read tasks file ${tasksPath}`);
  }
  const tasks = parseTasksJsonl(tasksText, tasksPath);

  // --- runner ----------------------------------------------------------------
  const runnerRaw = parsed['runner'];
  if (!isPlainObject(runnerRaw)) {
    throw new ConfigError('runner', 'must be an object like {"command": "..."}');
  }
  rejectUnknownKeys(runnerRaw, ['command', 'timeoutSeconds'], 'runner');
  const runnerCommand = runnerRaw['command'];
  if (typeof runnerCommand !== 'string' || runnerCommand.trim() === '') {
    throw new ConfigError('runner.command', 'must be a non-empty shell command template');
  }
  checkPlaceholders('runner.command', runnerCommand, RUNNER_PLACEHOLDERS, 'SKILL_FILE');
  const runner: RunnerCommandConfig = {
    command: runnerCommand,
    timeoutSeconds: readTimeout(runnerRaw['timeoutSeconds'], 'runner.timeoutSeconds'),
  };

  // --- model -----------------------------------------------------------------
  const modelRaw = parsed['model'];
  if (!isPlainObject(modelRaw)) {
    throw new ConfigError('model', 'must be an object with a "provider"');
  }
  rejectUnknownKeys(
    modelRaw,
    ['provider', 'baseUrl', 'apiKeyEnv', 'model', 'command', 'timeoutSeconds'],
    'model',
  );
  const model = readModelConfig(modelRaw, env);

  // --- train -----------------------------------------------------------------
  const trainRaw = parsed['train'] ?? {};
  if (!isPlainObject(trainRaw)) {
    throw new ConfigError('train', 'must be an object when present');
  }
  rejectUnknownKeys(
    trainRaw,
    [
      'epochs',
      'batchSize',
      'seed',
      'splitRatio',
      'splitOverride',
      'gateMetric',
      'editBudget',
      'minEditBudget',
      'scheduler',
      'stateFile',
      'concurrency',
    ],
    'train',
  );
  const train = readTrainConfig(trainRaw, configDir);

  // --- split (validated up front so bad splits exit 2, not mid-run) ----------
  const splitField = train.splitOverride !== undefined ? 'train.splitOverride' : 'train.splitRatio';
  let split: TaskSplit;
  try {
    split =
      train.splitOverride !== undefined
        ? overrideSplit(tasks, train.splitOverride)
        : splitTasks(tasks, train.splitRatio ?? '5:2:3', train.seed);
  } catch (err) {
    throw new ConfigError(splitField, message(err));
  }
  if (split.train.length === 0) {
    throw new ConfigError(splitField, `training split is empty (${tasks.length} task(s))`);
  }
  if (split.val.length === 0) {
    throw new ConfigError(
      splitField,
      `validation split is empty (${tasks.length} task(s)); the gate needs held-out tasks`,
    );
  }

  const skillName = basename(skillPath).replace(/\.[^.]+$/, '');
  return {
    configPath: absConfig,
    skillPath,
    skillText,
    tasksPath,
    tasks,
    runner,
    model,
    train,
    split,
    trainedSkillFile: join(dirname(skillPath), `${skillName}.trained.md`),
    summaryFile: `${train.stateFile.replace(/\.json$/, '')}.summary.json`,
  };
}

// --- pieces -------------------------------------------------------------------

function parseTasksJsonl(text: string, tasksPath: string): Task[] {
  const tasks: Task[] = [];
  const seen = new Set<string>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).trim();
    if (line === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (err) {
      throw new ConfigError('tasks', `line ${i + 1} is not valid JSON: ${message(err)}`);
    }
    if (!isPlainObject(value)) {
      throw new ConfigError('tasks', `line ${i + 1} must be a JSON object with an "id"`);
    }
    const id = value['id'];
    if (typeof id !== 'string' || id === '') {
      throw new ConfigError('tasks', `line ${i + 1}: "id" must be a non-empty string`);
    }
    if (seen.has(id)) {
      throw new ConfigError('tasks', `line ${i + 1}: duplicate task id "${id}"`);
    }
    seen.add(id);
    const description = value['description'];
    if (description !== undefined && typeof description !== 'string') {
      throw new ConfigError('tasks', `line ${i + 1}: "description" must be a string when present`);
    }
    const task: Task = { id };
    if (typeof description === 'string') task.description = description;
    if (value['payload'] !== undefined) task.payload = value['payload'];
    tasks.push(task);
  }
  if (tasks.length === 0) {
    throw new ConfigError('tasks', `no tasks found in ${tasksPath}`);
  }
  return tasks;
}

function readModelConfig(
  raw: Record<string, unknown>,
  env: Record<string, string | undefined>,
): ModelConfig {
  const provider = raw['provider'];
  if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'command') {
    throw new ConfigError(
      'model.provider',
      `unknown provider ${JSON.stringify(provider)}; expected "openai", "anthropic", or "command"`,
    );
  }

  if (provider === 'command') {
    const command = raw['command'];
    if (typeof command !== 'string' || command.trim() === '') {
      throw new ConfigError(
        'model.command',
        'must be a non-empty shell command template when provider is "command"',
      );
    }
    checkPlaceholders('model.command', command, MODEL_PLACEHOLDERS, 'PROMPT_FILE');
    return {
      provider,
      command,
      timeoutSeconds: readTimeout(raw['timeoutSeconds'], 'model.timeoutSeconds'),
    };
  }

  const modelName = raw['model'];
  if (typeof modelName !== 'string' || modelName === '') {
    throw new ConfigError('model.model', `must name the ${provider} model to use`);
  }
  const baseUrl =
    raw['baseUrl'] ?? (provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com');
  if (typeof baseUrl !== 'string' || baseUrl === '') {
    throw new ConfigError('model.baseUrl', 'must be a URL string when present');
  }
  const apiKeyEnv =
    raw['apiKeyEnv'] ?? (provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY');
  if (typeof apiKeyEnv !== 'string' || apiKeyEnv === '') {
    throw new ConfigError('model.apiKeyEnv', 'must be an environment variable name when present');
  }
  const apiKey = env[apiKeyEnv];
  if (apiKey === undefined || apiKey === '') {
    throw new ConfigError('model.apiKeyEnv', `environment variable ${apiKeyEnv} is not set`);
  }
  return { provider, baseUrl, apiKey, model: modelName };
}

function readTrainConfig(raw: Record<string, unknown>, configDir: string): TrainConfig {
  const epochs = readPositiveInt(raw['epochs'], 'train.epochs', 1);
  const batchSize = readPositiveInt(raw['batchSize'], 'train.batchSize', 4);
  const seed = readInteger(raw['seed'], 'train.seed', 42);

  const splitRatio = raw['splitRatio'];
  if (splitRatio !== undefined && typeof splitRatio !== 'string') {
    throw new ConfigError('train.splitRatio', 'must be a "train:val:test" string like "5:2:3"');
  }
  const splitOverride = readSplitOverride(raw['splitOverride']);
  if (splitRatio !== undefined && splitOverride !== undefined) {
    throw new ConfigError('train.splitRatio', 'cannot be combined with train.splitOverride');
  }

  const gateMetric = raw['gateMetric'] ?? 'soft';
  if (gateMetric !== 'soft' && gateMetric !== 'hard') {
    throw new ConfigError('train.gateMetric', `must be "soft" or "hard", got ${JSON.stringify(gateMetric)}`);
  }

  const editBudget = readPositiveInt(raw['editBudget'], 'train.editBudget', DEFAULT_EDIT_BUDGET);
  const minEditBudget = readPositiveInt(
    raw['minEditBudget'],
    'train.minEditBudget',
    Math.min(MIN_EDIT_BUDGET, editBudget),
  );
  if (minEditBudget > editBudget) {
    throw new ConfigError('train.minEditBudget', `must not exceed train.editBudget (${editBudget})`);
  }

  const scheduler = raw['scheduler'] ?? 'constant';
  if (scheduler !== 'constant' && scheduler !== 'cosine') {
    throw new ConfigError('train.scheduler', `must be "constant" or "cosine", got ${JSON.stringify(scheduler)}`);
  }

  const stateFileRaw = raw['stateFile'] ?? DEFAULT_STATE_FILE;
  if (typeof stateFileRaw !== 'string' || stateFileRaw === '') {
    throw new ConfigError('train.stateFile', 'must be a file path when present');
  }

  const concurrency = readPositiveInt(raw['concurrency'], 'train.concurrency', 1);

  return {
    epochs,
    batchSize,
    seed,
    ...(typeof splitRatio === 'string' ? { splitRatio } : {}),
    ...(splitOverride !== undefined ? { splitOverride } : {}),
    gateMetric,
    editBudget,
    minEditBudget,
    scheduler,
    stateFile: resolveFrom(configDir, stateFileRaw),
    concurrency,
  };
}

function readSplitOverride(raw: unknown): SplitOverride | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    throw new ConfigError('train.splitOverride', 'must be an object with "train", "val", and "test" id arrays');
  }
  rejectUnknownKeys(raw, ['train', 'val', 'test'], 'train.splitOverride');
  const readIds = (key: 'train' | 'val' | 'test'): string[] => {
    const ids = raw[key];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      throw new ConfigError(`train.splitOverride.${key}`, 'must be an array of task id strings');
    }
    return ids as string[];
  };
  return { train: readIds('train'), val: readIds('val'), test: readIds('test') };
}

function checkPlaceholders(
  field: string,
  template: string,
  allowed: readonly string[],
  required: string,
): void {
  for (const name of templatePlaceholders(template)) {
    if (!allowed.includes(name)) {
      throw new ConfigError(
        field,
        `unknown placeholder {{${name}}}; allowed placeholders: ${allowed.map((p) => `{{${p}}}`).join(', ')}`,
      );
    }
  }
  if (!templatePlaceholders(template).includes(required)) {
    throw new ConfigError(field, `must contain the {{${required}}} placeholder`);
  }
}

function readTimeout(raw: unknown, field: string): number {
  if (raw === undefined) return DEFAULT_TIMEOUT_SECONDS;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    throw new ConfigError(field, `must be a positive number of seconds, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

function readPositiveInt(raw: unknown, field: string, fallback: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new ConfigError(field, `must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

function readInteger(raw: unknown, field: string, fallback: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new ConfigError(field, `must be an integer, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  prefix: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new ConfigError(prefix === '' ? key : `${prefix}.${key}`, 'unknown config key');
    }
  }
}

function resolveFrom(configDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(configDir, path);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
