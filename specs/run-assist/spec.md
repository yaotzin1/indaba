# Epic: Indaba tells the person what a run needs and what is left (RUN-ASSIST)

> **Level**: epic. Features below are specs of their own; stories live inside each feature's `spec.md`.
> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1
> **Semver impact**: minor, per feature (below 1.0); each feature classifies its own in `api-surface.md`.
> **Origin**: a comparison on 2026-11-18 with a published Claude Code project template whose skills `/dev-prep` (before
> building: a checklist of what a person must supply) and `/dev-smoke` (after building: settle the open decisions, do the
> manual checks) solve a real problem with a prompt that depends on the model following it. Here the same two moments become
> **properties of the engine**: computed, deterministic, and shown by the TUI and the web view. No skill, command or document
> is something the person has to run or write.

---

## 1. The problem

An agent run stops being autonomous in two predictable places, and today Indaba says nothing about either:

- **Before it starts.** The run needs things only a person can arrange: an API key in the environment, an agent CLI on the
  `PATH`, a folder that exists, an account, a decision, a mockup. Indaba finds out when a step fails, after time and tokens are
  spent, and the message is an exit code, not "your key `OPENROUTER_API_KEY` is not set".
- **After it ends.** What remains for a person is scattered: findings nobody settled, a step that passed with a warning, things
  no agent can do (look at the screen on a real phone, enter a password, pay by card, check production). They are in the trace,
  if anyone reads it, and a later run raises the same finding again.

For a non-developer who runs Indaba for a regular task (`project_audience-non-developers`) this is the whole difference between
a tool they can use and one they cannot. The aim is that Indaba computes both lists, shows them where the person already is
(TUI, web view, `--plain`), and remembers the answers.

## 2. Hierarchy: epic, features, stories

Epic `RUN-ASSIST` is delivered by two features. Acceptance criteria ids (`AC-nn`) are scoped to their feature.

| Id | Feature (spec) | Stories | Delivers | Depends on |
| :--- | :--- | :--- | :--- | :--- |
| `RA-1` | [`run-readiness`](../run-readiness/spec.md) | 1.1 to 1.6 | a readiness report before a run: what is ready, what is missing, what only a person can confirm; shown in the start confirmation | `workflow-inputs`, `agent-permissions` (the report precedent), `tui-run-control`, `web-app-actions` |
| `RA-2` | [`run-handover`](../run-handover/spec.md) | 2.1 to 2.6 | a handover after a run: open items and human-only checks, a fix / accept / defer answer for each, remembered across runs | `RA-1` (the item shape), `debate-findings`, `step-verdicts`, `tui-questions` for the TUI answer surface |

`RA-1` ships alone. `RA-2` ships its CLI and web forms first and the TUI answer surface when `tui-questions` is unblocked
(the feature says so in its Parity section).

## 3. Rules for every feature of this epic

- **R-01 Computed, not written.** The person never writes or maintains a checklist file. A workflow author may *declare* what
  Indaba cannot infer (one optional field each), and Indaba computes the rest from the workflow, the registry and the host.
- **R-02 Names, never values.** A secret is reported by the name of its variable and "set" or "not set". Its value, its length
  and a prefix are never read into a report, a trace, an event or an artifact. Indaba never checks that a key *works*; that
  needs a call, and a call is the person's decision.
- **R-03 No model call.** Both features are deterministic code. Nothing here asks an agent to analyse anything, so the report is
  the same for the same inputs, costs nothing and cannot be talked out of a finding.
- **R-04 Parity.** Every feature has a "Parity" section: a table of rows (web view, TUI, `--plain`/CLI), as in the TUI epic's R-01.
  A cell that says "not yet" names a date or a spec.
- **R-05 One item shape.** Readiness and handover share `AttentionItem` (`@indaba/core`), so a front end draws both the same way.
- **R-06 Extension, not privilege.** Where an item comes from is a contract in `@indaba/core` (`ReadinessProbe`,
  `HandoverSource`) that a plugin can implement; the built-in sources use the same `PluginHost`.
- **R-07 Inform, never block.** A report informs and never stops a run. The person can always start; an item that will probably
  make the run fail is marked *critical* and shown first, nothing more.

## 4. Non-goals of the epic

- Not a project-management layer: no task tracker, no planning of a roadmap, no reading of a person's free-text plan.
- Not account creation, key generation or secret storage. Secrets stay in the host environment.
- Not an analysis by an agent of "what might be missing"; if that is ever wanted it is its own spec with its own cost.
- Not a replacement for the review gate or the question channel: those stop *inside* a run; this is before and after it.

## 5. Where it lives

Pure types and the analysis in `@indaba/core` (no `node:` import; the host is a probe injected by the caller). The probe's real
implementation, the handover store and the declared fields' parsing in `@indaba/engine`. The commands and the injection into the
TUI in `indaba`, the screens in `@indaba/tui` and `@indaba/web`, the HTTP routes in `@indaba/server`.

## 6. Review

Pending: the epic is reviewed with the first feature that is implemented.

## Artifacts not written

- `plan.md`: an epic orders features; each feature carries its own
- `research.md`: an epic orders features; each feature carries its own
- `data-model.md`: an epic orders features; each feature carries its own
- `events.md`: an epic orders features; each feature carries its own
- `tasks.md`: an epic orders features; each feature carries its own
