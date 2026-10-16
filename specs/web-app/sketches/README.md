# Sketches: the local web view, delivery step 1

The three sketches AC-21 asks the maintainer to review before the page is built (task T-09 of `../tasks.md`). They are
wireframes: structure, wording and state, not final style. Open the `.html` files in a browser; they use no script and no
network, follow the system light or dark setting, and are filled with **sample data**, not a real run.

| File | Shows |
| :--- | :--- |
| [`01-runs.html`](01-runs.html) | The Runs screen: the runs on this machine, newest first, with state, start time and cost |
| [`02-run.html`](02-run.html) | One run: the graph of its steps, the step list, the cost, the attempts of a retried step, the output of the selected step |
| [`03-states.html`](03-states.html) | Empty and failure states: no runs, server stopped, token missing, stream dropped, half-written file, unknown event, long output, newer server, run not found, unknown cost, a phone at 320 px |

`sketch.css` is shared by the three. Nothing here is shipped: the page itself is `@indaba/web` (T-07, T-08).

## What the sketches commit to

- A state is a word and a symbol; colour and the border style repeat it, never replace it (AC-07, AC-20).
- Cost: `unknown`, `at least $x (partial)`, `$0.00 (no model calls)`, and `no limit` for a step without a budget (AC-19).
- The page reads and shows; it has no Run, Stop, edit or delete (those arrive with later delivery steps).
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

Answer in the pull request or here; T-09 is ticked when you say the sketches stand.
