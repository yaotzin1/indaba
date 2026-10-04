# Self-review: TypeScript port

> **Status**: complete for what was verified on the maintainer's Windows 11 host (Node 22.20, pnpm 9). The CI matrix has not run on GitHub yet.

Answers the seven questions of [`.agents/rules/review.md`](../../.agents/rules/review.md).

## 1. Boundary and layering

`packages/core/src` imports only its own relative modules: `packages/core/test/architecture.test.ts`
scans every import and passes. `packages/engine/test/layers.test.ts` and
`packages/runners/test/layers.test.ts` hold engine and runners to relative files, `node:*`, their
declared dependency and `@indaba/core`, and keep them from reaching the CLI or each other; both pass.
The extension contracts (`Guard`, `GuardResult`, `Plugin`, `PluginHost`, `Runner`) are defined in core,
so adding a runner, guard type or listener edits nothing in core, engine or runners; AC-11 is covered
by `packages/cli/test/plugins.test.ts` (core's `extension.test.ts` covers the contract types). The CLI is the one composition root. Not verified by a
test: that no built-in uses an access a plugin lacks (review only, dimension 1 of the rule).

## 2. Determinism and failure isolation

Decision logic under `packages/core/src` and `packages/engine/src` takes a `Clock` and an
`IdGenerator`; `node scripts/security-audit.mjs --source` reports no `Date.now()`, `Math.random()` or
`process.env` there outside the three engine edge files (`git.ts`, `system.ts`,
`jsonl-span-exporter.ts`), and its self-test covers each exemption. The engine tests exercise retry
isolation, bounded retries and worktree removal. Not verified: timeout and abort behaviour of real
agent CLIs, and process-tree kill on macOS (only Windows ran here).

## 3. Public surface and semver

Classified **major** in `api-surface.md` (a different language and package manager) with the amendments
for the core-owned contracts. Nothing was ever published, so no consumer breaks and the first release
is `0.1.0`. The workflow schema, CLI options, events and span attributes keep their names. One
discrepancy found while writing the docs: the spec says a CLI runner falling back to piped stdio is
"recorded on the span", and no code in `packages/*/src` records the process mode on a span. The docs do
not claim it. Either the spec or the code should change.

## 4. Security

`scripts/security-audit.mjs` now scans TypeScript, the scripts, hooks, every `package.json`,
`tsconfig.base.json` and `biome.json` and reports no findings. It bans `eval`, `new Function`, `vm`,
string-form `exec`, `shell: true`, `any`, non-null assertions, suppression comments and a shell
interpreter with its command flag outside `packages/runners/src/shell-runner.ts` (plus the test that pins
its argument array). The hostile-input tests named in the tasks (path traversal, argument injection,
redaction) live in the packages' test directories and pass in `pnpm qa`; their coverage was not
audited again here. Secret redaction in a real OpenRouter run was not exercised (no key, no network).

## 5. Observability and honest numbers

No span, attribute or event was added or renamed; the JSONL record shape matches the PHP exporter
(comment in `jsonl-span-exporter.ts`), and the observability tests pass. Cost for an unknown model is
`undefined`, not zero (`PricingTable.costUsd`).

## 6. Dependencies and packaging

Runtime dependency `yaml` (engine) and optional `node-pty` (runners), as recorded in
`workflow.ai.yml`; `@indaba/core` has none. `check-workflow` compares those lists with every
`package.json`. `pnpm audit` was **not** run here (CI job "Dependency audit"). `pnpm build && pnpm smoke`
packed the four packages, installed the tarballs in a clean directory and booted `indaba --version`:
`smoke-pack: 4 packages packed, installed and booted (indaba 0.1.0)`.

## 7. Verification

`pnpm qa` (run from the repository root, Windows 11, Node 22.20.0):

```
> indaba-monorepo@ qa
> pnpm lint && pnpm typecheck && pnpm test

> indaba-monorepo@ lint
> biome check .
Checked 90 files in 51ms. No fixes applied.
Found 1 info.          (biome migrate: the "recommended" field is deprecated; not an error)

> indaba-monorepo@ typecheck
> tsc -p tsconfig.json --noEmit

> indaba-monorepo@ test
> vitest run
 Test Files  20 passed (20)
      Tests  211 passed (211)
```

The node gates:

```
$ node scripts/validate-skills.mjs
All 23 skills validated successfully! (0 Security Threats / 0 Syntax Errors)
$ node scripts/sync-claude-skills.mjs --check
.claude/skills is in sync (23 skills)
$ node scripts/sync-agent-docs.mjs --check
AGENTS.md, GEMINI.md and the cycle file are in sync (4 tracks, 8 stages, 23 skills, 8 gates, 17 rules)
$ node scripts/check-workflow.mjs
workflow.ai.yml matches the repository
$ node scripts/security-audit.mjs --source
security audit: no findings (source, manifests, tsconfig, biome.json)
$ node --test scripts/*.test.mjs
# tests 38
# pass 38
# fail 0
$ pnpm build && pnpm smoke
smoke-pack: 4 packages packed, installed and booted (indaba 0.1.0)
```

The tests that would catch a regression: the layers and architecture tests (boundaries), the
`scripts/*.test.mjs` self-tests (the gates themselves, including the glob paths in `check-track` and the
manifest checks in `check-workflow`), and `packages/cli/test/plugins.test.ts` (AC-11).

## Known gaps

- Nothing is published and no tag exists. Publishing needs the maintainer's npm trusted-publishing setup
  and a decision to push a `v*` tag; the `@indaba` scope's availability on npm is unverified.
- The CI matrix (Windows, Linux, macOS) and the "Dependency audit" job have not run on GitHub; only
  Windows ran here. Branch protection on `main` was not compared (`check-workflow.mjs --remote` was not run).
- Real-PTY behaviour through `node-pty` on Windows (ConPTY) is unconfirmed; the tests use the piped path.
- A Windows npm `.cmd` shim cannot be started without a shell, and Indaba never uses a shell for agent
  CLIs, so a runner there needs a native executable.
- The piped-fallback mode is not recorded on a span, although the spec says it is (see section 3).
- `biome.json` triggers a deprecation notice for `recommended`; migrating it is a configuration change
  that was left alone.
- The `tui`, `desktop-app` and `web-app` specs still assume PHP and carry a "Retargeting needed" note.
