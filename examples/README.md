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

A coding-agent example that trains a real `generate-basic-cad` skill against
four CAD backends: AnchorSCAD, Replicad, TSCAD, and scad-js. The initial task
surface stays small—cube, sphere, and a named two-part cube+sphere assembly—
while parameter variants create a 12 train / 8 validation / 12 test split.
Every backend has held-out coverage for all three model kinds, and the held-out
set is evaluated after `train()` returns.

Held-out scores are labeled as single-sample because coding-agent rollouts are
stochastic. If no edit is accepted, the example reuses one rollout for both
columns instead of presenting noise as a change.

There is no public package named OpenTsCad. This example records the explicit
assumption that “OpenTsCad” means the current TSCAD project and uses
`@tscad/modeling` under the `opentscad` backend id. It likewise normalizes
“AnchorCAD” to AnchorSCAD, using the `anchorscad-core` distribution under the
`anchorscad` backend id.

Install and build the zero-runtime-dependency core first, then install the CAD
runtimes in the isolated example package:

```
cd autoimprove
npm ci
npm run build
cd examples/cad-skill
npm ci
npm run setup:python
npm test
npm run dry-run
```

The AnchorSCAD setup uses `uv` to provision Python 3.12. AnchorSCAD Core 0.2.4
installs on the system's Python 3.14, but its renderer is not compatible with
that interpreter.

Run one backend first to reduce live-agent calls:

```
npm run train -- --backends replicad
```

Then run the complete matrix:

```
npm run train
```

The default target and optimizer commands use authenticated `codex exec`
processes. Override either command with a JSON argv array when another coding
agent CLI reads its prompt from stdin:

```
CAD_TARGET_COMMAND_JSON='["my-agent","--print"]' \
CAD_OPTIMIZER_COMMAND_JSON='["my-agent","--print"]' \
npm run train -- --backends scad-js
```

Each candidate must return backend-native part objects plus a combined preview.
The fixed verifier scores execution, artifacts, part names and primitive types,
world-space centers, per-part bounds, combined bounds, and native volume where
the backend exposes a stable measurement. Assemblies therefore retain
their two named instances; a fused mesh alone does not count as an assembly.

Generated model source is executable code. The example constrains Node
verifiers with Node's permission model, applies a Python audit guard, strips
the verifier environment, and keeps candidates outside the repository, but it
is not a hardened multi-tenant sandbox. Use only target and optimizer commands
you trust; use a container or VM for hostile candidates.

Training state and the resulting `SKILL.trained.md` are ignored by git. Pass
`--resume` to continue an interrupted run or `--keep-workdirs` to retain task
sandboxes under the system temporary directory for debugging.
