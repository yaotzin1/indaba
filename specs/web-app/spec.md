# Specification: Web application (React)

> **Status**: Draft. **Specification only: nothing in this directory is implemented, and this change
> adds no code.** Implementation starts only after this spec is clarified and accepted.
> **Stage entry**: 1
> **Semver impact**: minor (adds a new public HTTP surface and a new package; below 1.0)
> **Sibling**: [`specs/desktop-app`](../desktop-app/spec.md) is a separate spec. It may embed what this
> one builds, but neither requires the other.

---

## 1. The problem

Indaba is operated from a terminal and observed through a JSONL trace file. That is fine for one
person running one workflow, and poor for everything a multi-agent system needs a human for:

- seeing a run as it happens (which step is running, what each agent is saying, what it costs),
- reading a debate and deciding what to do when it **escalates** (no consensus, retries exhausted),
- reviewing the patch an isolated step produced before it is applied,
- comparing runs (the same pipeline on different models: cost, duration, outcome),
- starting a run without remembering command-line flags.

The founding requirement already names the intent: real-time observability "for real-time frontend
streaming (SSE / Mercure / WebSockets)". The engine emits the events. Nothing consumes them.

## 2. User stories

- **US-01.** As a person running workflows, I see the workflow as a graph (DAG) with each step's live
  state (`PENDING`, `RUNNING`, `VALIDATING`, `FAILED`, `ESCALATED`, `COMPLETED`).
- **US-02.** As a person watching a run, I see each step's output and each agent call (runner, model,
  tokens in/out, latency, USD cost) as it streams, and a running total of cost.
- **US-03.** As a person whose run escalated, I read the consensus transcript (who proposed, critiqued,
  agreed), the open objections, and the guard or command failure that stopped it.
- **US-04.** As a reviewer, I read the patch produced by an isolated step as a diff before deciding.
- **US-05.** As someone tuning a pipeline, I compare two or more runs side by side.
- **US-06.** As a workflow author, I validate a workflow file and see its plan and MCP findings (the
  output of `bin/indaba plan`) without a terminal.
- **US-07.** As a person with a screen reader or only a keyboard, I can do all of the above.

## 3. Acceptance criteria

Checkable statements; each becomes at least one test when implementation is scheduled.

- [ ] AC-01 The app is a single-page React + TypeScript application in its own package (`web/`) built
      with Vite. It never imports PHP code and shares nothing with `src/` but the HTTP contract.
- [ ] AC-02 The only integration surface is the **run API** (section 7): JSON over HTTP plus
      Server-Sent Events. Request and response types are generated from one OpenAPI document, so the
      contract is checked in CI rather than agreed by convention.
- [ ] AC-03 Live view: a span or step event reaches the screen within one second of being emitted,
      and the stream reconnects with resume (`Last-Event-ID`) without duplicating or losing events.
- [ ] AC-04 Agent and command output is rendered as **text**, never as HTML or markup. No
      `dangerouslySetInnerHTML`, `innerHTML` or equivalent anywhere (the same ban the PHP side holds).
- [ ] AC-05 Secrets never appear: the API redacts before sending, and the UI shows only what it was
      given. MCP server definitions (commands, URLs, env) are never displayed, only their names.
- [ ] AC-06 The server binds to `127.0.0.1` by default and requires a bearer token; binding to any other
      address without a token is refused at start-up. CORS allows only the configured origin.
- [ ] AC-07 Every action that changes anything (start, cancel, approve, reject) is an explicit user
      action with a confirmation that names what will happen; there are no automatic mutations.
- [ ] AC-08 Keyboard-only operation and a labelled landmark structure; sort/state is announced to
      assistive technology; contrast meets WCAG 2.2 AA; works at 320 px width.
- [ ] AC-09 No invented numbers: a cost that cannot be computed (model missing from the pricing table)
      is shown as "unknown", never `$0.00`; a total that includes an unknown is marked partial.
- [ ] AC-10 Strings are in a message catalogue from the first commit so the UI can be translated.
- [ ] AC-11 A production build runs with no network access to third parties (no CDN fonts, scripts or
      analytics) and has no telemetry of its own.

## 4. Non-goals

- **No new engine behaviour.** The app displays and triggers what the engine already does. Anything it
  seems to need from the engine (pause, resume, parallel steps) is a separate spec for the engine.
- **No workflow editor in v1.** It shows, validates and runs workflow files; authoring stays in an
  editor. A visual builder is attractive and a large product of its own.
