# Self-review: The local web view, step 3c (edit a workflow on the graph)

> **Status**: done, 2026-10-25. Stages run: 1 to 8 of the feature track (spec, clarifications, api-surface,
> plan with the stage 5 co-op audit with Claude, tasks, implementation test-first, verification, and this stage 8
> co-op review with Claude). One stage 6 finding went back to Stage 3 and is recorded in `spec.md`, `api-surface.md`
> and `plan.md`: `stepBrickEdit` selects the default agent and API runners from `catalog.runners` capability flags
> without hardcoding built-in runner names in `@indaba/web` (`specs/agent-permissions` AC-16,
> `packages/web/test/layers.test.ts`). Five stage 8 findings from Claude's code review were fixed and tested:
> duplicate-id step selection by index, no invented `max_retries` when reading a draft, preserving untouched
> `depends_on` items, queue-safe `moveStep` and `applyStepBrick`, and moving `retriedBy` card copy into `messages.ts`.

## 1. Boundary and layering

`@indaba/core`, `@indaba/engine`, `@indaba/runners`, `@indaba/server`, `@indaba/tui` and `indaba` (CLI) are untouched.
All changes live in `@indaba/web`, which is private and bundled into `@indaba/server/page/` at build time.
`packages/web/src` imports only types from `@indaba/core` (enforced by `packages/web/test/layers.test.ts`), contains no
`node:` import, and names no built-in runner (`'claude-code'`, `'codex'`, `'antigravity'`, `'opencode'`, `'cursor'`,
`'openrouter'`) anywhere in `.ts` source. Built-ins and plugins have identical standing: `stepBrickEdit` inspects only
`catalog.runners` and `r.permissions` from `GET /api/v1/editor`.

## 2. Determinism and failure isolation

`buildWorkflowGraph`, `stepBrickEdit`, `failureBrickEdit`, `isValidGraphConnection`, `connectStepsEdit`,
`disconnectDependsOnEdit` and `clearFailureEdit` are pure functions of their arguments and read no clock, randomness or
environment (`now` is passed as `0` to `RunGraph` in edit mode, where `StepCard` renders `draft` metadata rather than
elapsed run time). Node positions come deterministically from `@dagrejs/dagre` over the draft's `steps` order and valid
`depends_on` edges between addressable steps; editing non-structural fields (`goal`, `runner`, `permissions`,
`on_failure`) keeps every node at the exact same `(x, y)` coordinates (tested), while structural edits re-rank the
graph deterministically. Internal `dagre` node ids are prefixed (`n:<nodeId>`) so steps named `constructor` or
`__proto__` and cyclic `depends_on` graphs lay out with finite coordinates without throwing (tested). Graph actions that
address a step by id (`applyStepBrick`, `applyFailureBrick`, `connectStepsEdit`, `disconnectDependsOnEdit`,
`clearFailureEdit`, `move`) run as `QueuedEdit` functions against `valueRef.current` in `SourceScreen`'s sequential edit
queue (AC-10), so rapid back-to-back actions never overwrite each other or hit a stale step index.

## 3. Public surface and semver

Patch (or minor bundle update of `@indaba/server`), recorded in `api-surface.md` and `CHANGELOG.md`. No exported
TypeScript symbol, CLI command or option, workflow field, guard, runner, event, span attribute, HTTP endpoint or
`CONTRACT_VERSION` (`1.3.0`) changes in any published package. Within `@indaba/web` (private), the new internal helpers
in `graph-model.ts`, `RunGraph.ts`, `FormView.ts`, `GraphView.ts` and `SourceScreen.ts` match `api-surface.md`.

## 4. Security

