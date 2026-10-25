# Specification: The local web view

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code. This replaces the
> earlier PHP-era draft of this directory; the earlier text is in git history.
> **Stage entry**: 1 (the decisions in section 8 are recommendations the maintainer confirms)
> **Semver impact**: minor (two new packages, one new CLI command, a new local HTTP surface; below 1.0)
> **Builds on**: [`specs/tui`](../tui/spec.md) (the event stream and the run view model, which the page reuses),
> [`specs/workflow-registry`](../workflow-registry/spec.md) (the list of workflows),
> [`specs/single-step-run`](../single-step-run/spec.md) (running one step),
> [`specs/workflow-inputs`](../workflow-inputs/spec.md) (the values a workflow asks for before it runs),
> [`specs/agent-sandbox`](../agent-sandbox/spec.md) (isolation and its health),
> [`specs/run-blackboard`](../run-blackboard/spec.md) and [`specs/ruling-channel`](../ruling-channel/spec.md) (the board
> and the questions the page shows).
> **Decided by the maintainer**: the terminal dashboard and the web view both exist, and there is no desktop
> application; the web view starts local, and a hosted version is a separate, later product
> ([`docs/hosted-service.md`](../../docs/hosted-service.md)).

---

## 1. The problem

Indaba is operated from a terminal. The dashboard (`specs/tui`) shows one run well, and it cannot show what a
terminal is bad at: a list of all your workflows with their last results, a workflow drawn as the graph it is, every
attribute of a step one click away, a budget next to what was spent, a place to answer a question from an agent, and
a button for people who do not want to type `indaba run`. The people this project is for (`docs/positioning.md`) are
not all developers, and some will never open a terminal.

Everything the page needs is already written to files by a run, or will be by the specifications it builds on. The
page is a second view of those files and a front for the commands that start, stop and answer. It is not a second
engine.

## 2. User stories

- **US-01.** As a person, I open `indaba ui` and see my workflows in a table: name, project, last result, last cost,
  last run, and anything that needs me.
- **US-02.** As a person, I open a workflow and see it as a graph. I click a step and read every attribute it has:
  runner and fallbacks, role, prompt, guards, permissions, retries, budget, isolation, sandbox, inputs, outputs.
- **US-03.** As a person, I press **Run** and watch the graph animate as steps start, validate, fail, escalate and
  complete, with their output, the board and the cost so far.
- **US-04.** As a person, I run a single step (for example only the review step) against the results of an earlier
  run, or against the current state of the folder.
- **US-05.** As a person, I see the budget set and what was spent, in the currency the workflow uses, and "unknown"
  when a cost cannot be computed.
- **US-06.** As a person, I see which workspace mode a workflow uses (git worktree, copy, none) and which sandbox
  (host, container, VM), and what the run changed before it is applied.
- **US-07.** As a person, I send a message to an agent and answer the questions it asks, with the answer recorded as
  mine (`specs/ruling-channel`).
- **US-08.** As a person, I am told what is wrong with my setup before a run fails: a missing agent, a missing API
  key, an unreachable server, a container engine that is not running. Each item says what to do.
- **US-09.** As a person, I create a workflow with a wizard, edit one, or copy one for another project and change what
  differs (`specs/workflow-editor`).
- **US-10.** As a person using a keyboard or a screen reader, I can do all of this.
- **US-11.** As a developer, the page and the terminal dashboard show the same run the same way, because they read
  the same files through the same view model.

## 3. Acceptance criteria

**Packages and transport**

- [ ] AC-01. Two new packages: `@indaba/server` (Node, no framework; the local API, event stream and static file
  serving) and `@indaba/web` (React and TypeScript, built with Vite into static files that `@indaba/server` serves).
  `@indaba/web` imports no `node:` module and is the only package that imports `react` or MUI; it imports from
  `@indaba/core` types only (`import type`), and a layers test enforces both. `@indaba/server` imports no UI package and
  receives the static bundle's folder as an option (`staticDir`). `indaba` loads the server lazily, so a user who never
  runs `indaba ui` installs and loads none of it (the `@indaba/tui` pattern).
