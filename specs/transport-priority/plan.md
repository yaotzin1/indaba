# Plan: Transport priority

Stage 3. Written after reading `step-executor.ts`, `parser.ts`, `validator.ts`, `model.ts`,
`guard/*`, `runner/index.ts`, `registry.ts`, `process.ts` and `openrouter-runner.ts`. Facts below
are from that code, not from the spec.

## What the code looks like today (and what it forces)

1. **A failure to run and a failed run are not distinguishable.** Every runner throws the one
   `RunnerError` for "could not start" (`process.ts:150`, `registry.ts:37`, `openrouter-runner.ts:52`)
   and, per its contract, returns a `RunResult` for a run that failed. But `RunnerError` is also
   thrown on the way (`mcp.ts:48`, mid-stream problems are possible), so "any `RunnerError` means
   fall back" would replay after partial work. Decision: a subclass **`RunnerUnavailableError`**
   that means exactly "nothing has been sent to the agent". Only it triggers fallback. A plain
   `RunnerError` still fails the step.
2. **The role beats the step today** (`resolveRunner`, `step-executor.ts:272`: a step with a role
   ignores `step.runner`). Clarification 4 says the step wins. This is a behaviour change for a
   workflow that sets both; recorded in api-surface.md.
3. **MCP resolution depends on the runner** (`this.mcp.resolve(workflow, step, role, runner)`), so a
   fallback re-resolves MCP for each candidate. A candidate that cannot supply a required MCP server
   is skipped with that reason, not failed.
4. **`ProcessSpawner.run` is one-shot**: no stdin channel, resolves when the child is gone. ACP is
   a bidirectional conversation, so it needs a second seam, not a change to the first.
5. **`Span` has attributes only, no events.** The skip record (AC-09) and ACP updates (AC-13) need
   `Span.addEvent`, a small core addition, and the JSONL exporter must write them.
6. **`GuardDefinition` is `{ type, paths }`** and guard types are open strings registered through
   `GuardRegistry`, so `diff_within_scope` needs no model change: `paths` are the allowed globs.
7. **There is no glob matcher and no glob dependency.** Both the guard and the ACP gate need one,
   so it is a small pure module in `@indaba/core` (no `node:`), with its own tests.
8. **Unknown runner names are only found at run time** (`RunnerRegistry.get` throws). AC-10 asks
   for parse-time rejection; the parser gets an optional runner lookup, like the guard registry it
   already takes.

## Modules touched

| Package | Change |
| :--- | :--- |
| `@indaba/core` | `runnerChain()`; `fallbackRunners` on role and step; `StepPermissions` and `permissions` on step; `RunRequest.permissions`; `RunResult.reportedCostUsd`; `RunnerUnavailableError`; `glob` module; `Span.addEvent` |
| `@indaba/engine` | parser (`runner` as name or list, `permissions`, runner lookup), validator (AC-10 and the two warnings), `resolveRunner` precedence, fallback loop and per-candidate MCP in `StepExecutor`, consensus participants use the same loop, implicit `diff_within_scope` guard, `DiffWithinScopeGuard`, exporter writes span events |
| `@indaba/runners` | `OpenAiCompatibleRunner` (the body of `OpenRouterRunner`, parametrised), `openrouter` registered as its preset; `AcpRunner` and `AcpConnection` (JSON-RPC over a streaming process); `StreamingProcessSpawner`; ACP agent presets; `RunnerUnavailableError` thrown at the existing "cannot start" sites; registry wiring |
| `indaba` (CLI) | passes the runner registry to the parser for `validate`; prints the skip reasons on a failed chain; composition root registers through `PluginHost` |
| docs | `docs/workflow-format.md`, `docs/extending.md`, README transport order, CHANGELOG, `specs/DEPENDENCY_MAP.md`, AGENTS.md map line |

## Design

### Runner chain and the fallback boundary (AC-01..04, 09, 11)

Core's `runnerChain(owner)` returns `[owner.runner, ...(owner.fallbackRunners ?? [])]`. The
executor picks the owner (step, else role) and walks the chain:

```
for name of chain:
  candidate = registry.get(name)            // unknown: RunnerUnavailableError
  mcp       = resolve MCP for candidate     // missing required: skip
  try  result = invoke(candidate, request)  // request is built fresh from the original prompt
  catch RunnerUnavailableError e: record skip(name, e.message); continue
  return result                             // any RunResult, success or not, ends the walk
all skipped: throw RunnerChainExhaustedError listing every runner and reason
```

The request never carries output from an earlier candidate (AC-03), so retry isolation is
unchanged. Cancellation: `signal.throwIfAborted()` before each candidate; an abort never advances
the chain. The exhausted error is a `RunnerError` (not "unavailable"), so the step fails and
`on_failure` applies.

### Permissions and the guard (AC-12, AC-14)

`permissions` is parsed into `StepPermissions { fsRead, fsWrite, terminal }`. `fsWrite` globs imply
an engine-added `diff_within_scope` guard, so the author declares scope once. The guard runs
`git status --porcelain --untracked-files=all` in the worktree and fails on any path outside the
allowed globs, listing them. It needs git isolation to be meaningful: a step with `permissions.fs.write`
and `isolation: none` is a validation **warning** (the diff then includes unrelated working-tree
changes). The guard is the enforcement that holds for every runner; the ACP gate is the early,
visible layer on top.

