---
name: verification
description: Use at stage 7 of every change, and whenever a gate fails. Covers pnpm qa, the node gates, reading a failing gate from its own output, and the manual checks no gate can make.
---

# Verification

Stage 7. A change is unverified until this has passed end to end.

## The commands

All from the repository root, natively, on any OS. No container is involved.

```bash
# Toolchain: needs `pnpm install` once
pnpm qa                                  # biome, tsc strict, vitest, in that order
pnpm build && pnpm smoke                 # the packed install, when packaging changed
pnpm audit --audit-level low

# Document gates: plain node
node scripts/validate-skills.mjs
node scripts/sync-claude-skills.mjs --check
node scripts/sync-agent-docs.mjs --check
node scripts/check-workflow.mjs
node scripts/security-audit.mjs --source
node --test scripts/*.test.mjs
```

| Gate | Catches |
| :--- | :--- |
| `pnpm lint` | Biome violations and suppression-free style (`pnpm lint:fix` repairs formatting) |
| `pnpm typecheck` | everything strict `tsc` can prove; no `any`, no suppressions allowed |
| `pnpm test` | unit, architecture and integration tests in `packages/*/test` |
| `pnpm audit` | known vulnerabilities in installed packages |
| `validate-skills` | malformed or unsafe skill files |
| `sync-*` `--check` | AGENTS.md, GEMINI.md or the skill pointers drifting from the YAML |
| `check-workflow` | the YAML describing a toolchain, gate, CI job or spec directory the repository does not have |
| `security-audit` | banned constructs, secrets, and manifest, tsconfig or biome.json weakening |

The pre-commit hook runs the node gates and `pnpm qa`. Without `node_modules` it fails and says to run
`pnpm install`; it never skips the toolchain gate. CI runs everything again on Linux, Windows and
macOS and adds the dependency audit and the smoke test from `smoke_tests`. Results from another Node
major or a stale `node_modules` are not evidence.

## When a gate fails

Run that gate alone and read its actual output.

```bash
pnpm vitest run packages/engine/test/engine.test.ts -t "retry"
pnpm tsc -p tsconfig.json --noEmit
pnpm biome check packages/runners
```

On the feature track, write the remediation as a task in `tasks.md`. After three attempts at the same
gate, stop: the plan is wrong, not the implementation, and the work returns to Plan.

## What not to do

- Do not add a suppression comment, a skipped test or a lowered strictness flag to pass.
- Do not use `--no-verify` to get past a gate.
- Do not report a summary instead of the run. If two tests failed, say which two and what they said.
- Do not claim a result from a platform you did not run on; say what ran where.

## Manual checks the gates cannot make

- Run the CLI against a sample workflow and read the output as a user would.
- Kill a run midway and check no process or `.indaba/worktrees/*` directory is left behind.
- Look at a trace for a planted secret.
- Run `pnpm pack` in a package and read the file listing before a release.
