# Tasks: Transport priority

Ordered by dependency. Domain first, infrastructure second, console and documentation last. Each
task independently checkable. Tests are written with each task, not after (qa skill).

## Domain (`@indaba/core`)

- [ ] **T-01** `RunnerUnavailableError`, `RunnerChainExhaustedError`, `SkippedRunner`, `runnerChain()`; tests for chain order, single name, empty list
- [ ] **T-02** model: `fallbackRunners`, `agent`, `StepPermissions`, `PermissionMode`, `GuardType.DiffWithinScope`; `defineStep` defaults
- [ ] **T-03** `support/glob.ts`: `matchesGlob`, `matchesAny` (`*`, `**`, `?`, no regex from user input, case-sensitive, `/` separators on every OS); hostile-input tests (pattern length bound, no catastrophic backtracking)
- [ ] **T-04** `RunRequest.permissions` and `agent`; `RunResult.reportedCostUsd`
- [ ] **T-05** `Span.addEvent`, `SpanEvent`, `Span.events`; tracer tests
- [ ] **T-06** architecture test still green (no `node:` in core)

## Engine

- [ ] **T-07** parser: `runner` string or list at role and step, `agent`, `permissions`; optional runner lookup; error paths use the field path
- [ ] **T-08** validator: empty list, duplicates, unknown name, the two warnings; `validate` surfaces warnings without failing
- [ ] **T-09** `DiffWithinScopeGuard` and registry default; fails closed when git state cannot be read; tests with a temporary git repo (qa skill)
- [ ] **T-10** `StepExecutor`: step-over-role precedence, the chain walk with per-candidate MCP resolution, skip events, `RunnerChainExhaustedError`, abort never advances; implicit guard from `permissions.fs.write`
- [ ] **T-11** consensus participants use the same chain
- [ ] **T-12** JSONL exporter writes `events`; a span without events is byte-identical to before (snapshot test)

## Runners

- [ ] **T-13** throw `RunnerUnavailableError` at the existing "cannot start" sites (`process.ts`, `registry.ts`, `openrouter-runner.ts` key and model checks, MCP temp-file failure stays a plain `RunnerError`); tests
- [ ] **T-14** `OpenAiCompatibleRunner` extracted from `OpenRouterRunner`; URL validation (`http`/`https`, no credentials in the URL); a test pins that `openrouter` output, headers and usage handling are unchanged
- [ ] **T-15** `StreamingProcessSpawner`, `ProcessSession`, `NodeStreamingProcessSpawner` (piped, argument vector, tree-kill, bounded stderr); fake spawner for tests; a real spawn test on a tiny Node script that runs on all three OSes
- [ ] **T-16** `AcpConnection`: newline framing, bounded line length and message count, request correlation, notifications, agent-to-client handlers, malformed input; tests for partial chunks and flood
- [ ] **T-17** `AcpRunner` happy path against a scripted fake agent: initialize, session/new, prompt, updates to `onOutput`, `end_turn`
- [ ] **T-18** `AcpRunner` failure paths: spawn failure, version mismatch, `authenticate` required (all unavailable); crash after the prompt is written (failed result, never unavailable); each non-`end_turn` stop reason; cancel with grace then kill; timeout
- [ ] **T-19** `AcpRunner` permission policy: the `kind` table, never `allow_always`, `cancelled` when no safe option, deny with no `permissions`; `fs/*` confinement incl. `..`, symlink out of the worktree, absolute paths, Windows drive and UNC paths
- [ ] **T-20** cost and context reporting: USD cost to `reportedCostUsd`, other currencies dropped, context numbers only on span attributes; secrets redacted in events
- [ ] **T-21** presets `claude`, `codex`, `gemini`, overridable; explicit environment allowlist; registry wiring (`acp`, `openrouter`)
- [ ] **T-22** a runner contract test helper (exported from a test-support entry or documented in `docs/extending.md`) that plugin authors run to check the unavailable-versus-failed rule

## Console (`indaba`)

- [ ] **T-23** pass the registry as the parser's runner lookup for `run`, `plan` and `validate`; show warnings
- [ ] **T-24** `plan` prints chains and effective guards; a failed chain prints each skip reason
- [ ] **T-25** `INDABA_OPENAI_COMPAT_*` read in the composition root only; registration through `PluginHost`; the layers test stays green

## Tests

- [ ] **T-26** unit coverage for new behaviour, success and failure paths (85% floor on all four metrics)
- [ ] **T-27** hostile-input tests: JSON-RPC from the agent, paths in `fs/*`, base URL, preset `command` arrays, glob patterns; hostile strings built from fragments (security gate)
- [ ] **T-28** end-to-end through the built CLI: a workflow whose first runner is unavailable falls back to a scripted second one; one whose first runner fails does not
- [ ] **T-29** `pnpm smoke`: the packed install still boots with the new exports

## Documentation

- [ ] **T-30** `docs/workflow-format.md`: runner lists, `agent`, `permissions`, `diff_within_scope`, the fallback boundary in plain words, transport order (API, ACP, CLI last)
- [ ] **T-31** `docs/extending.md`: writing a runner that throws `RunnerUnavailableError` correctly; adding an OpenAI-compatible endpoint; `docs/README.md` index
- [ ] **T-32** README transport section, CHANGELOG under Unreleased (Added, and Changed for step-over-role), `specs/DEPENDENCY_MAP.md`, AGENTS.md repository map if a path changed
- [ ] **T-34** `docs/using-the-alpha.md`, starting with a "which transport when" table (API for text work and consensus, ACP for agents that edit code, CLI last) with the same YAML as the example in the transport spec; the rest of it:  (linked from README and `docs/README.md`): how to try this alpha end to end. Install the preview, set an API key, a first workflow on an OpenAI-compatible runner, adding a fallback list, running an ACP agent (`claude`, `codex`, `gemini` presets) with `permissions`, CLI runners as the last resort, reading the trace to see which runner ran and what was skipped, what is alpha (no stability promise, ACP v1 only, presets download via `npx`), and how to report a problem. Every command and YAML snippet in it is run before it is committed.
- [ ] **T-35** Examples in `examples/` (next to `task-pipeline.workflow.ai.yml`, listed in README): `transport-fallback.workflow.ai.yml` (API first, ACP second, CLI last, with `permissions` on a worktree step) and a minimal `api-only.workflow.ai.yml`; each passes `indaba validate` and `indaba plan` from the built CLI, and a test keeps them parsing. The alpha guide (T-34) walks through them.
- [ ] **T-33** `specs/runner-adapters` gets a pointer to this spec for the ACP and fallback behaviour

## Stage 7: Verification

- [ ] `pnpm qa` and the node gates (`node scripts/check-workflow.mjs`) green end to end, output recorded in review.md
- [ ] `pnpm e2e` and `pnpm smoke` (if present on this branch's base) green