- [ ] AC-02. `indaba ui` starts the server on `127.0.0.1` on a free port, prints the address with the token in the
  fragment, and opens the browser unless `--no-open`. Every API request needs the token in an `Authorization` header and
  the server refuses it without; the static files of the page are the one thing served without it, because a browser
  navigation cannot send a header, and they carry the `Host` check and the Content-Security-Policy of AC-16. The page
  reads the token from the fragment, removes the fragment from the address, and keeps the token in memory only. The server
  checks the `Host` and `Origin` headers (section 6) and ends with the command. Runs it started are stopped through the
  engine's teardown when it ends, and the page says so before the first Run (C-12).
- [ ] AC-03. The server binds only to loopback. A flag to bind elsewhere does not exist in this spec; the hosted
  service is a different product with its own security model.
- [ ] AC-04. The contract between page and server is one versioned HTTP+JSON API plus Server-Sent Events, described in
  `api-surface.md`, with request and response types shared by both packages from one source. A page whose contract
  major is older than the server's refuses to run and says to restart. The shared types are declarations in
  `@indaba/core`, with no runtime code (section 7).
- [ ] AC-05. The event stream resumes with `Last-Event-ID` without duplicating or losing events, and an event reaches
  the screen within one second of the engine emitting it (the stream tails the files the engine writes). The page reads
  it with `fetch` and the `Authorization` header, because the browser's `EventSource` cannot send one. A second stream,
  for the whole server, announces a new or finished run and a change to the registry, so a second open page learns of
  them without polling.

**Screens**

- [ ] AC-06. **Workflows** is the home screen: a table with sorting, filtering, selection and pagination, built on
  `apsw-gridwright-mui` (section 8 C-02). Columns: name, project, last result, last cost, last run, state, health. A row
  opens the workflow. Actions: new, edit, copy for another project, import (add a folder to the scan roots), remove from
  the list (never deletes the file). Import and new need no path typed into the page (section 6).
  *Delivered in slices: the table, annotate, copy, import and remove are `specs/web-app-registry` (import takes one typed path that
  the server resolves and shows back, as section 6 allows); New waits for the wizard (`workflow-editor` step 3d); the health column
  waits for AC-14 and AC-15.*
- [ ] AC-07. **Workflow** shows the graph (nodes are steps, edges are `depends_on`), laid out left to right. A node
  shows the step name, the runner, and its state colour **and** a text label (never colour alone). Selecting a node opens
  the inspector. Debate and review loops are drawn as a loop on the node, not as extra nodes.
- [ ] AC-08. The inspector lists every attribute the parser knows for the selected step, each with its source (this step,
  the workflow default, or the built-in default), and shows resolved values for runner chain, budget, workspace and
  sandbox. It is read-only when a run is active.
- [ ] AC-09. The side panel shows: actions (Run, Run this step, Stop, Resume after a stop), budget and spent, workspace
  mode, sandbox mode, the task list (steps with state and duration), and the health list of AC-15.
- [ ] AC-10. **Run** starts the whole workflow. While it runs, the graph animates state changes, the active node is
  marked, the edges of completed steps are marked, and a user who prefers reduced motion gets the same information without
  animation. **Run this step** follows `specs/single-step-run`. When the workflow declares inputs, Run first asks for
  them in a form, validated as `specs/workflow-inputs` says, and starts nothing until they are given.
- [ ] AC-11. A **chat** panel sends a message to the step's agent when its runner supports it, shows the agent's
  questions with their answer boxes, and records who answered (`specs/ruling-channel`). Sending a free-form message has
  no specification yet (C-07). A runner that cannot take a message shows the panel as unavailable, with the reason.
- [ ] AC-12. A change list (what a workspace changed) is shown before it is applied, with the apply, keep and discard
  choices of `specs/workspace-without-git`, and the same plain wording.
- [ ] AC-13. Every action that changes anything (run, stop, apply, discard, answer, remove, import) is an
  explicit user action; a destructive one names what will happen and asks. Nothing starts a run on page load.

**Health**

- [ ] AC-14. The server computes a health report from the registry, the runner registry, the sandbox doctor
  (`specs/agent-sandbox`) and the environment, and the page shows it on the home screen and per workflow.
- [ ] AC-15. The report names, per item: what (a runner, an agent, a key, a server, an engine, a folder), the state
  (`ok`, `warning`, `missing`, `unreachable`, `denied`), why in plain words, and the one next action. For a key it says
  whether the variable is set and never anything about its value. It checks only what the workflow needs, with a
  timeout of its own and no more than one probe per target per minute. It probes only hosts the workflow itself
  declares for an MCP server or an API runner, follows no redirect, sends no credential, and writes no URL to a log or to
  the page; the page receives the name of the target and the state (AC-17).

