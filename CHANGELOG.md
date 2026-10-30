# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html).

A changed default is treated as a breaking change even though nothing fails to type-check: the
consumer's code stays green and their runs behave differently, which is exactly what makes it worth
a major. Until 1.0, a breaking change takes the next minor and is labelled as such. The workflow
file schema, the command line, emitted events and span attribute names are part of the public
surface.

The first published version is `0.1.0-alpha.0`, a preview of the packages named under "The TypeScript
port". The PHP prototype that preceded them was never published.

## [Unreleased]

### Added

- **The run board, in `@indaba/core`** (minor; track `feature`; `specs/run-blackboard`). `RunBoard` (an append-only board of
  notes between steps, settled by records, rebuildable with `replay`), `buildDigest`, `parseBoardLines`, `BoardKind`,
  `BoardRecorded`, `StepDefinition.board` and an optional `observer` fourth parameter of `ConsensusArbiter.deliberate` and `Tracer.now()`.
  Every run now makes a board and hands it, with the attempt number, to each step; settlement follows the step's result
  and a retry's reset (`WorkflowEngineOptions.board` sets its limits and redaction).
  The step field `board:` (`read`, `post`, `digest_chars`) is parsed, validated with the path of each problem and
  described in the editor schema.
- **The run board, in `@indaba/engine` and `indaba`** (minor; same feature). A step with `board.post` has its reply scanned
  for `BOARD <kind>: <text>` lines (`BOARD fact <key>: <text>` for a fact); a step with `board.read` gets the notes of earlier steps
  added to its prompt as a bounded section. Notes are settled with the step: accepted when it completes, discarded when it
  fails, replaced when a retry resets it. A debate's messages, outcome and ruling are put on the board by the engine. Every
  run writes `.indaba/traces/<traceId>.board.jsonl` (`BoardWriter`, read with `BoardReader`), redacted as the event stream is;
  a failure to write it never fails the run and is reported once on the root span (`indaba.board.degraded`). New span
  attributes: `indaba.board.digest.entries`, `.digest.chars`, `.digest.omitted`, `indaba.board.posted`, `indaba.board.ignored`.
  `indaba plan` prints a `board:` line under each step that has the field, and `indaba watch --plain` ends with the board
  (a run with no board file prints what it did). Workflows without `board` fields run byte for byte as before; the trace file
  and event stream are pinned by a test against files the older code wrote. The new third file in `.indaba/traces` is the one
  visible difference.
- **The board pane, in `@indaba/tui`** (minor; same feature). `b` opens the board in the dashboard: one line per entry with a
  symbol and a word per kind, filters by step, kind and sender, the facts, one entry in full, and plain messages when there is
  no board file yet or the board is incomplete. `watch` follows the board file beside the trace. Exports: `reduceBoard`,
  `boardAction`, `boardRows` and the related state functions. On a terminal at least `DOCK_COLUMNS` (160) wide, with a board,
  the pane is docked beside the steps and the output; `computeLayout` takes an optional `{ dock }`, `Layout` gains `dockWidth` and
  `dockRows`, `Screen` gains `dock`. The width is a first choice from rendering a few sizes, not a measurement.
- **Playbooks, and documentation for machines.** [docs/playbook.md](docs/playbook.md) has a recipe for each way of working, with terminal
  pictures made from real output; [docs/ai-playbook.md](docs/ai-playbook.md) is for an AI agent that uses Indaba (the loop, exit
  codes, the files, the board grammar, failures and what to do). The site build now also writes `llms.txt` (an index) and
  `llms-full.txt` (every page in one Markdown file) at the site root, so they always match the documentation; `examples/board-handoff.workflow.ai.yml` shows the board.

## [0.1.0-alpha.4] - 2026-10-28

The fourth preview, published under the `next` tag. Its point is `@indaba/server`: the `0.1.0-alpha.3` on npm cannot
be installed, and this one can, so `indaba ui` works from npm (`npm install -g indaba@next @indaba/server@next`). Every
package now has a README on npm, and the documentation site is up to date. No behaviour of the engine, the runners or
the CLI changes.

### Fixed

- **`@indaba/server` installs from npm again with the next release** (patch; track `chore`; `.github/workflows/release.yml`,
  `scripts/smoke-pack.mjs`). Its `0.1.0-alpha.3` was published by hand with `npm publish`, which kept the
  `workspace:*` ranges on `@indaba/core` and `@indaba/engine`, so `npm install @indaba/server` fails with
  `EUNSUPPORTEDPROTOCOL`. The release workflow now packs and stages it with the other packages, and before staging
  it audits the tarballs: every published package present, the tag's version, and no `workspace:`, `link:`, `file:`
  or `portal:` range left. `pnpm smoke` runs the same range check.

### Documentation

- **Every package has a README** (patch; track `chore`; `packages/*/README.md`, `scripts/smoke-pack.mjs`). The pages
  of the packages on npm were empty. Each published package now carries a README: what it is, how to install it,
  how it is used, and links to the documentation site. The runners' npm description names all of them. `pnpm smoke`
  and the release's tarball audit now refuse a published package without a README.
- **The documentation site matches 0.1.0-alpha.3** (patch; track `chore`; every page of `docs/`, `README.md`, the
  landing page). The pages still described 0.1.0-alpha.2 as the newest preview, the web view as unpublished and
  read-only, and most of phase 6 of the roadmap as planned. They now give the alpha.3 versions, the commands and
  options as built (`ui`, `settings`, `report`, permission levels, `--allow-full-access`), the Workflows, editor and
  Settings screens, the plugin contracts as exported, and the roadmap's built and not-built work. `@indaba/server`
  0.1.0-alpha.3 is on npm but cannot be installed (its manifest kept `workspace:*`), so the pages say to run
  `indaba ui` from a checkout for now.
- **The vision page describes the TypeScript implementation** (patch; track `chore`; `docs/vision.md`). The page still
  presented Indaba as PHP 8.4 with Symfony, PHPStan and Composer, under a supersession note. It now states the same
  mission, modules and workflow contract as built: TypeScript for Node 22+, the pnpm packages, the current runners,
  `pnpm test` in the example. The PHP original stays in git history, and the "kept verbatim" rule is retired.

- **Pattern: a review debate** (patch; track `chore`; `docs/workflow-format.md`, `examples/review-debate.workflow.ai.yml`).
  A debate that reviews work ended `max_rounds_exceeded` although the reviewers agreed with each other, because
  `AGREEMENT` was defined as "the work is good" and they kept answering `CRITIQUE`. The docs (and so the docs site)
  now describe the pattern: `AGREEMENT` means "I accept the other reviewers' findings", `CRITIQUE` means a finding is
  missing or wrong. The example uses it. No engine behaviour changes.

## [0.1.0-alpha.3] - 2026-10-26

