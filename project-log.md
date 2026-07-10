# autoimprove: project log

## 2026-07-09: Initial implementation (v0.1.0, local only)

Replaced the npm name-reservation placeholder (v0.0.1: empty `index.js`,
stub README) with the first real implementation: an embeddable
TypeScript library for SkillOpt-style skill training (independent
implementation of arXiv:2605.23904, not a port of the Python).

What was built:

- Core loop: `train()` with rollout -> reflect (failure/success
  minibatches) -> merge -> select -> bounded patch -> held-out validation
  gate with strict-improvement acceptance. Seeded train/val/test
  splitting (default 5:2:3, test never touched), per-epoch seeded
  shuffles, resumable JSON state file written atomically after every
  step, rejected-edit buffer fed back into reflection as negative
  context, per-step records and a final summary with token usage.
- Bounded edits: `add`/`delete`/`replace` patches matching exact existing
  text, `applyEdits` skips non-matching edits with reasons. Edit budget
  schedulers: constant (default 4) and cosine (4 down to 2).
- Interfaces over implementations: `ModelClient` and `TaskRunner` are the
  two user-supplied pieces. Shipped `OpenAICompatClient` and
  `AnthropicCompatClient` (global fetch, shared constructor shape) so
  provider swap is one line.
- All prompts embedded as TS constants in `src/prompts.ts`, and defensive
  JSON parsing (`extractFirstJson`, `parseEditsResponse`): both are
  direct reactions to being burned upstream, once by a wheel shipping an
  empty prompts directory and once by models wrapping JSON in prose.
- Failure containment in `runRollout`: retry a runner rejection once,
  then score `{hard: 0, soft: 0}` with a visible `error` field plus a
  logger warning. Motivated by a real incident where infra failures
  averaged in as silent zeros and invalidated a baseline.
- Determinism: inline mulberry32 PRNG; no `Math.random`/`Date.now` in
  core paths.

Design choices worth remembering:

- Merge/select skip their optimizer call when the edit set already fits
  (<=1 edit, or <= budget), saving tokens; fallbacks on unparseable
  responses are the input set (merge) and first-N (select).
- `train()` refuses to resume a state file written with a different seed
  (splits would silently diverge); a corrupt state file logs a warning
  and starts fresh.
- Success minibatches also reflect (make winning behavior explicit), not
  just failures.
- Gate rejects ties: strictly-greater only.

State: 70 vitest tests green (patching, split determinism, schedulers,
defensive JSON, rollout containment, reflect prompts incl. rejected
buffer, gate semantics, HTTP clients with stubbed fetch, end-to-end
train with mock model/runner, resume-from-state), `tsc --noEmit` clean,
`npm run build` emits `dist/`. Version bumped to 0.1.0 locally; NOT
published, NOT pushed anywhere, no GitHub repo created.

Deferred (intentionally out of scope for v0.1): meta-skill and
slow-update variants, task adapters (DeepWork jobs, session
transcripts), test-split final evaluation helper.

## 2026-07-09: Requirements retrofit (RFC 2119 + pinned tests)

Retrofitted formal requirements discipline onto the finished v0.1.0
library, mirroring the Outfitter OFTR convention, so future changes to
normative behavior must go through an explicit requirement amendment
instead of a silent test edit.

What was added (no production code changed):

- `docs/requirements/AIMP-001-core-loop.md`: 8 requirement sections
  (AIMP-001.1 failure containment, .2 self-containment, .3 gate
  integrity, .4 bounded edits, .5 determinism/resume, .6 defensive
  parsing, .7 client contract, .8 governance), each a numbered list of
  single-claim RFC 2119 statements.
- Traceability comments: every test validating a requirement now carries
  the two-line `THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.M.K)` /
  `YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.` pin
  (wording copied from Outfitter), plus a file-top banner stating the
  amendment rule: amend AIMP-001 first, then touch the test.
- Six new tests closing coverage gaps: applied-edits-per-step never
  exceeds the scheduler budget even when the select model over-returns
  (train.test.ts); reflection prompts label infra-errored results as
  INFRASTRUCTURE ERROR (reflect.test.ts); a plain object with a
  conforming complete() works as ModelClient (clients.test.ts); and
  package.test.ts pins zero runtime dependencies, the
  dist/README/LICENSE files allowlist, and prompts-as-embedded-constants
  (prompts.ts contains no fs access).
- Root `.deepreview` with two rules: `requirements_rfc2119` (every
  numbered requirement uses an RFC 2119 keyword, AIMP heading/numbering
  format) and `pinned_test_amendment` (pinned-test changes require a
  matching AIMP-001 amendment in the same change).

