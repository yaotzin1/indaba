# Feature TUI-2: runs, workflow picker and run control (`tui-run-control`)

> **Level**: feature of [`tui-epic`](../tui-epic/spec.md) (TUI-2). **Status**: Stage 3 to 5 written; implementation on `feat/tui-run-control` (revised 2026-11-13 after an Indaba debate, section 9).
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
- [ ] AC-03 (2.5) **Deferred to `tui-run-inputs`** (section 9): `StartRunRequest` has no inputs field and `workflow-inputs` is not implemented. A workflow that needs inputs shows the engine's start failure with a hint to use `indaba run`.
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
| Stop | yes | this feature (`s` on a run this screen started) | Ctrl+C in the foreground run; no separate stop command today |
| Detach | n/a | this feature | `indaba run` in the background by the user |

## 7. Where it lives

`@indaba/tui` (screens, form state), `@indaba/engine` (re-exports of the wire types), `indaba` (builds the controls from `run-control/`,
adds the detached mode, injects them).

- [ ] AC-10 (debate) A workflow file that changes between the two confirmations makes the screen drop both stored hashes, say "changed since you looked", and show the new use; no hash from before the change is ever sent.
- [ ] AC-11 (debate) Quitting while a start is pending is refused with a line saying so. With no live run started here, quitting asks nothing. With one: `d` detaches (the runs go on, exit 0), `c` stops them and waits (exit 130 only after), `n` stays; if stopping fails the screen says so and stays open.
- [ ] AC-12 (debate) A start id that never appears, or that the control no longer knows, ends in `failed` (a start lost, or a timeout); no timer outlives the screen.
- [ ] AC-13 (debate) Every text that came from a workflow file or from the control (use, steps, problems, failure) has its control sequences removed and its credentials replaced before it is drawn.

## 9. Clarifications (an Indaba debate, 2026-11-13)

`claude-code` and `antigravity` debated the design for three rounds and reached consensus (trace `238353b535ed1ad14519cb06d1170269`). Decided:

- **Flow.** Home `n` opens the picker (all workflows, grouped by project; an invalid one shows its problems and cannot be started; `/` filters, `h` shows hidden ones). `Enter` starts: `confirmation_required` leads to a confirmation of what the workflow uses (`y` echoes the hash); `full_access_required` leads to a separate screen (`a`, no default) that sends both hashes; then `starting` polls the start until the run exists and opens it in the dashboard as a run started here. `too_many_runs` names the cap and returns.
- **Port.** `@indaba/tui` declares its own `RunControlPort` (`list`, `start`, `startStatus`, `stop`, `isAlive`, `detach`, `stopAll`) from wire types that `@indaba/engine` re-exports; the CLI satisfies it from `createRunControl`, which gains `detach()` (releases the live children without stopping them). A refusal is recognised by `name === 'RunControlError'` and a string `code`, as the server does.
- **Detach.** `release()` closes the channel and `bin.ts` has no disconnect listener, so a released run is not cancelled; a test locks that in. The confirmed copy under `.indaba/run-inputs` stays after a detach; the sweep now removes only copies older than a threshold that is longer than the start timeout, so a second process cannot delete a copy a child has not parsed. Deleting the copy from the child is left out (a gap).
- **Stop.** `s` on a run this screen started asks once, names the run, and calls `stop`; a run started by another process says so and is not stopped. `ended` says it had finished; `undefined` says it is not known here.
- **Inputs** (2.5, AC-03) go to a later feature, `tui-run-inputs`, blocked on `workflow-inputs`.

## Artifacts not written

- `research.md`: nothing external is relied on.
- `data-model.md`: no data is added.
- `events.md`: no new event; the runs emit what they emit today.
