# Self-review: Transport priority

> **Status**: self-review done by the implementer on 2026-10-05, before any pull request. It has not
> been reviewed by anyone else. Nothing was run against a real ACP agent (see Known gaps).

Answers to the seven questions in [`.agents/rules/review.md`](../../.agents/rules/review.md).

## 1. Boundary and layering

- `@indaba/core` gained only pure code: `runnerChain`, the two error classes, `matchesGlob`/`matchesAny`,
  `Span.addEvent`, the permission and agent types, and fields on existing interfaces. It still imports no
  `node:` module; the architecture test is green. `errors/index.ts` imports a *type* from `runner/`, which
  is erased at build time, so there is no runtime cycle.
- `@indaba/engine` holds the decisions that need the workflow: the chain walk, precedence, the implied
  guard, and `DiffWithinScopeGuard` (the only new code that runs git). It does not import the runners
  package; the layers test is green.
- `@indaba/runners` holds everything that touches a process or the network. `AcpConnection` and the policy
  module are internal; only the runner, presets, the spawner interface and `openAiCompatibleFromEnv` are
  exported.
- The CLI is the only place that names concrete runners and reads `INDABA_OPENAI_COMPAT_*`. Environment
  endpoints register through `PluginHost.registerRunner`, the door a plugin uses. The ACP runner and the
  generic API runner get no access an external runner lacks.

## 2. Determinism and failure isolation

- The chain walk reads no clock, id or environment. The ACP runner and the API runner use
  `performance.now()` for `durationMs`, as the existing runners do; neither is decision logic.
- Retry isolation: every candidate receives the original request (`{ ...request, mcpServers }`), never
  anything an earlier candidate produced. A test asserts the fallback prompt does not contain the first
  runner's failure text.
- The fallback boundary is a type, not a guess: only `RunnerUnavailableError` advances the chain. The ACP
  runner throws it only until it has written `session/prompt`; a test ends the agent right after the
  prompt and asserts a failed result, not a thrown error. A plain `RunnerError` mid-stream fails the step
  (tested).
- Abort: `signal.throwIfAborted()` runs before each candidate, so a cancelled run never advances; the ACP
  runner sends `session/cancel`, waits a bounded grace, then ends the process tree. A test covers abort
  before the prompt, after it, and an agent that ignores the cancel.
- Every run ends the child: `session.kill()` is in a `finally`, and a real-process test checks that a
  silent agent is stopped on timeout and on abort.

## 3. Public surface and semver

Classified **minor** (below 1.0) at stage 3. The additions are in `api-surface.md`, and its
"Amendments made during stage 6" table lists every difference between the plan and what was built.
Two behaviour changes would be majors after 1.0 and are in the CHANGELOG under "Changed":

1. A step with both `role` and `runner` now uses the step's `runner` (the role's used to win silently).
2. `openrouter` now throws `RunnerUnavailableError` for no response at all and for HTTP 401 or 403 (it
   returned a failed result for those two).

Other existing behaviour is pinned: a test checks the `openrouter` request body, URL and messages are
unchanged, and an existing test that listed exactly six built-in runners now lists seven.

## 4. Security

- **Processes:** the agent command is an argument vector, never a shell string; a start failure names only
  the program and the error code. The child's environment is an allowlist (baseline, the preset's own
  prefixes, `INDABA_ACP_PASS_ENV`), not the parent's; a test shows an unrelated `OPENROUTER_API_KEY` does
  not reach a real child process.
- **Untrusted JSON-RPC:** line length and message count are bounded; invalid JSON, a wrong version or an
  invalid id fail the connection; a response to nothing we asked is ignored; an internal handler failure
  is answered as "Internal error" without its text (tested with a path in the message).
- **Paths:** file requests must be absolute, inside the real path of the working directory, with symlinks
  resolved on the deepest existing ancestor; `.git` and `.indaba` segments are refused in any case; a
  write through a link is refused; size is capped. Tests cover relative paths, `..`, an absolute path
  outside, git internals in two cases, and a junction/symlink out of the directory.
- **Permissions:** only `allow_once` or `reject_once` are ever selected; with neither offered the answer
  is `cancelled`. Without a `permissions` block, edit, delete, move and execute are refused.
- **Secrets:** the API key is a private field; an unreachable-endpoint error carries no `cause` (the cause
  held the key; found by an existing test and fixed); agent stderr in a message is redacted of any
  secret-looking variable value we passed on; events carry kinds, statuses and counts only (tested with a
  path in a tool title).
- **Endpoints:** a base URL must be `http(s)` without credentials; endpoints come only from the
  environment, never a workflow file; a built-in name cannot be redefined.