Findings: no spec violations in the production code; behavior matched
the documented contract everywhere the requirements probe it. One
boundary note recorded here for future reference: a pathological custom
scheduler returning 0 would still see one edit applied, because
selectEdits floors its budget at 1 — the built-in schedulers guarantee
>= 1, and AIMP-001.4.6 pins that guarantee, so the requirement set is
stated in terms of budgets >= 1.

State: 76 vitest tests green (was 70), `tsc --noEmit` clean. Local
commits only; nothing pushed or published.

## 2026-07-09: Minimal CLI (AIMP-002)

Added the deliberately-minimal CLI: exactly one command,
`autoimprove train --config <path>` with `--resume` and `--dry-run`
flags. No init, no scaffolding, no plugin system, no second command —
this is a curation rule from Tyler, pinned as AIMP-002.1. The library
story stays primary; the CLI is a thin shell over `train()`.

What was built:

- `src/cli.ts` (bin entry, `package.json` "bin": `dist/cli.js`) plus
  `src/cli/{main,config,shell,runner,model}.ts`, all compiled by the
  existing build. Zero new dependencies: JSON config, `node:util`
  parseArgs, `node:child_process` for command templates.
- Config schema: `skill` (seed markdown; best skill written next to it
  as `<name>.trained.md`), `tasks` (JSONL of {id, description?,
  payload?}), `runner.command` (shell template with {{SKILL_FILE}},
  {{TASK_ID}}, {{TASK_PAYLOAD}}, {{WORK_DIR}}; stdout must END with a
  {"hard", "soft", "trajectory", "failReason"?} JSON object — the LAST
  balanced JSON object is parsed; `runner.timeoutSeconds` default 900),
  `model` (openai/anthropic HTTP clients or a `command` template with
  {{PROMPT_FILE}}/{{SYSTEM_FILE}} for `claude -p`-style CLI auth;
  command models also get a 900s default timeout), and `train`
  (epochs/batchSize/seed/splitRatio/splitOverride/gateMetric/editBudget/
  minEditBudget/scheduler/stateFile/concurrency).
- Behavior contracts: first invalid config field is NAMED and the CLI
  exits 2 (ordered validation, unknown keys rejected); `--dry-run`
  validates, prints the plan (split sizes, steps, invocation upper
  bounds) and makes zero runner/model invocations; placeholder values
  are always single-quote shell-escaped (payloads with quotes/spaces/
  `$()` pass through literally); non-zero exit / timeout / bad stdout
  throw into the library's AIMP-001.1 retry+containment; an existing
  state file is refused without `--resume`; completion writes
  `<state>.summary.json` and prints a compact summary. Runtime failures
  exit 1.
- `docs/requirements/AIMP-002-cli.md` (RFC 2119, AIMP-001.8 governance
  unchanged): .1 command surface, .2 config validation, .3 dry run,
  .4 runner command contract, .5 placeholder substitution, .6 zero
  runtime deps + governance. `.deepreview` pinned_test_amendment rule
  generalized from AIMP-001-specific wording to any AIMP doc.
- Tests: 83 -> 135 (+52) across test/cli-config.test.ts,
  cli-shell.test.ts, cli-runner.test.ts, cli.test.ts (+ cli-helpers.ts
  fixture builder). 20 of them carry AIMP-002 pins. End-to-end test
  drives runCli in-process with a stub node runner (scores 0.9 when the
  skill contains MAGIC, else 0.4) and a stub model command that always
  proposes the same add-edit; asserts the accept, the trained skill
  file, and the summary JSON. Also verified the BUILT `dist/cli.js`
  manually against a scratch fixture: dry-run, full accept run, exit
  codes 0/2 all correct.

Design notes / lessons:

- Public API unchanged: the CLI composes already-exported pieces.
  `extractLastJsonObject` was added to `src/json.ts` but deliberately
  NOT re-exported from `index.ts` — package `exports` only exposes ".",
  so it stays internal.
- A constant model-command response (a bare edits JSON array) satisfies
  reflect, merge, AND select, because all three parse with
  parseEditsResponse and merge/select skip their model call when the
  edit set already fits — handy for stubs and smoke tests.
- One test-authoring gotcha: asserting `$()` non-execution by checking
  stdout does NOT contain the inner word is wrong — the literal
  unexpanded text contains it. Assert the unexpanded `$(echo pwned)`
  substring is present instead.

Deliberately left out (curation): init/scaffolding, YAML config,
per-rollout (vs per-task) skill temp files, progress UI, any second
command. State: 135 tests green, typecheck clean, build clean. Local
commits only; nothing pushed (repo now has a GitHub remote — untouched).
