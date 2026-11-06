# API surface contract: terminal dashboard comes with `indaba`

## Semver classification

**minor** (below 1.0, that is the next alpha of the current line).

Reasoning: no export, signature, workflow field, CLI option, event or span attribute changes. What changes is what
`npm install indaba` puts on disk: `@indaba/tui`, `ink` and `react` now enter every consumer's tree (the rule that a new
runtime dependency is a minor). Three stderr messages change their wording; they are diagnostics, not a documented format.

## Public symbols added / changed / removed

None. `RUN_TUI_INSTALL` in `packages/cli/src/run-tui.ts` keeps its name and type; only its text changes, and it is not exported from the package index.

## Packaging

| Package | Before | After |
| :--- | :--- | :--- |
| `indaba` `@indaba/tui` | optional peer (`>=0.1.0-alpha.2`), dev dependency | dependency (`workspace:*`, published as the exact version) |
| `indaba` `@indaba/server` | optional peer, dev dependency | unchanged |

## Defaults introduced or changed

| Option | Old default | New default |
| :--- | :--- | :--- |
| the dashboard of `watch` / `settings` / `run --tui` on a fresh `npm install indaba` | absent, plain output | present |

## Checks

- [x] No new public type
- [x] `pnpm qa` and the node gates pass (see `review.md`)
