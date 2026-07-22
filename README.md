# autoimprove

Recursive Skill Improvement: train portable markdown skills for coding
agents from your existing workflows and sessions.

A small, embeddable TypeScript library implementing a SkillOpt-style
training loop. It treats a markdown skill document as the trainable
parameter of a frozen agent: run tasks under the current skill, reflect on
failures and successes with an optimizer model, propose bounded edits, and
accept a candidate only if it strictly improves a held-out validation
score.

**Status: early.** The loop works and is tested, but the API will move.
Pin an exact version if you depend on it.

Algorithm reference: [SkillOpt](https://github.com/microsoft/SkillOpt)
(Microsoft Research, arXiv:2605.23904). This is an independent
implementation, not a fork.

## Results

Measured on a real workflow: a daily blog-drafting job whose own review
rubrics were used as the scoring function, with a Haiku 4.5 target agent,
an Opus 4.8 optimizer and judge, 22 replayable tasks, and a held-out
validation split of 4 tasks (identical dates in both runs below).

| Run | Trainer | Baseline (val soft) | Best | Gate decisions |
| --- | --- | --- | --- | --- |
| Run 2, 2026-07-09 | upstream Python `skillopt` 0.2.0 | 0.6374 | 0.7155 | 1 accept, 2 rejects, 1 skip |
| Run 3, 2026-07-09 | this library | 0.6226 | 0.6637 | 1 accept, 3 rejects |

Both runs share one shape: exactly one gate-accepted edit improved the
held-out score (+12.3% and +6.6% relative), and every later candidate was
refused — including batches scoring 0.49 and 0.42 that would have shipped
without held-out validation. Run 3 swapped only the trainer for this
library (same rollout code, scorer, judge prompt, and pinned validation
dates); its baseline within judge noise of Run 2's is the scorer parity
check, and both implementations independently induced the same kind of
edit (evidence-discipline rules distilled from the reviewer's rejection
patterns). Numbers are single runs on n=4 validation, so treat them as
loop-works evidence, not benchmarks.

## How the loop works

1. **Rollout.** A batch of training tasks runs under the current skill via
   your `TaskRunner`. Each result carries a hard score (0 or 1), a soft
   score in [0, 1], and a trajectory text.
2. **Reflect.** Results are grouped into failure and success minibatches.
   One optimizer-model call per minibatch analyzes the trajectories and
   proposes edits.
3. **Bounded edits.** Edits are patches (`add`, `delete`, `replace`) that
   must match exact existing text; an edit budget per step (the "textual
   learning rate", default 4) caps how much can change at once, with
   constant and cosine schedulers.
4. **Merge and select.** Duplicate or conflicting proposals are merged,
   then ranked, keeping at most the step's budget.
5. **Validation gate.** The candidate skill is evaluated on a held-out
   validation split. It is accepted only on strict improvement. Rejected
   edits go into a buffer that future reflection calls see as negative
   context.
6. **Trainer.** `train()` runs epochs over your task list with seeded
   shuffling, a train/val/test split (default `5:2:3`; the test split is
   never touched), a resumable JSON state file, and a final summary.

## Install

```
npm install autoimprove
```

Node 20 or newer. ESM only. Zero runtime dependencies.

## Quickstart

You bring two things: a `ModelClient` (the optimizer model) and a
`TaskRunner` (your agent harness plus scorer). The library never shells
out itself.

```ts
import { train, OpenAICompatClient, type TaskRunner } from 'autoimprove';

const model = new OpenAICompatClient({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-5.5',
});

// Your agent harness: run one task under the skill, score the outcome.
const runner: TaskRunner = async (task, skill, ctx) => {
  const output = await runMyAgent({
    instructions: skill,
    input: task.payload,
    signal: ctx.signal,
  });
  const passed = await checkAnswer(task, output.answer);
  return {
    id: task.id,
    hard: passed ? 1 : 0,
    soft: scorePartialCredit(task, output.answer),
    trajectory: output.transcript,
    failReason: passed ? undefined : 'answer did not match expected result',
  };
};

const summary = await train({
  skill: initialSkillMarkdown,
  tasks,                       // [{ id, description?, payload? }, ...]
  runner,
  model,
  epochs: 2,
  stateFile: '.autoimprove/state.json', // optional: makes the run resumable
});

console.log(summary.bestScore, summary.bestSkill);
```

Swapping the optimizer provider is one line:

```ts
const model = new AnthropicCompatClient({
  baseUrl: 'https://api.anthropic.com',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-sonnet-5',
});
```

Any object with a `complete({system?, prompt, maxTokens?})` method works
as a `ModelClient`, so local models and gateways plug in the same way.

## CLI

For hosts that would rather bring a shell command than TypeScript, the
package ships one command:

```
autoimprove train --config train.json [--resume] [--dry-run]
```

The JSON config points at the seed skill, a JSONL task file
(`{"id", "description"?, "payload"?}` per line), a runner command
template, and the optimizer model:

```json
{
  "skill": "skill.md",
  "tasks": "tasks.jsonl",
  "runner": { "command": "./run-task.sh {{SKILL_FILE}} {{TASK_ID}} {{TASK_PAYLOAD}} {{WORK_DIR}}", "timeoutSeconds": 900 },
  "model": { "provider": "anthropic", "model": "claude-sonnet-5", "apiKeyEnv": "ANTHROPIC_API_KEY" },
  "train": { "epochs": 2, "batchSize": 4, "seed": 42, "stateFile": ".autoimprove/state.json" }
}
```

The runner command runs once per task with the current skill written to
`{{SKILL_FILE}}` inside a fresh `{{WORK_DIR}}`; its stdout must end with
`{"hard": 0|1, "soft": number, "trajectory": string, "failReason"?: string}`
(the last JSON object on stdout is parsed, so log freely before it).
Placeholder values are shell-escaped; a non-zero exit or unparseable
output is contained by the library's retry logic like any runner failure.
For CLI-authenticated optimizers use `"provider": "command"` with a
template like `claude -p "$(cat {{PROMPT_FILE}})"`. `--dry-run` validates
the config and prints the plan without invoking anything; bad config
names the first invalid field and exits 2. On completion the best skill
lands next to the seed as `<name>.trained.md` with a summary JSON next to
the state file. Full contract: `docs/requirements/AIMP-002-cli.md`.

## API overview

High level:

- `train(options)`: the full loop. Returns a summary with
  accepts/rejects/skips, best skill and score, per-step records, split
  task ids, and token usage when the model client reports it.

Lower-level pieces, exported so hosts can compose custom loops:

- `runRollout({tasks, skill, runner, ...})`: run a batch with retry and
  failure containment. A runner that throws twice yields a result scored
  `{hard: 0, soft: 0}` with a visible `error` field and a logger warning;
  an infrastructure failure is never silently averaged in as a real zero.
- `reflect({model, skill, results, rejected?})`: failure/success
  minibatch analysis, returns proposed edits.
- `mergeEdits(...)` / `selectEdits(...)`: dedupe proposals, then rank and
  keep at most the edit budget.
- `applyEdits(skill, edits)`: apply bounded patches; edits that do not
  match exact existing text are skipped with a reason, never thrown.
- `gate({candidateSkill, valTasks, runner, baselineScore})`: held-out
  evaluation with strict-improvement acceptance.
- `splitTasks(tasks, ratio, seed)`: deterministic seeded split.
- `constantScheduler(budget)` / `cosineScheduler(initial, min)`: edit
  budget schedules.
- `OpenAICompatClient` / `AnthropicCompatClient`: fetch-based model
  clients with a shared constructor shape.

All optimizer prompts are embedded as TypeScript constants in
`src/prompts.ts`; the package has no loose prompt files that can go
missing in a build. Model responses are parsed defensively: the first
JSON value is extracted from surrounding prose, and unparseable output
degrades to "no edits" instead of crashing the loop.

## Determinism

Splits and shuffles use a seeded PRNG (`seed` option, default 42). The
same seed, tasks, and deterministic runner reproduce the same batches and
splits. Resuming from a state file requires the same seed; the trainer
refuses to resume otherwise.

## Examples

See [examples/README.md](examples/README.md) for the compact word-transform
loop and an Outfitter v1 `cad` profile whose Replicad skill improves against
withheld CADTestBench-style model and assembly evaluations on a weekly schedule.

## Not in scope yet

Meta-skill learning and slow-update variants from the paper are not
implemented. There are no built-in task adapters yet (DeepWork jobs,
session transcripts); v0.1 is the core loop only.

MIT.
