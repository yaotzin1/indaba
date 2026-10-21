# Self-review: The local web view

> **Status**: design reviewed on 2026-10-16, and the review's edits applied to `spec.md` and `api-surface.md` the same day
> (specification only). The implementation self-review stays pending: nothing is built, so sections 2, 5 and 7 have
> nothing to answer yet.

Answer all seven. See [`.agents/rules/review.md`](../../.agents/rules/review.md). This round reviewed the
specification as a design, not code. Two reviewers (Claude and Antigravity, each through its own CLI) debated it with
Indaba's own consensus step and settled one list in two rounds; the maintainer then had the findings checked against
the repository. The transcript is `.indaba/artifacts/web_app_review.transcript.md` (a run artifact, not committed).
Each finding below says whether it was confirmed, and how. The edits are applied; where a point was a choice, the spec
now carries it as a recommendation in section 8 (C-04, C-12) for the maintainer to confirm, and the maintainer decided
one of them (shared types in `@indaba/core`, types only).

**Found while applying the edits, not by the debate:** `spec.md` (C-04) and `api-surface.md` called `RunViewModel` "the
existing type of `@indaba/engine`". No such name exists in `packages/`, in `specs/tui` or in `docs/`; the type is
`RunState`, with `StepView`, `AttemptView` and `RunnerView`, in `packages/engine/src/trace/view.ts`. Both documents now use the
real names. Both reviewers repeated the wrong name.

## 1. Boundary and layering

- **Finding (confirmed): the server cannot start a run without breaking the layers.** `api-surface.md` has
  `POST /runs`, and `spec.md` says `@indaba/server` depends on engine and core and imports no UI package. Registering
  runners and plugins is the composition root, which lives in `indaba`; `ServerOptions` has no way to receive it.
  Proposed edit: `indaba ui` injects a run starter into `startServer`, and `ServerOptions` gains `staticDir?`
  (the server serves `@indaba/web` but may not import it). Add `packages/server/test/layers.test.ts`, extend the
  tests of `@indaba/web`, and state the lazy edge from `indaba` the way `specs/DEPENDENCY_MAP.md` states it for
  `@indaba/tui`.
- **Finding (confirmed, design decision open): shared types have no home.** AC-04 wants request and response types
  "from one source" for both packages, and the page may import no `node:` module, yet `WorkflowView` is declared in
  `@indaba/server`. The first proposal was to move the types into `@indaba/core` (types only); a contract subpath of
  `@indaba/server` is the alternative. The maintainer decides.
- **Finding (confirmed): name clash.** `api-surface.md` declares a `StepView` inside `WorkflowView`, and
  `@indaba/engine` already exports a `StepView` (`packages/engine/src/trace/view.ts`). Rename the inspector's type to
  `WorkflowStepView`.

## 2. Determinism and failure isolation

- **Open (unspecified): what happens to running runs when `indaba ui` exits.** AC-02 says the server "ends with the
  command" and says nothing of runs it started. The reviewers proposed that exit cancels active runs through the
  engine's teardown; that is a proposal, not something the spec says. Decide, then write it down.
- Nothing runs yet, so there is no code to check for clocks, randomness or process ownership.

## 3. Public surface and semver

- **Finding (confirmed): the HTTP API is incomplete for its own acceptance criteria.** `api-surface.md` has no
  endpoint to create a workflow (AC-06 lists "new"), none to remove one from the list (AC-06, AC-13), and none for the
  full log that the failure table promises ("open the full log"). It also gives no request or response shape for
  `copy`, `PUT /workflows/{id}`, `changes`, `messages` or `answers`, although AC-04 promises shared types. Proposed
  edit: add `POST /workflows`, `DELETE /workflows/{id}` (removes the registry entry, never the file) and
  `GET /runs/{id}/steps/{step}/log`, define every schema, and take "delete" out of AC-13 or say what it deletes.
- **Finding (plausible, one claim not found): no stream for the run list.** Only `GET /runs/{id}/events` exists, so a
  second tab cannot learn of a new run or a registry change without polling. A server-wide `GET /events` is the
  proposal. The reviewers cited a passage of section 5 about a second tab; I did not find that passage.
- **Finding (confirmed): `POST /runs` takes `inputs?`, but no screen collects them.** `specs/workflow-inputs` is not
  in "Builds on", and the user flows never ask for a value before Run. Add the dependency and an inputs prompt.
