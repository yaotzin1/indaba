# Sketches: the local web view, delivery step 1

The six sketches AC-21 asks the maintainer to review before the page is built (task T-09 of `../tasks.md`). The first three are
delivery step 1; the fourth shows what is possible with the data a run has today and with more; the fifth and sixth are later views (the editor, and the Workflows
screen that opens it), shown now so the graph is built once and the navigation is honest. They are
wireframes: structure, wording and state, not final style. Open the `.html` files in a browser; they use no script and no
network, follow the system light or dark setting, and are filled with **sample data**, not a real run.

| File | Shows |
| :--- | :--- |
| [`01-runs.html`](01-runs.html) | The Runs screen: the runs on this machine, newest first, with state, start time and cost |
| [`02-run.html`](02-run.html) | One run: the graph of its steps, the step list, the cost, the attempts of a retried step, the output of the selected step |
| [`04-discussion.html`](04-discussion.html) | The discussion of a debate step: today's summary from the trace, and the full thread (rounds, who said what, agreement, the arbiter's ruling) that needs more data |
| [`05-editor-later.html`](05-editor-later.html) | Not step 1: the same graph as an editor, with a palette of bricks, a canvas and a settings panel |
| [`06-workflows.html`](06-workflows.html) | Not step 1: the Workflows screen (a grid of workflows with last result, cost, health and the actions of AC-06) that opens the graph and the editor |
| [`03-states.html`](03-states.html) | Empty and failure states: no runs, server stopped, token missing, stream dropped, half-written file, unknown event, long output, newer server, run not found, unknown cost, a phone at 320 px |

`sketch.css` is shared by all six. Nothing here is shipped: the page itself is `@indaba/web` (T-07, T-08).

## The look

The sketches carry the intended look, not only the structure, in a light and a dark theme. They follow the system setting
unless **Light** or **Dark** is picked in the header (three radio buttons and CSS `:has()`, so still no script; the choice
does not carry to the next sketch, the real page keeps it).

- **Accent: deep ochre** from the logo (`docs/assets/indaba-mark.svg`), `#8f4f12` on light and `#eab36a` on dark. It marks
  the current page, focus, links, the primary button and the sketch notes, and is never a state.
- **States** are a symbol and a word first; colour repeats them: completed green, running blue, failed red, pending grey,
  and escalated **violet** (handed to a person), so it is not mistaken for the accent. Every text and state pair meets
  WCAG 2.2 AA (5.1:1 or more) in both themes.
- **Type: Atkinson Hyperlegible Next** for the interface and **Atkinson Hyperlegible Mono** for output and code (SIL
  Open Font License), chosen for legibility (AC-20). `@indaba/web` bundles them; the sketches use them when installed and
  fall back to the system's own sans otherwise.
- **The graph sits on a dotted canvas**, the one decorative element; panels are flat, with no shadows, and the radius
  falls with rank (region 12 px, item 8 px, chip 5 px).
- Notes about a sketch have an ochre rule in the margin, so they are never read as part of the product.

## What the sketches commit to

- A state is a word and a symbol; colour and the border style repeat it, never replace it (AC-07, AC-20).
- Cost: `unknown`, `at least $x (partial)`, `$0.00 (no model calls)`, and `no limit` for a step without a budget (AC-19).
- The page reads and shows; it has no Run, Stop, edit or delete (those arrive with later delivery steps).
- Every step can be selected, in the graph or in the list. Its panel says what happened and what happens if it fails: which step
  runs again, how many times, and whether the run then ends as escalated or failed (as `docs/workflow-format.md` defines them).
- Tables are `apsw-gridwright` grids (sorting, selection and paging by default; search, column filters, column layout and
  density as add-ons). The steps of a run are rows, and a retried step opens to show its tries.
- **No dead links.** Every sketch carries the same header, Runs and Workflows, and each leads somewhere. In delivery step 1 the real
  page shows **only Runs**: a Workflows item appears with the registry (`specs/workflow-registry`), not before.
- One graph component, a view mode now and an edit mode later (sketch 5), so the editor is not a second picture.
- A message that blocks replaces the screen; it never shows part of it, and it says the one thing to do.
- Text from a run is shown as plain text; the server has already dropped escape sequences and links (AC-16).

## Questions for the maintainer

1. **Cost on the Runs screen.** `RunSummary` has no cost, so the column of sketch 1 needs one. Computing it means reading
   every run's file for each list request (the list already reads every run for its state). Add `cost` to `RunSummary`, or
   drop the column in this step and show cost only on the Run screen?
2. **What happens to runs when the server stops.** In this read-only step the server starts no run, so sketch 3 says "Runs you
   started in a terminal are not affected". When step 2 lets the page start runs, C-12 of the spec (ending `indaba ui` cancels
   the runs it started) decides what that message says. Fine to leave it until then?
3. **Last known.** When the stream drops, sketch 3 turns the state chips grey and labels them `last known`. The spec says only
   "never shows a stale run as live". Is the label what you want, or just the banner?
4. **Selecting a step.** Sketch 2 selects with Tab and the arrow keys, Enter shows the output, and the step list on the right
   does the same by click. Is one place for output enough, or should the list and the graph stay in step?
5. **Graph direction on a phone.** Left to right everywhere (AC-07), scrolling sideways on a narrow screen with the step list
   first. Prefer top to bottom below 640 px instead?
6. **Names.** AC-09 of the spec calls the list "the task list". The sketches call it **Steps**, as the workflow file and the
   engine's own `StepView` do. Use "steps" everywhere?

7. **The structure of a run.** The graph needs which step waits for which and where a failure leads, and a run's trace records
   neither. The recommendation (T-20) is that the engine records both on each step's span: two new attributes, a minor, and an
   old run shows its steps in order with a note. The alternative is to read the workflow file, which a run does not name
   reliably and which may have changed since. Record it in the trace?
8. **The discussion.** With today's trace the page can show a debate's outcome and rounds, not its messages (sketch 4, version A).
   The full thread needs the board of `specs/run-blackboard` or a transcript kept under the run (T-21). Which, and may step 1
   ship with the summary only?
9. **The editor.** Sketch 5 shows the graph as an editor with bricks. It is out of step 1; is the one-component approach (a view
   mode now, an edit mode later) what you want, and is the list of bricks right? Whether editing is paid is not decided here.

Answer in the pull request or here; T-09 is ticked when you say the sketches stand.
