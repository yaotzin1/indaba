# Specification: The local web view

> **Status**: Draft, specification only: nothing here is implemented and this change adds no code. This replaces the
> earlier PHP-era draft of this directory; the earlier text is in git history.
> **Stage entry**: 1 (the decisions in section 8 are recommendations the maintainer confirms)
> **Semver impact**: minor (two new packages, one new CLI command, a new local HTTP surface; below 1.0)
> **Builds on**: [`specs/tui`](../tui/spec.md) (the event stream and the run view model, which the page reuses),
> [`specs/workflow-registry`](../workflow-registry/spec.md) (the list of workflows),
> [`specs/single-step-run`](../single-step-run/spec.md) (running one step),
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
  `@indaba/web` imports no `node:` module and is the only package that imports `react` or MUI. `indaba` loads the server
  lazily, so a user who never runs `indaba ui` installs and loads none of it (the `@indaba/tui` pattern).
- [ ] AC-02. `indaba ui` starts the server on `127.0.0.1` on a free port, prints the address with the token in the
  fragment, and opens the browser unless `--no-open`. The server refuses any request without the token, checks the `Host`
  and `Origin` headers against its own address, and ends with the command.
- [ ] AC-03. The server binds only to loopback. A flag to bind elsewhere does not exist in this spec; the hosted
  service is a different product with its own security model.
- [ ] AC-04. The contract between page and server is one versioned HTTP+JSON API plus Server-Sent Events, described in
  `api-surface.md`, with request and response types shared by both packages from one source. A page whose contract
  major is older than the server's refuses to run and says to restart.
- [ ] AC-05. The event stream resumes with `Last-Event-ID` without duplicating or losing events, and an event reaches
  the screen within one second of the engine emitting it (the stream tails the files the engine writes).

**Screens**

- [ ] AC-06. **Workflows** is the home screen: a table with sorting, filtering, selection and pagination, built on
  `apsw-gridwright-mui` (section 8 C-02). Columns: name, project, last result, last cost, last run, state, health. A row
  opens the workflow. Actions: new, edit, copy for another project, import (add a folder to the scan roots), remove from
  the list (never deletes the file).
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
  animation. **Run this step** follows `specs/single-step-run`.
- [ ] AC-11. A **chat** panel sends a message to the step's agent when its runner supports it, shows the agent's
  questions with their answer boxes, and records who answered (`specs/agent-conversation`, `specs/ruling-channel`).
  A runner that cannot take a message shows the panel as unavailable, with the reason.
- [ ] AC-12. A change list (what a workspace changed) is shown before it is applied, with the apply, keep and discard
  choices of `specs/workspace-without-git`, and the same plain wording.
- [ ] AC-13. Every action that changes anything (run, stop, apply, discard, answer, remove, import, delete) is an
  explicit user action; a destructive one names what will happen and asks. Nothing starts a run on page load.

**Health**

- [ ] AC-14. The server computes a health report from the registry, the runner registry, the sandbox doctor
  (`specs/agent-sandbox`) and the environment, and the page shows it on the home screen and per workflow.
- [ ] AC-15. The report names, per item: what (a runner, an agent, a key, a server, an engine, a folder), the state
  (`ok`, `warning`, `missing`, `unreachable`, `denied`), why in plain words, and the one next action. For a key it says
  whether the variable is set and never anything about its value. It checks only what the workflow needs, with a
  timeout of its own and no more than one probe per target per minute.

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
| two pages are open | both read the same files; an action in one appears in the other |

## 6. Security and data handling

The server is an authenticated way to start programs that change files, so it is treated as one. It listens on loopback
only, requires a token in a header (not a cookie, so no cross-site request can carry it), checks `Host` and `Origin`
(against DNS rebinding), and rejects methods it does not serve. The token is random per start and shown only to the
person who started it.

- **Paths are identifiers.** The browser sends a workflow id from the registry, never a path. The server resolves it,
  confines it to a registered root, and refuses symbolic links that leave it. Import accepts a path only from the
  command line or a native folder dialog the person opens, never from the page's own text field without confirmation of
  the resolved folder.
- **Untrusted text.** Agent output, diffs, messages and workflow files are rendered as inert text (AC-16).
- **Secrets.** Redaction happens on the server before serialisation; the page never receives environment values or
  tokens. The health report states presence only.
