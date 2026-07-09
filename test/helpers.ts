import type {
  Logger,
  ModelClient,
  ModelRequest,
  ModelResponse,
  RolloutResult,
  Task,
} from '../src/index.js';

/** Model mock: routes each request through `respond`, records every call. */
export class MockModelClient implements ModelClient {
  calls: ModelRequest[] = [];

  constructor(
    private readonly respond: (request: ModelRequest, call: number) => string,
    private readonly usage: { promptTokens: number; completionTokens: number } | undefined = {
      promptTokens: 7,
      completionTokens: 3,
    },
  ) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const call = this.calls.length;
    this.calls.push(request);
    const text = this.respond(request, call);
    return this.usage !== undefined ? { text, usage: this.usage } : { text };
  }
}

/** Logger mock that records messages per level. */
export function collectLogger(): Logger & { infos: string[]; warns: string[]; debugs: string[] } {
  const infos: string[] = [];
  const warns: string[] = [];
  const debugs: string[] = [];
  return {
    infos,
    warns,
    debugs,
    info: (m: string) => infos.push(m),
    warn: (m: string) => warns.push(m),
    debug: (m: string) => debugs.push(m),
  };
}

export function makeTasks(n: number): Task[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    description: `task number ${i + 1}`,
  }));
}

export function okResult(id: string, soft: number, trajectory = `trajectory for ${id}`): RolloutResult {
  return { id, hard: soft > 0.5 ? 1 : 0, soft, trajectory };
}
