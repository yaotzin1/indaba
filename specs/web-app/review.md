# Self-review: The local web view

> **Status**: design reviewed on 2026-10-16 (specification only). The implementation self-review stays pending: nothing
> is built, so sections 2, 5 and 7 have nothing to answer yet.

Answer all seven. See [`.agents/rules/review.md`](../../.agents/rules/review.md). This round reviewed the
specification as a design, not code. Two reviewers (Claude and Antigravity, each through its own CLI) debated it with
Indaba's own consensus step and settled one list in two rounds; the maintainer then had the findings checked against
the repository. The transcript is `.indaba/artifacts/web_app_review.transcript.md` (a run artifact, not committed).
Each finding below says whether it was confirmed, and how. None of the edits has been applied to `spec.md` or
`api-surface.md` yet; they wait for the maintainer.

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
- The ten edits above are not applied to `spec.md` or `api-surface.md`.
- Stale text in this directory: the previous version of this file named `docker compose run php composer qa`, and
  `spec.md` still cites `specs/agent-conversation` (lines 92 and 215), which does not exist; `specs/ruling-channel`
  is the closest, and `specs/run-api`, which the previous review cited, does not exist either.
- Not checked: the licence trees of `apsw-gridwright-mui` and `apsw-gridwright`, and whether `@indaba/core` is the right
  home for the page's types.
