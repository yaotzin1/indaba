# Plan: run-readiness

> Stage 3. The contract is `api-surface.md`; the decisions are `spec.md` section 8 (confirmed by the maintainer on 2026-11-20).

Pure first, I/O second, front ends last, in three pull requests.

## Slices

| PR | Holds | Acceptance criteria |
| :--- | :--- | :--- |
| 1 | `@indaba/core` (types, `analyzeReadiness`), `@indaba/engine` (`requires` parser and schema, the real probe, `ReadinessChecked` span event), `indaba` (`plan`, `run`, `--confirm`) | AC-01, 02, 04 to 12 (CLI part), 14 to 17 |
| 2 | `@indaba/tui`: the report in the start confirmation, a key to confirm | AC-12 and 13 (TUI), 15 |
| 3 | `@indaba/server` (the two routes), `@indaba/web` (start dialog, confirm buttons) | AC-12 and 13 (web), 15 |

**AC-03 (input checks) is deferred.** `workflow-inputs` is not implemented. `analyzeReadiness` keeps its `inputs` parameter
(an empty map today) so the signature does not change when that spec lands; the `input` kind is in the union and produced by nothing.
The deferral goes in `review.md` and in the dependency map.

## Decisions taken at stage 3

1. **Inferred secrets come from a table, not from the runner contract.** The spec forbids a new runner contract (section 4), and a
   `Runner` does not say which variables it reads. `@indaba/engine` holds a small table: `openrouter` reads `OPENROUTER_API_KEY`;
   an OpenAI-compatible endpoint reads the variable named by its `INDABA_OPENAI_COMPAT_<NAME>_KEY_ENV`; `acp` reads the names in
   `INDABA_ACP_PASS_ENV`. Agent CLIs that sign in on their own (claude-code, codex) get no `secret` item: Indaba cannot know. A
   plugin runner adds its own through the probe (C-06).
2. **The snapshot is a span event, not a new trace record.** `RunRecord` is the wire union of `<traceId>.events.jsonl`; a new
   `type` would reach every reader. The run span gets one event `indaba.readiness` with the attributes `indaba.readiness.items` (one JSON text of `[id, state]` pairs, because span attributes are scalars), `indaba.readiness.critical_missing` and `indaba.readiness.needs_confirmation`, also set on the run span. Ids contain names and never values (AC-17).
3. **Confirmations travel on the start request.** `StartRunRequest` (web contract, `@indaba/core`) gets `confirmed?: readonly string[]`;
   the CLI maps `--confirm <id>` to the same list. The engine receives them as the `confirmed` set of `analyzeReadiness`.
4. **`requires` of kind `tool` and the `runner` item use the same `hasExecutable`**, a directory scan of `PATH` with `PATHEXT` on
   Windows; a `.cmd` or `.bat` match is reported *missing* with the native-executable message (spec section 5).
5. **The probe never throws out of the analysis.** `analyzeReadiness` wraps each probe call; a throw makes that item `unknown`.

## Order inside PR 1

1. `@indaba/core`: `attention.ts`, `readiness.ts`, `Requirement` and `WorkflowDefinition.requires`, exports.
2. `@indaba/engine`: parser and validator for `requires` (AC-07 to 09), schema and catalog text, the probe, the `runner` table, the span event.
3. `indaba`: a `readiness-report.ts` formatter (plain words, ordered), `plan` section, `run` warning, `--confirm`, help text.
4. Docs, changelog, dependency map, `review.md`.

## Test layers

| Layer | Where | Covers |
| :--- | :--- | :--- |
| pure | `core/test/readiness.test.ts` | every kind in every state with a fake probe; order (AC-10); same input, same list; a throwing probe gives `unknown`; the serialised report never contains the fake secret value or its length |
| parser | `engine/test/requires.test.ts` | AC-07 to 09: lengths, unknown key names its path, absolute and `..` file names refused |
| probe | `engine/test/readiness-probe.test.ts` | a temporary folder: file, directory, missing, symlink out (skipped where symlinks need a privilege), `PATH` scan with a `.cmd` shim, env set and empty |
| cli | `cli/test/readiness-report.test.ts`, `plan.test.ts`, `run.test.ts` | the section in `plan`, the warning in `run`, the run still starts with a critical item missing, exit codes unchanged, `--confirm` |
| layers | the existing `architecture.test.ts` and `layers.test.ts` | core imports no `node:` |

## Risks

- `PATH` on Windows is `Path` in some environments: the probe reads the key case-insensitively from the injected env, not `process.env`.
- Ids must be stable across recomputation or a `--confirm` is lost; the id test pins the format `<kind>:<stepId or ->:<name>`.

## Stage 5: analysis

| Question | Result |
| :--- | :--- |
| A published signature broken? | No: additive only. Stage 5 fixed names in `api-surface.md` that did not exist (`Workflow` is `WorkflowDefinition`; `StartRequest` is `StartRunRequest`; `RunRecord` is the trace wire union and stays unchanged) |
| A `node:` import or I/O in core? | No: `analyzeReadiness` is pure and reads through `ReadinessProbe` |
| A new runtime dependency? | None |
| Untrusted data to a shell, path or log? | `requires.name` of kind `file` is confined at parse time and again by the probe; `PATH` is scanned, no `which`; `description` and `how` are sanitised by the front end |
| Clock, randomness or environment in decision logic? | None: env and `PATH` come from the injected probe |
| Unbounded loop or buffer? | `description` 300 and `how` 500 characters; one item per step, variable and requirement |
