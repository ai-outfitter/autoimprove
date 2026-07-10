# AIMP-002: CLI

## Overview

The autoimprove CLI is a deliberately thin shell around the library's
`train()` loop: exactly one command (`autoimprove train --config <path>`),
a JSON config file, a shell-command task runner, and a shell-command or
HTTP optimizer model. It exists so a host can train a skill without
writing TypeScript; the library story stays primary. This document states
the normative obligations of that surface: the single-command curation
rule, named-field config validation, dry-run isolation, the
runner-command stdout contract, shell-escaped placeholder substitution,
and the continued zero-runtime-dependency guarantee.

Scope: `src/cli.ts`, the `src/cli/` modules, and the `bin` packaging
entry. The training loop itself, failure containment, gate integrity, and
package self-containment are governed by AIMP-001 and are not restated
here except where the CLI binds to them.

Amendment rules: requirements here are pinned by tests carrying a
traceability comment, exactly as in AIMP-001. Amend this document FIRST —
in the same change or an earlier one — before modifying any pinned test.
AIMP-001.8 governs this document unchanged (see AIMP-002.6).

## Requirements

### AIMP-002.1: Command Surface

1. The CLI MUST expose exactly one command, `train`; invoking it with any other command word, or with none, MUST print usage and exit with code 2.
2. The `train` command MUST accept exactly three flags beyond `--help`: `--config <path>` (REQUIRED), `--resume`, and `--dry-run`; an unknown flag MUST print usage and exit with code 2.
3. The CLI MUST NOT add init, scaffolding, plugin, or any second command.

### AIMP-002.2: Config Validation

1. A config validation failure MUST name the first invalid field (for example `runner.command` or `model.provider`) in the error message and MUST exit with code 2, before any runner or model invocation.
2. Relative paths in the config file (`skill`, `tasks`, `train.stateFile`) MUST be resolved against the config file's directory.
3. A config whose tasks yield an empty training or validation split MUST fail validation with exit code 2 rather than surfacing mid-run.

### AIMP-002.3: Dry Run

1. `autoimprove train --dry-run` MUST make zero model invocations and zero runner invocations.
2. A successful dry run MUST print the plan — task count, split sizes, step count, model description, and estimated invocation counts — and exit with code 0.

### AIMP-002.4: Runner Command Contract

1. The runner command's stdout MUST be parsed by extracting the LAST balanced JSON object; any text before, between, or after JSON objects MUST be ignored.
2. A runner command that exits non-zero, exceeds `runner.timeoutSeconds` (default 900), or yields no parseable result object MUST be treated as a task-runner failure subject to AIMP-001.1 containment (one retry, then a `{hard: 0, soft: 0}` result carrying an `error` field); it MUST NOT abort the training run.
3. The parsed result object MUST provide `hard` as 0 or 1, `soft` as a finite number, and `trajectory` as a string; a result violating this shape MUST be treated as a runner failure per AIMP-002.4.2.
4. Every runner invocation MUST receive a fresh work directory as `{{WORK_DIR}}` containing the current skill text written to the `{{SKILL_FILE}}` path.

### AIMP-002.5: Placeholder Substitution

1. Values substituted for placeholders in command templates MUST be shell-escaped so that quotes, spaces, `$(...)`, and other shell metacharacters in values (task payloads in particular) are passed to the command literally, never interpreted by the shell.
2. A command template containing an unrecognized placeholder MUST fail config validation with the template's field named and exit code 2.
3. `runner.command` MUST contain the `{{SKILL_FILE}}` placeholder, and `model.command` (when `model.provider` is `command`) MUST contain the `{{PROMPT_FILE}}` placeholder; a template missing its required placeholder MUST fail config validation with exit code 2.

### AIMP-002.6: Zero Runtime Dependencies and Governance

1. The CLI MUST NOT add any runtime dependency: AIMP-001.2.2 continues to bind with the CLI included, config parsing MUST use JSON via built-ins, and argument parsing MUST be hand-rolled or use `node:util`.
2. CLI source modules (`src/cli.ts`, `src/cli/*`) MUST import only from `node:` built-ins and this package's own modules.
3. Tests validating requirements in this document MUST carry the AIMP-001.8.1 traceability banner referencing the AIMP-002 requirement id, and the amendment rules of AIMP-001.8 SHALL apply to this document unchanged.
