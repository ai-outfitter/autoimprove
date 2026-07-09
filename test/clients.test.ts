// PINNED REQUIREMENT TESTS. Tests below marked with a HARD REQUIREMENT
// comment validate docs/requirements/AIMP-001-core-loop.md. To change one,
// amend AIMP-001 FIRST, then update the test in the same change.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAICompatClient,
  AnthropicCompatClient,
  reflect,
  type ModelRequest,
} from '../src/index.js';
import { collectLogger } from './helpers.js';

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function stubFetch(status: number, payload: unknown): { captured: Captured[] } {
  const captured: Captured[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
      captured.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(payload), { status });
    }),
  );
  return { captured };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAICompatClient', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.7.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('posts to chat/completions and parses text and usage', async () => {
    const { captured } = stubFetch(200, {
      choices: [{ message: { content: 'hello there' } }],
      usage: { prompt_tokens: 11, completion_tokens: 4 },
    });
    const client = new OpenAICompatClient({
      baseUrl: 'https://api.openai.com/v1/',
      apiKey: 'sk-test',
      model: 'gpt-test',
      headers: { 'x-extra': 'yes' },
    });
    const res = await client.complete({ system: 'sys', prompt: 'hi', maxTokens: 128 });

    expect(res.text).toBe('hello there');
    expect(res.usage).toEqual({ promptTokens: 11, completionTokens: 4 });
    const call = captured[0]!;
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call.headers['authorization']).toBe('Bearer sk-test');
    expect(call.headers['x-extra']).toBe('yes');
    expect(call.body['model']).toBe('gpt-test');
    expect(call.body['max_tokens']).toBe(128);
    expect(call.body['messages']).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('throws with status and body snippet on HTTP errors', async () => {
    stubFetch(429, { error: 'rate limited' });
    const client = new OpenAICompatClient({ baseUrl: 'https://x.test/v1', apiKey: 'k', model: 'm' });
    await expect(client.complete({ prompt: 'hi' })).rejects.toThrow(/429.*rate limited/s);
  });
});

describe('AnthropicCompatClient', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.7.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('posts to v1/messages with anthropic headers and parses text blocks', async () => {
    const { captured } = stubFetch(200, {
      content: [
        { type: 'text', text: 'part one ' },
        { type: 'tool_use', id: 'ignored' },
        { type: 'text', text: 'part two' },
      ],
      usage: { input_tokens: 9, output_tokens: 2 },
    });
    const client = new AnthropicCompatClient({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'ak-test',
      model: 'claude-test',
    });
    const res = await client.complete({ system: 'sys', prompt: 'hi' });

    expect(res.text).toBe('part one part two');
    expect(res.usage).toEqual({ promptTokens: 9, completionTokens: 2 });
    const call = captured[0]!;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers['x-api-key']).toBe('ak-test');
    expect(call.headers['anthropic-version']).toBe('2023-06-01');
    expect(call.body['system']).toBe('sys');
    expect(call.body['max_tokens']).toBe(4096);
    expect(call.body['messages']).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('normalizes base URLs already containing /v1', async () => {
    stubFetch(200, { content: [{ type: 'text', text: 'ok' }] });
    const client = new AnthropicCompatClient({ baseUrl: 'https://gw.test/v1', apiKey: 'k', model: 'm' });
    const res = await client.complete({ prompt: 'hi' });
    expect(res.text).toBe('ok');
    expect(res.usage).toBeUndefined();
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('https://gw.test/v1/messages');
  });

  it('throws with status and body snippet on HTTP errors', async () => {
    stubFetch(500, { error: 'server broke' });
    const client = new AnthropicCompatClient({ baseUrl: 'https://x.test', apiKey: 'k', model: 'm' });
    await expect(client.complete({ prompt: 'hi' })).rejects.toThrow(/500.*server broke/s);
  });
});

describe('ModelClient contract', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.7.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('accepts any object with a conforming complete() method as the model client', async () => {
    const prompts: string[] = [];
    const structuralClient = {
      async complete(request: ModelRequest) {
        prompts.push(request.prompt);
        return { text: '[{"op": "add", "text": "structural client works"}]' };
      },
    };
    const edits = await reflect({
      model: structuralClient,
      skill: '# Skill',
      results: [{ id: 'f1', hard: 0, soft: 0.1, trajectory: 'failed trajectory' }],
      logger: collectLogger(),
    });
    expect(edits).toEqual([{ op: 'add', text: 'structural client works' }]);
    expect(prompts).toHaveLength(1);
  });
});
