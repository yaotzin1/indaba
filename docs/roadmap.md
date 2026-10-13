# Roadmap

The order in which to build the parts of Indaba, written on 2026-10-11 to start work on 2026-10-12. It is a plan, not
a promise: the order is the part that matters, and a phase may change after we use what the one before it built. What
Indaba is for, and which parts exist today, is in [positioning.md](positioning.md).

## How the order was chosen

1. **A terminal dashboard people can use comes first.** The web view later shows what the dashboard already shows.
2. **Each phase gives the next one something to show.** The dashboard cannot show a debate before the debate is
   recorded, and cannot be a conversation before there is something to answer.
3. **Nothing is built before it has been used.** Each phase ends with a real task run through Indaba with the
   dashboard open, and a short list of what was wrong. That list decides the next fix.
4. **Every feature still follows the repository's own process**: a specification in `specs/`, then the plan,
   tasks, tests first, `pnpm qa`, and a pull request.

## The phases

| Phase | Goal | Built from | Done when |
| :--- | :--- | :--- | :--- |
| 0 | A dashboard you can use today | `specs/tui` (already built), small fixes | A real run, started with `indaba run --tui` on Windows Terminal, can be followed to its end. The header shows tokens and cost (a figure that is unknown is shown as unknown, never as zero). A failed or escalated step says why. With several runs, you can choose one. Every item on the friction list is fixed or written down |
| 1 | See the debate | `specs/run-blackboard` | A debate run writes `<traceId>.board.jsonl`; the dashboard has a board pane with filters and a detail view; `watch --plain` prints a board section; a retried step never sees its failed attempt's posts |
| 2 | Talk and answer | smallest slice of `specs/agent-conversation` and `specs/ruling-channel` | A `BOARD question:` line from a step shows up in the dashboard; you answer, or a decider you named answers, and the step continues; the answer records who gave it; with nothing configured the question goes to the person (a test pins it) |
| 3 | Safe to leave running | `specs/step-budgets`, `specs/step-verdicts` | A cap stops a step and asks whether to resume; costs show in their own currency and a chosen one; a review loop stops after its limit and ends `escalated` |
| 4 | Not only code | `specs/workspace-without-git`, `specs/workflow-inputs` | A workflow runs on a folder that is not a git repository with `isolation: copy`; the result is applied only after you see the change list; `--input` and the prompt for missing inputs work |
| 5 | Safe on the machine | `specs/agent-sandbox` | `sandbox: container` runs a step in a container that Indaba set up itself (image, agent, cleanup); a step never falls back to the host; `indaba sandbox doctor` says what to do when it cannot; tried on the maintainer's Windows machine |
| 6 | The web view | `specs/web-app`, `specs/workflow-registry`, `specs/single-step-run`, then `specs/workflow-editor` | `indaba ui` serves a page on the local machine, with a token: first read-only (workflow list, graph, inspector, live run, health), then actions (run, stop, one step, answers), then the editor and wizard |

Later and only if asked for: variants (`specs/step-variants`), the voter arbiter, the debate prompt library, the asset helper for downloading skills and prompts, and downloading agents (`specs/acp-agent-install`).

## Implementation plan: phases 5 and 6

Each line is one pull request (feature track: spec accepted, plan, tasks, tests first, `pnpm qa`, review). The order
inside a phase is the order of dependencies; a line does not start before the one above it is merged. Sizes are guesses
and are replaced by what the first pull request actually took.

**Phase 5, safe on the machine** (`specs/agent-sandbox`)

1. Core contracts: `SandboxSpec`, `SandboxBackend`, `PreparedLaunch`, `SandboxPolicy`, `registerSandbox`, the optional
   `Runner.execution` and `RunRequest.sandbox`. Pure, with tests and the layers test. No behaviour yet.
2. Workflow field and policy: parse and validate `sandbox`, resolve per step, fail closed when no backend is registered.
   Fake backend in tests proves a sandboxed step never reaches the host spawner.
3. Runners call `prepare`: the process runners wrap their launch; `ShellRunner` and the ACP runner first. A runner without
   `supportsSandbox` is refused.
4. Container backend: Docker and Podman through argument vectors, naming, labels, limits, kill by name, cleanup and sweep.
   Tested against a fake engine; one test that needs a real engine is skipped when none exists and says so.
5. Image builder and agent install: the generated definition, digest pinning, the cache, agent installation under the
   `acp-agent-install` consent rules.
6. `indaba sandbox doctor | setup | clean`, then network `agent_api` with the egress proxy (its own pull request).
7. Exit test on the maintainer's Windows machine: a real step in a container, a cancel, a crash and a sweep. Write down
   the measured start-up and image cost; documentation quotes only that.

**Phase 6, the web view** (`specs/workflow-registry`, `specs/single-step-run`, `specs/web-app`, `specs/workflow-editor`)

1. `WorkflowRegistry` contract and `FileWorkflowRegistry` with `indaba workflows list | scan | add | remove | copy`.
   Usable from the terminal before any page exists.
2. Single-step run: `StepState.Skipped`, `RunOptions.only`, the input resolution and `--plan`, then the CLI options.
3. `@indaba/server`: token, header checks, `GET` endpoints for workflows, runs, board and health, the event stream over the
   trace files. No page yet; tested over HTTP.
4. `@indaba/web` read-only: three sketches reviewed first, then the workflows table (`apsw-gridwright-mui`), the graph
   and inspector, and the live run view. `indaba ui`.