- **Rejected: "the contract-version rule is inconsistent".** AC-04 ("page major older than the server's refuses"),
  the failure table ("contract newer than the page") and `GET /contract` ("the page refuses a newer major") all
  describe the same condition. The wording could be unified, but nothing contradicts.
- The semver class stays a minor below 1.0; moving types into core would add exports, which is also a minor.

## 4. Security

- **Finding (confirmed): authentication contradicts itself.** AC-02 says the server "refuses any request without the
  token" and `api-surface.md` says every request carries `Authorization: Bearer`. A browser navigation that loads the
  static bundle cannot send that header, and a browser `EventSource` cannot either. Proposed edit: serve the static
  assets without the token but with the `Host` check and a content security policy, keep the token in memory only,
  strip the fragment from the address after load, and read the stream with `fetch` and the header.
- **Finding (confirmed gap): running a workflow is running code.** A workflow in a scanned root may contain `shell`
  steps, so `PUT /workflows/{id}` followed by `POST /runs` executes what was written. The spec treats the token as
  the only defence. Proposed edit: say this is the threat model, and require a confirmation of the runner and the
  permissions the first time an imported or edited workflow runs.
- **Finding (plausible): health probes could be steered.** AC-15 probes "servers" taken from workflow files and
  limits only timeout and rate. Proposed edit: probe only the declared MCP and API hosts, follow no redirect, send no
  credential, and log no URL.
- **Finding (confirmed, small): the accepted `Host` values are not listed.** `host` is `'127.0.0.1'` only, while the
  address checks speak of "its own address". List `localhost`, `127.0.0.1` and `[::1]` if all three are accepted, and
  require `Origin` on every state-changing request.
- **Open (ambiguous): "a native folder dialog the person opens"** (spec section 6) is not something a page can use to
  hand over a path. If the server opens an operating-system dialog, say so; otherwise import only through `--root` or
  a typed path the server confirms, which is what `api-surface.md` already implies.

## 5. Observability and honest numbers

Not reviewed: the spec adds no span, attribute or cost figure of its own; it reuses the run view model. Review it
again when the server exists.

## 6. Dependencies and packaging

- **Finding (confirmed): `elkjs` is not MIT.** C-01 says "each is MIT" and offers `dagre` or `elkjs`. The registry
  lists `elkjs` as `EPL-2.0 OR GPL-3.0-or-later`; `dagre`, `@xyflow/react`, `react-router` and
  `@tanstack/react-query` are MIT. Choose `dagre` in C-01. (The reviewers named EPL-2.0 alone; the dual licence is
  what the registry shows.) `apsw-gridwright-mui` and `apsw-gridwright` are MIT at the top level; their dependency
  trees are not checked.
- **Finding (confirmed): the dependencies are not recorded.** `project.runtime_dependencies` in `workflow.ai.yml`
  holds `yaml`, `ink` and `react`. The rule that every runtime dependency is a recorded decision needs React, MUI,
  `@xyflow/react`, `react-router`, `@tanstack/react-query` and the table component named in the spec, with the
  package that loads them, before any `package.json` changes.

## 7. Verification

Nothing was built, so `pnpm qa` was not run for this feature. What was run:

- the debate: `indaba run` on a two-role consensus workflow, converged in two rounds;
- the checks described above: the spec text and `api-surface.md` read again, `specs/` listed, the engine's
  `StepView` found in its source, and the licences read from the npm registry with `npm view <package> license`.

The documentation-only change that records this review is verified by the commit gates.

## Known gaps

- Specification only; nothing is implemented and nothing was run.
- Applied to `spec.md` and `api-surface.md`: authentication of the static files and the stream; the `Host` and `Origin`
  rules; a confirmation before the first run of an imported or edited workflow (AC-22); health probes limited to declared
  hosts (AC-15); an injected run starter and `staticDir` in `ServerOptions`; shared types in `@indaba/core` as
  declarations only, with `WorkflowStepView`; `dagre` instead of `elkjs`, and the dependencies listed; the missing
  endpoints (`POST /workflows`, `DELETE /workflows/{id}`, the step log, the server-wide `GET /events`) and a body and
  response for each; an inputs form before Run; no native folder dialog; `workflow-inputs` in "Builds on";
  `agent-conversation` removed (C-07); runs end with `indaba ui` (C-12).
