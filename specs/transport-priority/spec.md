# Specification: Transport priority (API and ACP first, CLI as fallback)

> **Status**: Draft
> **Stage entry**: 1
> **Semver impact**: minor (provisional; confirmed in api-surface.md; below 1.0)

---

## 1. The problem

Every agent that is not an HTTP endpoint is reached today by driving its terminal CLI, through a
pseudo-terminal where `node-pty` loads and piped stdio otherwise. That is the most fragile way to
talk to an agent: output is scraped from a screen-oriented program, behaviour changes with CLI
releases, `node-pty` has no prebuilt binary on some platforms, and on Windows an npm `.cmd` shim
cannot be started at all. Meanwhile the only structured transport, `OpenRouterRunner`, is a single
vendor.

A workflow author also cannot say "use the API, and if it is unavailable use the CLI": a role names
exactly one runner, and a runner that cannot run fails the step.

## 2. User stories

- **US-01.** As a workflow author, I list runners for a role in priority order, so that a structured
  transport is used when available and a CLI is only the last resort.
- **US-02.** As a workflow author, I use any OpenAI-compatible endpoint (OpenRouter, OpenAI, a local
  server) by configuration, without a code change.
- **US-03.** As a workflow author, I drive an agent that speaks the Agent Client Protocol (ACP)
  without scraping its terminal.
- **US-04.** As a developer embedding Indaba, I add another API client or protocol as a plugin
  runner and it takes part in priority and fallback like a built-in.
- **US-05.** As a person running a workflow, I can see in the trace which runner of the list actually
  ran and why earlier ones were skipped.

## 3. Acceptance criteria

- [ ] AC-01. A role's `runner` accepts either one name (unchanged) or an ordered list of names.
- [ ] AC-02. The engine tries the list in order and moves to the next entry only when a runner
      **could not run** (`RunnerError`: unavailable, missing credential, binary or `node-pty` absent,
      connection refused, ACP handshake failed). A runner that ran and returned a failed
      `RunResult` is a failed task: it is not a reason to fall back, and `on_failure` handles it.
- [ ] AC-03. A fallback never replays after a partial run: the next runner receives the original
      prompt only, with no output from the runner that could not run. Retry isolation is unchanged.
- [ ] AC-04. If every runner in the list could not run, the step fails with one error naming each
      runner and its reason, containing no secret.
- [ ] AC-05. A generic OpenAI-compatible runner is configured by base URL, API-key environment
      variable name and default model; `openrouter` remains and behaves as before (a preset of it).
- [ ] AC-06. One generic `acp` runner speaks ACP (JSON-RPC over stdio) to any ACP agent. The agent
      is configuration (`agent:` preset name, or `command` + `args`), not a new runner class per
      tool. It maps session updates to `onOutput`, maps cancellation and timeout to ACP cancel and
      then process teardown. It targets ACP protocol v1 and treats any other negotiated version as a
   `RunnerError`. ACP reports context occupancy and optional cost, not an input/output token split,
   so the runner reports cost when present and never fills `TokenUsage` from it.
- [ ] AC-12. The ACP runner is the permission arbiter. It serves the agent's file requests only inside
      the step's declared scope (paths confined to the worktree and to the step's `scope` globs) and
      answers `session/request_permission` from the step's declared policy; anything outside is
      rejected at the protocol level and recorded. With no policy declared, the default is deny.
- [ ] AC-14. A new guard type (working name `diff_within_scope`) fails the step when the worktree
      diff touches a path outside the step's `permissions.fs.write` globs (a `permissions` block
      without `fs.write` means the step may change nothing). It works for every
      runner, so it is the enforcement that holds when an agent bypasses the ACP client methods, or
      when the list fell back to a CLI runner. Only `git_diff_empty` exists today; this is new
      surface and is added through the guard contract, with no privileged access.
- [ ] AC-13. ACP session updates (plan, tool call, tool result, file edit, completion) are recorded as
      span events on the step span, with secrets redacted.
- [ ] AC-07. CLI runners (`claude-code`, `codex`, `antigravity`, `cursor`) are unchanged in
      behaviour but are never selected unless a workflow names them; the documentation and examples
      present API and ACP first and CLI last.
- [ ] AC-08. API and ACP runners are registered through `PluginHost.registerRunner` the same way an
      external one would be (no privileged access).
- [ ] AC-09. The span for a step records the runner that ran, and a span event per skipped runner
      with the reason.
- [ ] AC-10. `validate` rejects an empty list, a duplicate name in one list, and unknown names, at
      parse time, with the field path.
- [ ] AC-11. Consensus steps resolve each speaker's list the same way.

## 4. Non-goals

- Automatic transport discovery, or choosing a runner from a capability or cost model.
- Fallback on a failed result, a timeout of a running agent, or a guard failure: that is `on_failure`.
- Running two runners in parallel or racing them.
- A native Anthropic Messages runner and other vendor clients in this change. The generic runner
  and the plugin contract are the extension path; each further client is its own feature.
- Hosting an ACP server (Indaba as an ACP agent).
- Treating the permission gate as a security boundary on its own. An agent can write to disk without
  asking the client; the git worktree remains the isolation boundary and the gate is a second layer
  that rejects out-of-scope work early and makes it visible.
