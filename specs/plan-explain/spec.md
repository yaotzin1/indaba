# Specification: Explaining a plan (`indaba plan --explain`, with `--json`)

> **Status**: Implemented (#171, #172); reviewed on 2026-11-27. Of the decisions that review added to section 8, C-10 to C-12 are settled; C-09 and C-13 await the maintainer.
> **Stage entry**: 1 to 4 written; section 8: C-01 and C-07 confirmed by the maintainer on 2026-11-22 (C-07 refined by what the code showed), C-08 added at his suggestion; C-02 to C-06 confirmed unchanged on 2026-11-22; C-01 to C-08 are settled; of C-09 to C-13, added by the review of 2026-11-27, C-10 to C-12 are settled and C-09 and C-13 await confirmation
> **Semver impact**: minor (two new optional options of `plan`, new optional exports; below 1.0). **No default changes**:
> `indaba plan` without the new options prints exactly what it prints today (but see C-13). Provisional; confirmed in [`api-surface.md`](api-surface.md).
> **Builds on**: [`specs/agent-permissions`](../agent-permissions/spec.md) (the permission report is the precedent for a
> fact computed before a run), [`specs/run-readiness`](../run-readiness/spec.md) (`AttentionItem`: a fact plus how to fix it),
> [`specs/step-stalls`](../step-stalls/spec.md) and [`specs/parallel-steps`](../parallel-steps/spec.md) (limits whose source
> Indaba already records), [`specs/workflow-editor`](../workflow-editor/spec.md) (the catalog and the descriptions).
> **Origin**: a discussion on 2026-11-22 about the cost of writing and reading workflow files. A workflow that passes
> `validate` can be six lines long; what a person cannot see before spending tokens is what those six lines mean.

---

## 1. The problem

A workflow file may be very short: `version`, `name` and one step with a `runner` and a `goal` or `commands` pass `validate`.
Everything else is a default, and the defaults live in four places: the engine, the runner, the command line and
`indaba.config`, and in one more for permissions, where a step's block, its role's block and `defaults` are tried in that order.
`plan` prints the order of the steps and a few facts, each in its own sentence at the end. A person who wrote six lines cannot
read from it, for one step: who writes, where it may write, what stops it, how many times it is run again, what counts as success,
and for each answer whether they wrote it or Indaba chose it.

That is the reason a short file feels like a black box: not the length of the YAML, but that the effective configuration exists
nowhere a person can look at before a run. It also stops two later things: a front end (the web view, the TUI, the workflow
assistant) cannot show the effective configuration without re-implementing the defaults, and a person cannot learn what an
optional field is for from a file that does not use it.

What is wanted: `indaba plan --explain` prints, for each step, the **effective value of each setting that decides what the step
may do and when it stops**, each with its **origin**, and names what is **not limited or not checked**. `--json` prints the same
facts as a stable structure.

## 2. User stories

- **US-01.** As a person with a short workflow file, before a run I see for each step who runs, where it may write, what
  permission it has, how it is stopped and run again, and how it counts as done.
- **US-02.** As a workflow author, I see for each value whether I wrote it (with the line), it came from the role or `defaults`,
  or Indaba chose it (and which part of Indaba), so I know what a line I add would change.
- **US-03.** As a person, I am told in plain words what a step does **not** have: no limit on which files it may change, no
  check on its result, and what already covers it if something does.
- **US-04.** As a developer building a front end or the workflow assistant, I read one structure per step and never copy a
  default into my own code.
- **US-05.** As a person in CI, I read the same facts as JSON, byte for byte the same for the same file and the same machine
  facts.

## 3. Acceptance criteria

Terms. A **setting** is one of the keys of AC-02. The **origin** of a setting says where its effective value comes from (AC-03).
A **gap** is a fact about what a step lacks (AC-05). An **explanation** is the data of AC-08; the text of AC-09 and the JSON of
AC-10 are two renderings of it.

- [ ] AC-01. **Options.** `indaba plan [file] --explain` prints the explanation as text after the order of the steps and before
  the closing readiness lines. `--json` prints the explanation as JSON and nothing else on stdout. `--json` without `--explain`
  is the same as with it (section 8, C-01). Without either option the output, the exit code and the error messages of `plan`
  are unchanged, byte for byte (but see C-13).
- [ ] AC-02. **Settings.** For each step the explanation gives, when the step has the setting at all, the effective value of:
  `runner` (the chain, in order), `permissions.level`, `permissions.fs.write` (what the step may change), `permissions.terminal`,
  `isolation`, `timeout_seconds`, `stall`, `on_failure` (action, target, `max_retries`), the guards in force (the step's own and the
  one a write scope adds), `mcp_policy`, and for a debate the `decision_type`, the `arbiter` and the number of rounds it is given. A setting that does not apply to
  the kind of step (a shell step has no permissions block; a shell step is not run again by a stall) is left out, not shown empty.
- [ ] AC-03. **Origin.** Every value carries one origin of these kinds: `file` (the step wrote it; with its line and column when the
  source is known), `role` (the step's role wrote it; the role's name and line), `workflow_defaults` (the workflow's `defaults` block wrote
  it; with its line), `fallback` (nothing in the file wrote it; `by` names who decided: `engine`, `runner:<name>`, `flag:<option>`,
  `env:<NAME>`, `config:<key>`, as `indaba.workflow.max_parallel.source` does), and `preset` (reserved, see C-04). A merged value
  (permissions are taken whole from the first block that has one, never merged) has the origin of the block it came from.
- [ ] AC-04. **No copy of a default.** Where a built-in value is shown, it is the value the engine or the runner would use, read
  from the same constant or function, not a second copy of the number or the sentence. A test fails when the explanation and the
  run disagree (section 7).
- [ ] AC-05. **Gaps.** The explanation names, per step, each of the gaps below that is true, each with a stable `code`, a sentence
  in plain words, and `mitigatedBy` (the ids of steps that already cover it, when any). A gap is a fact, never an error: it never
  changes the exit code (C-03).
  - `no_permission_level`: an agent step with no `level`; the sentence says what the runner's built-in default allows (the
    wording of `agent-permissions` AC-08, from the same table).
  - `no_write_scope`: an agent step that works in the project folder and has no write scope and no guard that limits what it
    changed: nothing says which files it may change.
  - `no_check_on_result`: a step with no guard of any kind (narrowed by C-12: not a shell step): it counts as done when its runner finishes without an error. If
    steps that depend on it, directly or not, include a shell step, their ids are listed in `mitigatedBy`; Indaba does not judge
    whether their commands check anything.
  - `failure_stops_run`: a step with no `on_failure`: a failure stops the run. Information, not a warning.
  - `full_access`: the level is `full`: the existing sentence of `agent-permissions`, from the same function.
