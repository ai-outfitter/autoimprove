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