The third preview, published under the `next` tag. It adds `indaba ui` (the web view and `@indaba/server`, now staged by the release workflow too), permission levels, the Workflows screen and the graph editor, and the logging settings. Entries below are the detail.

### Added

- **Edit a workflow on the graph in `indaba ui`** (patch; track `feature`; spec `specs/web-app-editing-graph`, step 3c of
  `specs/web-app`; `@indaba/web`). The workflow editor screen (`/workflows/{id}`) gains **Graph** alongside **Form** and
  **Source** on the same draft. `buildWorkflowGraph` in `@indaba/web` lays out the draft's steps deterministically with
  `@dagrejs/dagre` (left to right, or top to bottom below 640 px) and keeps dangling `depends_on` and `on_failure.target`
  references visible on the step card and in the **Connections** panel without silent repair. A **Bricks** palette adds
  an **Agent step**, **API step**, **Shell step** or **Debate**, or sets **Retry a step**, **Escalate** or **Fail** on the
  selected step, by click/Enter or drag-and-drop; handles on addressable steps connect `depends_on` (`out` to `in`) and
  `retry_step` (`fail-out` to `fail-in`); the side panel edits the selected step's connections, order and schema-driven
  fields through the sequential edit queue. No public API or dependency changed.

- **The Workflows screen: the registry from the page** (minor; track `feature`; spec `specs/web-app-registry`; `@indaba/core`, `@indaba/engine`,
  `indaba`, `@indaba/server`, `@indaba/web`; web contract 1.6.0). A **Workflows** item in the header opens a table (`apsw-gridwright`, already a
  dependency) of every workflow the registry lists, hidden and missing ones included on request: name, project, tags, last result, last cost, last run and
  state. From it a person edits an entry's name, project and tags, hides or shows it, copies it into another folder of the registry (and sees the places
  to review), imports a folder by typing its path once and confirming the folder Indaba resolved it to, removes an entry that a scan would not list again
  (never deleting a file), and scans on request. New resources `GET /api/v1/registry` and `POST /api/v1/registry/{scan, roots/resolve, roots, {id}/annotate,
  {id}/copy, {id}/remove}`, served only when the command line supplies a `RegistryControl`; the server writes nothing itself. **Widened behaviour:** `indaba ui`
  now also covers the folders of `indaba workflows add` (the per-user list), so a folder added on either side shows on the other, and a workflow of it can
  be run from the page after its usual confirmation. New in `@indaba/core`: the `Registry*View` and `Registry*Request` types; in `@indaba/engine`:
  `isWorkflowFileName`. No dependency added.

- **Agent permissions in the page and the editor** (minor; track `feature`; spec `specs/agent-permissions`, T-14; `@indaba/core`, `@indaba/engine`,
  `@indaba/runners`, `indaba`, `@indaba/server`, `@indaba/web`; web contract 1.5.0). `indaba catalog` and the editor's catalog gain, per runner,
  `permissions: { read, edit, full }`, each with a `mode`, a `scope` and a `note` id (optional, so `catalog` stays `1`); a runner that does not
  implement `PermissionCapable` is listed as unable to hold any level. The permissions field of the form offers the levels: *Read only* writes
  `{ level: read }`, *Edit only these folders* `{ level: edit, fs: { write } }`, *Full access* `{ level: full }`, switching presets is one edit per path and
  removes the keys the new shape forbids, a level the runner of the step cannot hold is refused in plain words, and a level only checked after the step
  or an `edit` whose commands are not limited says so. A block written before levels existed is still shown under its preset's name, marked old style,
  and is rewritten only when changed; the old Full access is not `level: full`. `POST /runs` accepts `fullAccessConfirmedHash` and answers
  `409 full_access_required` with the steps whose agent has `full` access, **every time** a run starts, whether or not the file was confirmed before; with
  the hash the server starts the child with `--allow-full-access=page`. `RunSummaryOfUse` gains `fullAccessSteps`. The Run confirmation lists those
  steps. New in `@indaba/core`: `permissionMapOf`, `CatalogPermissions`, `FullAccessStep`, `FullAccessRequired`. No dependency added.