- [ ] AC-06. **Nothing invented.** A gap or a value is reported only when it follows from the parsed workflow and the facts the
  runners and the configuration already give. Where Indaba cannot tell (a runner that declares no default; a limit no spec
  defines), the explanation says `unknown`, with the reason, and does not guess. No count or limit is stated that is not a value
  in the model or a constant of the engine.
- [ ] AC-07. **Retry bound.** For a step with `on_failure.retry_step` the explanation states the maximum number of times the target
  is run again, as `max_retries` says, and that each retry is isolated and carries only the last failure
  (`workflow-engine`). A step with a stall policy states its `retries` the same way. Where a step can be run again through two
  mechanisms the explanation lists both and does not add them (they are different counters).
- [ ] AC-08. **The data.** An explanation is a pure value of `@indaba/core` (`PlanExplanation`: `steps`, each an `ExplainedStep` with
  `id`, `kind`, `settings` and `gaps`), computed by a pure function from the parsed workflow, an origin map and the facts of the
  runners (section 7). It is deterministic: the same inputs give the same value; the order of steps is the order of `plan`; the
  settings of a step are in the fixed order of AC-02.
- [ ] AC-09. **Text.** The text rendering is one block per step under the step's line of `plan`, one setting per line, the origin at
  the end of the line (`<- file, line 6`, `<- fallback, claude-code`), and a mark and a sentence for each gap. It writes no
  control character or escape sequence from the file (the sanitizer of the event stream is used). `NO_COLOR` and `INDABA_ASCII`
  are honoured as everywhere else; meaning is never carried by colour alone.
- [ ] AC-10. **JSON.** The JSON rendering carries `schema: "indaba.plan-explain"` and `version: 1`, the workflow's name, and the
  steps as in AC-08. Keys are in a fixed order, there is no timestamp, no absolute path and no environment value. A new optional
  key is a minor change of the contract; renaming or removing one, or changing a meaning, is a major (a reader is told to ignore
  keys it does not know and `origin.kind` values it does not know).
- [ ] AC-11. **Inputs are not shown.** The value of a workflow input is never part of an explanation, and neither is a goal or a
  command's text beyond what `plan` already prints. Origins of `${{ inputs.x }}` references are not followed.
- [ ] AC-12. **Unknown source.** When the workflow is given without its source (an embedder that holds only the parsed value),
  `file`, `role` and `workflow_defaults` origins have no line and the explanation still works. With the source, the lines are those of the
  YAML document, found by reading the document, not by changing the parser (section 7).
- [ ] AC-13. **Exit code.** `plan --explain` exits as `plan` does: 1 where `plan` would fail (an error finding, an invalid file) and
  0 otherwise. With `--json` and an invalid file, stdout stays empty and the problems go to stderr, as today.
