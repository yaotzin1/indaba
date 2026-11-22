# Specification: Workflow supervisor (an optional model that advises on a workflow file, before a run and after a failure)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 and 2 written; every decision of section 8 (C-01 to C-12) confirmed by the maintainer on 2026-11-22, as recommended, C-06 kept strict
> **Semver impact**: minor (one new command, new optional exports, new span attributes; below 1.0). No default changes: nothing
> calls the supervisor unless a person runs the new command. Provisional; confirmed in [`api-surface.md`](api-surface.md).
> **Builds on**: [`specs/plan-explain`](../plan-explain/spec.md) (the deterministic JSON this model reads; specification only, so this
> feature is implemented after it), [`specs/workflow-assistant`](../workflow-assistant/spec.md) (the profile, the closed list of edits,
> the classification of high-impact edits, the validation on a copy; specification only), [`specs/workflow-editor`](../workflow-editor/spec.md)
> (`WorkflowDocument`, `WorkflowEdit`, `validate` with the catalog), [`specs/agent-permissions`](../agent-permissions/spec.md) (the level
> `read`), [`specs/attempt-history`](../attempt-history/spec.md) (the attempts of a step; implemented), [`specs/run-readiness`](../run-readiness/spec.md).
> **Origin**: a request from the maintainer on 2026-11-22: an optional model that watches over a workflow but never rewrites it by
> itself.

---

## 1. The problem

Two checks exist before a run and they stop short of meaning. `indaba validate` says that a file is well formed. `indaba plan --explain`
(`plan-explain`) says what each step will be given and what it lacks. Neither knows what the person is trying to do, so neither can say
that the goal needs a new package while the step may not write `package.json`, or that a test step calls `vitest` in a repository that
uses `jest`. A person finds that out when a step fails, after time and tokens are spent.

After a failure the position is the same. A step has used all of its `retry_step` runs, or a debate ended without consensus. The
person reads the attempts, works out why and edits the YAML. A model could read the same evidence and propose the edit; what is wanted is
that it can **only propose**, that the proposal is an exact change to the file, that the file still passes `validate`, and that a person
decides.

What is wanted: an **opt-in** model that, on request, reads a fixed, deterministic input and returns a structured, bounded set of
**findings** and optionally a **patch** to the workflow file. It is never part of a run, has no hand on a running engine, and nothing it
says is applied without a person looking at the exact diff.

### How this differs from what exists

| Existing | What it is | Why the supervisor is not it |
| :--- | :--- | :--- |
| `workflow-assistant` | free-form conversation in the edit view, on the draft that is open, started by the person's words | the supervisor is a one-shot report from a fixed input, command-line first, with a pre-flight and a post-failure phase and a mandatory link from each finding to evidence; it reuses the assistant's profile, closed edits and classification, and adds none of its own |
| `plan --explain` | computed, offline, no model (`plan-explain` non-goal) | it stays so; the supervisor is a separate command and `plan` never calls it |
| `review-gate` advisors | a model that advises a gate on a decision about a step's output, inside a run, as a labelled advice that binds nobody | the supervisor advises on the workflow file, outside a run |
| `run-handover` | what is left for a person after a run (open findings, checks only a person can do), computed | phase 2 reads why a step failed to propose a file change; it does not list what remains |
| `debate-arbiter` | the human or a promoted agent settles a failed debate **inside** the run | phase 2 starts after the run has ended |

## 2. User stories

- **US-01.** As a person about to run a workflow for a task I can state, I ask a model of my choice whether the file fits the task, and I
  get findings I can read, each tied to a fact I can check.
- **US-02.** As a person whose step failed after all its retries, I ask for a diagnosis and get a proposed change to the file as a diff.
- **US-03.** As a person, I see exactly what will be sent to the model before anything is sent, and I confirm it.
- **US-04.** As a person, a proposed change never reaches my file until I have read the diff and said yes, and a change that would widen
  what an agent may do asks me separately.
- **US-05.** As a person who does not use a model, I notice nothing: no setting, no default, no extra output anywhere.
- **US-06.** As a developer building a front end, I read one JSON contract for the report and one for the patch.

## 3. Acceptance criteria