5. Actions: run, stop, resume, run one step, answers and messages, apply or discard a change list.
6. Editing: the wizard and editor of `specs/workflow-editor`, and copy for another project.

Not scheduled until asked for: sign-in, a hosted service ([hosted-service.md](hosted-service.md)), and a VM sandbox
backend (a plugin).

## Monday: Phase 0

1. Apply the review findings to the merged specs (`run-blackboard` in #42, `workspace-without-git` in #44).
2. Run a real workflow with `indaba run <file> --tui` on Windows Terminal. Keep a plain list of what felt wrong:
   anything unclear, slow, missing or ugly.
3. Check what the dashboard shows for cost, failure and escalation, and for choosing among runs. These are the first
   fixes; they need no new specification.
4. Turn the list into the checklist for Phase 1.

## Friction list from the first runs (2026-10-12)

Three real runs with `indaba run <file> --tui` on Windows Terminal: the demo workflow, a four-step build check of a
sibling project, and a two-step run with one real model call (the `claude-code` runner) and one step that fails on
purpose. The exit points of Phase 0 passed except "choose among several runs", which was not tried. This list is the
checklist for the next phase; a fix is its own small pull request.

| # | What was seen | Kind | Status |
| :--- | :--- | :--- | :--- |
| 1 | **A secret in a command or its error output reaches the trace.** With `OPENROUTER_API_KEY` set, a failing shell step whose command line or stderr contains that value is redacted on screen but stored in plain text in `<traceId>.jsonl` and `<traceId>.events.jsonl` (the span's `status_message`, the `indaba.label` attribute, the state-change reason) and printed unredacted in the plain `run` output's status line. The rule is that secrets are in no trace, event or exception. Reproduced with a built CLI; the existing secrets test does not put the value in the command or its output | **Fix first** (security) | Done (#35) |
| 2 | A run with no model call shows `cost none`; it should say "no model calls", and "unknown" only when a call was made and could not be priced | Fix | PR #36 |
| 3 | `runners: shell ok 0s -> shell ok 2s` on a step with two commands reads like a fallback chain; it lists the commands | Fix | PR #37 |
| 4 | Long agent output lines are cut with `…` in the output pane instead of wrapped or openable | Fix | PR #39 |
| 5 | The runner line (`claude-code ok 27s`) says nothing about tokens or cost; when unknown it should say so | Fix | PR #37 |
| 6 | An agent's own retries are not visible in the dashboard | Idea | Open |
| 7 | A failure reason repeats the stderr text as `reason:` and again under `output` | Fix (small) | PR #38 |
| 8 | A step with no output shows an empty pane with no "no output" or exit code | Fix (small) | PR #38 |
| 9 | `indaba` is not a command in a clone; the documentation should say `pnpm build` then `pnpm indaba ...` | Docs | PR #41 |
| 10 | `install-hooks` leaves the two hook files staged with an executable-bit change on Windows | Fix (small) | PR #40 |
| 11 | Not tried: choosing one run among several (`indaba watch`) | Check | Checked: `latest`, a whole id and a prefix that fits one run work, a prefix that fits several lists them, and a name that is not hexadecimal is refused |
| 12 | `indaba watch` lists runs by id, status and time only, so with several runs there is no telling which is which without opening each. The workflow name belongs in the list. It is an additive field on `RunSummary`, so a minor change and a specification first | Feature | Open |

## How we work

- One real task per phase, run through Indaba, with notes. The review-specs helper is the first such task: it
  reviews our own specifications, and its first results (six findings each on `run-blackboard` and
  `workspace-without-git`) are waiting to be checked and applied.
- Keep the change small, the gates green, and the specification honest about what is built.
- Prefer showing to two or three real people over adding another specification.

## The web view: what it must be

- **The same data as the dashboard.** The page reads the files a run writes. It is a second view, not a second
  engine, and nothing in the file formats is dashboard-shaped.
- **Three screens.** Home: your runs, templates to start from, and what needs you. Run: the live steps, a "needs you"
  list, the board and the conversation, and cost. Edit: the wizard and workflow editor.
- **Plain words first.** The default view says what is happening, what needs you, what it costs and the result. The
  technical view (steps, spans, kinds of board entry) is one click away.
- **For everyone.** Complete with the keyboard, not dependent on colour, usable on a phone for the questions that need
  an answer, and text from agents is shown as text and never as markup.
- **Local, with a hosted version as a separate idea.** There is no desktop application; a hosted service is described in
  [hosted-service.md](hosted-service.md) and is not planned. It listens on the local machine only, requires a token, checks the `Host` header, and never
  sends a secret to the page.
- **Designs before code.** Three sketches (Home, Run, Edit) are reviewed before the page is built.

## Decisions waiting for the maintainer

These are open in the specifications and block the phases named.

| Decision | Blocks |
| :--- | :--- |
| Metering as a required obligation of every runner and plugin: the strict form (a major under the repository's rule) or a grace period (a minor) | Phase 3 |
| Keep `max_cost_usd` as well as `max_cost` plus `currency`, or only the second | Phase 3 |
| Whether a run's attempts under variants may name different models | Phase 6 or later |
| Whether the new `Isolation` value `copy` ships as a major in practice | Phase 4 |
| Whether `StepState.SKIPPED` ships as a major in practice (single-step runs) | Phase 6 |
| Docker and Podman as the first sandbox engines; the first `vm` backend as a plugin, later | Phase 5 |
| Whether to host at all, or to offer a self-hosted package | the hosted-service note |
| Whether Phase 2's first decider scope is only "questions" | Phase 2 |
