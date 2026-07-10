import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ModelClient, ModelRequest, ModelResponse } from '../types.js';
import { AnthropicCompatClient, OpenAICompatClient } from '../clients.js';
import { renderTemplate, runShellCommand } from './shell.js';
import type { ModelConfig } from './config.js';

/**
 * Shell-command ModelClient for CLI-authenticated setups (e.g. `claude -p`).
 * The prompt and system text are written to temp files, substituted into
 * the template as `{{PROMPT_FILE}}` / `{{SYSTEM_FILE}}` (shell-escaped),
 * and the command's entire stdout is the completion text.
 */
export class CommandModelClient implements ModelClient {
  constructor(private readonly config: { command: string; timeoutSeconds: number }) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const dir = await mkdtemp(join(tmpdir(), 'autoimprove-model-'));
    try {
      const promptFile = join(dir, 'prompt.md');
      const systemFile = join(dir, 'system.md');
      await writeFile(promptFile, request.prompt, 'utf8');
      await writeFile(systemFile, request.system ?? '', 'utf8');
      const command = renderTemplate(this.config.command, {
        PROMPT_FILE: promptFile,
        SYSTEM_FILE: systemFile,
      });
      const result = await runShellCommand(command, {
        timeoutMs: this.config.timeoutSeconds * 1000,
      });
      if (result.timedOut) {
        throw new Error(`model command timed out after ${this.config.timeoutSeconds}s`);
      }
      if (result.code !== 0) {
        throw new Error(
          `model command exited with code ${result.code ?? 'unknown'}${snippet(result.stderr)}`,
        );
      }
      return { text: result.stdout };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** Build the optimizer ModelClient the config asks for. */
export function createModelClient(config: ModelConfig): ModelClient {
  if (config.provider === 'command') {
    return new CommandModelClient(config);
  }
  const options = { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model };
  return config.provider === 'openai'
    ? new OpenAICompatClient(options)
    : new AnthropicCompatClient(options);
}

function snippet(stderr: string): string {
  const trimmed = stderr.trim();
  if (trimmed === '') return '';
  return `: ${trimmed.slice(-500)}`;
}
