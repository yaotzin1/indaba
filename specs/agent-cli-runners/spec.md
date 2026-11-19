# Specification: More agent CLI runners (GitHub Copilot CLI, Junie, Kimi Code, omp)

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code.
> **Stage entry**: 1 (the decisions in section 8 are recommended; the maintainer confirms them)
> **Semver impact**: minor (below 1.0): new built-in runners and, where a CLI speaks ACP, new ACP presets. Nothing that has
> been released changes. Provisional; confirmed in [`api-surface.md`](api-surface.md).
> **Builds on**: [`specs/runner-adapters`](../runner-adapters/spec.md) (the runner contract and the CLI runners),
> [`specs/transport-priority`](../transport-priority/spec.md) (runner lists, "could not run" versus "ran and failed"),
> [`specs/agent-permissions`](../agent-permissions/spec.md) (the capability of each runner for each level),
> [`specs/host-process-containment`](../host-process-containment/spec.md) (the environment a runner gets),
> [`specs/acp-agent-install`](../acp-agent-install/spec.md) (the presets and the installer).
> **Origin**: a comparison with Cezar (2026-11-19), which added runners for Gemini CLI, GitHub Copilot CLI, Cursor Agent,
> Junie, Kimi Code, Antigravity and omp on top of Claude Code, Codex and OpenCode.

---

## 1. The problem

Indaba's strength is agents of different vendors cross-examining each other. Today it has runners for Claude, Codex,
OpenCode, Cursor and Antigravity, ACP presets for `claude`, `codex`, `gemini` and `opencode`, an OpenRouter runner and a shell
runner. An author who wants GitHub Copilot CLI, Junie, Kimi Code or omp in a debate, or as the second runner of a list,
writes a plugin runner first. Every extra vendor is one more independent opinion in a debate, so the gap is felt exactly
where Indaba is meant to be strong.

## 2. User stories

- **US-01.** As a workflow author, I name `copilot`, `junie`, `kimi` or `omp` as an agent, in a step, a debate or a runner
  list, and it runs like the built-in ones.
- **US-02.** As a person running a workflow, a CLI that is not installed is reported as "could not run", so the next runner
  of the list takes over.
- **US-03.** As an author, I see in `indaba catalog` and the editor what each runner can do (permission levels, MCP) and
  what it cannot, without running it.
- **US-04.** As a maintainer, I add the next CLI without editing the engine: a runner is a small class or a preset, with
  the same tests as every other.

## 3. Acceptance criteria

- [ ] AC-01. For each of `copilot` (GitHub Copilot CLI), `junie`, `kimi` (Kimi Code) and `omp`, a runner is registered
      under that name, listed by `indaba catalog`, and accepted by the parser and `diagnose` wherever an agent name is.
- [ ] AC-02. A CLI that documents the Agent Client Protocol is added as an ACP **preset** (structured events, the permission
      gate of `agent-permissions`), not as a new class. A CLI that does not is a `CliRunner` that reads its terminal output,
      as `CursorRunner` does. Which of the two a CLI gets is recorded from its own documentation (C-01), not assumed.
- [ ] AC-03. Every runner builds an argument **array**, never a shell string; on Windows it points at a native executable
      and never at an npm `.cmd` shim.
- [ ] AC-04. Every runner's `permissionCapabilities()` states, per level (`read`, `edit`, `full`), what the CLI can enforce.
      A level whose argument is not confirmed in the CLI's documentation is `unsupported` with a reason, as in `CursorRunner`;
      no runner claims a level it has not confirmed.
- [ ] AC-05. Every runner passes the child process only the environment `host-process-containment` allows plus a short list
      of prefixes for that CLI's own variables (for example the vendor's key and base URL). No other variable passes.
- [ ] AC-06. A missing binary, a binary that does not start, or a CLI the host cannot run throws `RunnerUnavailableError`, so
      `transport-priority` falls through to the next runner. A CLI that ran and returned a failure is a failed `RunResult`.
- [ ] AC-07. Each runner passes the runner contract cases of `create_runner` with a `ProcessSpawner` fake: success, non-zero
      exit, timeout, abort, missing binary, large output; plus one real run of a tiny `node -e` program as an argument vector
      so the case works on every OS. No unit test depends on a real agent CLI.
- [ ] AC-08. `model` is passed through only when the CLI documents a model argument; otherwise a step that sets `model` for
      that runner fails validation with a message, rather than the value being dropped silently.
- [ ] AC-09. The runner keeps the CLI's own wording of a limit or an authentication failure in the output it returns, and
      does not interpret it. Recognising a limit is `limit-handoff` (its T-01 gathers the real signals).
- [ ] AC-10. A CLI whose documented non-interactive mode cannot be confirmed is **not shipped**. It stays in section 4 until it
      can be, and `docs/` says which runners exist.
- [ ] AC-11. `docs/` and the runner table in `README.md` name each added runner, its binary, what it needs (key, login) and
      the permission levels it can enforce. No runner is described as supporting what AC-04 marks unsupported.

## 4. Non-goals

- `gemini` as a CLI class: it is already an ACP preset. Whether a Gemini-specific class adds anything over the preset is
  not decided here.
- Installing the CLIs. `acp-agent-install` owns installation of ACP agents; for the others the person installs the binary.
- Signing in, token storage or any credential handling: the CLI owns its own login.
- Parsing a CLI's private stream formats beyond what its documentation promises.
- Cursor and Antigravity: they exist already.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the binary is not on the path | `RunnerUnavailableError`; the next runner of the list is tried |
| the CLI exits non-zero | failed `RunResult` with the exit code and the tail of the output; `on_failure` applies as today |
| the timeout elapses or the run is cancelled | the whole process tree is killed; as every CLI runner today |
| the CLI prints a limit or login message | returned as output, unchanged (AC-09); a failed result |
| a requested permission level is unsupported | the parser or `diagnose` reports it before the run, as `agent-permissions` already does |

## 6. Security and data handling

- The prompt reaches the CLI as an argument or on standard input, never through a shell.
- The environment is an allow-list (AC-05); secrets are in no trace, event, exception or artifact, as everywhere.
- A runner that cannot confine an agent to read-only says so (AC-04); the permission model refuses the level instead of
  trusting the CLI.

## 7. Where it lives

`@indaba/runners`: one file per CLI runner extending `AbstractCliRunner`, or an entry in `ACP_AGENT_PRESETS`;
`RunnerRegistry`'s default list. `@indaba/core` is untouched. `indaba`: the composition root registers them as it does the
others. No dependency added.

## 8. Clarifications

- **C-01 (task, before any code).** For each CLI, record from its **own** documentation: the binary name, the
  non-interactive flag, whether it speaks ACP and with which flag, the model flag, the permission flags and the environment
  variables it reads. The record goes in `research.md` (created then). Nothing in this spec asserts those facts.
- **C-02 (recommended).** One runner per slice, in the order the maintainer picks, each its own pull request, so a CLI that
  cannot be confirmed (AC-10) does not hold the others back.
- **C-03 (recommended).** Names are the short ones above (`copilot`, `junie`, `kimi`, `omp`); a longer alias is added only if
  a vendor's own name differs.

## Artifacts not written

- `plan.md`: stage 3 has not begun; the shape is one class or preset per CLI.
- `tasks.md`: stage 4 has not begun.
- `data-model.md`: nothing is stored.
- `research.md`: written when C-01 is done, before implementation; it needs each CLI's documentation, which this change does
  not fetch.
- `events.md`: no event is added; the existing runner spans carry the runner name.