- [ ] AC-14. **Same answer as the run.** The effective permission level, write scope, isolation, timeout, retry bound and guards in
  an explanation equal those the engine uses for that step in a run of the same file (tested against `StepExecutor`'s own
  resolution, not against a copy).

## 4. Non-goals

- **No new defaults and no change to a default.** This feature shows what is; changing it is a major and a spec of its own
  (`AGENTS.md`, "Classify the semver impact").
- **No refusing to run.** A gap does not stop `plan` and cannot stop `run`; `run-readiness` already says why (C-04 of that spec).
- **No model, no network.** The explanation is computed from the file and the machine; nothing is sent anywhere.
- **No editing.** It suggests no change to the file and writes no file. Turning a gap into an edit is the editor's and the
  assistant's work, which read the same data.
- **No explanation inside `run`.** `run` keeps printing what it prints; showing the explanation at the start of a run is a later,
  separate decision (C-05).
- **No cost or token estimate.** No price table is applied and no number of tokens is predicted (`observability`: no invented
  numbers).
- **No web or TUI screen here.** They read the JSON contract in later specs.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the file is invalid | the same problems as `plan` today, on stderr, exit 1; with `--json` nothing on stdout |
| a runner cannot say what its default allows | the setting is `unknown` with the reason; no sentence is invented |
| the source text is unavailable (an embedder) | no lines in origins; everything else is the same |
| `--json` and `--explain` with an input that is missing | the same message and exit 2 as `plan` for a missing input |
| a plugin runner declares no facts | its steps show the settings that come from the file and `unknown` for the rest |
| output is closed early (a pipe) | the same behaviour as `plan`: no partial JSON is promised; the exit code is not changed |

## 6. Security and data handling

- The file, the role names, the step ids, the commands and the paths of a workflow are untrusted text. Everything printed as text
  goes through the sanitizer used for the event stream; JSON is escaped by the serializer. A value is never put into a shell, a
  path or a log line.
- No secret can appear: an origin names an environment variable by its name, never its value (`flag:` and `config:` name an
  option or a key, never its value where the value is a path or a key). `plan` already prints no value of `OPENROUTER_API_KEY`.
- Paths in `permissions.fs.write` are shown as written in the file, relative, as `plan` shows `diff_within_scope` today; no
  absolute path of the machine is printed.
- Input values and goals are not part of the output (AC-11).

## 7. Where it lives

| Part | Package | Kind |
| :--- | :--- | :--- |
| `PlanExplanation`, `ExplainedStep`, `ExplainedSetting`, `Origin`, `Gap`, and `explainPlan(...)`, the pure function that applies AC-02 to AC-08 | `@indaba/core` | pure domain; no `node:` import |
| the facts it needs and core cannot hold: what each runner's default allows, the run's `--timeout` and limits | read through contracts that already exist (`Runner` capabilities, `PermissionFacts`) and one new small read-only interface, `ExplainFacts` | contract in `@indaba/core` |
| `readOrigins(source, workflow)`: reads the YAML document with a `LineCounter`, as `diagnose` does, and says for each setting whether the step, its role or `defaults` wrote it, and at which line | `@indaba/engine` | infrastructure; the parser is not changed |
| the text rendering, the JSON rendering and the two options | `indaba` (the CLI) | composition root and rendering |

The explanation must use the run's own resolution (`effectiveGuards`, the permission chain, the timeout chain) and not repeat
it. `explainPlan` is in `@indaba/core`, which cannot import `@indaba/engine`, so exporting the engine's functions is not enough:
the pure resolvers move **into `@indaba/core`** (`effectiveGuards` already imports only core types and constants; the timeout
and retry resolution is moved the same way, or stays in the engine and reaches `explainPlan` as a value through `ExplainFacts`, one
choice per function, named in `api-surface.md` before stage 6). `@indaba/engine` imports them from core, so the run and the
explanation call one function, as a minor (AC-04, AC-14). *Proposed in a review on 2026-11-23, awaiting the maintainer's confirmation.* A runner a plugin registered takes part through the same contracts as a built-in one.

## 8. Clarifications

C-01 to C-08 are confirmed by the maintainer (2026-11-22), C-10 to C-12 on 2026-11-27. C-09 and C-13 are proposals that
await confirmation.

- **C-01. `--json` implies `--explain`. Confirmed 2026-11-22.** `plan` has no `--json` today, so nothing existing is broken.
  Two options that must be given together are a usage error waiting to happen. A person who asks for JSON of the plan gets the
  explanation, which is the only JSON `plan` has.
