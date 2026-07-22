---
name: self-improve-cad
description: Run the repository's deterministic Autoimprove training, held-out CADTest evaluation, and promotion gate for the Replicad skill. Use for scheduled CAD maintenance, benchmark runs, or requests to improve the skill from measured single-model and assembly performance.
---

# Self Improve CAD

Run exactly one bounded improvement cycle. The training command owns candidate
generation, repeated evaluation, metric history, and promotion.

1. Require `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, and a positive integer
   `CAD_IMPROVE_TRIALS` supplied by the workflow.
2. Run:

   ```bash
   npm --prefix examples/cad-skill run train -- \
     --run-id "$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" \
     --trials "$CAD_IMPROVE_TRIALS"
   ```

3. Read `examples/cad-skill/metrics/latest.json` and report the baseline and
   candidate PR, RS, invalidity, and the single-model and assembly slices.
4. Report whether the deterministic gate promoted the candidate. A successful
   run may update only these tracked files:

   - `.agents/agents/cad/skills/generate-replicad-cad/SKILL.md`
   - `examples/cad-skill/metrics/history.jsonl`
   - `examples/cad-skill/metrics/latest.json`

   Resumable state and raw evidence may be written only below the ignored
   `examples/cad-skill/.autoimprove/<run-id>/` directory.

Do not interpret the scores and copy a candidate manually. Do not modify tasks,
tests, metric code, tolerances, or promotion rules. Do not commit, push, or open
a pull request. If training or evaluation fails, leave the canonical skill
unchanged and return the failure.