- **Agent permissions: `permissions.level`** (minor; track `feature`; spec `specs/agent-permissions`, core, engine, runners and CLI; the page
  and the editor presets are the entry above). A `permissions` block gains `level` (`read`, `edit`, `full`) and is valid on a role and in
  `defaults` (the step's, else the role's, else `defaults`'s, whole). Each runner turns a written level into its own arguments, placed after
  `extraArgs`; `validate`, `plan` and run start refuse a level a runner of the chain cannot hold and state, for a step with no level, the
  built-in default its runner applies. `indaba run --permissions [<step>=]<level>` lowers levels for one run; `--allow-full-access` acknowledges
  steps at `full` when there is no terminal. A runner refused a permission in headless mode (`antigravity`) now fails the step with a fixed reason.
  New in `@indaba/core`: `PermissionLevel`, `PermissionCapable`, `resolvePermissions`, `applyBound` and friends; `RunRequest.permissionLevel`;
  span attributes `indaba.permissions.level`, `.mode`, `.scope` and `indaba.permissions.full_acknowledged`. **Behaviour change to know:** a
  `permissions` block that a file already carried on a role or in `defaults` was ignored and now applies. Nothing else that exists changes; the
  removal of the runners' built-in defaults is a later labelled release. `ask` is reserved. No dependency added.

- **`indaba ui` lists the workflow registry** (minor; track `feature`; spec `specs/workflow-registry`, slice 2). The Run a
  workflow panel lists the registry of the served folders by the registry's ids: each workflow with the name, project
  and tags set by `indaba workflows annotate` and its last run (state, when, cost); hidden ones behind a toggle; the list
  asked for again when the window gains focus, the folders scanned at most every 30 seconds; a deleted file is not
  offered. `WorkflowSummary` in `@indaba/core` gains optional `tags`, `hidden` and `lastRun`; `@indaba/server` takes a
  workflow id of 16 or 32 hexadecimal characters; `CONTRACT_VERSION` is `1.4.0`. No dependency added.

- **The workflow registry and `indaba workflows`** (minor; track `feature`; spec `specs/workflow-registry`, slice 1).
  `indaba workflows list | scan | add | annotate | remove | copy` lists the workflow files of the current folder and of
  folders you add (kept in `<user config>/indaba/workflow-roots.json`), each valid or with its first problem, its last
  run (matched by the workflow's name within its folder), your name, project and tags, or hidden. The list is a JSON
  index per folder in `.indaba/registry/`, with a `.gitignore` so it stays on the machine; files are never deleted or
  rewritten, and a copy is written beside the others with `wx` and says what to review. New in `@indaba/core`:
  `WorkflowRegistry`, `RegistryEntry`, `RegistryScanReport`, `RegistryAnnotation`, `RegistryCopy`, `RegistryOrigin`,
  `RegistryValidation`, `RegistryErrorCode`, `RegistryError`, and the optional `PluginHost.registerRegistry`. New in
  `@indaba/engine`: `FileWorkflowRegistry`, `REGISTRY_INDEX`, and the walk and confined read the page already used,
  moved from the command line (`scanWorkflowFiles`, `readWorkflowFile`, `UnreadableWorkflow`, `tooLarge`, the scan
  limits, `DEFAULT_WORKFLOW`, `MAX_WORKFLOW_BYTES`); what they find is unchanged. No dependency added.

- **Edit a workflow as a form in `indaba ui`** (minor; track `feature`; spec `specs/web-app-editing-forms`, step 3b of
  `specs/web-app`). The workflow screen has **Form** and **Source**, two views of one draft; the form comes first when the
  file can be read. Its fields are read from the workflow's JSON Schema and its choices from the catalog and the file:
  the name, each role's runner and model, and every field of a step but `agent` and `guards`, with presets for what a
  step's agent may change (read only, edit only these folders, full access). Each change is one edit of its path, so the
  file's comments and layout stay; steps can be added, removed and moved; a problem is shown at its field. New in
  `@indaba/core` (types only): `JsonValue`, `JsonObject`, `WorkflowPath`, `WorkflowEdit`, `EditWorkflowRequest`,
  `WorkflowEditResponse`, `WorkflowNotEditable`, `WorkflowEditRefused`, `CatalogEntry`, `EditorCatalog`,
  `EditorResponse`, and `path` on `WorkflowProblem`. New in `@indaba/server`: `WorkflowEditor`, `WorkflowEditorError`,
  `MAX_EDITS`, `MAX_PATH_PARTS`, `MAX_KEY_LENGTH`, `MAX_VALUE_DEPTH`, `ServerOptions.workflowEditor`,
  `GET /api/v1/editor` and `POST /api/v1/workflows/edit`; the check and save answers carry `path` on their problems.
  `CONTRACT_VERSION` is `1.3.0`. The page's first view of a workflow is the form when it can be read (it was the text).
  No dependency added.

- **Descriptions, and `indaba catalog`** (minor; track `feature`; spec `specs/workflow-editor`, part 3).
  `Runner`, `Guard` and `Adjudicator` in `@indaba/core` may carry an optional `description`, one line a wizard shows
  next to the name; every built-in has one (this also delivers `specs/debate-arbiter` T16). `Described` is exported;
  `AdjudicatorRegistry`, `GuardRegistry` and `RunnerRegistry` gain `describe()`. `catalogOf(sources)` and the
  `Catalog` shape in `@indaba/engine` list the runners, guard types and arbiters of an installation, cleaned and cut
  at 200 characters, with the format's allowed values; `indaba catalog [--json] [--plugin <spec>]` prints it (exit
  `1` when a plugin fails to load, `2` for a usage error). `voters`, `prompts` and `values.promptAdditions` are empty
  until later features fill them.

- **Edit a workflow file without losing its text, and its JSON Schema** (minor; track `feature`; spec
  `specs/workflow-editor`, part 2). `WorkflowDocument` in `@indaba/engine` holds a workflow's text and edits it by path
  (`get`, `set`, `remove`, `has`) and by step id (`addStep`, `removeStep`, `moveStep`); everything not edited stays byte
  for byte (comments, blank lines, key order, quoting), and every edit is checked by reading the result back.
  `problems()` places what `indaba validate` reports. It refuses keys that reach a prototype, values that are not plain
  JSON, text over 1 MiB (`MAX_DOCUMENT_BYTES`) and more than 100 aliases (`MAX_ALIASES`), with a
  `WorkflowDocumentError` naming the path. `workflowJsonSchema()` and the new command `indaba schema` give the file's
  JSON Schema (draft 2020-12), kept equal to the parser by a test. `ajv` joins the development dependencies for that
  test; nothing new ships.

- **Every problem of a workflow file, placed** (minor; track `feature`; spec `specs/workflow-editor`, part 2, T5 and
  T5b). `WorkflowParser.diagnose(text)` in `@indaba/engine` answers the problems `indaba validate` reports (the same
  sentences: errors, or the warnings of a valid file), each with its `path` (`$.steps[0].role`), `severity`, and a
  1-based `line` and `column`; a missing key points at the mapping that lacks it. New exports: `Problem`, `Path`,
  `pathText`. The source view of `indaba ui` now has a line for every problem, not only for YAML syntax. `parse` and
  `validate` are unchanged.

- **Edit a workflow's text from `indaba ui`** (minor; track `feature`; spec `specs/web-app-editing-core`, step 3a of
  `specs/web-app`). **Edit** in the Run a workflow panel opens a workflow file as text, with line numbers, the problems
  `indaba validate` would report as you type (with line and column for YAML syntax), **Save**, and **Run** once the
  saved file is valid. A save is against the version read: a file changed on disk since is not overwritten, and the
  page shows both versions to choose from. A save writes a temporary file beside the target and renames it over, keeping
  its permission bits. Saving changes the content hash, so the next Run asks for a confirmation again. New in
  `@indaba/core` (types only): `WorkflowProblem`, `WorkflowSourceResponse`, `SaveWorkflowSourceRequest`,
  `SaveWorkflowSourceResponse`, `WorkflowChangedOnDisk`, `CheckWorkflowRequest`, `WorkflowCheckResponse`. New in
  `@indaba/server`: `WorkflowStore`, `WorkflowStoreError`, `MAX_SOURCE_BYTES`, `MAX_SOURCE_BODY_BYTES`,
  `ServerOptions.workflowStore`, `GET` and `PUT /api/v1/workflows/{id}/source`, `POST /api/v1/workflows/check`;
  `CONTRACT_VERSION` is `1.2.0`. No dependency added.

- **Run and Stop from `indaba ui`** (minor; track `feature`; spec `specs/web-app-actions`, the first slice of step 2 of
  `specs/web-app`). The Runs screen has **Run a workflow**: a panel with the workflow files of the served projects (a
  bounded search; an invalid file listed with its problems and not runnable). The first run of a workflow's content shows
  what its file says it will use (runners, commands, permissions, steps that need a person) and runs on confirmation;
  the confirmation is kept per SHA-256 of the file in the user's configuration folder, outside every project. Each run
  is an `indaba run` of its own, from a copy of the confirmed bytes under `.indaba/run-inputs/`. The Run screen has
  **Stop** for a run the page started, which stops it as Ctrl+C does; closing `indaba ui` stops the runs it started
  (cancel, five seconds, then the process tree). New in `@indaba/core` (types only): `WorkflowSummary`,
  `WorkflowListResponse`, `RunSummaryOfUse`, `StartRunRequest`, `StartRunResponse`, `ConfirmationRequired`,
  `StartStatusResponse`, `StopRunResponse`, and `canStop` on `RunResponse`. New in `@indaba/server`: `RunControl`,
  `RunControlError`, `MAX_CONCURRENT_RUNS`, `ServerOptions.runs`, `GET /api/v1/workflows`, `POST /api/v1/runs`,
  `GET /api/v1/starts/{id}`, `POST /api/v1/runs/{id}/stop`; `CONTRACT_VERSION` is `1.1.0`. Without `runs` the server
  is the read-only one. No dependency added.

