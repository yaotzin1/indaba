# Specification: Run preview (start the app a run produced, so a person can look at it before it is merged)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: minor (below 1.0): new optional workflow field `preview`, new command, new events and attributes. The
> default (no `preview` field) keeps today's behaviour. Provisional; confirmed in [`api-surface.md`](api-surface.md).
> **Builds on**: [`specs/git-workspace`](../git-workspace/spec.md) (the run worktree and a step's worktree),
> [`specs/parallel-steps`](../parallel-steps/spec.md) (a finished step's worktree, reviewed before landing),
> [`specs/host-process-containment`](../host-process-containment/spec.md) (the environment and process tree of a child),
> [`specs/run-integration`](../run-integration/spec.md) (what happens after a person has looked).
> **Origin**: a comparison with Cezar (2026-11-19), whose Preview starts the application of a task by itself.

---

## 1. The problem

A run that builds or changes an application ends with files in a worktree. To see whether it works, a person finds the
worktree under `.indaba/worktrees/`, works out the command, installs, picks a free port and remembers to stop it. For several
parallel runs that is repeated and the processes are left behind. The review before landing (`parallel-steps`) and a gate
(`review-gate`) ask a person to decide, and the best evidence for a decision about an app is to see it running.

## 2. User stories

- **US-01.** As a workflow author, I say once how the application of this project starts and when it is ready.
- **US-02.** As a person reviewing a run or a finished step, I press Preview and get an address to open, without knowing
  where the worktree is or which port is free.
- **US-03.** As a person, I see the application's output and when it stopped, and I stop it myself at any time.
- **US-04.** As a person, a preview is never left running after the run is done, removed or aborted.
- **US-05.** As a developer embedding the engine, I replace how a preview is started (a container, a remote machine) through the
  plugin contract.

## 3. Acceptance criteria

### Declaring it

- [ ] AC-01. A workflow may declare `preview` with: `command` (an argument array, never a string), optional `install` (an
      argument array run once first), `ready` (a path on the local address that answers when the app is up, or a text its
      output prints), `port_env` (the name of the variable the app reads its port from), `timeout_seconds` for the start
      (default 120) and `max_minutes` for how long it may run (default 30).
- [ ] AC-02. No `preview` field, no preview: nothing is started by guesswork. Indaba does not infer a command from the
      project's files.
- [ ] AC-03. `diagnose` and the parser reject a `command` that is a string, an empty array, or that names a path outside the
      worktree.

### Starting and stopping

- [ ] AC-04. `indaba preview <run> [<step>]` starts the declared command in the run's worktree, or in the named finished step's
      worktree (a step that has not landed). It prints the address. It refuses a run whose worktree is already removed.
- [ ] AC-05. Before starting, the command and the directory are shown to the person and confirmed once, as a full-access run
      is (`agent-permissions`); `--yes` skips only that prompt. A preview never starts by itself, from a workflow, a tracker
      event or an agent.
- [ ] AC-06. The port is chosen by Indaba from the free ones on the loopback address and given to the app in the variable
      `port_env` names; the app is told to listen on `127.0.0.1`. The address printed is `http://127.0.0.1:<port>`. Nothing
      binds to another interface.
- [ ] AC-07. Ready means `ready` answered (a `GET` with a short timeout, redirects not followed to another host) or the text
      appeared, within `timeout_seconds`. If not, the preview is stopped and reported `failed` with the tail of its output.
- [ ] AC-08. At most one preview per run runs at once (a second `indaba preview` on the same run returns the address of the
      first). At most `--max-previews` run on the host (default 3); beyond it the command refuses and names the ones running.
- [ ] AC-09. A preview stops when: the person stops it, `max_minutes` elapse, the run ends, is stopped or is removed, the step
      lands or fails, or `indaba` exits. The whole process tree is killed, as for a runner.
- [ ] AC-10. `indaba previews` lists the running ones; `indaba preview <run> --stop` stops one.

### Environment and output

- [ ] AC-11. The child gets the environment `host-process-containment` builds, plus the port variable and the variables the
      workflow's `preview.env` names from the host's environment (a list of names, never values). Nothing else passes.
- [ ] AC-12. The child's output is captured, bounded, shown in the views and passes through the redaction of `logging`.
- [ ] AC-13. Events: `preview.started`, `preview.ready`, `preview.stopped` (with the reason: person, time, run ended, landed,
      failed, exit), `preview.failed`. Span attributes on a span of its own: `indaba.preview.run`, `.step`, `.port`,
      `.outcome`, `.seconds`.
- [ ] AC-14. The web view and the dashboard offer Preview on a run or finished step that has `preview` declared, show the
      address (the web view as a link that opens in a new tab with `rel="noopener noreferrer"`), the output and Stop. Each
      action has a keyboard path.
- [ ] AC-15. The contract is `PreviewHost` in `@indaba/core`, registered through `PluginHost`. The built-in one starts a local
      process; a plugin can start a container or anything else. The built-in gets no access a plugin lacks.

## 4. Non-goals

- Hosting or sharing a preview: no tunnel, no public address, no authentication of visitors.
- Editing the running application from the page, or any design-editing mode.
- Screenshots, recordings or automated checks of the running app (a guard or a step does that).
- Inferring how to start a project, detecting its framework, or installing system packages.
- Databases and services the app needs: `install` and `command` may start what they like inside the worktree, but Indaba
  provisions nothing.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| `install` exits non-zero | the preview ends `failed` with the tail of the output; nothing else runs |
| the app never becomes ready | stopped at `timeout_seconds`; reported `failed` (AC-07) |
| the app exits by itself | `preview.stopped` with reason `exit` and the exit code; the address is no longer offered |
| the run is stopped or removed while a preview runs | the preview is stopped first (AC-09), then the worktree is removed |
| the host has no free port in the range tried | refused with a message; nothing started |
| `indaba` is killed | the child may outlive it; the next `indaba previews` finds the recorded process and stops it, and says so |

## 6. Security and data handling

- The command comes from the workflow file, which is as trusted as the steps in it, and it is shown and confirmed before it
  runs (AC-05). A workflow from an unknown repository is not run on trust: the confirmation names the directory and the
  command in full.
- Arguments are an array; no shell. Paths are confined to the worktree. The address is loopback only.
- The environment is an allow-list (AC-11). Secrets are in no event, trace, log or artifact.
- A previewed application is untrusted code written by an agent. It runs as the person's user, like any step's work;
  isolating it further is `agent-sandbox`'s business and a `PreviewHost` plugin's.

## 7. Where it lives

`@indaba/core`: the `preview` model, `PreviewHost`, the events (pure types). `@indaba/engine`: the built-in `LocalPreviewHost`
(spawn, port, ready check, tree kill, the record of running previews), the parser and `diagnose` rules. `indaba`: `preview`,
`previews`. `@indaba/tui`, `@indaba/server`, `@indaba/web`: the control and the output. No dependency added.

## 8. Clarifications

- **C-01 (recommended).** Declare, never infer (AC-02): a guessed command is an unreviewed command.
- **C-02 (recommended).** Loopback only and one confirmation (AC-05, AC-06): the first version cannot expose anything.
- **C-03 (open).** Whether the confirmation of AC-05 is remembered for a workflow file whose `preview` has not changed. The
  text asks every time; the maintainer decides.
- **C-04 (open).** The defaults of AC-01 and AC-08 are proposals.

## Artifacts not written

- `plan.md`: stage 3 has not begun.
- `tasks.md`: stage 4 has not begun.
- `data-model.md`: the record of running previews is a small file under `.indaba/`; its layout is decided at stage 3.
- `research.md`: nothing outside the repository is needed.
- `events.md`: the events are listed in AC-13.
