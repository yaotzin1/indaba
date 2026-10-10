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
| 5 | The web view | a new `web-app` spec, `specs/workflow-editor` | `indaba ui` serves a page on the local machine, with a token, that mirrors the dashboard's panes from the same files; then the workflow editor and wizard; then what only a page can do |

Later and only if asked for: variants (`specs/step-variants`), the voter arbiter, the debate prompt library, a
desktop app, the asset helper for downloading skills and prompts, and downloading agents (`specs/acp-agent-install`).

## Monday: Phase 0

1. Merge the open pull requests (positioning, the review-specs helper, the workflow-inputs spec) once their checks
   pass, and apply the review findings to the merged specs in one follow-up documentation change.
2. Run a real workflow with `indaba run <file> --tui` on Windows Terminal. Keep a plain list of what felt wrong:
   anything unclear, slow, missing or ugly.
3. Check what the dashboard shows for cost, failure and escalation, and for choosing among runs. These are the first
   fixes; they need no new specification.
4. Turn the list into the checklist for Phase 1.

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
- **Local and safe.** It listens on the local machine only, requires a token, checks the `Host` header, and never
  sends a secret to the page.
- **Designs before code.** Three sketches (Home, Run, Edit) are reviewed before the page is built.

## Decisions waiting for the maintainer

These are open in the specifications and block the phases named.

| Decision | Blocks |
| :--- | :--- |
| Metering as a required obligation of every runner and plugin: the strict form (a major under the repository's rule) or a grace period (a minor) | Phase 3 |
| Keep `max_cost_usd` as well as `max_cost` plus `currency`, or only the second | Phase 3 |
| Whether a run's attempts under variants may name different models | Phase 5 or later |
| Whether the new `Isolation` value `copy` ships as a major in practice | Phase 4 |
| Whether Phase 2's first decider scope is only "questions" | Phase 2 |
