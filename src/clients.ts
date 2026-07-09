import type { ModelClient, ModelRequest, ModelResponse, TokenUsage } from './types.js';

/**
 * Built-in ModelClient implementations. Both use global fetch (Node 20+),
 * take the same constructor shape, and exist so swapping model or provider
 * is a one-line change:
 *
 *   new OpenAICompatClient({ baseUrl: 'https://api.openai.com/v1', apiKey, model: 'gpt-4.1' })
 *   new AnthropicCompatClient({ baseUrl: 'https://api.anthropic.com', apiKey, model: 'claude-sonnet-4-5' })
 */
export interface CompatClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Extra headers merged into every request (e.g. proxies, org ids). */
  headers?: Record<string, string>;
}

const DEFAULT_MAX_TOKENS = 4096;

/** Chat Completions-compatible client (OpenAI, most local/proxy servers). */
export class OpenAICompatClient implements ModelClient {
  private readonly url: string;

  constructor(private readonly options: CompatClientOptions) {
    const base = options.baseUrl.replace(/\/+$/, '');
    this.url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (request.system !== undefined) messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: request.prompt });

    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
        ...this.options.headers,
      },
      body: JSON.stringify({
        model: this.options.model,
        messages,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI-compatible API error ${res.status}: ${await errorSnippet(res)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    const usage = normalizeUsage(data.usage?.prompt_tokens, data.usage?.completion_tokens);
    return usage !== undefined ? { text, usage } : { text };
  }
}

/** Messages API-compatible client (Anthropic and compatible gateways). */
export class AnthropicCompatClient implements ModelClient {
  private readonly url: string;

  constructor(private readonly options: CompatClientOptions) {
    const base = options.baseUrl.replace(/\/+$/, '');
    if (base.endsWith('/v1/messages')) this.url = base;
    else if (base.endsWith('/v1')) this.url = `${base}/messages`;
    else this.url = `${base}/v1/messages`;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01',
        ...this.options.headers,
      },
      body: JSON.stringify({
        model: this.options.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(request.system !== undefined ? { system: request.system } : {}),
        messages: [{ role: 'user', content: request.prompt }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic-compatible API error ${res.status}: ${await errorSnippet(res)}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
    const usage = normalizeUsage(data.usage?.input_tokens, data.usage?.output_tokens);
    return usage !== undefined ? { text, usage } : { text };
  }
}

function normalizeUsage(
  promptTokens: number | undefined,
  completionTokens: number | undefined,
): TokenUsage | undefined {
  if (typeof promptTokens !== 'number' || typeof completionTokens !== 'number') return undefined;
  return { promptTokens, completionTokens };
}

async function errorSnippet(res: Response): Promise<string> {
  try {
    const body = await res.text();
    return body.slice(0, 500);
  } catch {
    return '(unreadable response body)';
  }
}