- **The cost of a run in the list of runs** (minor; track `feature`; spec `specs/web-app`, task T-23, answer 1 of the
  sketches). `RunSummary` gains `cost` (`RunCost` in `@indaba/core`: `usd`, `unknown`, `calls`, the shape
  `RunState.cost` already had), filled by `TraceReader.listRuns` with the reducer a run's own view uses, so the two never
  disagree; `GET /api/v1/runs` carries it. The Runs screen of `indaba ui` has a Cost column (`unknown`, `at least … (partial)`
  and `$0.00 (no model calls)` as on the Run screen) with what the cost is made of in a tooltip, and the Run screen has a
  table of the cost of each step that called a model. Code that builds its own `RunSummary` value adds the field.
- **The discussion of a debate, kept and shown** (minor; track `feature`; spec `specs/web-app`, task T-21). When a debate
  step ends, the engine keeps its messages (round, sender, type, text, and the ruling if one was asked for) as
  `<traceId>.<stepId>.json`, redacted and with control sequences dropped, in `.indaba/discussions` or the folder given
  with `indaba run --discussion-dir <dir>`. The server answers
  `GET /api/v1/runs/{id}/steps/{step}/discussion` (404 `discussion_not_found` when none was kept) and looks in each
  root's default folder plus any `indaba ui --discussion-dir <dir>`. The step panel of a debate has a closed
  `Show the discussion` section: the rounds, who said what, where each participant ended, and the ruling, as plain text.
  New in `@indaba/core`: `DiscussionView`, `DiscussionMessage`, `DiscussionRuling`, `DiscussionResponse` (types only);
  in `@indaba/engine`: `DiscussionStore`, `discussionOf`, `DISCUSSION_DIRECTORY`. A run from before this change has no
  messages and the page says so.
- **The page stops asking a server that is not there** (minor; track `feature`; spec `specs/web-app`, answer 2 of the
  sketches). After 8 failed attempts in a row (about half a minute with the growing waits; a starting value, not a
  measurement) a stream reports `unavailable`; the header says `Server stopped`, a banner says what to do, and a
  `Check again` button asks the server once and restarts the screen's streams when it answers. The state on screen stays
  as the last known one.
- **`@indaba/server`, the local server of the web view** (minor, below 1.0; track `feature`; spec `specs/web-app`, tasks
  T-01 to T-06, T-10 and T-12). A new optional package. `startServer({ roots, staticDir, port?, token?, pollMs?, sleep?,
  coalesceMs?, discussionDirectories?, logger? })` returns `{ url, port, close() }`, and `CONTRACT_VERSION` is `1.0.0`. It answers
  `GET` only, under `/api/v1`: `/contract`, `/runs`, `/runs/{id}`, `/runs/{id}/events` (Server-Sent Events, resumable
  with `Last-Event-ID`), `/runs/{id}/steps/{step}/log`, `/runs/{id}/steps/{step}/discussion` and `/events` (a run
  started or ended). Its defaults are part of the contract, and changing any of them later is a major: it listens on
  `127.0.0.1` only, requires `Authorization: Bearer <token>` on every API request with a new random token at each start,
  accepts only its own `Host` (`localhost`, `127.0.0.1` or `[::1]` with its port), refuses every other method, sends no
  CORS header, and serves the page with a Content-Security-Policy that allows no inline script. Run and step ids are
  matched before any path is built, and every text of a run (output, reasons, names of the workflow, the steps' runners
  and models, states, tool kinds) is sent with control and escape sequences removed. The built page ships in the
  package's `page/`. With `logger` (the contract of `specs/logging`) it records its start and stop with the address but
  never the token, each refused request, each stream opening and closing and a failed request; `indaba ui` hands it the
  command's logger, so all of it lands in `.indaba/logs`. `loggedPath` is exported. New in `@indaba/core`, as declarations only: the `web-contract` types (`RunSnapshot`, `RunSummary`,
  `RunCost`, `ApiError`, the request, response and stream types), and `RunState`, `StepView`, `AttemptView`,
  `RunnerView`, `SkippedRunnerView` and `RunStatus`, which moved from `@indaba/engine`; the engine re-exports them, so no
  import path breaks.
- **`indaba ui [--root <dir>]... [--discussion-dir <dir>]... [--port <n>] [--no-open]`** (minor; track `feature`; spec `specs/web-app`, task T-11). Starts
  the local server over the runs of one or more projects, prints the address with its token, opens the browser unless
  `--no-open`, and serves until Ctrl+C. `@indaba/server` is loaded on demand like `@indaba/tui` (an optional peer
  dependency of `indaba`), and says what to install when it is missing; `@indaba/server` gains `defaultPageDirectory()`.
  The browser is opened with `rundll32`, `open` or `xdg-open` and the address as one argument, never through a shell.
- **The page of `indaba ui`** (minor; track `feature`; spec `specs/web-app`, tasks T-07 and T-08). A new private
  package, `@indaba/web`, built into static files for `@indaba/server` to serve: the runs on this machine in an
  `apsw-gridwright` grid, and one run live, with its steps as a graph (React Flow, laid out left to right by
  `@dagrejs/dagre`), the failure route drawn, every step selectable from the graph or the step list, what happened in
  it and what happens if it fails, its tries and its output as plain text, and the cost with unknowns marked. Light
  and dark themes that follow the system, keyboard and screen-reader use, and a phone at 320 px, where the graph runs
  top to bottom. While the connection is down every state says `last known` in words as well as turning grey. Opening a
  run adds one entry to the browser's history, so Back leaves it at once. The token is read
  from the address fragment, removed from it and kept in memory; the event stream is read with `fetch` so it carries
  the header, and resumes after a drop. It starts nothing and changes nothing. The page is not published on its own
  and adds nothing to a consumer's dependencies: its build ships inside `@indaba/server`, in `page/`, with
  `page/THIRD-PARTY-LICENSES.txt` carrying the licence of every library it bundles (task T-10). `indaba ui` serves it, and `pnpm try:ui`
  serves it from a checkout (`--demo` runs a small workflow with a retry first, with no agent or key). Documented in
  `docs/web-view.md`, and for contributors in `docs/web-view-development.md`.
- **A run records the shape of its workflow** (minor; track `feature`; spec `specs/web-app`, task T-20). When a run
  starts, its root span gains `indaba.workflow.structure`: every step, in the order the engine runs them, with
  `depends_on` and `on_failure`, as one JSON string. It is written once, on the root, because a step's own span exists
  only when the step runs. New in `@indaba/core`: `RunState.structure`, `StepStructure` and `StepFailureRoute`. New in
  `@indaba/engine`: `describeStructure`, `readStructure`, `WORKFLOW_STRUCTURE_ATTRIBUTE` and `MAX_STRUCTURE_STEPS`. The
  reducer fills `structure` and leaves it `undefined` for an older run or a value it cannot trust; `steps`, the dashboard
  and the plain output are unchanged.
