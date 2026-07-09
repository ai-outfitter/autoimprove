# AIMP-001: Core Training Loop

## Overview

autoimprove is an embeddable SkillOpt-style training loop: it treats a
markdown skill document as the trainable parameter of a frozen agent,
proposes bounded edits with an optimizer model, and accepts candidates
only when they strictly improve a held-out validation score. This
document states the normative obligations of that loop, extracted from
the library's design principles (README, project-plan.md, and module
documentation). It covers failure containment, self-containment, gate
integrity, bounded edits, determinism and resume, defensive parsing,
and the model-client contract.

Scope: the runtime behavior of the published `autoimprove` package
(`src/`), its packaging (`package.json`), and the governance of the
tests that pin these requirements. Host-side concerns (task runners,
agent harnesses, publishing workflow) are out of scope.

Amendment rules: requirements here are pinned by tests carrying a
traceability comment. Amend this document FIRST — in the same change or
an earlier one — before modifying any pinned test. See AIMP-001.8.

## Requirements

### AIMP-001.1: Failure Containment

1. `runRollout` MUST retry a task-runner rejection exactly once before treating the task as failed.
2. A task whose runner rejects on both attempts MUST produce a result scored `{hard: 0, soft: 0}` that carries a machine-readable `error` string field describing the failures, AND `runRollout` MUST emit a logger warning for that task; the two signals are REQUIRED together.
3. A retry that succeeds MUST produce a normal result with no `error` field and no warning.
4. Infrastructure failures MUST NOT be silently indistinguishable from genuine zero scores; every errored result MUST remain identifiable via its `error` field wherever results are surfaced.
5. The validation gate MUST emit a logger warning when errored results contribute zero scores to the gate metric.
6. Reflection prompts MUST label errored results as infrastructure errors so the optimizer does not treat their scores as meaningful evidence.

### AIMP-001.2: Self-Containment

1. All optimizer prompts MUST be embedded as TypeScript constants in `src/prompts.ts`; the library MUST NOT load prompt text from loose files at runtime.
2. The published package MUST NOT declare any runtime dependency: `package.json` MUST NOT contain a `dependencies` or `peerDependencies` entry.
3. The npm `files` allowlist MUST contain only `dist`, `README.md`, and `LICENSE`, so no loose prompt or data files can ship or be required at runtime.

### AIMP-001.3: Gate Integrity

1. The gate MUST evaluate the candidate skill on the held-out validation split, never on training data.
2. A candidate skill MUST be accepted only on STRICT improvement of the gate metric over the baseline score (`candidate > baseline`).
3. A tie between candidate and baseline scores MUST be rejected.
4. A regression below the baseline score MUST be rejected.
5. When the gate rejects a candidate, `train()` MUST add the applied edits to the rejected-edit buffer, capped at `rejectedBufferSize` entries with the oldest dropped first.
6. Subsequent reflect calls MUST receive the rejected-edit buffer as negative context in their prompts.

### AIMP-001.4: Bounded Edits

1. `applyEdits` MUST apply a `delete` or `replace` edit only when its `target` matches exact existing text in the evolving skill.
2. `applyEdits` MUST skip any edit it cannot apply (missing fields, no exact match, no-ops, unknown ops) and MUST record a reason for each skipped edit.
3. `applyEdits` MUST NOT throw for any list of `SkillEdit` inputs.
4. `selectEdits` MUST return at most the step's edit budget of edits, even when the optimizer response contains more.
5. The number of edits applied in a `train()` step MUST NOT exceed the scheduler's edit budget for that step.
6. Built-in schedulers MUST return an integer budget of at least 1 at every step.

### AIMP-001.5: Determinism and Resume

1. Task splits MUST be reproducible from the seed: the same tasks, ratio, and seed MUST yield identical train/val/test assignments.
2. Per-epoch training shuffles MUST be derived from the seed so a resumed run replays the same batch order.
3. `train()` MUST NOT run test-split tasks through the runner; the test split is never evaluated or trained on.
4. `train()` MUST refuse to resume (throw) when the state file was written with a different seed than the current run.
5. A state file that is not valid JSON or has an unexpected shape MUST produce a logger warning and a fresh run; it MUST NOT crash the run or silently diverge.
6. When a `stateFile` is provided, `train()` MUST persist state after every completed step, and completed steps MUST NOT be re-executed on resume.
7. An explicit split override MAY be supplied (`TrainOptions.splitOverride`: task ids for train/val/test). When supplied, it MUST be honored verbatim — exact membership and order, bypassing ratio splitting; an override that lists a task id with no matching task, or lists the same id more than once, MUST throw rather than silently drop or invent tasks; and the test split MUST still never be evaluated (AIMP-001.5.3 applies unchanged).

### AIMP-001.6: Defensive Parsing

1. `parseEditsResponse` MUST return an empty edit list for unparseable or invalid optimizer output and MUST NOT throw.
2. `reflect` MUST degrade a failed or unparseable optimizer response to zero edits for that minibatch rather than throwing mid-loop.
3. `mergeEdits` MUST fall back to the input edits unchanged when its optimizer call fails or returns an unparseable response.
4. `selectEdits` MUST fall back to the first `budget` input edits when its optimizer call fails or returns an unparseable response.

### AIMP-001.7: Client Contract

1. Both bundled clients (`OpenAICompatClient`, `AnthropicCompatClient`) MUST accept a constructor options object of shape `{baseUrl, apiKey, model, headers?}`.
2. Any object with a conforming `complete(request)` method MUST be usable as a `ModelClient`; the library MUST NOT require inheritance from a bundled class.

### AIMP-001.8: Requirements Governance

1. Tests that validate a requirement in this document MUST carry a two-line traceability comment immediately before the test: `THIS TEST VALIDATES A HARD REQUIREMENT (AIMP-001.M).` followed by `YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.`
2. A pinned test MUST NOT be modified unless this document is amended first, in the same change or an earlier one.
3. Requirement IDs in this document MUST NOT be renumbered or reassigned once they are referenced by tests or review rules.
4. Every numbered requirement in this document MUST use at least one RFC 2119 keyword.
