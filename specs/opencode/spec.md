# Specification: OpenCode integration

> **Status**: Draft (stage 1 written 2026-10-08; stage 2 questions open in section 8)
> **Stage entry**: 1
> **Semver impact**: minor (provisional; confirmed in api-surface.md)

---

## 1. The problem

OpenCode (opencode.ai) is an open-source coding agent that works with many model providers. Indaba
cannot start it by name today. A workflow author can reach it only by writing
`agent: { command: [opencode, acp] }` by hand and knowing which environment variables to let through,
and there is no CLI runner, so a role cannot say `runner: opencode`. OpenCode documents two headless
entry points, both usable without a shell:

- `opencode acp`: an ACP server over stdio (nd-JSON). It keeps OpenCode's built-in tools, MCP servers
  from its own configuration, `AGENTS.md` rules and its permission system.
- `opencode run [prompt]`: non-interactive, with `--model provider/model`, `--format json` (raw JSON
  events), `--dir` and `--auto` (auto-approve permissions that are not explicitly denied).

Source: opencode.ai/docs/cli and opencode.ai/docs/acp, read 2026-10-08. The flags are the documented
ones, not yet exercised: OpenCode is not installed on the development machine.

## 2. User stories

- **US-01.** As a workflow author, I write `agent: "opencode"` on a role whose runner is `acp` and get
  OpenCode as an agent that edits code, under the same permission gate and `diff_within_scope` guard as
  the other ACP agents.
- **US-02.** As a workflow author, I can list OpenCode in a fallback chain, for example
  `runner: ["acp", "opencode"]`, so a missing ACP route falls back to its CLI.
- **US-03.** As a person running Indaba, `indaba plan` and the trace say that OpenCode ran, by which
  transport, and with which model.

## 3. Acceptance criteria

- [ ] AC-01 `agent: "opencode"` resolves to the command `opencode acp`, never through a shell.
- [ ] AC-02 The preset passes on only the environment prefixes it needs (to be fixed in stage 2).
- [ ] AC-03 If the `opencode` binary is absent, the runner "cannot run" and the next runner in the chain
      is tried; the message names the fix and holds no secret.
- [ ] AC-04 A CLI runner named `opencode` (if stage 2 keeps it) builds `opencode run --model <m> <prompt>`
      as an argument vector, honours timeout and abort, and kills the process tree.
- [ ] AC-05 Without `permissions`, edits and commands are refused as for every ACP agent; the CLI runner
      never adds `--auto` on its own, only through `extraArgs` (as `AntigravityRunner` does for its
      permission-skipping flag).
- [ ] AC-06 No unit test depends on a real OpenCode.
- [ ] AC-07 The docs carry a snippet for each transport and the CHANGELOG an Added entry.

## 4. Non-goals

- Starting or managing an `opencode serve` server, or `--attach` to a remote one.
- Writing OpenCode's own configuration, credentials or `auth.json`; Indaba never touches them.
- Bridging Windows and WSL (running `wsl.exe`, translating paths): to use OpenCode in WSL, Indaba is installed in WSL too.
- Installing OpenCode (`npx` or a package manager); the binary must already be there.
- Mapping OpenCode's `/undo` and `/redo` (unsupported over ACP by OpenCode itself).
- Parsing `opencode stats` for cost; usage comes from what the protocol reports, else it is unknown.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| `opencode` is not on PATH | cannot run; next runner of the chain, else the step fails and names it |
| the ACP handshake fails | cannot run; same |
| the process exits non-zero after starting | the step fails; the next runner is not tried |
| the timeout elapses or the run is cancelled | the process tree is killed; step failed or cancelled as for other runners |
| no provider credentials for the chosen model | OpenCode's own error is surfaced, redacted |

## 6. Security and data handling

Untrusted: the prompt and any model output. The prompt travels over ACP or as one argument, never in a
shell string. The credential variables the provider needs are passed from the caller's environment by
prefix and appear in no trace, event or exception. `--auto` is never added by Indaba. On Windows the
`opencode` executable may be an npm `.cmd` shim, which Indaba does not start; the docs say to point
`agent.command` at the native binary.

## 7. Where it lives

Infrastructure, in `@indaba/runners`: a preset in `acp-runner.ts` (data, no new class), and optionally
`opencode-runner.ts` extending `AbstractCliRunner`, registered by the CLI composition root through
`PluginHost` like the others. Nothing in `@indaba/core` changes.

## 8. Clarifications

Question 3 is open; it is settled by a real run, and until then the role model is not forwarded over ACP:

1. **Scope. Resolved 2026-10-08 (maintainer):** transport priority is always ACP, then API, then CLI, as in
   `specs/transport-priority`. OpenCode therefore gets the ACP preset (`agent: "opencode"`) and a small CLI runner
   (`runner: opencode`, `opencode run`) kept for the limited cases where ACP cannot be used (the maintainer
   expects it to be a rare fallback, so it gets no features beyond the contract), so `runner: ["acp", "opencode"]` is the
   documented chain. OpenCode has no hosted model API of its own; the API tier for its models is the
   existing `openrouter` runner, listed between the two when a role wants it. Driving `opencode serve`
   over HTTP stays a non-goal.
2. **Environment prefixes. Resolved 2026-10-08 (maintainer):** `OPENCODE_`, `ANTHROPIC_`, `OPENAI_`, `GOOGLE_`,
   `GEMINI_` and `OPENROUTER_`. Each is a default every consumer inherits.
3. **Model selection.** Over ACP the model is OpenCode's own configuration; does a role's `model` apply?
   To be settled by a real run before the api-surface is written.

## Artifacts not written

- `data-model.md`: no new entity; a preset and a runner class only.
- `research.md`: the sources are cited in section 1; nothing was compared.
- `events.md`: no new event or span; the existing runner span and `indaba.runner.skipped` event cover it.
