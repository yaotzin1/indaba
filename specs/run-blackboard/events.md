# Events and attributes: Run blackboard

The board adds one event, five span attributes and one span event. It adds no record to the trace file and none
to the event stream (`<traceId>.events.jsonl`); the board has its own file, whose records are in
[`data-model.md`](data-model.md). Attribute names follow the repository's `indaba.*` namespace; none of them
carries board text.

## E-01. The event `BoardRecorded`

Dispatched through the existing event dispatcher for every record the run's board makes, in order: the start
record, each post, each settlement, the truncation. It carries `traceId` and the `BoardRecord` as made (already
cleaned and redacted). The built-in `BoardWriter` is a listener of it, and a plugin can register another with
`PluginHost.registerListener`; a listener that throws fails alone, as for every other event.

## E-02. Span attributes, on the span of the step that read or posted

| Attribute | Type | Meaning |
| :--- | :--- | :--- |
| `indaba.board.digest.entries` | int | entries in the digest the step was given |
| `indaba.board.digest.chars` | int | characters of the digest section |
| `indaba.board.digest.omitted` | int | entries that matched but did not fit |
| `indaba.board.posted` | int | posts taken from the step's reply |
| `indaba.board.ignored` | int | `BOARD ` lines that were not valid posts, or beyond the limit |

Set only on a step that has `board.read` (the first three) or `board.post` (the last two). A step without a
`board` field gets none, so its span is unchanged. Counts only: no text, no sender, no key.

## E-03. Span event, on the root span

| Name | Attributes | When |
| :--- | :--- | :--- |
| `indaba.board.degraded` | `indaba.board.error`: the error's class name | the board file could not be written; once per run |

The in-memory board is unaffected (`spec.md` C-09). The attribute holds the class name only, never the message,
which can contain a path or an operating-system detail.

## What is not an event

Debate messages, rulings and verdicts are not new events: they are posts, carried by `BoardRecorded`. The step
status changes, the span starts and ends and the streamed output remain in the event stream as before.
