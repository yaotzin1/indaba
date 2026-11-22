# Plan: Explaining a plan

Stage 3. Section 8 of [`spec.md`](spec.md): C-01 to C-07 are confirmed by the maintainer and C-08 was adopted at his suggestion (2026-11-22).
Nothing is left open.

## Modules touched

| File | Change |
| :--- | :--- |
| `packages/core/src/workflow/explain.ts` (new) | `PlanExplanation`, `ExplainedStep`, `ExplainedSetting`, `SettingKey`, `Origin`, `OriginMap`, `ExplainedGap`, `GapCode`, `ExplainFacts` and `explainPlan` (AC-02 to AC-08). Pure: it imports only `@indaba/core` itself and reuses `resolvePermissions`, `effectiveLevel`, `runnerChain` and the permission wording table that `agent-permissions` already has |
| `packages/core/src/mesh/consensus.ts` | export `DEFAULT_MAX_ROUNDS` and use it in the constructor; no behaviour change (C-07) |
| `packages/core/src/index.ts` | export the new symbols |
| `packages/engine/src/engine/chain.ts` and the file that holds the timeout and retry resolution | export the functions the explanation must share with the run (`effectiveGuards` is already in this file); the run keeps calling them (AC-04, AC-14) |
| `packages/engine/src/editor/origins.ts` (new) | `readOrigins(source, workflow)`: parse the document with a `LineCounter` as `parser/diagnose.ts` does, and for each setting say whether the step, its role or `defaults` wrote it, at which line and column (AC-03, AC-12) |
| `packages/engine/src/index.ts` | export `readOrigins` |
| `packages/cli/src/plan-explain.ts` (new) | `renderExplanationText` and `renderExplanationJson`; sanitising of file text; the fixed key order (AC-09, AC-10) |
| `packages/cli/src/main.ts` | parse `--explain` and `--json` for `plan`; call `explainPlan` with the facts the composition root holds (runner defaults, `--timeout`, the parallel limit and its source, `INDABA_PARALLEL`, `indaba.config`); usage text; exit code unchanged (AC-01, AC-13) |
| `packages/cli/src/permission-report.ts` | export the table of runner-default wording and the note words, so the gap and the existing report use one source (AC-05) |
| `docs/workflow-format.md` or the `plan` page, `docs/`, `README.md` if it lists commands, `llms.txt` if it lists options | the two options and the JSON contract |
| `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md` | entry under Unreleased; a row for `plan-explain` and the dashed edge to nothing (it waits for no spec) |
| `packages/*/test/**` | tests listed in `tasks.md` |

## Where the behaviour lives

Questions of `.agents/rules/architecture.md`, section 3:

- **Is it a decision about what a step means?** Yes: which value is in force and which gap is true. That is pure and goes to
  `@indaba/core`, with every fact it cannot hold passed in through `ExplainFacts` (the clock and the environment are not read;
  AGENTS.md, Determinism).
- **Does it touch a file, a process or the environment?** Reading the YAML source for lines is a file concern: `@indaba/engine`.
  Reading `--timeout`, `INDABA_PARALLEL` and `indaba.config` is the composition root's: `indaba`, which already reads them for `plan`.
- **Does a front end need it?** Yes, later: the web view, the TUI and the workflow assistant take the JSON of AC-10 and render it
  with their own words (the front end owns its words, as `agent-permissions` C-10 says). Nothing here imports a UI package.

Layer that wins: the pure domain for the rules, the engine for lines, the console for words and options.

## Trade-offs taken

- **Origins by a second read of the document** (C-02), not by recording them in the parser. Cost accepted: the file is read twice
  for `plan --explain`. Reason: `StepDefinition` stays unchanged, so no consumer who builds one is broken.
- **Gaps are facts and do not fail `plan`** (C-03). Cost accepted: a person can ignore them. Reason: a short valid file must not
  become a failing one.
- **Sharing the engine's resolution instead of re-implementing it** (AC-04). Cost accepted: some private functions are exported
  from `@indaba/engine` as a minor. Reason: a second copy of a default is the exact drift this feature exists to remove.
- **`fallback`, not `default`, and `workflow_defaults`, not `defaults`** (C-08). Cost accepted: two long names in JSON. Reason: two
  kinds that differ by one letter are misread and mistyped.
- **A fixed order of settings and keys** (AC-08, AC-10). Cost accepted: a new setting is added at a defined place, not where it
  reads best. Reason: byte-identical output for the same file.

## Risks

| Risk | Mitigation |
| :--- | :--- |
| the explanation and a run disagree after a later change to a default | AC-14 test: for each step of the example workflows, the explanation equals what `StepExecutor` resolves; the shared functions are the only source |
| a gap sentence claims more than the engine knows | AC-06: sentences are written from the facts in `ExplainFacts`; a runner that declares nothing gives `unknown`; a review item checks each sentence against its source |
| line numbers are wrong for a YAML construct the line counter handles oddly (anchors, merge keys, flow style) | `readOrigins` falls back to an origin without a line rather than a wrong line; tests with anchors, flow mappings, multi-document files and CRLF |
| untrusted file text reaches a terminal | the sanitizer of the event stream is used for every string from the file; a hostile-input test builds the escape sequences from fragments (security audit) |
| the JSON becomes a de-facto API that is hard to change | `schema` and `version` in the output; readers told to ignore unknown keys and unknown `origin.kind` values; additive changes are minors |
| `readOrigins` disagrees with the parser about which layer a permissions block came from | it is tested against `resolvePermissions` over every combination of step, role and `defaults` (written, absent, empty) |

## Out of scope for this change

- Printing the explanation at the start of `run` (C-05).
- A web or TUI screen; they read the JSON in later specs.
- Presets and `indaba init`; `preset` is only a reserved name here (C-04).
- Any change to a default or to what a run does.
- Price or token estimates.
