# Self-review: The workflow registry, slice 1

> **Status**: done, 2026-10-23. Stages run: 1 (spec rewritten with the decisions), 2 (the maintainer's four
> answers, C-01 to C-03 and C-07, and C-04 to C-11 resolved), 3 (`api-surface.md` rewritten, `plan.md`), 4
> (`tasks.md`), 5 (the audit in `plan.md`), 6 (tests with each part), 7 (below), 8 (this review). Two stage 6 findings
> went back to the contract and the spec, recorded there: the confined read moves with the walk (amendment), and a root
> that is gone lists nothing (C-11).

## 1. Boundary and layering

`@indaba/core` gains types, one error class and an optional `PluginHost` member; no `node:` import (the architecture
test). The store, the walk and the confined read are in `@indaba/engine`; the command line keeps step 2's ids and its
wrappers, so `indaba ui` behaves as before (its tests are unchanged and green). A plugin's registry replaces the
built-in one through the same host every plugin gets; the built-in store uses nothing a plugin cannot.

## 2. Determinism and failure isolation

The clock and the ids are injected (the engine's layers test bans `Date.now`, `new Date()` and `randomBytes`); the command
line supplies them. A scan is bounded by the walk's limits and reads a file only up to 1 MiB. An aborted scan writes no
index after the abort (tested). An unreadable index is set aside, never overwritten (tested). Two processes: whole-file
atomic writes, the later one wins; documented in the spec.

## 3. Public surface and semver

Minor, below 1.0, recorded in `api-surface.md` (with its amendment) and `CHANGELOG.md`. `registerRegistry` is optional,
so no implementer of `PluginHost` breaks (C-09). The functions moved to the engine keep their command line exports and
what they find. A new command group; `indaba --help` lists it.

## 4. Security

Every path is confined by realpath to its root: the walk follows no link, `add` and `copy` refuse anything outside a
root or reached through a linked folder (tested), the index is not written through a `.indaba` or `registry` that is a
link or a file (tested). A copy's name is a restricted set of characters, written with `wx` (tested with `../x` and
`a/b`), and never under `.indaba`, `.git` or `node_modules`. File contents are parsed with the parser a run uses, never
evaluated; names and messages are cleaned before they are stored and printed. The index holds paths, names, hashes and
one line of a parse error, never content. Logs hold counts, roots and ids. A plugin store's error is redacted by the
command line before it is printed. `.indaba/registry/.gitignore` keeps the index out of git in any project.

## 5. Observability and honest numbers

No span or attribute. The last run is the trace reader's summary, matched only when the workflow's name is unique in its
root; otherwise nothing is shown rather than a guess (C-06, tested). The limits are the page's starting values, said so.

## 6. Dependencies and packaging

No dependency added. `pnpm smoke` packs and installs the six packages and the CLI boots.

## 7. Verification

On Linux (this machine), each gate of `workflow.ai.yml`'s `quality_gates` run alone:

```
node scripts/validate-skills.mjs              exit 0
node scripts/sync-claude-skills.mjs --check   .claude/skills is in sync (23 skills)
node scripts/sync-agent-docs.mjs --check      AGENTS.md, GEMINI.md and the cycle file are in sync (4 tracks, 8 stages, 23 skills, 8 gates, 19 rules)
node scripts/check-workflow.mjs               workflow.ai.yml matches the repository
node scripts/security-audit.mjs --source      security audit: no findings (source, manifests, tsconfig, biome.json)
node --test scripts/*.test.mjs                exit 0
pnpm qa                                       Tests 2152 passed | 2 skipped; All files | 97.04 | 92.33 | 96.79 | 97.32
pnpm e2e                                      Tests 36 passed
pnpm smoke                                    6 packages packed and audited; indaba boots
node scripts/check-track.mjs                  run by the commit hook on each commit
```

New files, statements / branches: `engine/registry/file-registry.ts` 94.9 / 89.9, `index-file.ts` 92.4 / 98.6,
`files.ts` 90.5 / 87.0 (moved code; its edge cases are covered by the command line's race tests), `cli/workflows.ts`
97.1 / 91.5.

CI on #69: Agent instruction set, Track and deliverables, Dependency audit, and Verify on ubuntu, windows and macOS all passed. The `main()` tests write nothing outside their
temporary folder on any system (macOS reads the configuration folder from the real home, so those tests only scan).

## Known gaps

- Slice 2: `indaba ui` and the page still use step 2's scan and ids (AC-14, AC-15).
- The last run is found by name; recording the file in the trace would make it exact (a span attribute, a change of its
  own).
- A root that is gone lists nothing; showing its old entries as missing needs a store outside the root (C-11).
- Annotations are on one machine; sharing them is a store plugin's job (C-02).
