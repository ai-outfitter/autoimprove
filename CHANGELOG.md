# Changelog

## 0.1.0 (unreleased)

Initial implementation.

- Core training loop: rollout → reflect (failure/success minibatches) →
  bounded add/delete/replace edits under a per-step budget ("textual
  learning rate", constant and cosine schedulers) → merge and select →
  strict-improvement validation gate with a rejected-edit buffer fed back
  to reflection as negative context.
- `train()` orchestrator: seeded deterministic splits and shuffles
  (test split never touched), resumable JSON state, per-step records,
  token accounting, AbortSignal support, `splitOverride` for pinning
  exact split membership.
- Failure containment: task-runner failures retry once, then score
  `{hard: 0, soft: 0}` with a visible `error` field and a logger warning.
- `OpenAICompatClient` / `AnthropicCompatClient`: fetch-based model
  clients with one constructor shape; any object with a conforming
  `complete()` works as a `ModelClient`.
- All optimizer prompts embedded as TypeScript constants; defensive JSON
  parsing throughout; zero runtime dependencies.
- Formal requirements in `docs/requirements/AIMP-001-core-loop.md`
  (RFC 2119) with requirement-pinned tests and `.deepreview` enforcement.

## 0.0.1 — 2026-07-08

npm name reservation; no functionality.
