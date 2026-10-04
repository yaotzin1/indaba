# Plan: TypeScript port

## Modules touched

| Area | Change |
| :--- | :--- |
| `packages/core` | new: ports `src/Core`, `Workflow/Model|Graph|State`, `Mesh`, the runner contract, `Observability` value types |
| `packages/engine` | new: ports `Workflow/Parser|Guard|Engine`, `Workspace`, `Observability` exporter |
| `packages/runners` | new: ports `src/Runners` |
| `packages/cli` | new: ports `src/Console` and `bin/indaba` |
| root | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `vitest.workspace.ts`, `.nvmrc` |
| `scripts/` | `security-audit.mjs` scans `.ts`, `package.json`, `tsconfig*.json`, `biome.json`; `check-workflow.mjs` knows the new gates |
| `workflow.ai.yml`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.agents/**` | retargeted from PHP/Docker to Node/pnpm; synced by the sync scripts |
| `.github/workflows/` | CI matrix on three OSes; release workflow publishes with provenance (only on a tag the maintainer pushes) |
| PHP files, Composer, Docker | deleted in the last commits |

## Where the behaviour lives

Unchanged from the PHP architecture: pure domain in `@indaba/core` (no `node:` import, enforced by an
architecture test that scans the package's imports), engine and workspace in `@indaba/engine`, runners
in `@indaba/runners`, composition root only in `indaba` (the CLI). Nothing outside the CLI names a
concrete runner. The mesh depends on the `Runner` contract, which lives in core so core never imports
the runners package.

## Trade-offs taken

- Core owns the `Runner` contract and `TokenUsage` so the mesh stays pure; the cost is that `core` is a
  little larger than the PHP `Core` directory.
- `node-pty` is optional with a piped fallback: the CLI works everywhere, but an agent CLI that needs a
  TTY may behave differently without it. The span records which mode ran.
- `parseArgs` instead of a CLI framework: no dependency, but help text is hand-written.
- Biome instead of ESLint: fewer rules than type-aware ESLint; accepted for speed and zero config sprawl.

## Risks

| Risk | Mitigation |
| :--- | :--- |
| behavioural drift while porting | tests are ported first, one PHP test file at a time; both suites stay green until the PHP is deleted |
| `node-pty` install/prebuild failures on a platform | optional dependency, lazy import in a try/catch, piped fallback tested in CI |
| process-tree kill differs on Windows | a `killTree` helper using `taskkill /T /F` on win32 and a process-group signal elsewhere; covered by a spawn test on all three OSes |
| the hook and CI gates break mid-port | strangler order: PHP gates keep running until the final commits; node gates extended first |
| `@indaba` scope taken on npm | rename in one commit before publishing |

## Out of scope for this change

Publishing, tagging, parallel steps, Resolve/media workflows, desktop, web, TUI.

## Commit sequence (each commit declares `Track: feature`)

1. specs
2. workspace scaffold and Node gates extended (PHP gates still run)
3. `@indaba/core`, tests first
4. `@indaba/engine`
5. `@indaba/runners`
6. `indaba` CLI and smoke test
7. retarget workflow.ai.yml, AGENTS.md, CI, hooks; delete PHP, Docker and Composer; docs and changelog