No new HTTP endpoint, file I/O, shell execution or process spawn. Every edit is a `WorkflowEdit` sent through the
existing `POST /api/v1/workflows/edit` endpoint with the bearer token, `Host` check, `Origin` check and body/depth/key
caps of step 3b. Untrusted strings from the workflow file (step ids, runner names, role names, globs, problem messages)
are stored only in `Map`/`Set` or checked with `Object.hasOwn` (never plain object maps where `__proto__` or
`constructor` could pollute prototypes) and rendered exclusively as React text children (`createElement`, no JSX, no
`innerHTML` or `dangerouslySetInnerHTML`, enforced by `packages/web/test/layers.test.ts` and
`scripts/security-audit.mjs --source`). HTML5 drag-and-drop `dataTransfer` payloads are validated through `isBrickKind`
against a fixed 7-value allowlist before any edit is constructed.

## 5. Observability and honest numbers

No span or attribute is added. No number is invented: when `on_failure.max_retries` is absent or `< 1` in the draft,
`buildWorkflowGraph` records `0` (matching the engine parser) and `messages.graph.failureRoute` and
`messages.graph.card.edgeRetry` omit `, up to <n>` rather than inventing a retry count; only when a person actively
applies the **Retry a step** brick or connects a `fail-out -> fail-in` handle on a step that has no `max_retries` yet
does the edit set `max_retries: 3` (preserving any existing `max_retries` value in the file). Dangling `depends_on`
(including self-dependencies) and `on_failure.target` references are never silently repaired or hidden: they are shown on
the step card and in **Connections** as `no such step` alongside `problems()`.

## 6. Dependencies and packaging

No runtime or dev dependency was added (`@xyflow/react` and `@dagrejs/dagre` were already in `@indaba/web` from delivery
step 1). `pnpm smoke` packs all six publishable packages and verifies that `@indaba/server` ships the built page in
`page/` with no forbidden files or dependencies.

## 7. Verification

On Windows (this machine), every blocking gate in `workflow.ai.yml` plus `pnpm e2e` and `pnpm smoke` was run and passed:

```
node scripts/validate-skills.mjs              Valid: 23 skills passed syntax and security checks.
node scripts/sync-claude-skills.mjs --check   .claude/skills is in sync (23 skills)
node scripts/sync-agent-docs.mjs --check      AGENTS.md, GEMINI.md and the cycle file are in sync (4 tracks, 8 stages, 23 skills, 8 gates, 19 rules)
node scripts/check-workflow.mjs               workflow.ai.yml matches the repository
node scripts/security-audit.mjs --source      security audit: no findings (source, manifests, tsconfig, biome.json)
node --test scripts/*.test.mjs                83 passed, 0 failed
pnpm qa                                       Test Files 111 passed; Tests 2097 passed | 2 skipped
                                              All files | 96.59% stmts | 91.85% branch | 96.46% funcs | 96.83% lines
pnpm e2e                                      Test Files 12 passed; Tests 36 passed
pnpm smoke                                    smoke test passed: 6 packages packed and audited
```

Coverage on `@indaba/web`:
- `packages/web/src`: **99.3% statements, 94.81% branches, 99.67% functions, 99.36% lines** (`graph-model.ts` 99.2%
  statements / 92.34% branches; `form-model.ts` 99.31% / 97.54%).
- `packages/web/src/ui`: **95.52% statements, 88.62% branches, 94.97% functions, 95.81% lines** (`GraphView.ts` 97.29%
  statements / 86.23% branches; `RunGraph.ts` 94.91% / 90.09%; `FormView.ts` 99.51% / 94.49%; `SourceScreen.ts` 92.3% /
  84.03%).

Only Windows was run locally; Linux and macOS run in CI on the pull request.

## Known gaps

- `artifacts`, `mcp_servers`, `agent`, `guards` and unknown keys continue to link to their line in **Source** from the
  step settings panel (spec AC-08, C-03); guard and MCP bricks from sketch 5 are deferred until form editors for
  `guards` and `mcp_servers` are added.
- Unaddressable steps (missing or duplicate `id`) use synthetic node id `\0step:<index>` and have handles, move and
  remove disabled (`addressable: false`); React Flow never queries handles or edges on them.
- Layout at 320 px (`scrollWidth === clientWidth`) and contrast in light and dark themes were verified structurally and
  via CSS media queries (`@media (max-width: 1000px)` and `@media (max-width: 640px)`), not measured with a screen
  reader or contrast tool in this session.
