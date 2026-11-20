# Feature RA-1: readiness of a run (`run-readiness`)

> **Level**: feature of [`run-assist`](../run-assist/spec.md) (RA-1). **Status**: Draft, specification only: nothing here is implemented.
> **Stage entry**: 3 (section 8 confirmed by the maintainer on 2026-11-20; AC-03 is deferred until `workflow-inputs` is implemented)
> **Semver impact**: minor (one optional workflow field, new optional exports and CLI output; below 1.0). No default changes:
> a report never stops a run (section 8, C-04).
> **Builds on**: [`specs/workflow-inputs`](../workflow-inputs/spec.md) (declared inputs), [`specs/agent-permissions`](../agent-permissions/spec.md)
> (the permission report is the precedent for a report computed before a run), [`specs/tui-run-control`](../tui-run-control/spec.md)
> (the start confirmation) and [`specs/runner-env-passthrough`](../runner-env-passthrough/spec.md) (which variables a runner receives).

---

## 1. The problem

A run fails late for reasons a person could have fixed in a minute, and says so badly. `OPENROUTER_API_KEY` is not set: the first
OpenRouter step fails after the steps before it have already run. An agent CLI is not installed: the step exits with 127. An
`input_artifact` points at a file nobody created. A workflow needs an account, a decision or a mockup that only a person can
provide, and nothing in the file says so. For a person who does not use a terminal, "exit code 127" is a dead end.

What is wanted: before the run starts, Indaba computes what the run needs, checks what it can check on this machine, and shows a
short list in plain words: **ready**, **missing** (with how to fix it) or **needs your confirmation**. It is a property of
starting a run, not a command to remember and not a file to write.

## 2. User stories

- **US-01 (1.1).** As a person about to start a workflow, I see before it starts what is missing on this machine, in plain words
  and with how to fix each item, so I do not find out three steps in.
- **US-02 (1.2).** As a person, a key I need is reported by the name of its variable and "set" or "not set", never by its value.
- **US-03 (1.3).** As a workflow author, I declare what Indaba cannot infer (an account, a decision, a mockup, a tool) with
  `requires`, and it appears in the same list for everyone who runs the workflow.
- **US-04 (1.4).** As a person, an item only I can judge ("the Google OAuth client exists") is shown as *needs your confirmation*,
  I confirm it in the interface, and the confirmation is recorded in this run, not in the workflow file.
- **US-05 (1.5).** As a developer embedding the engine, I compute the report without a terminal, with the machine replaced by a fake,
  and get the same list every time.
- **US-06 (1.6).** As a person in CI, `--plain` prints the report as text and the report is plain text I can keep in the log; it never stops the run.
- **US-07.** As an author of an existing workflow, nothing changes: a file without `requires` still gets the items Indaba infers,
  and nothing a person did before changes: the report only adds information.

## 3. Acceptance criteria

**What is inferred (no declaration needed)**

- [ ] AC-01. For each step, the report has a `runner` item: *missing* when the runner type or preset is not registered, or its
  executable is not found on the `PATH` (the same lookup the runner uses to start); otherwise *ready*.
- [ ] AC-02. For each environment variable a step's runner is configured to read (the API-key variable of an OpenRouter step, the
  names in `passEnv`), a `secret` item: *ready* when the variable is set and non-empty, otherwise *missing*. The report contains the
  name and the state and nothing derived from the value (epic R-02).
- [ ] AC-03. For each declared input without a default that was not given, an `input` item, *missing*; for a given `path` input that
  does not exist or lies outside the project, *missing* with the reason (`workflow-inputs` AC on paths).
- [ ] AC-04. For each `input_artifact` that no earlier step lists in its `outputs` and that is not a workflow input: an `artifact`
  item, *ready* when the file exists inside the project, otherwise *missing*.
- [ ] AC-05. A `workspace` item says what isolation the run will use (a git worktree, or a copy; `workspace-without-git`) and is
  *missing* only when the workflow asks for a worktree and the folder is not a git repository.
- [ ] AC-06. The permission summary of `agent-permissions` is one `permission` item per step with a non-default grant: *ready*,
  informational, never critical.

**What is declared**

- [ ] AC-07. A workflow may have a top-level `requires` list. Each entry has `kind` (`env`, `file`, `tool`, `account`, `decision`,
  `asset`), `name`, a non-empty `description` (at most 300 characters, shown to the person), optional `how` (at most 500 characters:
  where to get it) and optional `critical` (default `false`: the run will probably fail without it). Any other key is an error that names the path.
- [ ] AC-08. `env`, `file` and `tool` entries are checked by the machine like their inferred counterparts. `account`, `decision` and
  `asset` cannot be checked: they are *needs confirmation* until the person confirms (AC-12).
- [ ] AC-09. `name` for `file` is a path relative to the project, confined to it (the same confinement as an artifact path); an
  absolute path or a `..` segment is a validation error at parse time.

**Reading the report**

- [ ] AC-10. The report is a list of items ordered by severity (*critical* and *missing*, then *needs confirmation*, then *missing* but
  not critical, then *ready*), then by step order. The same workflow, inputs and machine give the same list in the same order.
- [ ] AC-11. Every item has a plain-words `message` and, when known, a `how` in one sentence. No item message contains a path outside
  the project, a stack trace or an exit code.