**Safety**

- [ ] AC-16. Everything an agent produced (output, diff, board, messages) is shown as text. No
  `dangerouslySetInnerHTML`, no `innerHTML`, no auto-linking of executable schemes. The production page carries a
  Content-Security-Policy that forbids inline script and third-party origins, and loads no font, script or analytics from
  a network.
- [ ] AC-17. No secret reaches the page: environment values, API keys and tokens are redacted by the server with the same
  rules as traces; MCP server definitions (commands, URLs, environment) are never sent, only their names.
- [ ] AC-18. The server starts a run only from a workflow in the registry, and runs only inside its project root. A path
  from the browser is an identifier to look up, never a file to open (section 6).
- [ ] AC-19. No invented numbers: a cost that cannot be computed is "unknown", and a total that includes an unknown is
  marked partial. A step with no budget shows "no limit", not zero.

**Quality**

- [ ] AC-20. Complete with the keyboard, labelled landmarks, state changes announced, contrast at WCAG 2.2 AA, usable at
  320 px width (the questions and the run view must be usable on a phone). Strings come from a message catalogue.
- [ ] AC-21. Three sketches (Workflows, Workflow with graph, Run) are reviewed by the maintainer before the page is
  built (`docs/roadmap.md`).

**Safety, continued**

- [ ] AC-22. Running a workflow is running code: a step may be a `shell` step, and a saved edit followed by a run
  executes what was written. The first time a workflow that was imported, copied or edited through the page runs, the
  page shows the runners, the permissions and the shell commands it will use and asks for confirmation; the answer is
  kept per workflow and per hash of its content, so a later change asks again (C-12). Every state-changing request carries an
  `Origin` the server accepts (section 6).

## 4. Non-goals

- **No second engine.** The page shows and triggers what the engine does. Anything it seems to need that the engine
  lacks (pause, parallel steps, run one step) is its own engine spec; run one step is `specs/single-step-run`.
- **No accounts, roles or multi-user hosting.** One person on one machine. The hosted service is
  [`docs/hosted-service.md`](../../docs/hosted-service.md) and is not built here.
- **No remote access.** The server does not listen beyond loopback (AC-03).
- **No desktop application.** Decided by the maintainer. A packaged shell around this page is possible later and needs
  no change to it.
- **No server-side rendering and no framework server.** Static files served by `@indaba/server`.
- **No separate state.** The page keeps nothing the files and the registry do not (section 8 C-05).
- **The terminal dashboard stays.** It is not replaced and it does not depend on the server.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the event stream drops | the page shows "reconnecting", resumes from the last event id, and never shows a stale run as live |
| the server stops | the page shows that and the address it tried; no spinner that never ends |
| the token is missing or wrong | a blocking message to start again with `indaba ui`; nothing is cached or shown |
| a run is stopped from the page | the engine tears down as it does today; the page shows `cancelled` only after the engine confirms |
| a workflow file is edited or deleted outside | the registry notices at the next scan (or on request); a deleted file shows as missing, not as an error |
| a workflow file no longer validates | the row shows the validation message; Run is disabled with the reason |
| a very long output | virtualised and truncated with "n bytes hidden, open the full log" |
| an event the page does not know | shown generically; never a crash |
| the contract is newer than the page | a blocking "restart" message, not partial rendering |
| a health probe hangs | that item shows `unreachable` after its own timeout; the page stays responsive |
| two pages are open | both read the same files; an action in one appears in the other, through the server-wide stream of AC-05 |
| `indaba ui` ends while a run is active | the run is stopped through the engine's teardown and recorded as `cancelled`; the next `indaba ui` shows it so (C-12) |
| the confirmation of AC-22 is declined | nothing starts; the workflow stays runnable from the terminal as before |

## 6. Security and data handling

The server is an authenticated way to start programs that change files, so it is treated as one. It listens on loopback
only, requires a token in a header (not a cookie, so no cross-site request can carry it), checks `Host` and `Origin`
(against DNS rebinding), and rejects methods it does not serve. The token is random per start and shown only to the
person who started it. The accepted `Host` values are `localhost`, `127.0.0.1` and `[::1]`, each with the server's own
port; any other value is refused. Every request that changes anything must carry an `Origin` equal to the server's own
address, and one without is refused. The threat to design against is a token that leaks, or a page open in another
tab of the same browser: with the token an attacker can save a workflow and run it, and a run can execute a shell
command (AC-22).