- Still open for the maintainer: C-12 (runs cancelled when `indaba ui` ends, and the confirmation remembered per hash of
  the file's content, which hash and where is a plan-time choice); whether the data shape of `RunState` can move to
  core as pure declarations (its file imports the record types of `records.ts` and `RunStatus` of `trace-reader.ts`;
  check at plan time); the three sketches of AC-21.
- Not written: `DEPENDENCY_MAP.md` still lists `web-app` as `@indaba/server`, `@indaba/web` and `indaba`; it also gains
  `@indaba/core` (types) when the dependency map branch merges.
- Not checked: the licence trees of `apsw-gridwright-mui` and `apsw-gridwright`.

## Implementation round, 2026-10-21: cost on the run list, packaging, hostile input, coverage, end to end

Tasks T-23 (answer 1 of the sketches), T-10, T-12, T-13 and T-15, on `feat/web-app`. Stages run: plan (the cost
amendment in `api-surface.md`, the packaging decisions in `plan.md`), tasks, implement, verify. Not run as separate
stages: specify and clarify (the maintainer's answers of 2026-10-21 settled them), and a written analyze pass; the
seven dimensions below are answered for this round only.

1. **Boundary.** `RunCost` is a declaration in `@indaba/core`; the cost is added up by the engine's reducer, and the
   list reuses it (`listRuns` calls `reduceAll`), so no second rule for money exists. The page's per-step table follows
   the same rule and its test checks that the rows add up to the run's total.
2. **Determinism and failure isolation.** Nothing new reads a clock. The stream tests show that a resume after a drop
   neither repeats an id nor loses what was written meanwhile, and that dropped streams leave the server answering.
3. **Surface.** One field and one type, a minor (`api-surface.md`, "Cost on the run list"). Code that builds its own
   `RunSummary` must add `cost`: said in the changelog. No attribute, event, option or default changed.
4. **Security.** T-12 found a real gap: the server cleaned output and reasons but not the workflow's name, the task
   id, runner names, models, states, tool kinds or a debate's outcome, so an escape sequence in a workflow name reached
   the page. Fixed in `snapshotOf` and `summaryOf`; tested with hostile values. The secret test runs the real
   `indaba run` and reads every byte the server sends. The server writes nothing to a log, whatever it is sent.
5. **Honest numbers.** The list's cost is `unknown`, `at least … (partial)` or `$0.00 (no model calls)` exactly as on
   the Run screen; a step whose only call is still running says `unknown`, not `no model calls`.
6. **Packaging.** The page ships in `@indaba/server`'s `page/`, staged at pack time, with
   `THIRD-PARTY-LICENSES.txt` (28 packages). The check found that the bundle carried no licence notice at all, against
   what `vite.config.ts` said, and that `d3-ease` is BSD-3-Clause, not ISC as the licence check of 2026-10-20 recorded.
   `pnpm smoke` now audits every tarball and boots `indaba` without the optional packages.
7. **Tests.** New: `packages/server/test/hostile.test.ts`, `runs.test.ts`, `streams.test.ts`,
   `packages/cli/test/secret-to-page.test.ts`, `packages/cli/e2e/ui.e2e.test.ts`, `packages/web/test/cost.test.ts`,
   page cases in `ui.test.ts` and `client.test.ts`, and the script self-tests `stage-page.test.mjs` and
   `smoke-pack.test.mjs`.

**Gate output (Linux, Node 22.22.0, pnpm 9.15.1, after `pnpm install`):**

```
node scripts/check-workflow.mjs        workflow.ai.yml matches the repository
node scripts/security-audit.mjs        security audit: no findings (source, manifests, tsconfig, biome.json)
node --test scripts/*.test.mjs         tests 83, pass 83, fail 0
pnpm qa                                Biome: 249 files, no errors; tsc strict: clean;
                                       Vitest: 83 files, 1510 passed, 1 skipped
                                       coverage 97.78 / 93.68 / 97.66 / 97.96 (statements, branches, functions, lines)
pnpm e2e                               9 files, 32 passed
pnpm smoke                             6 packages packed and audited; indaba 0.1.0-alpha.2 boots without @indaba/tui
                                       and @indaba/server, and the installed server finds its page
pnpm audit --audit-level low           No known vulnerabilities found
```

**Not done in this round:** a manual run in a browser (the page's changes are covered by tests in happy-dom only); the
runs on Windows and macOS (CI runs them); `@indaba/server` in `.github/workflows/release.yml`, which needs its npm
trusted publisher configured by the maintainer first; T-16 and the rest of T-17.
