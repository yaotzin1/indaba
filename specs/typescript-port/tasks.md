# Tasks: TypeScript port

Ordered by dependency. Each task independently checkable.

## Scaffold

- [ ] **T-01** pnpm workspace, `tsconfig.base.json` (strict flags), `biome.json`, Vitest workspace, `.nvmrc` (22)
- [ ] **T-02** root scripts: `build`, `typecheck`, `lint`, `test`, `qa`
- [ ] **T-03** `scripts/security-audit.mjs` scans TypeScript and the new config files; self-tests extended

## Domain (`@indaba/core`)

- [ ] **T-04** errors, enums, workflow model types
- [ ] **T-05** `DagBuilder`, `StepState`
- [ ] **T-06** mesh: `AgentMessage`, `Blackboard`, `ConsensusArbiter`, `PingPongDetector`, `Participant`
- [ ] **T-07** `Runner`, `RunRequest`, `RunResult`, `TokenUsage`, `PricingTable`, `Span`, `Tracer`, events, `Clock`, `IdGenerator`
- [ ] **T-08** architecture test: core imports no `node:` module and no other package

## Infrastructure

- [ ] **T-09** engine: parser, validator, interpolator, `ErrorBag`
- [ ] **T-10** engine: guards, `GuardRegistry`
- [ ] **T-11** engine: `Git`, `GitWorktreeManager`, `PatchService`
- [ ] **T-12** engine: `WorkflowEngine`, `StepExecutor`, `PromptBuilder`, `McpPlanner`, `JsonlSpanExporter`
- [ ] **T-13** runners: `ShellRunner`, `CommandRunner`, `SseParser`, `OpenRouterRunner`
- [ ] **T-14** runners: `AbstractCliRunner` with PTY and piped modes, Claude, Codex, Cursor, Antigravity, MCP config writer, registry
- [ ] **T-15** `killTree` helper and timeout/abort handling

## Console

- [ ] **T-16** `indaba run|plan|validate`, `createEngine`, bin entry
- [ ] **T-17** package smoke test (`npm pack`, install, `indaba --version`)

## Tests

- [ ] **T-18** every PHP test file ported before its code (see `tests/Unit/` listing)
- [ ] **T-19** hostile-input tests: path traversal, argument injection, secret redaction

## Governance and cleanup

- [ ] **T-20** `workflow.ai.yml`, `AGENTS.md`, `CLAUDE.md`, `.agents/**` retargeted; sync scripts run
- [ ] **T-21** CI matrix (Windows, Linux, macOS), release workflow (no tag pushed)
- [ ] **T-22** delete PHP, `composer.*`, Docker files, `phpstan.neon`, `phpunit.xml.dist`
- [ ] **T-23** README, `docs/`, CHANGELOG, `specs/DEPENDENCY_MAP.md`, vision note, examples use `npm`
- [ ] **T-24** retarget notes in the `tui`, `desktop-app`, `web-app` specs

## Stage 7: Verification

- [ ] `pnpm qa` and every node gate green, output recorded in review.md
