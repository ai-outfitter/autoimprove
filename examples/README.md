# Examples

## train-word-transform.mjs

The complete loop in ~60 lines against a toy task: the agent must learn to
answer with the input word reversed, uppercased, and bracketed, but the
seed skill only says "reverse the word". The optimizer has to induce the
missing rules from failure trajectories, and the validation gate has to
confirm they generalize.

Runs real model calls through the `claude` CLI (both the target agent and
the optimizer), so it needs the CLI installed and authenticated. Cost is
a few cents; takes a few minutes.

```
npm run build
node examples/train-word-transform.mjs
```

Expected shape of a run: a low baseline, then one gate-accepted edit that
adds the full transformation procedure to the skill, exit code 0. Exact
scores vary run to run; the accept behavior is the stable part.

## cad-skill

An Outfitter v1 `cad` profile with two responsibilities kept separate:

- `generate-replicad-cad` is the trainable skill. It writes Replicad models for
  boxes, cubes, spheres, and named multi-part assemblies.
- `self-improve-cad` owns the maintenance procedure. It runs Autoimprove,
  evaluates the candidate, and lets a deterministic promotion gate update the
  generation skill.

The evaluator is a pinned, attributed Replicad/OpenCascade.js port of the
[CADTestBench](https://github.com/dimitrismallis/CADTestBench) schema and
PR/RS metrics, not an unmodified run of its Python/CadQuery harness. It ports
official sample `00003247` (a rectangular prism with 13 CADTests) and labels
the cube, sphere, parametric, and named-assembly cases as local extensions.

The target prompt and temporary work directory contain one public example. After
generation, the verifier reuses the same `build(spec)` implementation with
evaluator-only parameter probes and measures the resulting B-reps: OpenCascade
validity, topology, bounds, volume, area, center of mass, geometry types,
boolean IoU, mesh integrity, and pairwise assembly distance/interference. The
probes are withheld from the ordinary target flow, not an adversarial secrecy
boundary: a trusted same-host agent could deliberately inspect this checkout.

Use Node 22.19 or newer. Install Outfitter v1 and the isolated Replicad runtime,
then validate the profile:

```
cd autoimprove
npm ci
npm run build
git clone https://github.com/ai-outfitter/outfitter.git ../outfitter-v1
git -C ../outfitter-v1 checkout b4ee211dbe84a8d462485e892c6a6c21cd83ae07
npm --prefix ../outfitter-v1 ci
npm --prefix ../outfitter-v1 run build
npm --prefix ../outfitter-v1/code/cli link
cd examples/cad-skill
npm ci
npm test
npm run dry-run
cd ../..
outfitter validate --strict
```

Run the maintenance skill through the profile:

```
GITHUB_RUN_ID=local GITHUB_RUN_ATTEMPT=1 CAD_IMPROVE_TRIALS=3 \
outfitter run cad --harness pi -- --print \
  'Use $self-improve-cad to run one measured improvement cycle with 3 trials.'
```

For development, invoke the deterministic training entrypoint directly:

```
cd examples/cad-skill
npm run train -- --trials 3 --run-id local-001
```

Both target and optimizer model calls resolve the copied Outfitter v1 `cad`
profile by default. Override either with a JSON argv array for fixtures or a
different stdin-driven harness:

```
CAD_TARGET_COMMAND_JSON='["my-agent","--print"]' \
CAD_OPTIMIZER_COMMAND_JSON='["my-agent","--print"]' \
npm run train -- --trials 3 --run-id alternate-harness
```

Held-out evaluation is repeated (three trials by default). Every run records
PR, RS, invalid percentage, B-rep validity, category accuracy, B-rep IoU,
geometric errors, parametric pass rate, and separate model/assembly slices.
The candidate is promoted only when RS improves by at least one percentage
point while PR, invalidity, and both slices do not regress. Aggregate history
is committed under `examples/cad-skill/metrics/`; raw trajectories remain ignored under
`examples/cad-skill/.autoimprove/`.

The scheduled workflow runs the profile weekly, pushes a long-lived automation
branch, and opens or updates a draft PR. It requires `OPENAI_API_KEY`. A
dedicated fine-grained bot token is
recommended in the `OUTFITTER_BOT_TOKEN` secret so workflow pushes trigger
normal CI; `GITHUB_TOKEN` is the fallback.

Generated model source is executable code. The example constrains Node
verifiers with Node's permission model, strips checkout and workflow locators
from nested command environments, and keeps candidates outside the repository,
but it is not a hardened multi-tenant sandbox. API credentials remain available
to the configured model harness, and same-host filesystem access is not a
security boundary. Use only target and optimizer commands you trust; use a
container or VM for hostile candidates. Pass `--resume` with the same run id to
continue an interrupted cycle, or `--keep-workdirs` to retain task sandboxes for
debugging.
