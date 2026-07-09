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