- **Cross-origin.** No CORS header is sent; the page is served by the same origin as the API.
- **Dependencies.** React, MUI, `apsw-gridwright-mui` (and its dependency), a graph library and a layout library are
  runtime dependencies of `@indaba/web` only, each recorded, MIT-compatible with its tree checked, locked, with no
  install scripts. `@indaba/server` adds none (`node:http`).

## 7. Where it lives

- `@indaba/core`: the registry contract (`specs/workflow-registry`); nothing else new for this spec.
- `@indaba/engine`: the run view model and the event stream (existing, from `specs/tui`), reused unchanged.
- `@indaba/server` (new): the local API, the event stream over files, the health report, static serving, the token and
  header checks. Depends on `engine` and `core`; imports no UI package.
- `@indaba/web` (new): the React application. Depends on nothing at run time but the contract types.
- `indaba` (the CLI): `indaba ui`, loading `@indaba/server` lazily.
- Contract: the HTTP+JSON+SSE API of `api-surface.md`. The terminal dashboard and the page are two clients of the
  engine's files; neither calls the other.

`DEPENDENCY_MAP.md` gets the two packages and their edges in the change that implements them.

## 8. Clarifications

All recommendations; the maintainer confirms.

- **C-01. Stack.** React and TypeScript with Vite; MUI for components and theme; `apsw-gridwright-mui` for the
  workflows table and the task list; `@xyflow/react` (React Flow) with a layout library (`dagre` or `elkjs`) for the
  graph; React Router; TanStack Query for server state. No global store until a need shows up. Each is MIT, which is
  checked together with its dependencies when the dependency is added, under the repository's open-source rule.
- **C-02. The table component is the maintainer's own.** `apsw-gridwright-mui` is published under the maintainer's
  account, MIT, with peers on React, `@mui/material` and `apsw-gridwright`. The page is a first consumer, so a gap in
  the component is fixed in that project rather than worked around here, and the dependency is pinned to an exact
  version in the lockfile. If it cannot meet AC-06 and AC-20 (keyboard and screen reader), the fallback is MUI's
  community data grid, decided at plan time.
- **C-03. Graph.** React Flow gives pan, zoom, selection and a node per step with state classes; the layout library is
  deterministic for a given workflow so the picture does not jump between runs. A loop (debate, review) is a badge and a
  self-edge on the node because adding nodes would make the picture disagree with the file.
- **C-04. One run view model, two clients.** The dashboard's `RunViewModel` (`@indaba/engine`) is the source for both.
  A field the page needs that the dashboard does not (the inspector's attributes with their sources) is added to a
  separate `WorkflowView` type, so the dashboard's model does not grow for the page.
- **C-05. State.** The page's own state is only what a person would expect to survive a reload: the open workflow, a
  filter and the sort. It lives in the URL. The workflow list is the registry (`specs/workflow-registry`); runs are the
  files.
- **C-06. Reading by tailing, not by a database.** The server follows `.indaba/traces/*.jsonl` and
  `<traceId>.board.jsonl` and derives the stream. If that proves too slow with many runs, an index is a performance
  change under the same contract.
- **C-07. Chat scope.** Phase 2 of the roadmap delivers questions and answers; free-form messages to a running agent
  depend on `agent-conversation`. Until a runner declares it can take a message, the panel is shown as unavailable.
- **C-08. Health is advisory.** It never blocks a run by itself; the run's own preflight does. The health view is where
  a person learns about it beforehand.
- **C-09. Delivery in three steps.** (1) Read-only: Workflows, Workflow with the graph and inspector, Run with the live
  graph, health. (2) Actions: Run, Stop, Run this step, answer questions, apply or discard a change. (3) Editing: the
  wizard and editor of `specs/workflow-editor`. Each step is a pull request that leaves the page useful.
- **C-10. Remote and hosted.** Everything in this spec is local. The seams for a hosted service (`WorkflowRegistry`,
  `AuthProvider`, a run API the page does not know is remote) are in `docs/hosted-service.md`; none of them changes
  this spec's acceptance criteria.
- **C-11. Browsers.** The evergreen releases of the last two years.

## Artifacts not written

- `plan.md`: planning waits for the clarifications above and for the specifications it builds on.
- `tasks.md`: nothing to schedule until the plan exists.
- `research.md`: the graph and layout libraries are compared at plan time against a real workflow.
- `data-model.md`: the page keeps no model of its own (C-05); the view types are in `api-surface.md`.
- `events.md`: the page consumes events and emits none; the vocabulary belongs to `specs/observability`.