- **Every command keeps a log file** (minor; track `feature`; spec `specs/logging`). With no setup, `indaba
  validate`, `plan`, `run` and `watch` append JSON lines to `.indaba/logs/indaba-<yyyy-mm-dd>.log.jsonl` in the
  project (for `run`, the one of `--workdir`): a `process.start` record (command name, Indaba, Node, platform and
  architecture, never the arguments) and a `process.end` record with the exit code. A file is closed at 10 MiB and
  10 files are kept; both are starting values, not measurements. `warn` and above also go to standard error as one
  plain line; standard output does not change. New options on every command: `--log-level <error|warn|info|debug>`
  (default `info`; also the variable `INDABA_LOG_LEVEL`, which the option overrides) and `--log-dir <dir>` (a
  relative folder must stay inside the project). An unknown level is a usage error, exit code 2. A folder that cannot
  be written costs one warning and the command goes on. New in `@indaba/core`: `Logger`, `LogRecord`, `LogSink`,
  `createLogger`, `noopLogger`, `LOGGING_DEFAULTS`, `LOGGING_SETTINGS`, `resolveLoggingSettings` and the optional
  `PluginHost.logger`. New in `@indaba/engine`: `FileLogSink`, `logEngineEvents` (every step state change and every
  span that ends with an error is a record with its task, step or trace id; at `debug`, what a step streams) and the
  logging contract re-exported. New options: `logger` on `createEngine` of `indaba` and on `watch` of `@indaba/tui`.
  A plugin logs through `host.logger`.