Terms. A **finding** is one remark of the model about the workflow, with a severity and evidence (AC-13). A **patch** is a closed list of
`WorkflowEdit` (`workflow-editor`) with a reason for each. The **advisor input** is the closed structure of AC-07; the **failure digest**
is the closed structure of AC-10. A **report** is the structure of AC-12. **Phase 1** is the pre-flight, **phase 2** the triage after a
failure, **phase 3** a retrospective (not in this version, AC-26).

**The invariants (each is a property of the code, not a promise)**

- [ ] AC-01. **Optional.** Nothing starts the supervisor but a person running `indaba supervise`. No workflow field, no `indaba.config`
  key, no environment variable and no engine option turns it on, and `plan`, `validate`, `run`, `watch` and `ui` neither call nor import
  it. With no profile chosen (AC-17) the command says in plain words how to choose one and sends nothing. A test fails if any other
  command imports the supervisor module.
- [ ] AC-02. **Advisory.** A report never changes the exit code of `plan`, `validate` or `run`, never starts, stops, pauses or skips a
  run, and never marks a step. `blocker_suggestion` is a label for the person's attention, not a block: no code path reads a finding's
  severity to decide anything.
- [ ] AC-03. **No hand on a running engine.** The supervisor receives immutable data and returns data. It holds no reference to
  `WorkflowEngine`, `StepExecutor`, the DAG, the runner registry, the permission resolution or a guard, and nothing in its output is
  an instruction to the engine. It is never started for a run that is still going: phase 2 reads a run record that is in a final state and
  refuses one that is not (AC-11). The layers test of `@indaba/engine` fails if the supervisor module imports any of those.
- [ ] AC-04. **A patch is a closed list of edits on a copy.** The model's patch is parsed as a closed structure (the `ProposedEdit` of
  `workflow-assistant`: `set`, `remove`, `addStep`, `removeStep`, `moveStep`). Any other operation, a path the schema does not have or a
  value of the wrong type rejects the whole patch. The edits are applied in order to a **copy** of the file's text through
  `WorkflowDocument` and the result is checked by the same function `indaba validate` uses, with the catalog. A patch whose result does
  not validate is shown as invalid with the problems and cannot be accepted. The model is asked once to repair it, with only that failure
  as input; the repair counts in the usage.
- [ ] AC-05. **Explicit human acceptance, no bypass.** The supervisor writes a file only after a person, at a terminal, has been shown the
  unified diff computed by the program from the edits (never text the model wrote) and has answered yes. No flag (`--yes` does not
  exist), environment variable, configuration key or non-interactive mode skips this. With no terminal the command prints the report
  and the diff and writes nothing. The write happens only if the file still has the hash it had when the diff was computed; otherwise it
  is refused and says so. An edit the program classifies as high-impact (`classifyEdit` of `workflow-assistant`: permissions, a shell
  command, a runner, a guard, an arbiter, a gate that approves) is shown first, separately, and accepted one by one; "accept all" never
  includes it. The class is decided by the program from the edit, never from the model's words.
- [ ] AC-06. **No resume, no restart in this version.** Accepting a patch changes a file. It does not resume, restart or alter any run, and
  it does not touch a run record. A new run is the person's action. Resuming a stopped step with the changed file needs the resume of
  `step-budgets`, which is not implemented; if it ships, offering it here is a later spec with its own confirmation (C-10).

**What the model is given**

- [ ] AC-07. **The advisor input (phase 1)** is exactly: (a) the JSON of `plan --explain --json`, unchanged, at its `version`; (b) the
  **task**, the goal as the person gave it with `--goal` or `--goal-file`, bounded; (c) `repoFacts` (AC-09); (d) `stepText`: the commands
  of each shell step and the goal of each agent step as the file has them, with `${{ inputs.x }}` left unresolved, marked as data.
  Nothing else is read or sent: no other file, no value of an input, no environment value, no key, no absolute path, no history of the
  repository. (d) is a deliberate addition to the contract of `plan-explain`, which leaves goals and commands out (its AC-11); it is built
  by the supervisor from the parsed workflow so that `plan --explain` stays free of text (C-04).