- **Paths are identifiers.** The browser sends a workflow id from the registry, never a path. The server resolves it,
  confines it to a registered root, and refuses symbolic links that leave it. Import accepts a path only from the
  command line (`--root`) or from a path typed into the page that the server resolves and shows back, and that the person
  confirms. There is no native folder dialog: a page cannot hand a path to the server, and a dialog opened by the server
  itself is outside this spec.
- **Untrusted text.** Agent output, diffs, messages and workflow files are rendered as inert text (AC-16).
- **Secrets.** Redaction happens on the server before serialisation; the page never receives environment values or
  tokens. The health report states presence only.
- **Cross-origin.** No CORS header is sent; the page is served by the same origin as the API.
- **Dependencies.** React, MUI, `apsw-gridwright-mui` (and its dependency `apsw-gridwright`), `@xyflow/react`, `dagre`,
  `react-router` and `@tanstack/react-query` are runtime dependencies of `@indaba/web` only, each MIT-compatible with its
  tree checked, locked, with no install scripts. Each is recorded in `project.runtime_dependencies` of `workflow.ai.yml`,
  naming the package that loads it, in the change that adds it. `elkjs` is not a candidate: its licence is
  `EPL-2.0 OR GPL-3.0-or-later`, not MIT. `@indaba/server` adds none (`node:http`).

## 7. Where it lives

- `@indaba/core`: the registry contract (`specs/workflow-registry`), and the contract types the page and the server share,
  as declarations only, with no runtime code and no `node:` import (C-04). Adding them is a minor.
- `@indaba/engine`: the run view model (`RunState` and its parts, from `specs/tui`) and the event stream, reused
  unchanged. Where the page needs the shape of one of them, the declaration moves to core and the engine re-exports it
  (C-04).
- `@indaba/server` (new): the local API, the event stream over files, the health report, static serving, the token and
  header checks. Depends on `engine` and `core`; imports no UI package. It does not register runners or plugins:
  `indaba ui` passes it a function that starts a run (the composition root stays in `indaba`) and the folder of the
  static files (`staticDir`).
- `@indaba/web` (new): the React application. Depends at run time on nothing but the contract types of `@indaba/core`.
- `indaba` (the CLI): `indaba ui`, loading `@indaba/server` lazily, as it loads `@indaba/tui`, so no static import
  exists. Layers tests for `packages/server` and `packages/web` sit beside the existing ones (AC-01).
- Contract: the HTTP+JSON+SSE API of `api-surface.md`. The terminal dashboard and the page are two clients of the
  engine's files; neither calls the other.

`DEPENDENCY_MAP.md` gets the two packages and their edges in the change that implements them.

## 8. Clarifications

All recommendations; the maintainer confirms.

- **C-01. Stack.** React and TypeScript with Vite; MUI for components and theme; `apsw-gridwright-mui` for the
  workflows table and the task list; `@xyflow/react` (React Flow) with `dagre` for the layout of the graph; React
  Router; TanStack Query for server state. No global store until a need shows up. Each is MIT (the registry shows MIT for
  all of them, and for `apsw-gridwright-mui` and `apsw-gridwright` at the top level); the dependency trees are checked
  when each dependency is added, under the repository's open-source rule. `elkjs` was a candidate and is dropped: its
  licence is `EPL-2.0 OR GPL-3.0-or-later`.
  *Amended 2026-10-20 for delivery step 1 (plan, "Decisions taken while building the page"): no MUI, no router or query
  library yet; `@dagrejs/dagre` (the maintained `dagre`); the libraries are bundled, not installed.*
- **C-02. The table component is the maintainer's own.** `apsw-gridwright-mui` is published under the maintainer's
  account, MIT, with peers on React, `@mui/material` and `apsw-gridwright`. The page is a first consumer, so a gap in
  the component is fixed in that project rather than worked around here, and the dependency is pinned to an exact
  version in the lockfile. **Every table of the page is an `apsw-gridwright` grid** (decided by the maintainer on 2026-10-17): the
  Runs table, the steps of a run with their tries as child rows, and later the Workflows table. Sorting, selection and paging are
  the grid's defaults; search, column filters, column layout and density are its add-ons. Its limits (no range selection of
  cells, fixed row height under virtualization) are acceptable here. MUI's community data grid stays only as the fallback if the
  grid cannot meet AC-20 (keyboard and screen reader), decided at plan time.