- **Logging is configured in `indaba.config`, reaches Graylog and any JSON collector, and a plugin can add a sink**
  (minor; track `feature`; spec `specs/logging`). A YAML file `indaba.config` in the project root may hold a `logging:`
  section: `level` and a list of `sinks`, each `file` (`folder`, `maxFileBytes`, `maxFiles`), `stderr`, `gelf` (GELF
  1.1 over `http(s)://`, `tcp://` or `udp://`, for Graylog) or `http-json` (one JSON record per POST), each with its
  own `level`. A missing file means the defaults; an unknown key, a wrong type or an unknown section is a usage error
  naming the key, exit code 2. `--log-level`, then `INDABA_LOG_LEVEL`, then the file decide the level; `--log-dir`
  replaces the folder of every file sink. A remote sink never holds up a command: it queues (1000 records; the oldest
  `debug` ones go first when full), gives an attempt 5 seconds, retries 3 times while the collector is up and once
  while it is down, costs one warning per outage, and `flush` waits at most one timeout; all of them are settings and
  starting values, not measurements. A collector's credential is the NAME of a variable (`secretEnv`), sent as the
  `Authorization` header and redacted from every record; an address with a user name or password is refused. The
  redaction of every record now also removes bearer tokens, `Authorization` values, API-key and token shapes (OpenAI
  style, GitHub, GitLab, Slack, AWS, Google, JWT, private key blocks), a credential in a URL query or fragment
  (`#token=`) and a URL's password; the same rule now redacts the errors, traces and events the command line already
  redacted. The built-in runners record every process they start and end (the program's name, never its arguments)
  and every HTTP request (host and path, never the query or headers). A second Ctrl+C now writes the last records
  (for at most 2 seconds) before leaving; a third leaves at once. New in `@indaba/core`: `createRedactor`,
  `secretValuesOf`, `REDACTED`, `LogSinkRegistry` (`createLogger` now also returns `addSink`),
  `loggingSettingsToConfig`, `defaultLoggingSettings`, `Plugin.logSinks` and the optional
  `PluginHost.registerLogSink`. New in `@indaba/engine`: `GelfLogSink`, `HttpJsonLogSink`, `RemoteLogSink`,
  `parseCollectorAddress`, `readProjectConfig`, `parseProjectConfig`, `writeLoggingConfig` and `PROJECT_CONFIG_FILE`.
  New in `@indaba/runners`: `LoggingProcessSpawner`, `LoggingStreamingSpawner`, `loggingFetch` and the `logger`
  option of `RunnerRegistry.withDefaults`. New in `indaba`: `CreateEngineOptions.logSinks`.
- **`indaba report [run]` and `indaba settings`** (minor; track `feature`; spec `specs/logging`). `report` writes one
  redacted folder under `.indaba/reports/` (or `--out`) with the log lines of the commands that ran the run, its trace
  and events, the workflow file, `indaba.config` and the environment, says what it could not include, and sends
  nothing. `settings` prints the logging settings in use (`--plain`, or without a terminal) or, with `@indaba/tui`,
  opens a Settings screen: each value with its default beside it, checked as it is typed by the same rules as the
  file, a test record through one sink, and Save, which writes `indaba.config` keeping its comments and other keys.
  A collector's credential is entered as a variable's name; the screen shows whether it is set, never its value. New
  in `@indaba/tui`: `editLoggingSettings` and the pure state behind it (`reduceSettings`, `buildSettingsScreen`, ...);
  the engine re-exports the settings description so the dashboard takes it from there.
- **A Settings screen in `indaba ui`** (minor; track `feature`; spec `specs/logging`). `/settings` shows the same
  settings with their defaults, checked by the server as they are typed, a test record per sink, and Save. It is the
  one thing the server writes: `GET`/`PUT /api/v1/settings/logging`, `POST .../check` and `POST .../test`, only when
  the command line supplies `ServerOptions.loggingSettings` (it does, for the first `--root`), with the token, the
  `Host` check, a same-origin check, JSON bodies of at most 64 KiB; every other address still answers `GET` only.
  New in `@indaba/core`: `SINK_DEFAULTS`, the response shapes and `ApiError.problems`.
- **The list of runs names the workflow** (minor; track `feature`; spec `specs/watch-workflow-name`). `indaba watch`
  with no run id prints `<id>  <status>  <started>  <workflow>`; the workflow comes last so a script that reads the
  first three columns keeps working, and a run whose name is unknown shows `-`. The name is read from a file, so it
  is printed as plain text on one line and cut at 60 characters. New in `@indaba/engine`: `RunSummary.workflow` and
  the same field on what `summariseRun` returns.
- **A debate can have an arbiter** (minor; track `feature`; spec `specs/debate-arbiter`). A debate step may set
  `arbiter: "human"` (or the name of one a plugin registers). When its debate ends `stalled` or
  `max_rounds_exceeded`, the arbiter rules `accept` (the step completes) or `reject` (it escalates, with the note)
  instead of escalating at once. `human` asks in the terminal; with no terminal, `--tui` or a cancel it cannot
  answer, so the step escalates exactly as before. New in `@indaba/core`: `Adjudicator`, `Ruling`, `Verdict`,
  `RulingRequest`, `AdjudicatorRegistry`, the step field `arbiter` and `PluginHost.registerAdjudicator`. New span
  attributes: `indaba.arbiter.kind`, `.verdict`, `.source` and `.memo`. Every debate step now also writes
  `.indaba/artifacts/<step>.transcript.md`; a ruled one writes `<step>.ruling.md`.
- **A retried step shows each attempt** (minor; track `feature`; spec `specs/attempt-history`). The dashboard and
  the plain view showed a retried step only as `attempt 2` and the reason of the current attempt; the reason of an
  earlier one was dropped when the step ran again. They now print a line for each earlier attempt, such as
  `attempt 1: failed after 3s: tests red`. New in `@indaba/engine`: `StepView.history` (the newest 20 attempts),
  `AttemptView`, `MAX_ATTEMPTS_KEPT` and `attemptLines`. An agent CLI's own internal retries are not recorded and are
  not shown.
- **A decision ledger** in `.indaba-decisions/<workflow>.jsonl`, meant to be committed. Every ruling is appended as
  one JSON line (verdict, redacted note, outcome, rounds, commit, time; never the transcript). Before a debate
  runs, a ruling for the same workflow, step, goal and committed files is reused and the debate is skipped; with
  uncommitted changes, or outside git, nothing is reused. A malformed line fails the step, naming file and line.
- `examples/review-debate.workflow.ai.yml`: `claude-code` and `antigravity` review a project and debate it.
- **OpenCode** (minor; track `feature`; spec `specs/opencode`). `agent: "opencode"` on an `acp` role starts `opencode acp`
  and passes on only `OPENCODE_`, `ANTHROPIC_`, `OPENAI_`, `GOOGLE_`, `GEMINI_` and `OPENROUTER_` variables. A new `opencode`
  runner (`OpenCodeRunner`, `opencode run [--model <m>] <prompt>`) is the last-resort CLI transport, so
  `runner: ["acp", "opencode"]` is the chain; it never adds `--auto`. `ACP_AGENT_PRESETS` gains the key `opencode`.
  No dependency is added, and the flags follow OpenCode's documentation but have not yet been run against an
  installed OpenCode.
- **A run event stream** (minor; track `feature`; spec `specs/tui`). Every `indaba run` now also writes
  `.indaba/traces/<traceId>.events.jsonl` while it runs: one record per line for each span start and end, each
  step status change (`PENDING -> RUNNING -> ...`) and each chunk of output a step streams. It exists so
  something can follow a run live: the trace file only gets a span when the span ends, and records neither
  step states nor output. Output is passed through the same credential redaction the command line uses for its
  own messages (variables named like a key, token, secret, password or credential), cut to 4096 characters a
  record, and capped at 2 MiB a run, after which one `truncated` record is written. It can still hold whatever
  an agent printed, so it stays under `.indaba/` (gitignored, local).
- **`@indaba/tui`**, an optional terminal dashboard for a run (minor; track `feature`; spec `specs/tui`). A new
  package built on Ink 8 and React 19, both MIT and pinned exactly, and used by nothing else: steps on one side,
  the selected step's output on the other, keys for selecting, scrolling, following and help, a stacked layout
  below 80 columns, and a notice below 40x8. Every state is a glyph and a word as well as a colour, text from an
  agent is stripped of terminal control sequences before it is drawn, and the terminal is always given back
  (raw mode off, cursor shown) even when drawing fails. It follows a live run or replays a finished one at 1x or
  10x. `indaba watch` opens it on a terminal when it is installed.
  It always draws interactively on a terminal, even when `CI` is set, instead of leaving Ink to treat that as "no
  screen" and write only the last frame.
- **`indaba watch` opens the dashboard** on a terminal when `@indaba/tui` is installed (minor; track `feature`).
  `--plain` or `--output` print lines as before, `--ascii` draws without box or arrow characters, and with no
  terminal, or with the package absent (it says how to install it), the command prints lines. `indaba` lists
  `@indaba/tui` as an optional peer dependency, so `indaba` alone installs none of Ink or React.
- **`indaba run --tui`** (minor; track `feature`; spec `specs/tui`): starts the run in a process of its own and
  opens the dashboard on it, so closing the screen never decides whether the run lives. Quitting asks to detach (the
  run goes on) or cancel (it stops and removes its worktree); an interrupt on the command line cancels. Cancel is a
  message over the child's channel, not a signal, so it stops the run gracefully on Windows too. It needs a
  terminal and `@indaba/tui`, and starts nothing without them.
- **`indaba watch [run]`**: follow a run from the files it writes, or read a finished one. With no run it lists
  them, newest first; a run is its id, a unique start of it, or `latest`. It prints each step change and runner
  start and end as it happens (`--output` adds the streamed lines), then a final view, and exits the way the run
  did (0 completed, 1 failed, 2 escalated, 130 cancelled, 3 when the files end without a final state or the run
  goes quiet for `--stale` seconds). `--replay [--speed 1|10]` plays a finished run with its original timing. Agent
  text is stripped of terminal control sequences before it is printed. Plain output only for now.
- `@indaba/engine`: a pure run view model (`reduceRun`, `RunState`) and plain formatters (`formatPlain`,
  `formatEvent`) over the event stream, and the terminal-text sanitizer (`sanitize`, `createSanitizer`) the CLI
  used internally, now exported.
- `@indaba/core`: a `StepOutput` event, dispatched for each streamed chunk. `@indaba/engine`: `RunEventWriter`,
  `TraceReader` (read all, follow live, list runs; tolerates half-written and malformed lines, and reads runs
  written before the stream existed from their trace file), `parseRecord` and the record types.

### Changed

- **A write to `indaba ui`'s server needs the page's own `Origin`** (minor below 1.0, a tightened check; spec
  `specs/web-app-actions`, AC-16). A request without an `Origin` header was accepted with the token; it is now
  `403 origin_not_allowed`. A browser always sends one on `POST` and `PUT`, so the page is unaffected; a script that
  wrote the logging settings with only the token must send `Origin: http://127.0.0.1:<port>`. The 400, 403, 413 and
  415 answers no longer mention settings. `indaba ui`'s help no longer says it starts nothing.
- **The page of `indaba ui` uses `apsw-gridwright` 0.22.0** (track `chore`; bundled at build time, nothing enters a
  consumer's tree).
- A run now leaves two files in `.indaba/traces/` instead of one. The trace file `<traceId>.jsonl` is
  byte-for-byte what it was; the new `<traceId>.events.jsonl` has its own record format. A script that reads
  every `*.jsonl` there and expects span lines should skip names ending in `.events.jsonl`.

### Fixed

- A `retry_step` no longer fails the run when a step that does not depend on the target sits after it (patch; track `fix`). The
  loop moved back to the target and then tried to run that completed, unreset step again, which the state machine refuses
  (`Step "x" cannot move from COMPLETED to RUNNING`). A completed step that was not reset is now skipped.
- `WorkflowDocument.set` into an empty `{}` map no longer respaces the whole file (patch; track `fix`; spec
  `specs/workflow-editor`, AC-04). The edit now splices only its own text, as every other edit does.
- A run with no model call says so (patch; track `fix`). The cost in the header and the plain status line read
  `cost none` for a run that made no model call, which looks like a free run. It now reads `cost no model calls`; a
  call priced at exactly zero still shows `$0.0000`, and `unknown` stays for a call that could not be priced.
  `RunState.cost` gains a `calls` count.
- The runner line of a step is clearer (patch; track `fix`). The shell commands of a step are listed on a
  `commands (n): ok 0s, ok 2s` line instead of `shell ok 0s -> shell ok 2s`, which read like a fallback chain; an
  agent that has finished shows its tokens and cost, or says `tokens unknown` and `cost unknown`. Both the
  terminal dashboard and the plain `run` and `watch` output change; `runnerLines` is exported from
  `@indaba/engine`.
- The terminal dashboard shows a failed step more plainly (patch; track `fix`). The reason no longer repeats the
  error text the output pane already shows (its first line, which says what happened, stays), and a finished step
  that printed nothing says `(no output)`, with the exit code when a runner reported one, instead of an empty pane.
- The output pane of the terminal dashboard wraps a long line (patch; track `fix`). A line longer than the pane was
  cut with `…`, so the end of a long message could not be read. It now continues on the next rows, and scrolling
  counts rows as drawn.
- A credential no longer reaches the trace through a failed step (patch; track `fix`). The text a step reports when it
  fails (the command line, a runner's error output, a guard's message, the message of an error a runner throws) and
  the `indaba.label` span attribute were redacted on the terminal but stored as they were in `<traceId>.jsonl`,
  `<traceId>.events.jsonl` and the plain `run` status line. They are now redacted in the step executor before the engine
  records them. The redaction is still by variable name (key, token, secret, password, credential) and value, so a
  secret in a variable with another name is not recognised.
- `indaba` now exits when its work is done (patch; track `fix`). On Windows, a run that used a pseudo-terminal
  (every agent CLI runner by default) printed its result and then never returned the prompt, because the
  terminal's `conhost` outlived its child and kept Node's event loop alive. The command line now flushes
  stdout and stderr and exits with the run's status. A program that embeds `@indaba/runners` and uses the
  pseudo-terminal on Windows is not helped by this and must exit itself; `@indaba/runners` is unchanged.
- A cost an ACP agent reports in USD is now recorded on the step's span as `indaba.cost.usd`. The `acp` runner
  returned it as `RunResult.reportedCostUsd` and the changelog said it was used, but the engine never copied it
  onto a span, so such steps had no cost in the trace. A cost worked out from the pricing table still wins, and
  nothing is recorded when neither exists.

## [0.1.0-alpha.2] - 2026-10-05

The second preview, and the release `0.1.0-alpha.1` was meant to be. It makes the API and ACP the primary
ways to reach an agent, with the agent CLIs as a fallback; the changes are listed under
`0.1.0-alpha.1` below. The API is still not stable. It is published under the `next` tag; `latest` stays on
`0.1.0-alpha.0` until the maintainer decides otherwise.

### Fixed

- The four packages now declare `repository`, `bugs` and `homepage`. npm's trusted publishing with provenance
  requires the repository in `package.json` to match the one that built the package; without it, staging
  failed with `422 ... "repository.url" is ""`.

## [0.1.0-alpha.1] - 2026-10-05

**Never published.** The version was tagged, its verification gate passed, and then npm refused to stage
`@indaba/core` because the manifests had no `repository` field (see `0.1.0-alpha.2`). No package of this
version reached npm, and the tag stays as it is. Its contents are released as `0.1.0-alpha.2`.

### Added

- `pnpm try:agent` (`scripts/try-agent.mjs`): tries a real ACP agent from a clean state (a throwaway project,
  the agent from npm into a cache, no machine-specific paths) with three scenarios, `read`, `edit` and
  `outside` a write scope, and checks the trace and patch. Needs `--yes`; never part of CI.
- **Transport priority: API and ACP first, the CLI as a fallback** (minor; track `feature`; spec
  `specs/transport-priority`).
  - `runner` accepts a name or a list in priority order, on a role and on a step. A runner that could
    not run is passed over for the next; a runner that ran and failed is a failed task and is never
    retried elsewhere. New `RunnerUnavailableError` (a `RunnerError`) marks "nothing was sent to the
    agent"; plugin runners throw it too. `indaba plan` prints the list.
  - `acp` runner: any agent that speaks the Agent Client Protocol (v1) over stdio, started from a preset
    (`claude`, `codex`, `gemini`) or `agent: { command: [...] }`. Indaba answers the agent's permission
    requests and serves its file requests only inside the step's scope; it never selects an "always"
    option and offers no terminal. Tool calls, plans, permission decisions and context use are recorded as
    span events. A cost the agent reports in USD is used; no token counts are invented.
  - `permissions` on a step (`fs.read`, `fs.write` globs, `terminal`) and a `diff_within_scope` guard,
    added automatically, that fails a step which changed anything outside `fs.write`, for every runner.
    `indaba validate` warns about `permissions` without a worktree or without an `acp` runner.
  - `OpenAiCompatibleRunner`: any OpenAI-compatible endpoint (OpenAI, vLLM, Ollama, LM Studio),
    configured with `INDABA_OPENAI_COMPAT_<NAME>_*` environment variables, never from a workflow file.
    `openrouter` is unchanged and still registered.
  - Span events (`Span.addEvent`, written under `events` in the JSONL trace only for spans that have
    them): `indaba.runner.skipped`, `indaba.acp.*`. `RunRequest` gains `permissions`, `agent` and
    `onEvent`; `RunResult` gains `reportedCostUsd`. Through the command line, an unknown runner name is
    now a validation error.
  - Logging in to an ACP agent: `agent: { preset | command, auth }` names the agent's own login method
    (from the `authMethods` it lists), and when it is left out and a person is at a terminal, `indaba run`
    lists the methods and asks, as an editor does. Without a terminal it never asks. A failed login is a
    runner that could not run. Found by a first run against the real Gemini CLI, which accepts a session
    without a login and fails at its first model call.
  - Examples `examples/transport-fallback.workflow.ai.yml` and `examples/api-only.workflow.ai.yml`, and a
    guide to this alpha: `docs/using-the-alpha.md`.

### Changed

- When a step sets both a `role` and a `runner`, the step's `runner` is now used (before, the role's
  silently won). The role still supplies the model. `indaba validate` warns when they differ.
- The `openrouter` runner now reports "could not run" (so a fallback list moves on) when there is no key or
  model, when the key is rejected (HTTP 401 or 403), and when the endpoint gives no response at all; it
  used to return a failed result for the last two. Other HTTP errors are still failed results.
- Every runner's "cannot start" error, and an unknown runner name, is now a `RunnerUnavailableError`
  (still a `RunnerError`).

### Fixed

- `indaba run` printed a status line glued to the end of an agent's answer when the answer did not end with a
  newline; it now starts on a fresh line.
- `indaba run -vv` wrote an agent's streamed output to the terminal as it came, so escape sequences in it
  (clear screen, window title, hyperlinks, carriage returns, bidirectional overrides) acted on the
  terminal. It now prints plain text only, newlines and tabs kept, including when a sequence is split
  across two chunks. Applies to every runner.
- ACP tool-call events now carry the kind of the call they belong to (an update repeats only the id).
- `indaba run`, `plan` and `validate` without a file now say that `.indaba/workflow.ai.yml` was the default
  they tried and how to name a file, instead of only reporting that the default could not be read.
- Cancelling a run (Ctrl+C) while a step is running now ends it as `CANCELLED` with exit code 130. The
  process runners report an abort as a failed result rather than an exception, so the engine recorded
  the run as `FAILED`. Found by the new end-to-end test on Linux.
- Giving `indaba` a development workflow (`version: "2.0"` with `stages`, `governance`, `tracks` or
  `quality_gates`, like this repository's own `workflow.ai.yml`) now says it looks like a development
  workflow instead of only reporting an unsupported version.

## [0.1.0-alpha.0] - 2026-10-04

A preview that reserves the package names, published by hand with a security-key login. Because it is
the first version, npm also pointed `latest` at it; from the next prerelease on, prereleases go to
`next`. The API is not stable.

### Added

- **The TypeScript port** (major per the semver rules, but nothing was ever published, so no consumer
  is broken; the first npm release is `0.1.0`; track `feature`). Spec: `specs/typescript-port`.
  - Four npm packages in a pnpm workspace, ESM only, types shipped, Node 22 or newer:
    - `@indaba/core`: the pure domain (workflow model, DAG, step state, mesh, `Runner`, `Guard`,
      `Plugin` and `PluginHost` contracts, tracer, typed event dispatcher). No dependencies, no
      `node:` import; a test fails the build otherwise.
    - `@indaba/engine`: the parser and validator, guards, `WorkflowEngine`, git worktrees and the
      JSONL span exporter. Runtime dependency: `yaml`.
    - `@indaba/runners`: `ShellRunner`, `OpenRouterRunner` (SSE over `fetch`), the Claude Code, Codex,
      Cursor and Antigravity CLI runners, `RunnerRegistry`. CLI runners use a pseudo-terminal through
      the optional `node-pty` and fall back to piped stdio.
    - `indaba`: the `validate`, `plan` and `run` commands with the same options as before, and
      `createEngine`.
  - A plugin contract: `Plugin` and `PluginHost` live in `@indaba/core`, guard types are an open string
    validated against the guard registry, and the command line loads plugins with a repeatable
    `--plugin <module-specifier-or-path>` option. Built-ins register through the same host.
  - Behaviour is a port: the workflow format (`version: "1.0"`), the exit codes, the events
    (`StepStatusChanged`, `SpanStarted`, `SpanEnded`), the `gen_ai.*` span attributes and the JSONL
    trace keep their names and shapes. Public names follow `specs/typescript-port/api-surface.md`
    (`RunnerInterface` is `Runner`, `*Exception` is `*Error`).
  - CI runs `pnpm qa` and a packed-install smoke test on Ubuntu, Windows and macOS, a dependency audit,
    and the Node gates. A release workflow publishes with provenance when a maintainer pushes a `v*`
    tag.
  - User documentation: `docs/getting-started.md`, `docs/workflow-format.md`, `docs/extending.md`.

### Changed

- The development governance is retargeted from PHP, Composer and Docker to Node, pnpm and TypeScript:
  `workflow.ai.yml`, `AGENTS.md`, the hooks, the CI jobs, the skills and rules. The quality gate is
  `pnpm qa` (Biome, `tsc` strict, Vitest) on the host, on any OS; TypeScript strictness replaces the
  analyser level, and no suppression comment of any tool is allowed. `scripts/security-audit.mjs` and
  `scripts/check-workflow.mjs` check TypeScript, `package.json`, `tsconfig.base.json` and `biome.json`.
- `docs/vision.md` is unchanged except for a note that its language references are superseded.
- The older feature specs carry a note that the implementation language changed and behaviour did not.

### Removed

- The PHP implementation, `composer.json` and `composer.lock`, the Docker files, and the PHP analyser,
  formatter and test configuration. History keeps them. The PHP prototype was never published, so
  there is no migration.

### History before the port

These entries describe the PHP prototype that existed in this repository before the port. It was never
published, so nothing below was ever released.

- **The initial engine** (minor; track `feature`). Specs: `specs/workflow-engine`,
  `specs/agent-mesh`, `specs/runner-adapters`, `specs/git-workspace`, `specs/observability` and
  `specs/cli`.
  - A workflow engine: a YAML parser with parse-time validation, DAG ordering, a step state machine,
    guards and bounded, isolated retries.
  - An agent mesh: immutable messages, a blackboard, a consensus arbiter and ping-pong detection.
  - Runners behind one `RunnerInterface`: shell, Claude Code and Cursor CLIs, and OpenRouter over
    Server-Sent Events.
  - Git worktree isolation per task, with diff and patch handling.
  - Tracing aligned with the OpenTelemetry GenAI conventions, token usage and cost accounting, and
    PSR-14 span events.
  - A `bin/indaba` command line with `validate`, `plan` and `run`.
  - MCP support through agents: `mcp_servers`, role and step `mcp`, and a `required` (default) or
    `optional` policy, set per workflow (`defaults.mcp_policy`) or per step. Claude Code and Codex get
    the servers injected, Antigravity and Cursor are agent-managed, runners without MCP are refused
    before the run under `required`. Specs: `specs/mcp-support`.
  - First-class `CodexRunner` (`codex exec --sandbox workspace-write`) and `AntigravityRunner`
    (`agy -p`), their invocations taken from the vendors' headless-mode documentation, replacing
    the placeholder command templates; both remain overridable through `INDABA_CODEX_CMD` and
    `INDABA_ANTIGRAVITY_CMD`.
- GitHub releases publish through npm trusted publishing (OIDC, no stored token or one-time
  password): the release workflow packs the four packages with pnpm and stages the tarballs with
  `npm stage publish`; the maintainer approves each staged version with 2FA, prereleases under `next`.
- Development governance: `workflow.ai.yml` (the *development* workflow, not the format Indaba
  executes), the agent instruction set, skills, rules, hooks and CI.