- [ ] AC-08. **See it first.** `indaba supervise --show-input` prints the exact advisor input (or failure digest) that would be sent, as
  text or JSON, sanitised for the terminal, and makes no call. Before the first call of a profile, and again when the input's content
  class changes, the command states where the content goes (the agent's own service or the endpoint of the profile, by name) and what is
  sent, and asks at a terminal for confirmation; with no terminal it sends nothing and exits with the same code as a missing input
  (2). The confirmation is not remembered across profiles.
- [ ] AC-09. **`repoFacts` is built by the program and is deterministic.** For each manifest of a fixed list at the project root
  (`package.json` and the others named in `api-surface.md`) it carries the **names** of the declared dependencies and the names and command
  text of the scripts; the names of the lockfiles present; and the names of the entries at the top level of the project folder, bounded in
  number. It carries no file contents other than those manifest fields, no value of an environment variable, no versions that are not
  part of a dependency name, and no absolute path. Paths are confined to the project root. Where a manifest cannot be read, the fact is
  `unknown` with the reason, not guessed. The same module is the one `indaba init` would use to detect a stack, so the two cannot
  disagree (C-09).
- [ ] AC-10. **The failure digest (phase 2)** is exactly: the run's id; the step id and its runner chain; for each attempt (from
  `attempt-history`) its number, the class of its outcome and of its reason, the exit code, and for a failed guard the type and the paths
  it names; what ended the step (`retry_step` exhausted, a stall, a timeout, a debate that reached `max_rounds_exceeded` or `stalled`) with
  the debate's rounds and participants; the **last failure text** of the step, which is the text the next attempt's prompt would carry (so
  the model sees no more than a retried agent sees), passed through the existing redaction, bounded and marked as data; and the
  `plan --explain` JSON of the workflow file. If the run record carries a digest of the workflow text and it differs from the file on
  disk, the command says the file changed since the run and does not proceed (C-08).
- [ ] AC-11. **No logs, no artifacts.** The model never receives a trace, the whole output of a step, an artifact, a diff of the work or a
  file of the project. Phase 2 refuses a run that is not in a final state, a run id it cannot find, and a step that did not fail.

**What it returns**

- [ ] AC-12. **The report** is a closed structure: `schema: "indaba.supervisor-report"`, `version: 1`, `phase` (`preflight` or `triage`), the
  workflow's name, `input_digest` (SHA-256 of the canonical advisor input or digest), `findings`, `dropped_unsupported` (a count),
  `patch` (absent when the model proposes none; otherwise the validated edits with a reason each and the unified diff computed by the
  program) and `usage` (tokens and cost as the runner reports them, `unknown` when it does not). A finding has `id`, `severity`
  (`info`, `warning`, `blocker_suggestion`), `step` (absent for the whole workflow), `anchor`, `message`, `evidence` and, when it has a
  fix, `edits` (indexes into the patch). `message` is plain text, bounded, never markup. Output that is not this structure is a refusal
  shown with its reason; nothing is partly used.
- [ ] AC-13. **Every finding is tied to evidence, or it is dropped.** Each finding names at least one evidence pointer, and the program
  checks that each pointer resolves in the input: a setting or a gap of the `plan-explain` JSON (`explain: <step>.<setting>`), a field of
  the digest (`digest: attempts[1].guard`), a fact of `repoFacts` (`repo: scripts.test`), a span of the task text (`task`), or a line of
  `stepText` (`step: <id>.commands[0]`). A finding with none, or with a pointer that does not resolve, is dropped and counted in
  `dropped_unsupported`; the person is told how many. The model's confidence is not a field.
- [ ] AC-14. **Known gaps are not repeated.** A finding whose only evidence is a gap `plan --explain` already reports is dropped as a
  duplicate (counted separately); the model adds what the rules cannot say.
- [ ] AC-15. **Deterministic shape.** The findings are ordered by severity (`blocker_suggestion`, `warning`, `info`), then by the order of
  the steps, then by the order of the anchors, then by `id`; keys are in a fixed order; there is no timestamp, no absolute path, no
  environment value and no secret. `id` is derived by the program from the finding's step, anchor and evidence, not by the model. For
  the same recorded model answer the text and the JSON are byte for byte the same (tested with a fake runner). The model's own words are
  not reproducible between calls and the spec does not claim they are.
