# Self-review: terminal dashboard comes with `indaba`

> **Status**: complete, written 2026-11-06 by the author of the change (the same model that wrote it). No independent review has been run.

## 1. Boundary and layering

No source moved. `packages/cli` still loads `@indaba/tui` with a dynamic `import()` (`tui-loader.ts`), so the CLI's `layers.test.ts`
(only `node:`, its own files, core, engine and runners statically) is untouched and passes. `@indaba/core` is not touched.

## 2. Determinism and failure isolation

No decision logic changed. A dashboard that cannot be loaded still degrades to plain output (`watch`, `settings`) or starts nothing
(`run --tui`, exit 2), as before; only the wording changed.

## 3. Public surface and semver

Minor, recorded in `api-surface.md` and `CHANGELOG.md`: no symbol changes, but `ink` and `react` now enter every consumer's tree.
Three stderr diagnostics changed wording; none is a documented format. A script that matched on "npm install @indaba/tui" would
notice, and none in this repository does.

## 4. Security

No new input, process, path or secret. The failed-load line prints the import error's message (module names and paths), the same
as `indaba ui` already does. No runtime install is introduced: downloading `@indaba/server` on demand was considered and refused
(spec section 4). `scripts/security-audit.mjs --source`: no findings.

## 5. Observability and honest numbers

No span, event or number changed. The failed-load reason is now on stderr instead of being dropped.

## 6. Dependencies and packaging

`@indaba/tui` moves from `peerDependencies` (optional) to `dependencies` in `packages/cli/package.json`; `pnpm-lock.yaml` was edited
by hand for that one importer (the registry metadata was not available offline) and `pnpm install --frozen-lockfile` accepts it.
`project.runtime_dependencies` is unchanged because the package is a link inside the repository. `ink` 8.0.0 and `react` 19.3.0 were
already in the published tree of `@indaba/tui`, both MIT. **Not run:** `pnpm audit` (needs the network); CI's "Dependency audit"
will be the first run of it on this change. `pnpm smoke` passes: the packed `indaba` alone resolves `@indaba/tui` from its real path
and does not contain `@indaba/server` or `@indaba/web`.

## 7. Verification

```
pnpm qa                          exit 0; Biome: Checked 410 files, no fixes; Vitest: 162 files passed, 2941 tests passed, 2 skipped; coverage floor met
node scripts/check-workflow.mjs  workflow.ai.yml matches the repository
node scripts/security-audit.mjs --source   no findings
node scripts/validate-skills.mjs; sync-claude-skills --check; sync-agent-docs --check; build-site --check   all clean
node --test scripts/*.test.mjs   94 pass, 0 fail
pnpm build && pnpm smoke         6 packages packed and audited; indaba 0.1.0-alpha.5 carries @indaba/tui, boots without @indaba/server, and the installed server finds its page
```

`node scripts/check-track.mjs` and `check-workflow.mjs --remote` have not been run: the first needs a commit, and CI jobs are unchanged.

## Known gaps

- A manual run of `npx indaba@next watch` on a real terminal after release has not been done; this needs the next published alpha.
- `indaba ui` still prints only `npm install -g @indaba/server`; the `npx -p ... -p ...` form is in the docs but not in that message (out of scope by decision).