- `scripts/security-audit.mjs --source` reports no findings.

## 5. Observability and honest numbers

- `indaba.runner.skipped` (runner and a bounded, redacted reason) is recorded for each skipped
  candidate; `invoke_agent <runner>` spans exist per attempt. The skipped runner's own span ends in
  `error`, which is true but may look alarming in a trace viewer.
- ACP events: `session`, `tool_call`, `plan`, `permission`, `usage`, `completion`.
- No invented numbers: ACP reports context occupancy and an optional cost, not an input/output split, so
  `TokenUsage` is never filled from it. A cost is used only when the agent reports it in USD; another
  currency is dropped, not converted. Context numbers appear only as event attributes named `acp.*`, not
  as `gen_ai.*`.
- The JSONL file adds `events` only to spans that have some; a test shows a span without events is
  written as before.

## 6. Dependencies and packaging

No dependency was added or changed: JSON-RPC is hand-written (research.md, question 1); `yaml` and the
optional `node-pty` are untouched; no `package.json` changed. `pnpm smoke` (pack, install the tarballs in
a clean directory, boot the CLI) passes. The ACP presets run `npx`, which downloads code at run time;
this is documented and overridable (`agent: { command: [...] }`).

## 7. Verification

Run on Windows 11, Node 22.20, on 2026-10-05. macOS and Linux run only in CI.

```
$ pnpm qa
Checked 107 files in 71ms. No fixes applied.
 Test Files  27 passed (27)
      Tests  405 passed (405)

$ node scripts/check-workflow.mjs
workflow.ai.yml matches the repository
$ node scripts/security-audit.mjs --source
security audit: no findings (source, manifests, tsconfig, biome.json)
$ node scripts/sync-agent-docs.mjs --check
AGENTS.md, GEMINI.md and the cycle file are in sync (4 tracks, 8 stages, 23 skills, 8 gates, 17 rules)
$ node scripts/validate-skills.mjs      -> All 23 skills validated successfully
$ node scripts/sync-claude-skills.mjs --check -> .claude/skills is in sync (23 skills)
$ node --test scripts/*.test.mjs        -> tests 38, pass 38, fail 0
$ pnpm smoke
smoke-pack: 4 packages packed, installed and booted (indaba 0.1.0-alpha.0)
```

Coverage over `packages/*/src`, measured with Vitest's v8 provider (the 85% floor is enforced on the
`chore/test-coverage` branch, not on this branch's base; measured here for the record):

```
All files          |   92.82 |     85.8 |   94.29 |   93.14 |   (statements, branches, functions, lines)
```

A manual end-to-end run through the built CLI: with no `OPENROUTER_API_KEY`, a role `[openrouter, acp]`
whose agent was the repository's scripted ACP agent in a real child process completed, and the trace held
the `indaba.runner.skipped` event for `openrouter` and the `indaba.acp.session` and
`indaba.acp.completion` events. `indaba validate` and `plan` ran on both new examples.

## Known gaps

- **Little real-agent coverage.** The ACP runner has been exercised against a scripted fake in-process and a
  scripted child process. A first run against the real Gemini CLI (0.52.0) confirmed `initialize` and
  `session/new` and found that it needs an explicit login (`authenticate`), which is now supported
  (AC-15, AC-16). Claude and Codex, and an actual completed turn with Gemini, are still unverified. Their real behaviour (login
  requirements, which tool kinds and locations they report, how they react to a refused permission) may
  differ. Condition to close: a manual run against each, recorded here.
- **Consensus steps ignore `permissions` and `agent`.** Participants of a consensus are built from role
  data and `RunnerParticipant` does not carry them, so a consensus over ACP is not gated or given an agent
  preset. `validate` does not warn. Condition: a debate that edits files; until then, keep consensus on
  API runners (as in the example).
- **Role-level `permissions`** do not exist; they are per step.
- **A blank entry in `agent.command`** (`[""]`) is not rejected at parse time; it fails at run time as a
  runner that could not run.
- **Platforms:** the real-process tests ran on Windows only here. The symlink test does nothing on a
  machine that cannot create links without privilege, so it can pass without testing that case.
  Linux and macOS are covered by CI, which has not run yet.
- **No mutation testing** was run (it lives on the unmerged `chore/test-coverage` branch).
- **Environment allowlist** may omit a variable an agent needs; `INDABA_ACP_PASS_ENV` is the escape, and
  the guide says so.
- **Only HTTP 401 and 403** count as "key rejected" for the API runner; other errors (including 5xx)
  are failed results and do not fall back. Deliberate: the request may have been processed.