- [ ] AC-16. **Text rendering.** The text groups findings by step, gives each its severity in words and a mark with an ASCII form
  (`INDABA_ASCII`), its evidence and its fix, then the diff and the count of what was dropped. Everything that came from the file, the
  repository or the model goes through the sanitizer used for the event stream; meaning is never carried by colour alone (`NO_COLOR`).

**Who the model is and what it may do**

- [ ] AC-17. **The model is the person's choice.** It is one of the **user-level profiles** of `workflow-assistant` (AC-03 there: an agent or
  a service, in the user's configuration folder, never in a project), selected with `--profile`; Indaba never picks one and a project cannot
  carry one. The key of a service comes from the environment and is in no file, output, log or span. Because the profile file is the
  user's, the supervisor cannot run where there is none (a clean CI machine): that is intended.
- [ ] AC-18. **No tools, no authority.** The model runs at the level `read` of `agent-permissions` through the `Runner` contract: an agent
  through a gate that refuses every request, a service with no tool definitions. It cannot read a file, run a command or reach the network
  except through the one call. The task, the repository facts, the step text, the failure text and the YAML are all data and are marked as
  such; what protects is not the marker but that the output has no authority (AC-04, AC-05, AC-13).
- [ ] AC-19. **Bounds.** The size of the input, the number of findings, the length of a message and the number of edits are named constants
  (`api-surface.md`; their values are chosen at stage 3 and are not measured). An input over its bound is refused before it is sent,
  naming what to remove. The command makes at most one call for the report and at most one for a repair of an invalid patch or of output
  that is not the closed structure.
- [ ] AC-20. **Cost, time, cancel.** The report shows tokens and cost when the runner reports them and `unknown` when it does not. A call has a
  timeout and Ctrl-C cancels it; a cancelled or failed call changes no file and says why in plain words. A model that is not installed, not
  logged in or not reachable is reported as that.

**What is kept**

- [ ] AC-21. **Nothing is stored.** Indaba writes no conversation, no prompt and no answer to disk. The report goes to stdout, or into a file
  only if the person redirects it. No trace, event or log line contains text sent to or received from the model; a test puts a sentinel
  string in the task, a script name, a failure text, the model's answer and a key and asserts that none appears in a span, an event or a log
  line.
- [ ] AC-22. **Telemetry is counts.** The span `indaba.supervisor` carries `indaba.supervisor.phase`, `indaba.supervisor.profile_kind`,
  `indaba.supervisor.input_digest`, `indaba.supervisor.findings`, `indaba.supervisor.findings_dropped`, `indaba.supervisor.edits_proposed`,
  `indaba.supervisor.edits_accepted`, `indaba.supervisor.high_impact_accepted`; no text, path or key.

**Interfaces and scope**

- [ ] AC-23. **The command.** `indaba supervise <file> [--goal <text> | --goal-file <path>] [--profile <name>] [--json] [--show-input]
  [--apply]` is phase 1. `indaba supervise <file> --run <id> [--step <id>] [...]` is phase 2. `--apply` only offers the acceptance of
  AC-05 at a terminal. Names are provisional until C-01 is settled. Exit codes: 0 when a report was produced (whatever its findings), 2 for
  a usage error or a missing input, 1 for a failure of the model call or an invalid file.
- [ ] AC-24. **Where the logic is.** The shapes and the pure checks are in `@indaba/core`; the building of the input and the digest, the call,
  the parsing, the evidence check, the validation on a copy and the diff are in `@indaba/engine`; the command and its words are in
  `indaba`. No UI package is involved.
- [ ] AC-25. **Nothing for the web page or the TUI in this version.** They may read the JSON of AC-12 later; the assistant panel is the likelier
  surface, through the same contracts.
- [ ] AC-26. **Phase 3 is not in this version.** A retrospective on the traces (tokens, time, repeats) needs honest numbers: only some
  runners report usage today, and a suggestion built on `unknown` would be invention. It is specified separately when `step-budgets`
  metering exists (C-03).

## 4. Non-goals

- **Anything inside a run.** No watching of a live run, no intervention, no pause, no skip, no change of the DAG, a permission or a gate while
  a run exists. The word "supervisor" is the maintainer's; it does not supervise a running engine (C-02).