- **C-02. Origins by reading the document, not by changing the parser. Confirmed 2026-11-22.** The parser merges a role's and `defaults`'s permissions
  into the step and drops where they came from. Recording origins in the parser would change `StepDefinition`, a public type (a
  major for those who build it). Reading the YAML document again with a line counter, as `diagnose` does, adds nothing to the
  model. The cost is a second read of a file that is already in memory.
- **C-03. Gaps are facts, not findings. Confirmed 2026-11-22.** `plan` already fails only on errors. A gap that failed `plan` would turn a short, valid
  file into a failing one, which is the opposite of the aim.
- **C-04. `preset` is reserved, nothing emits it in this spec. Confirmed 2026-11-22.** A preset that `indaba init` writes into a file is `file` from then
  on, because the values are in the file. `preset` is for the day a workflow is run from a preset held in memory (no file), which
  needs its own spec. The contract names the kind now so a reader written today does not break then.
- **C-05. Not printed by `run`. Confirmed 2026-11-22.** `run` already repeats the full-access sentence at its start; adding a block there changes what a
  run prints (a major by the repository's rule for output a person reads). A later spec may print a short form.
- **C-06. What `no_check_on_result` does not claim. Confirmed 2026-11-22.** A later shell step may check the result well, badly or not at all, and the
  engine cannot tell. The gap says what is true (this step has no guard) and lists the steps that might cover it.
- **C-07. Debates. Confirmed 2026-11-22 as "honest `unknown` over an invented number"; refined by the code.** The number of rounds is
  not read from the workflow file or the command line. It is `ConsensusArbiter`'s constructor default, written inline
  (`options.maxRounds ?? 4`), and `StepExecutor` builds `new ConsensusArbiter()` unless an embedder passes its own arbiter. So the
  explanation shows the number for the default arbiter, with origin `fallback` by `engine`, **read from one exported constant**
  (`DEFAULT_MAX_ROUNDS`) that the arbiter itself uses (AC-04): not a second copy of `4`. An embedder who injects another arbiter
  supplies its bound through `ExplainFacts`; where it supplies none the value is `unknown`. Exporting the constant changes no
  behaviour.
- **C-08. Origin names that cannot be confused. Proposed by the maintainer 2026-11-22; adopted.** `defaults` and `default` differ by
  one letter and would be misread and mistyped in a filter. The kinds are `file`, `role`, `workflow_defaults` (the `defaults` block
  of the file), `fallback` (a value nothing in the file wrote; `by` says who chose it) and `preset` (reserved, C-04). The word
  `defaults` stays where it names the YAML block; it is no longer an origin kind.

**Added by the review of 2026-11-27.** C-09 to C-12 make the explanation equal to the run (AC-14) where the text above did
not say how; C-13 records a change to the output of `plan`. C-09 and C-13 await the maintainer's confirmation. For C-10 and
C-12 the maintainer rejected what the review first proposed (leaving the two settings out at `full`; reporting the gap
for shell steps too), and the text below replaces it.

- **C-09. A debate has one `runner` setting for each role that speaks.** The engine takes every participant's chain from its
  role, so one setting cannot carry the origin of each value (AC-03). A key can therefore repeat in a step. A `runner`
  written on a debate step is not shown because it is not used. A debate with no limit of its own is shown with the
  runners' default, because the run's `--timeout` does not bind it.
- **C-10. At `full`, `permissions.fs.write` is `unlimited` and `permissions.terminal` is `allow`**, with the origin of the
  block that wrote the level. The block may not name them and the runner is sent neither, so the values the parser leaves
  in the model (nothing, `deny`) are never shown. The two values say that Indaba sets no limit, not that the runner is
  able to act: a runner that cannot change files, or that refuses `full`, shows them too, and the permission report of
  `plan` is where that is said.
- **C-11. Declared and implied guards are separate `guards` settings**, each with the origin of where it was written.
- **C-12. `no_check_on_result` is reported for an agent step or a debate with no guard, not for a shell step** (narrows
  AC-05): a command that exits with an error fails a shell step, so on every such step the gap would be noise. Its
  sentence names what still decides that the step is done: the runner finishing, or the debate ending in acceptance, and
  the declared `outputs` existing.
- **C-13. An exception to AC-01.** `plan` without the options prints the commands of a shell step, scope paths and role
  names as plain text on one line. Output differs from before only where that text held a line break, a tab, surrounding
  spaces, control characters or direction marks. Section 6 (untrusted text is sanitised) outranks byte equality there.

## Artifacts not written

- `research.md`: nothing is researched outside this repository; the facts are in the code named in section 7.
- `data-model.md`: the structure is small and is specified in AC-08 to AC-10 and in `api-surface.md`.
- `events.md`: the feature emits no event and adds no span or attribute.
