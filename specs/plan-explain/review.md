# Self-review: Explaining a plan

> **Status**: reviewed 2026-11-27, after #171 and #172 merged. A self-review plus three passes by a separate read-only
> agent that had the code and the contract, not the author's conclusions. The first pass found that the explanation said
> things a run does not do; those are fixed (tasks T-18 to T-24). The third covered what the maintainer then changed
> (C-10, C-12 of `spec.md`). The maintainer confirmed C-09 to C-13.

## 1. Boundary and layering

`packages/core/src` still imports only itself (the architecture test is in `pnpm qa`). The engine and the CLI import
toward core. The fix adds no rule to the engine: `explainPlan` now calls `runsInProject`, `planForRole` and
`DEFAULT_TIMEOUT_SECONDS` from core, the same ones the run uses. The engine's choice of participants of a debate is
**repeated** in `explain.ts` (`speakingRoles`), as it already is twice in `engine/src/engine/mcp.ts` and once in
`step-executor.ts`; a parity test covers the runners a debate calls. No built-in gets access a plugin lacks.

## 2. Determinism and failure isolation

`explainPlan` takes no clock, randomness or environment; the facts are passed in. The order is that of the DAG, and
the isolation of a step is decided from the steps before it in that order. Two runs of `plan --json` on one file gave
identical bytes. Nothing is started, no worktree is created, and no retry or abort path is touched.

## 3. Public surface and semver

Minor, as in `api-surface.md`; no release has carried the feature (the last tag is `v0.2.0-alpha.0`, before it), so the
fix changes no published behaviour of `--explain` or `--json`. No signature changed in the fix. The JSON of version 1
now repeats a `key` (`runner` in a debate, `guards`), which the documents state. The review found exports that were not
in the contract; they are recorded in `api-surface.md` as added after the fact. `plan` without the options differs only
as C-13 says.

## 4. Security

Nothing in this feature reaches a shell, a URL or a log. The review found that `plan` printed role names as written, so
an escape sequence in one reached the terminal; fixed, with a test. Goals, commands (beyond what `plan` printed
before), input values and environment values are not in the explanation. Paths in `permissions.fs.write` and in scope
guards are shown as the author wrote them, an absolute one included. A matter the second pass noticed outside this
feature was reported to the maintainer separately.

## 5. Observability and honest numbers

No span, attribute or event. Numbers shown are the model's values or constants the engine and the runners use. Two
places could still say more than Indaba knows: the sentence about a runner's default is looked up by name, so it
describes the built-in runner when a plugin or a command override replaced it; and a runner that declares nothing is
described as such in a gap, while no setting of it is shown as `unknown`.

## 6. Dependencies and packaging

No dependency added. `pnpm audit --audit-level low` reported no known vulnerabilities and `pnpm smoke` (the packed
install) exited 0.

## 7. Verification

Windows 11, Node 22.20.0, pnpm 9.15.1. Ubuntu and macOS were not run here; CI runs them.

```
$ VITEST_MAX_WORKERS=6 pnpm qa                      exit 0
Test Files  211 passed (211)
     Tests  4016 passed | 2 skipped (4018)
Statements   : 97% ( 15468/15946 )
Branches     : 92.65% ( 12570/13566 )
Functions    : 96.85% ( 3383/3493 )
Lines        : 97.21% ( 14842/15267 )

$ node scripts/validate-skills.mjs                  exit 0
$ node scripts/sync-claude-skills.mjs --check       exit 0
$ node scripts/sync-agent-docs.mjs --check          exit 0
$ node scripts/check-workflow.mjs                   exit 0
$ node scripts/security-audit.mjs --source          exit 0
$ node scripts/build-site.mjs --check               exit 0
$ node --test scripts/*.test.mjs                    exit 0  (98 tests, 98 pass, 0 fail)
$ pnpm e2e                                          exit 0  (16 files passed, 1 skipped; 48 tests passed, 1 skipped)
$ pnpm smoke                                        exit 0
$ pnpm audit --audit-level low                      exit 0  (No known vulnerabilities found)
```

`pnpm qa` with the default number of test workers **fails on this machine**: tests that start many git processes pass
alone (under 4 s each for `parallel-resolution`) and pass the 30 s limit when the whole suite runs, and one test of a
1 s bound in `core/test/board.test.ts` takes longer. The same eight failed on `main` before any change of this review,
with a timing test of `server/test/logging.test.ts`, which also failed once alone among the others (a fixed 50 ms wait).
CI was green on `main` for #171 and #172.

## Known gaps

- The sentence about a runner's default for a replaced runner, no skip for a runner that cannot act (the permission
  report skips it) and no `unknown` setting for a runner that declares nothing (AC-06, failure table rows 2 and 5).
  Closing them needs a new fact in `ExplainFacts`: a change to the contract.
- At `level: full` a runner that cannot act (`openrouter`) or that refuses `full` (`codex`, `cursor`) is still shown
  with `unlimited` writing and terminal `allow` (C-10: the values say Indaba sets no limit). The permission lines of
  `plan` say what the runner does; the JSON does not. Closing it needs the same new fact as the item above.
- T-09 is partly done: see the parity test below.
- A debate step gets no `no_permission_level` or `no_write_scope` gap: AC-05 speaks of agent steps, and the permission
  report leaves debates out too.
- A step with a written block, a declared scope guard and no level shows `permissions.fs.write` from the block, not the
  guard; the `guards` line shows the guard.
- Origins: `defaults` written through an alias gives `mcp_policy` as `fallback`; `isolation: ~` reads as written.
- An absolute path the author wrote is printed (section 6 says "as written", AC-10 says no absolute path).
- `--json` prints the document and exits 1 for a permission or stall error found after loading.
- The stall retry line does not say that a retry is isolated.
- The parity test compares guards, the limit and the permissions of the examples, and the runners of one debate; it does
  not compare isolation or the retry bound.
- Two test files are timing sensitive on a loaded machine (section 7). Fixing them is a separate `chore`.
