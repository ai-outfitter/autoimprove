# autoimprove: project plan

## What it is

`autoimprove` is a small, embeddable TypeScript library implementing a
SkillOpt-style skill-training loop. A "skill" is a markdown document that
guides a frozen agent through tasks; the library treats that document as
the trainable parameter. It rolls out tasks under the current skill,
reflects on the trajectories with an optimizer model, proposes bounded
text edits, and accepts a candidate skill only if it strictly improves a
held-out validation score.

Algorithm reference: SkillOpt (Microsoft Research, arXiv:2605.23904).
This is an independent TypeScript implementation of the algorithm, not a
port or fork of the Python codebase.

## Who it serves

Hosts that want to embed skill training rather than run a standalone
tool: the DeepWork autoimprove flow, Outfitter, and any harness that can
express "run one task under this skill and score it" as a function.
Published on npm as `autoimprove` (currently only the 0.0.1 name
reservation is published; 0.1.0 is local).

## Tech stack

- TypeScript (strict, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`)
- ESM only, Node >= 20
- Zero runtime dependencies; global `fetch` for the HTTP clients
- devDeps: `typescript`, `vitest`, `@types/node` only
- Build: `tsc -p tsconfig.build.json` to `dist/` (JS + `.d.ts`)
- Scripts: `npm run build`, `npm run typecheck`, `npm test`

## Architecture

```
src/
  types.ts       Core interfaces: Task, RolloutResult, TaskRunner,
                 ModelClient, Logger, meanScore
  prng.ts        mulberry32 + seededShuffle (all randomness is seeded)
  split.ts       splitTasks: seeded train/val/test split (default 5:2:3)
  schedulers.ts  Edit budget ("textual learning rate"): constant, cosine
  edits.ts       SkillEdit (add/delete/replace) + applyEdits
  json.ts        Defensive JSON extraction from model prose
  prompts.ts     ALL optimizer prompts as TS template constants
  rollout.ts     runRollout: batch execution, retry, failure containment
  reflect.ts     reflect (failure/success minibatches), mergeEdits,
                 selectEdits
  gate.ts        Held-out validation gate, strict-improvement acceptance
  train.ts       train(): epochs, batching, resumable state, summary
  clients.ts     OpenAICompatClient, AnthropicCompatClient
  index.ts       Public exports
  cli.ts         Bin entry (#!/usr/bin/env node; package.json "bin")
  cli/
    main.ts      runCli(): arg parsing (node:util parseArgs), dispatch,
                 dry-run plan, summary output; exit codes 0/1/2
    config.ts    JSON config loading + ordered validation (ConfigError
                 names the first bad field; CLI exits 2)
    shell.ts     shellEscape, {{PLACEHOLDER}} rendering, /bin/sh -c
                 executor with timeout
    runner.ts    runner.command template -> TaskRunner (fresh WORK_DIR +
                 SKILL_FILE per invocation, last-JSON stdout contract)
    model.ts     CommandModelClient ({{PROMPT_FILE}}/{{SYSTEM_FILE}},
                 e.g. `claude -p`) + provider dispatch to HTTP clients
test/            vitest suite mirroring the modules + end-to-end train()
                 and end-to-end CLI runs (stub runner/model commands)
```

### The training loop (train.ts)

1. Split tasks with the seed; throw early if train or val is empty. The
   test split is never touched by the loop.
2. Evaluate the initial skill on the validation split (baseline), unless
   resuming from a state file.
3. Per epoch, seeded-shuffle the training split (seed + epoch + 1) and
   walk it in batches. Per step:
   rollout batch -> reflect (failures + successes, with the rejected-edit
   buffer as negative context) -> merge duplicates (one model call) ->
   select within the step's edit budget (one model call) -> applyEdits ->
   gate on the validation split.
4. Accept only on strict improvement (`candidate > current`). On reject,
   applied edits enter the rejected buffer (capped, default 20 entries).
5. After every step, state is written atomically (tmp file + rename) to
   `stateFile` if provided: step counter, current/best skill and scores,
   rejected buffer, step records, token usage. Rerunning with the same
   state file resumes exactly; a seed mismatch is a hard error because
   splits would silently diverge.
6. Returns a summary: steps, accepts/rejects/skips, best skill/score/step,
   final skill/score, per-step records, split task ids, token usage,
   aborted flag (AbortSignal stops between steps; state stays resumable).

Merge and select skip their model call when the input already fits (one
edit, or fewer edits than budget); the step then costs only the reflect
calls.

## Public API surface

- `train(options): Promise<TrainSummary>`
- Interfaces: `ModelClient`, `TaskRunner`, `Task`, `RolloutResult`,
  `Logger`, `SkillEdit`, `RejectedEdit`, `TrainState`, `StepRecord`
- Composable pieces: `runRollout`, `reflect`, `mergeEdits`, `selectEdits`,
  `applyEdits`, `gate`, `splitTasks`, `constantScheduler`,
  `cosineScheduler`, `meanScore`, `mulberry32`, `seededShuffle`,
  `extractFirstJson`, `parseEditsResponse`
- Prompts: `OPTIMIZER_SYSTEM`, `reflectPrompt`, `mergePrompt`,
  `selectPrompt` (exported so hosts can inspect or reuse them)
- Clients: `OpenAICompatClient`, `AnthropicCompatClient`, both taking
  `{baseUrl, apiKey, model, headers?}` so provider swap is one line

## CLI

Exactly one command (a deliberate curation rule, pinned in AIMP-002.1):

```
autoimprove train --config <path> [--resume] [--dry-run]
```

JSON config (paths relative to the config file):

- `skill`: seed skill markdown; the best skill is written next to it as
  `<name>.trained.md` on completion.
- `tasks`: JSONL file of `{id, description?, payload?}` lines.
- `runner`: `{command, timeoutSeconds?}` — shell template run once per
  task via `/bin/sh -c` with placeholders `{{SKILL_FILE}}` (required),
  `{{TASK_ID}}`, `{{TASK_PAYLOAD}}` (JSON-stringified), `{{WORK_DIR}}`
  (fresh per-task temp dir holding the skill file). Stdout must end with
  `{"hard": 0|1, "soft": number, "trajectory": string, "failReason"?}`;
  the LAST balanced JSON object is parsed. Non-zero exit, timeout
  (default 900s), or invalid output throws into the library's
  retry/containment (AIMP-001.1). Substituted values are always
  shell-escaped.
- `model`: `{provider: "openai"|"anthropic"|"command", baseUrl?,
  apiKeyEnv?, model?, command?, timeoutSeconds?}`. `command` templates
  get `{{PROMPT_FILE}}` (required) and `{{SYSTEM_FILE}}`; stdout is the
  completion (for CLI-authenticated setups like `claude -p`).
- `train`: `{epochs, batchSize, seed, splitRatio?, splitOverride?,
  gateMetric?, editBudget?, minEditBudget?, scheduler?
  ("constant"|"cosine"), stateFile? (default .autoimprove/state.json),
  concurrency?}`.

Behavior: config validation errors name the first bad field and exit 2;
`--dry-run` prints the plan (split sizes, step count, estimated
invocation upper bounds) with zero runner/model invocations; an existing
state file is refused without `--resume`; on completion a compact
summary is printed and the `TrainSummary` JSON is written next to the
state file (`<state>.summary.json`). Runtime failures exit 1. The CLI
adds no runtime dependencies and no public API exports (it composes the
already-exported pieces; `extractLastJsonObject` lives in `src/json.ts`
but is deliberately NOT re-exported from `index.ts`).

## Design principles

- **Interfaces over implementations.** The user brings the agent harness
  (`TaskRunner`) and the optimizer model (`ModelClient`). The library
  never shells out and never talks to a provider except through the two
  bundled fetch clients, which are optional.
- **Self-containment.** All prompts live in `src/prompts.ts` as template
  constants. This is a hard rule: an upstream package once shipped with
  an empty prompts directory and failed at runtime. No loose prompt
  files, ever.
- **Visible failure.** A task runner rejection is retried once; a second
  failure scores `{hard: 0, soft: 0}` but carries a visible `error` field
  and a logger warning. Infra failures must never be silently averaged in
  as genuine zeros (this exact bug once invalidated a baseline). The gate
  also warns when errored results feed its metric.
- **Never throw mid-loop.** Model output is parsed defensively (first
  JSON value extracted from prose; invalid means "no edits"). Model call
  failures degrade to fallbacks (reflect: no edits; merge: input edits;
  select: first-N). Config errors (bad ratio, empty splits, seed
  mismatch) throw up front, before any work.
- **Determinism.** All shuffles and splits flow from an explicit seed via
  mulberry32. No `Math.random` or `Date.now` in core logic.
- **Bounded change.** Edits must match exact existing text (delete/
  replace) or an exact anchor (add); non-matching edits are skipped with
  a reason. The per-step budget (default 4, cosine floor 2) is the
  textual learning rate.

## Requirements and governance

Formal requirements live in `docs/requirements/`:

- `AIMP-001-core-loop.md`: sections `AIMP-001.1` through `AIMP-001.8`
  covering failure containment, self-containment, gate integrity,
  bounded edits, determinism/resume, defensive parsing, the model-client
  contract, and the governance rules themselves.
- `AIMP-002-cli.md`: sections `AIMP-002.1` through `AIMP-002.6` covering
  the single-command surface, named-field config validation with exit 2,
  zero-invocation dry run, the runner-command stdout contract
  (last-JSON-object parsing, containment of failures), shell-escaped
  placeholder substitution, and zero runtime dependencies. AIMP-001.8
  governance applies unchanged.

The format mirrors the Outfitter OFTR convention (`### AIMP-NNN.M:
Title` sections, one RFC 2119 claim per numbered item, stable IDs).

Traceability: every requirement is validated by vitest tests carrying a
two-line pinned comment immediately before the test:

```ts
// THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.M.K).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
```

Amendment rule: amend the AIMP document FIRST (same change or earlier),
then update the pinned test. Never edit a pinned test to match new
behavior without the corresponding requirement amendment. A root
`.deepreview` enforces both halves: `requirements_rfc2119` reviews
requirement-doc format (RFC 2119 keyword on every numbered item,
sequential section IDs), and `pinned_test_amendment` flags pinned-test
changes that lack a matching AIMP requirement amendment.

Requirement-specific tests added for coverage gaps: budget-cap
enforcement (`train.test.ts`), infrastructure-error labeling in
reflection prompts (`reflect.test.ts`), structural `ModelClient`
usability (`clients.test.ts`), and package self-containment — zero
runtime deps, `files` allowlist, prompts embedded as constants
(`package.test.ts`).

## Planned improvements (not yet built)

- Meta-skill / slow-update variants from the paper (explicitly out of
  scope for v0.1)
- Task adapters: DeepWork jobs, agent session transcripts -> `Task[]`
- Optional test-split evaluation helper for final reporting
- Streaming/progress callbacks beyond the injectable logger

## Conventions

- Do not publish to npm or push anywhere without Tyler's explicit
  go-ahead; version 0.1.0 is local only.
- Keep `package.json` name/description/license lineage intact.
- All tests green and `tsc --noEmit` clean before committing.