- **Dynamic rewriting of the workflow.** The only way a file changes is an accepted diff, written by a person's action (AC-05).
- **Applying, resuming or restarting by itself**, in any mode, including unattended runs and CI.
- **A model that reads the project, runs commands or browses.** One call, no tools (AC-18).
- **Judging the quality of a goal or of the person's task.** It reports what does not fit the evidence; it does not grade.
- **Reviewing the output of a step.** That is a review gate and its advisors.
- **Choosing or shipping a model, a key or a service.**
- **Rules a program can decide.** A check that follows from the explanation and the repository facts without a model belongs in
  `plan --explain` or the readiness report, not here (C-05).
- **Memory across sessions, learning, or a score of past runs.**
- **A forecast of cost or time.**

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| no profile chosen | says how to choose one; sends nothing; exit 2 |
| the model is missing, not logged in or unreachable | a plain-word reason; no file touched; exit 1 |
| the input is over its bound | refused before sending, naming what to remove; exit 2 |
| the model's output is not the closed structure | one repair call; if it still is not, a refusal with the reason; nothing used; exit 1 |
| a finding has no resolvable evidence | dropped and counted; the rest is shown |
| a patch is invalid after applying it to the copy | shown as invalid with the problems; one repair call; cannot be accepted |
| a patch names an unknown path or the wrong type | the whole patch is rejected; findings without a fix are still shown |
| the workflow file changed between the diff and the write | not written; says the file changed; the person asks again |
| there is no terminal | the report and the diff are printed; nothing is written (AC-05) |
| the person answers no, or Ctrl-C | nothing is written; exit 0 for a produced report |
| phase 2 and the run is not in a final state, or the run or step is unknown, or the step did not fail | refused with the reason; no call |
| phase 2 and the file differs from the one the run used | says so and stops; no call |
| a task text, a script or a failure text contains instructions | data; whatever comes of it is a finding the evidence check tests or an edit a person reads and, if high-impact, accepts separately |
| the sent text would contain a secret that redaction knows | redacted before it is shown by `--show-input` and before it is sent |

## 6. Security and data handling

- Every input is untrusted: the task, the manifests, the step text, the failure text and the file. So is the output. The model has no tools
  and no path to an effect: its words become a finding that must point at evidence, or an edit that is validated on a copy, shown as a diff
  and accepted by a person, one by one when it matters (AC-04, AC-05, AC-13, AC-18). A document that steers the model can at most put a marked
  change in front of a person.
- Content goes only to the profile the person chose and confirmed, after they saw what would be sent (AC-08). A key comes from the
  environment and is in no file, output, log, span or report (AC-17, AC-21).
- No secret, environment value or absolute path is in the input, the report or the JSON. The failure text is redacted with the existing
  redaction before it leaves; if redaction cannot be trusted for a given text, the text is replaced by its class (`unknown`) rather than
  sent.
- File access is confined to the project root; manifests are read from a fixed list, not discovered by the model.
- All text from the model is shown as text, sanitised for a terminal, and never executed or interpreted as markup.
- A patch is applied to a copy and written only by the acceptance of AC-05, and only if the file's hash is unchanged.

## 7. Where it lives

| Part | Package | Kind |
| :--- | :--- | :--- |
| `AdvisorInput`, `FailureDigest`, `SupervisorReport`, `Finding`, `Severity`, `EvidencePointer`; the pure checks `verifyEvidence`, `orderFindings`, `findingId`, `isDuplicateOfGap`; the size bounds | `@indaba/core` | pure domain |
| `ProposedEdit` and `classifyEdit` | `@indaba/core` | shared with `workflow-assistant`; whichever of the two features is implemented first adds them and the other reuses them |
| `buildRepoFacts`, `buildAdvisorInput`, `buildFailureDigest`, `parseSupervisorReply`, `applyPatchToCopy`, `renderUnifiedDiff`, the call through a `Runner` at `read` | `@indaba/engine` | infrastructure |
| `indaba supervise`, the confirmation prompts, the text rendering, the JSON output, the acceptance | `indaba` (CLI) | composition root and rendering |
| the profile file and its parsing | already specified by `workflow-assistant` | reused, not re-specified |

## 8. Clarifications

