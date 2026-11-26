# Tasks: Explaining a plan

Ordered by dependency. Domain first, infrastructure second, console and documentation last. Each task independently checkable.
The acceptance criteria are those of [`spec.md`](spec.md). Delivered in two pull requests: PR 1 is T-01 to T-09 (nothing a person
can run yet), PR 2 is T-10 to T-17.

PR 1

## Domain

- [x] **T-01** `@indaba/core`: export `DEFAULT_MAX_ROUNDS` and use it in `ConsensusArbiter`; a test that the arbiter with no option and with the constant behave the same (C-07).
- [x] **T-02** `@indaba/core`: the types of `workflow/explain.ts` (`Origin`, `OriginMap`, `SettingKey`, `ExplainedSetting`, `ExplainedGap`, `GapCode`, `ExplainedStep`, `PlanExplanation`, `ExplainFacts`) and their exports (AC-02, AC-03, AC-08).
- [x] **T-03** `@indaba/core`: `explainPlan` for settings: the chain of a step's runners, permissions, write scope, isolation, timeout, stall, `on_failure`, guards, `mcp_policy`, and for a debate `decision_type`, `arbiter` and rounds; the right origin for each; kinds that do not apply are left out (AC-02, AC-03, AC-07).
- [x] **T-04** `@indaba/core`: `explainPlan` for gaps: `no_permission_level`, `no_write_scope`, `no_check_on_result` with `mitigatedBy` from the dependency order, `failure_stops_run`, `full_access`; wording taken from the shared table; `unknown` with a reason where a fact is missing (AC-05, AC-06).
- [x] **T-05** `@indaba/core`: tests for T-03 and T-04: every setting and gap, true and false; the order of steps and settings; a step with its own, a role's and a `defaults` block; a debate; a shell step; no value invented; no secret, input value or goal in the result (AC-06, AC-08, AC-11).

## Infrastructure

- [x] **T-06** `@indaba/core` and `@indaba/engine`: move the pure resolvers the explanation shares with the run (`effectiveGuards` and the timeout and retry resolution) into `@indaba/core`, import them in the engine, and make the run call the same function (core cannot import the engine); tests unchanged and green (AC-04).
- [x] **T-07** `@indaba/engine`: `readOrigins(source, workflow)` with line and column; origin of permissions by step, role, `defaults`; a missing line instead of a wrong one (AC-03, AC-12).
- [x] **T-08** `@indaba/engine`: tests for T-07 against `resolvePermissions` for every combination of written, absent and empty blocks; anchors, merge keys, flow style, CRLF, a multi-document file (AC-03, AC-12).
- [x] **T-09** `@indaba/engine`: a test that, for every workflow in `examples/`, the explanation equals what `StepExecutor` resolves for each step: permissions, write scope, isolation, timeout, retry bound, guards (AC-14).

PR 2

## Console

- [x] **T-10** `indaba`: export the runner-default wording and the note words from `permission-report.ts`; the existing permission report still prints the same text (AC-05).
- [x] **T-11** `indaba`: `renderExplanationText` (one block per step, origin at the end of a line, a mark and a sentence per gap, sanitised, `NO_COLOR` and `INDABA_ASCII` honoured, no meaning by colour alone) (AC-09).
- [x] **T-12** `indaba`: `renderExplanationJson` (`schema`, `version`, fixed key order, no timestamp, no absolute path, no environment value) (AC-10).
- [x] **T-13** `indaba`: `plan --explain` and `plan --json` in `main.ts` and the usage text; `--json` implies `--explain`; the facts from the flag, the variable and `indaba.config`; exit code as `plan` (AC-01, AC-13).

## Tests

- [x] **T-14** `indaba`: tests: `plan` without the options is byte-identical (snapshot of today's output for every example); `--explain` text; `--json` shape and stability (two runs equal); invalid file, missing input: stderr and exit code, empty stdout with `--json` (AC-01, AC-10, AC-13; spec section 5).
- [x] **T-15** Hostile-input tests: control characters and escape sequences in a step id, a role name and a path; a value that looks like a secret in a path; built from fragments so no test file trips the security audit (AC-09, section 6).
- [x] **T-16** Architecture tests still green (core imports nothing outside itself; the CLI layer test); `pnpm e2e` with an end-to-end `plan --explain --json` on a built CLI.

## Documentation

- [x] **T-17** `docs/` (the workflow format or plan page, the JSON contract and its stability rule), `README.md`, `llms.txt` if it lists options; `CHANGELOG.md` entry that replaces the specification-only one; `specs/DEPENDENCY_MAP.md` row (implemented) and the feature-to-package table; `review.md` filled after a real review.

## Stage 7: Verification

- [ ] `pnpm qa` and the node gates (`node scripts/check-workflow.mjs`) green end to end, output recorded in review.md