### ACP runner (AC-06, 12, 13)

- `StreamingProcessSpawner.start(spec)` returns a `ProcessSession`: `write(line)`, an async
  iterable of stdout lines, `stderr` chunks, `kill()`, `exited`. Piped stdio, never a PTY, argument
  array only. The real implementation wraps `spawn` with the same tree-kill used by
  `ProcessSpawner`; tests inject a fake that scripts an agent.
- `AcpConnection` is the JSON-RPC layer: request ids, pending map, newline framing, a bounded line
  length, notifications, and client-side handlers for agent requests. No runtime dependency.
- `AcpRunner.run`:
  1. start the agent, `initialize` with `protocolVersion: 1` and capabilities derived from
     `permissions` (fs methods advertised only when granted; `terminal` never);
  2. `authenticate` is not attempted: an agent that needs it throws `RunnerUnavailableError`;
  3. `session/new` with absolute `cwd` and `mcpServers` mapped from `RunRequest.mcpServers`;
  4. **the `session/prompt` request is written: from here nothing may throw
     `RunnerUnavailableError`**; failures return a failed `RunResult`;
  5. `session/update` chunks go to `onOutput` and span events; `request_permission` is answered by
     the policy; `fs/*` requests are served through `confine()` (canonical path inside worktree and
     matching the globs) or refused;
  6. `stopReason`: `end_turn` is exit 0, `cancelled` is the abort code, `max_tokens`,
     `max_turn_requests` and `refusal` are non-zero with the reason as the failure text.
  7. timeout or abort: send `session/cancel`, wait a short grace period, then kill the tree.
- **Permission policy.** Select the first offered option whose `kind` is `allow_once` when the
  request is within policy, else the first `reject_once`, else `reject_always` is never chosen
  either (a persisted decision outlives the step), else answer `cancelled`. `allow_always` is never
  selected. Policy maps `kind`: `read` against `fsRead`, `edit`/`delete`/`move` against `fsWrite`
  (using the request's `locations`; no locations means the request is refused when a scope is set),
  `execute` against `terminal`, `fetch` and `search` allowed, `think`/`other`/`switch_mode` allowed.
  No `permissions` block at all means deny for `edit`, `delete`, `move`, `execute`.
- **Cost and usage.** `usage_update.cost` in USD becomes `RunResult.reportedCostUsd`; a non-USD
  currency is dropped (never converted). `TokenUsage` is not filled. `used` and `size` go on the
  span as `indaba.acp.context_used` and `indaba.acp.context_size`.
- Agent presets are data: `claude`, `codex`, `gemini` (research.md). A role or step names the runner
  `acp` plus `agent:`; `agent` also accepts a literal `{ command, args }`. Environment is explicit:
  only a passthrough allowlist, never the whole parent environment.

### Generic API runner (AC-05)

`OpenAiCompatibleRunner` takes `{ name, baseUrl, apiKeyEnv, defaultModel?, extraHeaders? }`. The
existing SSE, usage and pricing code moves unchanged. `openrouter` is registered as the instance
`{ name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY' }`,
so its behaviour is byte-for-byte what it was (a test pins that). Additional endpoints register
through `PluginHost.registerRunner` or `INDABA_OPENAI_COMPAT_*` environment entries read **only in
the CLI composition root**, never inside the runner. Base URL must be `http:` or `https:`;
credentials in the URL are rejected.

### CLI runners (AC-07)

No behaviour change except that the "cannot start" sites throw `RunnerUnavailableError`. Docs and
examples are reordered. No default anywhere selects a CLI runner.

## Trade-offs taken

- **Subclass instead of a flag on `RunnerError`**: one more exported class, but `catch` sites and
  `instanceof` stay simple, and plugin runners opt in by throwing it.
- **`fallbackRunners` next to `runner`** instead of replacing `runner` with an array: additive, so
  embedders constructing definitions keep compiling. The cost is that the list is split across two
  fields in the model; the YAML stays one list and `runnerChain()` hides the split.
- **Hand-written JSON-RPC**: no dependency, but we own protocol drift (v2). Mitigated by the
  version check and by keeping the connection layer generic and small.
- **Implicit guard from `permissions.fs.write`**: one declaration, but a behaviour the author did
  not type. The validator output and docs say so, and `plan` output lists the effective guards.

## Risks

| Risk | Mitigation |
| :--- | :--- |
| a runner throws `RunnerUnavailableError` after sending the prompt, causing a replay | the ACP runner's step 4 is tested with a fake that fails after the prompt; the base contract documents the rule; a contract test helper is exported for plugin authors |
| JSON-RPC peer floods or sends giant lines | bounded line length and message count per run; exceeding either is a failed run |
| agent writes outside scope without asking | `diff_within_scope` guard on the worktree; documented as the real boundary |
| `npx` presets download code at run time | overridable with `command`/`args`, documented; start failure is "unavailable" |
| Windows pipe and process-tree behaviour | reuse the existing tree-kill; a spawn test runs in the three-OS CI matrix |
| role-versus-step precedence change surprises someone | listed in CHANGELOG and api-surface.md; validator warns when a step sets both and they differ |
| parser/validator coupling to the runner registry | optional lookup argument, default absent, so core and existing callers are unaffected |