- [ ] AC-12. A person can confirm a *needs confirmation* item in the web view, in the TUI or with `--confirm <id>`; the confirmation is
  written to the run record and shown in the run's later views. It is never written to the workflow file.

**Starting**

- [ ] AC-13. The start confirmation of the TUI and the start dialog of the web view show the report before the person starts. *Ready*
  items are collapsed to a count.
- [ ] AC-14. `indaba plan` prints the report in a section after the plan. `indaba run` prints it as a warning and then starts. It adds
  no option and no exit code: the run starts exactly as before.
- [ ] AC-15. An unconfirmed *needs confirmation* item and a *missing* item never disable the start. The start button of the web
  view and the TUI is always available; the report is above it, with the *critical* items first.

**Honesty**

- [ ] AC-16. The analysis reads no environment variable, file or `PATH` itself: all of it comes through the injected `ReadinessProbe`
  (`@indaba/core` imports no `node:` module). A test with a fake probe covers every state of every kind.
- [ ] AC-17. The report is a snapshot. The run record stores the item ids and states at the start (never a value), so a later view can
  say "the key was not set when this run started".

## 4. Non-goals

- Not a check that a key or a token is *valid*: that is a network call to a third party and the person's decision (epic R-02).
- Not an analysis of the person's plan or free text by an agent (epic R-03). `requires` is how an author says what is needed.
- Not creating accounts, generating keys, writing a `.env` file or storing a secret; the host environment stays the only place.
- Not a replacement for `validate` (is the file well formed) or `plan` (what will run); it is what the *machine and the person* must
  provide for that plan.
- Not a re-check during the run; a step that fails still fails the way it does today, with a better message when the cause is on the list.
- No new runner contract: a probe asks questions a runner already answers (is it registered, which variables does it read).

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the probe itself throws (permission error reading a folder) | that item is `unknown` with the message "could not be checked"; the report still returns; `unknown` never blocks |
| the workflow does not parse | no report; the parse errors are shown as they are today |
| the `PATH` lookup finds a `.cmd` shim on Windows | the item is *missing* with the message that Indaba needs a native executable (CLAUDE.md trap) |
| an input path is a symlink out of the project | *missing*: "outside the project" (confinement) |
| the person confirms an item, then the run starts | the confirmation is in the run record; a second run asks again, because a confirmation belongs to a run |
| the report is requested for a run already started | allowed; it shows the start snapshot (AC-17) beside the present state |

## 6. Security and data handling

The report is built from names and states. A secret's value is never read by the analysis: the probe answers `set` or `not set`
(`isEnvSet(name): boolean`), so a value cannot reach the report even by mistake. Paths are confined to the project root before the
probe looks at them; an untrusted path (an input a person typed) is never passed to a shell, only to `fs` through the confined
resolver. `how` and `description` come from the workflow file and are escaped like any workflow text before a front end draws them
(the sanitizer the TUI already has). No new process is started: the `PATH` lookup is a directory scan, not `which` through a shell.

## 7. Where it lives

| Part | Package |
| :--- | :--- |
| `AttentionItem`, `ReadinessReport`, `ReadinessProbe`, `analyzeReadiness` (pure) | `@indaba/core` |
| the `requires` field: parser, schema, catalog description | `@indaba/engine` |
| the real probe (`PATH` scan, env presence, confined file check), confirmations in the run record | `@indaba/engine` |
| `plan` and `run` output, `--confirm`, injection into the TUI | `indaba` |
| the start confirmation | `@indaba/tui`, `@indaba/web`, `@indaba/server` (a route) |

## Parity

| Surface | Delivers |
| :--- | :--- |
| web view | the report in the start dialog; confirm buttons for *needs confirmation* |
| TUI | the report in the start confirmation of `tui-run-control`; a key to confirm the selected item |
| `--plain` / CLI | the section in `indaba plan`; the warning printed by `indaba run`; `--confirm <id>` |

All three ship in this feature.

## 8. Clarifications

- **C-01. Name.** `readiness`, not `preflight` (a word the project does not use) and not `doctor` (a command that exists nowhere here).
- **C-02. One declared field.** `requires` is the only new workflow field. Inferred checks need no field, so an old workflow gets
  value with no edit.
- **C-03. `unknown` is a state.** A check that cannot be made says so; it is never reported as ready and never blocks.
- **C-04. A report informs and never blocks.** Decided by the maintainer on 2026-11-18: a person should be aware, not prevented
  from starting. `indaba run` starts exactly as today. *Critical* is true for the inferred `runner` and `secret` items (the run
  would probably fail) and for a declared entry with `critical: true`; it only orders the list and marks the item. No default
  changes, so there is no exit code and no bypass option.
- **C-05. Confirmations belong to a run.** Not to the workflow, not to the person: an account can be deleted tomorrow.
- **C-06. The probe is an interface.** A plugin can add a probe (a company's own "is the VPN up"), through `PluginHost`, with the
  same access as the built-in (epic R-06).
- **C-07. Check order is the step order**, so a person fixes the first failing step first.

## Artifacts not written

- `events.md`: the one event is `indaba.readiness`, named in `api-surface.md`
- `research.md`: no open question needed research
- `data-model.md`: the types are in `api-surface.md`
