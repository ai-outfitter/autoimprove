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