- **C-03. Graph.** React Flow gives pan, zoom, selection and a node per step with state classes; the layout library is
  deterministic for a given workflow so the picture does not jump between runs. A loop (debate, review) is a badge and a
  self-edge on the node because adding nodes would make the picture disagree with the file.
- **C-04. One run view model, two clients, types in core.** The dashboard's `RunState` (`@indaba/engine`, with
  `StepView`, `AttemptView` and `RunnerView`) is the source for both. A field the page needs that the dashboard does not
  (the inspector's attributes with their sources) is added to a separate `WorkflowView` type, so the dashboard's model
  does not grow for the page. The page may import no `node:` module and the engine has some, so the declarations the page
  shares with the server live in `@indaba/core`, types only (decided by the maintainer on 2026-10-16): `WorkflowView`, its
  `WorkflowStepView` (not `StepView`, which the engine already exports), `HealthReport`, the request and response types of
  the API, and the data shape of `RunState` and its parts. The last move is the one to check at plan time: the
  declarations of `packages/engine/src/trace/view.ts` import the record types of `records.ts` and `RunStatus` of
  `trace-reader.ts`, and every declaration the page needs must be pure data before it moves; the engine then re-exports it,
  so no import path breaks.
- **C-05. State.** The page's own state is only what a person would expect to survive a reload: the open workflow, a
  filter and the sort. It lives in the URL. The workflow list is the registry (`specs/workflow-registry`); runs are the
  files.
- **C-06. Reading by tailing, not by a database.** The server follows `.indaba/traces/*.jsonl` and
  `<traceId>.board.jsonl` and derives the stream. If that proves too slow with many runs, an index is a performance
  change under the same contract.
- **C-07. Chat scope.** Phase 2 of the roadmap delivers questions and answers (`specs/ruling-channel`). Free-form messages
  to a running agent have no specification: an earlier draft named `specs/agent-conversation`, and that directory does
  not exist. Until a spec and a runner capability exist, the panel is shown as unavailable.
- **C-08. Health is advisory.** It never blocks a run by itself; the run's own preflight does. The health view is where
  a person learns about it beforehand.
- **C-09. Delivery in three steps.** (1) Read-only: Workflows, Workflow with the graph and inspector, Run with the live
  graph, health. (2) Actions: Run, Stop, Run this step, answer questions, apply or discard a change. (3) Editing: the
  wizard and editor of `specs/workflow-editor`. Each step is a pull request that leaves the page useful. Step 2 is
  delivered in slices, each with its own spec: the first, Run and Stop, is `specs/web-app-actions` (2026-10-22); Run this
  step, answering questions and applying a change wait for the specs they need.
- **C-10. Remote and hosted.** Everything in this spec is local. The seams for a hosted service (`WorkflowRegistry`,
  `AuthProvider`, a run API the page does not know is remote) are in `docs/hosted-service.md`; none of them changes
  this spec's acceptance criteria.
- **C-11. Browsers.** The evergreen releases of the last two years.
- **C-13. One graph, a view now and an editor later.** The graph of AC-07 is one component with a view mode and an edit mode, so
  designing a workflow by moving bricks from a palette onto the canvas (`specs/workflow-editor`, step 3 of C-09) is the same
  picture, not a second one. In view mode every step can be selected: its panel says what happened (runners, models, tokens,
  cost, tools, permissions, guards, output, tries), and what happens if it fails (retry which step, how many times, then
  escalated or failed). The edit mode writes the workflow file and shows the messages of `indaba validate`. Which editing is
  built is a product decision this spec does not make. React Flow (C-01) supports both modes.
- **C-14. The graph needs the workflow's structure.** A run's trace records, for a step, only its id and attempt number. Which
  step waits for which (`depends_on`) and where a failure leads (`on_failure`) are in the workflow file, not in the trace, and the
  trace names the workflow but not the file. Recommendation: the engine records both when the run starts
  (task T-20), on the run's root span because a step's span exists only once it runs, so a run describes itself, an old run is still readable, and the page and the dashboard agree. A run recorded
  before the change shows its steps in order, with a note that its structure was not recorded.
- **C-15. The discussion of a debate.** The trace holds a debate's outcome and number of rounds. The messages are in
  `.indaba/artifacts/<step>.transcript.md`, which the next run overwrites, so it cannot be tied to one run. The full discussion
  (rounds, who said what, `CRITIQUE` or `AGREEMENT`, the arbiter's ruling) needs either the board of `specs/run-blackboard` or the
  transcript recorded under the run (task T-21). Until then the page shows the summary and says the messages are not available.
  **Decided 2026-10-21 (maintainer, sketch answer 8):** the messages are kept, as one structured JSON file per run and step
  (`<traceId>.<stepId>.json`) written by the engine when the debate ends, redacted and with control sequences dropped. The
  person chooses the folder (`indaba run --discussion-dir <dir>`; default `<project>/.indaba/discussions`), and
  `indaba ui --discussion-dir <dir>` (repeatable) tells the server where else to look. The page shows the summary first and
  the full thread only when asked. A run that kept none (an older run, or a folder the server was not told) says so plainly.
- **C-12. Runs end with `indaba ui`.** The recommendation is that the server is the owner of the runs it starts, so
  ending it cancels them through the engine's teardown, as stopping a run from the page does, and the page tells the
  person before the first Run. The alternative, runs that outlive the server in a process of their own, needs a
  supervisor this spec does not describe. The confirmation of AC-22 is remembered per workflow and per hash of the file's
  content, so an edit asks again; which hash, and where the answer is kept, is decided at plan time (the digest of
  `specs/workflow-inputs` covers resolved inputs, not the file). Both choices are for the maintainer to confirm.

- **C-16. Rules per step, shown and editable (maintainer, 2026-10-17).** A person can say, for a step, what the agent may read,
  what it may change (nothing, by default) and whether it may run commands, as `permissions` in the workflow file defines them
  (`docs/workflow-format.md`). The page shows the rule on the graph (a badge such as `read-only` or `writes src/**`), in the step's
  panel (with how many requests were refused), and in the editor (presets: read-only, edit only these folders, full access).
  A sentence in a goal ("do not edit files") is a request, not a rule, and the page never presents it as one. The rule is
  enforced where the runner allows (over ACP as the agent asks; for every runner by the `diff_within_scope` guard after the
  step) and the page says which of the two applies.
- **C-17. Where a prompt goes (maintainer, 2026-10-17).** A step's instruction is its `goal`, edited in the step's settings. A
  value that changes from run to run, such as the spec to execute or review, is an input (`specs/workflow-inputs`) that the
  page asks for before Run (AC-10). "Execute a spec" and "Review a spec" are workflows (a code step, a verify step, a debate)
  that take the spec as an input; a quick start that fills one in from a template is a later option for people who do not
  write workflow files.
- **C-18. Skills (maintainer, 2026-10-17; not decided, needs its own spec).** A person can bring a skill, a reusable pack of
  instructions for an agent, from a source they choose, read it, edit it in the editor, and use it in a step. Open: what a skill
  is for Indaba (the `SKILL.md` format agents already use, or a smaller one), where they come from (a folder, a repository
  address, a shared catalogue), and whether a skill may carry rules. Constraints that hold whatever is chosen: downloaded text is
  untrusted data and can steer an agent, so it is shown in full and accepted by the person before first use, pinned by a hash
  so a change asks again, never run on download, and never able to widen a step's permissions (C-16 stays in the workflow);
  its licence is shown, and what Indaba itself depends on stays open source and MIT-compatible. The download model of
  `specs/acp-agent-install` (consent, checksum, per-user store, no silent install) is the one to reuse.
- **C-19. An assistant in the editor, over ACP, by choice (maintainer, 2026-10-17; not decided, needs its own spec).** While
  editing a workflow, a skill or a spec, a person may open an assistant panel and talk to an AI agent they already have, through
  ACP, the way Indaba drives agents today (the presets for claude, codex, gemini and opencode, or a command of their own). It is
  an option: off by default, and the person chooses the agent or none. The assistant only proposes: it can write to the draft and
  nothing else, runs no command, and the person sees the difference and accepts or discards it; saving and running stay the
  person's actions (AC-13, AC-22). It needs the conversation capability that C-07 says has no specification yet, so it comes
  after `specs/ruling-channel` and a spec for talking to an agent.

## Artifacts not written

- `research.md`: the graph and layout libraries are compared at plan time against a real workflow.
- `data-model.md`: the page keeps no model of its own (C-05); the view types are in `api-surface.md`.
- `events.md`: the page consumes events and emits none; the vocabulary belongs to `specs/observability`.