- **No multi-user hosting, accounts, roles or tenancy.** v1 is one person, one machine (or one trusted
  network). Hosted multi-tenant operation needs an authorisation model this spec does not attempt.
- **No agent chat.** The app does not let a person talk to a running agent; Indaba's value is that
  agents run unattended inside guard rails.
- **No server-side rendering, no Next.js.** A static bundle served by the run API keeps one deployable.
- Not a replacement for the CLI, which remains the scripting and CI interface.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the event stream drops | the UI shows "reconnecting", resumes from the last event id, and never shows a stale run as live |
| the API is unreachable | a clear offline state with the address it tried; no spinner that never ends |
| the token is missing or wrong | a sign-in prompt; nothing is cached or displayed from earlier sessions |
| a run is cancelled from the UI | the engine tears its worktree down (existing behaviour); the UI shows `cancelled` only after the engine confirms |
| a very long output | virtualised and truncated with a visible "n bytes hidden, download the full log" |
| an event the UI does not know | shown generically and logged to the console; never a crash |
| the API reports a newer contract version | a blocking "update the app" message, not partial rendering |

## 6. Security and data handling

Everything an agent writes is untrusted text, including the diff and the transcript: it is displayed
as inert text with no auto-linking of executable schemes. The API is a remote-code-execution surface
by nature (it starts agents that edit files), so it is authenticated, local by default and has a
strict origin policy; CSRF is handled by requiring the bearer token in a header rather than a cookie.
A run can only be started from a workflow file inside a configured project root (no arbitrary paths).
Logs and exports pass through the same redaction as traces. The static bundle carries a
Content-Security-Policy that forbids inline script and third-party origins. Dependency policy for the
Node workspace follows `security_guard`: lockfile, no install scripts, audited in CI.

## 7. Where it lives

Three parts, only the first being this spec's deliverable:

1. **`web/`**: the React application (this spec).
2. **The run API** (PHP): a small HTTP service in the Console layer, `bin/indaba serve`, exposing
   workflows, runs, spans, artifacts and an event stream. It is **a prerequisite and its own spec**
   (`specs/run-api`, not yet written): both this app and the desktop app need it, and it must not be
   specified twice. It must not run under php-fpm (an SSE stream needs a long-lived connection and
   fpm workers are not for that), so it needs a long-running PHP runtime (the options are RoadRunner,
   FrankenPHP worker mode, Amp or ReactPHP; the choice belongs to that spec).
3. **The engine**, unchanged, run as a child process per workflow (`bin/indaba run`), which writes the
   JSONL trace the API tails. Keeping runs out of the server process means a crashed server does not
   kill a run and a long run cannot starve the server.

The web app depends on (2) through the contract only.

## 8. Clarifications

Open questions to resolve at stage 2 before planning. A recommendation is given where one exists.

1. **Framework details.** React 19 + TypeScript + Vite; routing with React Router; server state with
   TanStack Query; no global store until a need shows up. *(Recommended; confirm.)*
2. **Graph and timeline rendering.** DAG with a layout library (for example `@xyflow/react` +
   `dagre`/`elkjs`), span waterfall drawn in SVG. The licence of each candidate must be MIT-compatible.
3. **Diff viewer.** Build on a small MIT library versus write one: decide after a spike on very large
   patches.
4. **Do approvals exist?** US-03 implies a human can approve or reject an escalated step. The engine
   has no such state today (ESCALATED is terminal). Either the UI is read-only in v1 (recommended) or
   the engine spec adds "resume after escalation". This is the single biggest scope question.
5. **Where runs live.** The API lists runs by scanning `.indaba/traces/*.jsonl`; whether it needs an
   index (SQLite) is a question for `specs/run-api`.
6. **Repository layout.** `web/` in this repository (one place for the contract and its consumer,
   recommended) versus a separate repository. This repository is PHP-only today; adding a Node
   workspace needs the governance scripts, CI and `security_guard` extended in the same change.
7. **Minimum browsers.** Evergreen browsers from the last two years; no IE or legacy Edge.

## Artifacts not written

- `plan.md`: planning waits for the clarifications above and for `specs/run-api`.
- `tasks.md`: nothing to schedule until the spec is accepted.
- `research.md`: the candidate libraries (graph, diff) are named in section 8 and compared at plan time.
- `data-model.md`: the view models derive from the run API's schema, which is not yet specified.
- `events.md`: the app consumes events and emits none; the event vocabulary is `specs/observability`'s.