All confirmed by the maintainer on 2026-11-22, as recommended. Two of them leave a check for stage 3 and are marked.

- **C-01. A separate command that shares the assistant's contracts, not a mode of `plan` and not a second assistant. Confirmed 2026-11-22.** `plan` is
  offline and model-free by the spec of `plan-explain`; putting a model call behind a flag there would break that. The assistant is a
  conversation in the edit view; the supervisor is a batch report on a command line. The two share the profile, the edit shape, the
  classification and the validation, so the code is written once.
- **C-02. The name. Confirmed 2026-11-22.** `workflow-supervisor` is the maintainer's. It suggests watching a run, which AC-03 forbids; `workflow-advisor`
  would say what it does, but `review-gate` already uses "advisor" for a different thing. Decided: keep the maintainer's name for the
  spec and the command `indaba supervise`, and say in the first line of the documentation that it never touches a running workflow.
- **C-03. Phases. Confirmed 2026-11-22.** Phase 1 and phase 2 are specified and may be delivered as two releases of the same feature; phase 2 depends on
  `attempt-history` (implemented) and on a way to name a finished run. Phase 3 is out (AC-26). Decided: phase 1 first.
- **C-04. `stepText` goes beyond "only the contract". Confirmed 2026-11-22.** A review of "the test step calls the wrong tool" needs the command text, and
  `plan-explain` leaves text out on purpose. The supervisor adds a separate, labelled block of goals and commands (inputs unresolved)
  instead of widening `plan --explain`, so that the offline command stays text-free.
- **C-05. Rules first, model second. Confirmed 2026-11-22.** A fact a program can decide (a step's write scope does not include the manifest its command names;
  a command names a binary no manifest declares) should be a deterministic gap or readiness item, tested and free. The model is for what
  needs the goal. AC-14 drops a duplicate of an existing gap; a later spec may add such rules.
- **C-06. Evidence or silence. Confirmed 2026-11-22, kept strict: evidence or rejection, no guessing and no generalities.** A finding without a resolvable pointer is dropped. This costs some true remarks (an observation with no
  field to point to) and removes the failure that makes advisers worthless: a confident remark that is not about this file.
- **C-07. No `--yes`. Confirmed 2026-11-22.** The one place a model's words become a file is a person's yes; a flag that skips it would be the first thing a
  scheduled job, a script or a prompt-injected instruction reaches for.
- **C-08. The digest of the workflow text in the run record. Confirmed 2026-11-22.** Phase 2 should refuse a file that changed since the run. If the run record
  does not carry a digest of the workflow text today, adding it is an additive attribute of the run's root span; stage 3 checks this and,
  if it is missing, lists it as a task. Until then phase 2 says it cannot tell. **Stage 3 verifies this in the code first and lists the digest as a task if it is missing.**
- **C-09. One stack detection. Confirmed 2026-11-22.** `repoFacts` and the detection `indaba init` needs read the same manifests. They are one module, with
  `init` using the facts and not the other way round; `init`'s own specification names it as a dependency.
- **C-10. Resume. Confirmed 2026-11-22.** There is no resume of a run or a step in the engine today. After an accepted patch the person starts a new run. When
  `step-budgets` ships its resume, "resume with the changed file" is a candidate for a follow-up with its own confirmation.
- **C-11. The profile is the user's. Confirmed 2026-11-22.** Reusing `workflow-assistant`'s per-user profile file means a project cannot carry a model choice and
  a CI job has none. If a team wants a supervisor in CI, that is a different design (a service account, no apply) and not this spec.
- **C-12. Numbers. Confirmed 2026-11-22.** The bounds of AC-19 are named constants whose values are fixed at stage 3 from the sizes of real inputs; this spec
  states none, because none has been measured.

## Artifacts not written

- `plan.md`: stage 3 follows the maintainer's confirmation of section 8.
- `tasks.md`: stage 4 follows the maintainer's confirmation of section 8.
- `research.md`: no external fact is relied on; the model is the person's choice. The two things to verify in the code (C-08) are recorded as tasks at stage 3.
- `data-model.md`: nothing is stored; the shapes are in `api-surface.md` and AC-07, AC-10, AC-12.
- `events.md`: no event; the span and its attributes are in AC-22 and `api-surface.md`.
