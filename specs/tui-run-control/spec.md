# Feature TUI-2: runs, workflow picker and run control (`tui-run-control`)

> **Level**: feature of [`tui-epic`](../tui-epic/spec.md) (TUI-2). **Status**: Draft, specification only (revised 2026-11-06 after review).
> **Stage entry**: 1 · **Semver impact**: minor (provisional)
> **Depends on**: `tui-home`; implemented specs `web-app-actions` (run control in the CLI), `workflow-registry`, `workflow-inputs`.

---

## 1. The problem

Starting and stopping a run is possible only from the command line or the web view. In the terminal application the person has to
leave it, type `indaba run ...`, and come back. Choosing a workflow needs a list of them, which exists only in the web view and as
the `indaba workflows` command.

## 2. Stories

- **TUI-2.1** As a person, I see the runs of this machine (running first, then finished), with state, workflow, start time and cost.
- **TUI-2.2** As a person, I open a run to follow it live, or replay a finished one (the existing dashboard).
- **TUI-2.3** As a person, I see my workflows grouped by project, with name, tags and whether the file is valid, and pick one. (Moved here from `tui-workflows`; read-only.)
- **TUI-2.4** As a person, I see what the picked workflow will use (roles, runners, models, what agents may change), and I confirm it; a workflow whose steps need full access asks for its own, separate confirmation.
- **TUI-2.5** As a person, I fill in the workflow's inputs in a form with their defaults and checks.
- **TUI-2.6** As a person, I start the run; if the limit of concurrent runs is reached I am told, with the number.
- **TUI-2.7** As a person, I stop a running run after a confirmation.
- **TUI-2.8** As a person, quitting or detaching leaves a run I started running.

## 3. Acceptance criteria

- [ ] AC-01 (2.1) The runs list is built from the same files `indaba watch` reads; no second index.
- [ ] AC-02 (2.4) The confirmation drives the same two-step protocol as the web view (`confirmation_required`, then the content hash echoed back; and the separate full-access confirmation), through the same control; a changed workflow file between the two asks again.
- [ ] AC-03 (2.5) Input validation uses the engine's own checks; an invalid input cannot be started.
- [ ] AC-04 (2.7) Stop asks once, names the run, and ends it through the same path as the web view's Stop.
- [ ] AC-05 (2.8) A started run is a child process of its own; its exit does not depend on the screen. The control gets an explicit **detached** mode in which quitting never calls `stopAll`; `indaba ui` keeps its behaviour of stopping its children on exit.
- [ ] AC-06 (2.6) The cap of concurrent runs (`MAX_CONCURRENT_RUNS`, 4 per control instance) is surfaced; the spec says it is per instance, so the TUI and a concurrent `indaba ui` do not share it.
- [ ] AC-07 `@indaba/tui` imports no CLI module and redeclares no wire type: the shapes are the engine's re-exports (epic R-02), with a test that fails otherwise.
- [ ] AC-08 Secret inputs are masked, never drawn back and never written to a log; every start, stop and detach logs one `info` record with ids only.
- [ ] AC-09 (2.3) Typed filters and paths are sanitised and length-limited; the list is read through the registry control, not the file system.

## 4. Non-goals

- Scheduling or queueing runs. Starting a workflow that is not in the registry or a given path. Remote runs. Run deletion or export.
- Managing the registry (`tui-workflows`) or editing workflows (`tui-editing`).

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| start refused (invalid workflow, inputs, cap) | the reason at the field or the top of the dialog; nothing started |
| the child fails to start | one message with the reason; the runs list shows nothing new |
| stop of a run already finished | says so; no error |
| the workflow file changed after the first confirmation | the confirmation is shown again |

## 6. Parity

| Capability | Web view | TUI | `--plain` / CLI |
| :--- | :--- | :--- | :--- |
| Runs list, open a run | yes | this feature | `indaba watch` |
| Workflow list and picker | yes (`workflow-registry`) | this feature | `indaba workflows` |
| Confirmation and inputs | yes (`web-app-actions`) | this feature | `indaba run` flags |
| Start | yes | this feature | `indaba run` |
| Stop | yes | this feature | Ctrl+C in the foreground run; no separate stop command today |
| Detach | n/a | this feature | `indaba run` in the background by the user |

## 7. Where it lives

`@indaba/tui` (screens, form state), `@indaba/engine` (re-exports of the wire types), `indaba` (builds the controls from `run-control/`,
adds the detached mode, injects them).

## Artifacts not written

- `plan.md`: written when the feature is scheduled.
- `tasks.md`: written when the feature is scheduled.
- `research.md`: nothing external is relied on.
- `data-model.md`: no data is added.
- `events.md`: no new event; the runs emit what they emit today.
