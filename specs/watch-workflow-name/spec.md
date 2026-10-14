# Specification: the workflow name in the list of runs

> **Status**: Accepted
> **Stage entry**: 1
> **Semver impact**: minor (an additive field on `RunSummary` and an extra column in the `indaba watch` list; confirmed in api-surface.md)

---

## 1. The problem

`indaba watch` with no run id lists the runs on this machine by id, status and start time. With more than a few
runs there is no telling which is which: a person has to open each one to learn what it was. The workflow name is
already in every run's records (the root span carries `indaba.workflow.name`), but the reader's summary of a run
leaves it out, so neither the list nor any later view (the terminal picker, the web view's home screen) can show it.

## 2. User stories

- **US-01.** As a person running several workflows, I run `indaba watch` and see which workflow each run belongs to,
  so I can pick the one I mean.
- **US-02.** As a developer embedding `@indaba/engine`, I read `RunSummary.workflow` from `TraceReader.listRuns()`
  and show it in my own list.

## 3. Acceptance criteria

- [ ] AC-01 `RunSummary` has `workflow: string | undefined`: the value of the root span's `indaba.workflow.name`
      attribute; when that is absent, the root span's name without its `indaba.task ` prefix; when neither gives a
      non-empty text, `undefined`.
- [ ] AC-02 `summariseRun` returns the same `workflow`, so every reader of a summary agrees.
- [ ] AC-03 A run read from a trace file written before the event stream existed has its workflow name too.
- [ ] AC-04 `indaba watch` prints the list as `id  status  started  workflow`, the workflow last so that a script
      that reads the first three columns keeps working. A run whose name is unknown shows `-`.
- [ ] AC-05 The name is untrusted text from a file. The list prints it as plain text on one line: control and escape
      characters are removed, line breaks become spaces, and a name longer than 60 characters is cut with `...`.
- [ ] AC-06 Nothing else changes: the order of the list, the statuses, how a run is picked, and the exit codes.

## 4. Non-goals

- Filtering or searching the list by workflow. A person reads the list; `latest` and an id prefix still pick a run.
- The task id, the cost or the step count in the list. Each is its own change, with its own cost of reading the file.
- A machine-readable (JSON) list. That belongs with the web view's server.
- Showing the workflow file path. The trace does not record it.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| the root span has no workflow name and a name that is not `indaba.task <name>` | `workflow` is `undefined`; the list shows `-` |
| the name attribute is not a string | it is ignored and the span name is tried |
| the run's files cannot be read | the run is left out of the list, as today |
| the name holds escape sequences or line breaks | they are removed before printing (AC-05) |

## 6. Security and data handling

The workflow name comes from a trace file, which is data that anything could have written. It reaches a terminal, so
it passes through the sanitiser in `@indaba/engine` (`sanitize`) before it is printed. It reaches no shell, path or
URL. It is not a secret: a workflow's name is already printed by `run`.

## 7. Where it lives

`@indaba/engine`, in `trace/trace-reader.ts`: `RunSummary`, `summariseRun` and `listRuns`. `indaba` (the CLI), in
`watch.ts`: the list. No change to `@indaba/core`, the file formats or the records.

## 8. Clarifications

- The name is taken from the attribute first because the span name is a display string (`indaba.task <name>`) that
  a future change may reword. The span name is the fallback because trace files exist that have no attribute.
- The column is last, not second, so a script reading the first three columns is not broken.
- Sixty characters is a bound, not a fit: the list is not clipped to the terminal width (an id alone is 32 characters),
  so only the name, the one free-text column, is limited.

## Artifacts not written

- `plan.md`: one function and one format string change; the plan is the api-surface.md.
- `tasks.md`: fewer than two independent steps worth tracking.
- `data-model.md`: no stored shape changes; the records and files are as they were.
- `research.md`: nothing to compare.
- `events.md`: no event and no span or attribute is added; the attribute read already exists.