- Removing or deprecating any CLI runner.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| a runner throws `RunnerError` | skip event recorded, next runner in the list is tried |
| the last runner throws `RunnerError` | step fails, error lists every runner and reason |
| a runner returns a non-zero `RunResult` | no fallback; step fails and `on_failure` applies |
| the timeout elapses on a running agent | no fallback; runner kills what it started, result says so |
| the run is cancelled | the signal aborts the active runner; no further runner is tried |
| ACP agent exits or sends malformed JSON-RPC before the prompt is accepted | `RunnerError` (fallback); after the prompt is accepted, a failed `RunResult` |
| the agent asks for a file or tool outside the step's scope | request rejected over ACP, span event recorded, the run continues; the agent decides what to do |
| the agent's output contains a secret-looking string | redacted as for every runner |

The boundary is "before the agent has been given the prompt" versus after. Before it, nothing has
happened and falling back is safe; after it, the agent may have changed the worktree, and a silent
second attempt would be wrong.

## 6. Security and data handling

ACP agent command lines are argument arrays, never a shell string; the agent's environment is
explicit. JSON-RPC frames from the agent are untrusted: size-bounded, parsed with a schema, never
reaching a shell, a path or a log unredacted. Paths the agent asks the client to read or write are confined to the worktree and the step scope
(canonicalised, symlinks resolved) before any file is touched. API keys come from the
named environment variable only, are never traced or put in an exception message. The generic
runner's base URL is configuration, validated as `http(s)`; it is not derived from agent output.
See `.agents/skills/application_security/SKILL.md`.

## 7. Where it lives

- `packages/core`: the `runner` field's shape (a name or a list) in the workflow model, and the
  fallback decision as a pure function. No `node:` import.
- `packages/engine`: parser and validator for the list, `resolveRunner` and the fallback loop in the
  step executor, the span events.
- `packages/runners`: the generic OpenAI-compatible runner (from `OpenRouterRunner`), the ACP
  runner, registration. Only `RunnerRegistry` and the CLI composition root name concrete runners.
- Docs: `docs/workflow-format.md`, `docs/runners` pages, README ordering of transports.

## 8. Clarifications

Resolved unless marked open. Items 1, 4 and 5 follow the external review of this spec.

1. **ACP wire library: resolved.** Hand-written JSON-RPC 2.0 over stdio, no runtime dependency.
   `research.md` confirmed the headless v1 subset is small (newline-delimited messages, seven
   methods). Caveat: protocol v2, still alpha, drops the client `fs/*` and `terminal/*` methods, so
   the fs gate in AC-12 is v1-only and AC-14 is the portable enforcement.
2. **Which ACP agents are first-class: resolved.** An `acp` runner configured by `command` + `args`,
   with presets only for agents whose own repository documents the ACP command: `claude`
   (`npx @agentclientprotocol/claude-agent-acp`), `codex` (`npx @agentclientprotocol/codex-acp`) and
   `gemini` (`gemini --acp`). Others run through `command` + `args`. See `research.md`.
3. **ACP client capabilities and policy shape: resolved (shape), details to confirm in
   `research.md`.** The step declares a `permissions` block:

   ```yaml
   steps:
     implement:
       runner: [acp, claude-code]
       agent: claude-code
       permissions:
         fs:
           read: ["src/**", "tests/**"]
           write: ["src/**"]
         terminal: deny
   ```

   The ACP runner advertises the fs methods and serves them only inside these globs (and the
   worktree), and advertises no terminal capability while `terminal: deny`. No `permissions`
   block means deny. Agents that write to disk through their own child processes are not seen by
   the client: the worktree stays the hard boundary, and a post-run guard (AC-14) checks the
   resulting diff against `fs.write`.

   Two points to settle at stage 3: `agent` configures the `acp` entry only, so the CLI entry of the
   same list ignores it (the validator must say so, or the field moves under a per-runner object);
   and `permissions` applies to ACP only, since a CLI runner cannot honour it, so a list that
   falls back to a CLI runner while `permissions` is set must warn at validate time.
4. **Where the list is configured: resolved.** `runner` takes a name or a list at both
   `roles.<role>.runner` and `steps.<step>.runner`, same shape. A step's `runner` takes precedence
   over its role's.
5. **Generic runner name: resolved.** `openai-compatible`, configured by base URL, key variable name
   and default model. `openrouter` stays registered as a preset of it, so existing workflows are
   unchanged. Presets for local servers (vLLM, Ollama, LM Studio) are configuration, not new
   classes. Endpoints are added only through the environment (`INDABA_OPENAI_COMPAT_<NAME>_*`, read
   in the CLI composition root) or a plugin, never from the workflow file: a base URL in a file that
   may come from an untrusted source would let it redirect the API key. Decided by the maintainer.

## Artifacts not written

- `data-model.md`: no persisted state; the only new shape is the runner list in api-surface.md.
- `events.md`: no new event class; the span events are listed in api-surface.md. Revisit at stage 3
  if the dispatcher needs a typed event.
- None of the optional artifacts is missing except `data-model.md` and `events.md`, listed above.
