# Events: Ruling channel

## Dispatched events (`@indaba/core`)

| Event | Fields | Dispatched when |
| :--- | :--- | :--- |
| `RulingRequested` | `taskId`, `id`, `stepId`, `outcome`, `rounds` | the request file has been written and the run starts waiting |
| `RulingAnswered` | `taskId`, `id`, `verdict` | a valid answer has been read, before the files are removed |

Neither carries the transcript, the topic or the note: an event reaches listeners, plugins and the event stream, and
those must not receive what only the person answering should see. The id lets a front end fetch the request through
`listPendingRulings`.

## Event-stream records (`.indaba/traces/<traceId>.events.jsonl`)

```json
{ "type": "ruling_requested", "at": "2026-10-09T12:00:00.000Z", "traceId": "…", "id": "rul-1a2b3c4d", "stepId": "review", "outcome": "max_rounds_exceeded", "rounds": 4 }
{ "type": "ruling_answered",  "at": "2026-10-09T12:02:11.000Z", "traceId": "…", "id": "rul-1a2b3c4d", "verdict": "accept" }
```

A reader that does not know these types treats them as unknown records and skips them; the existing reader already
does (`UnknownRecord`), and a test feeds it one.

## Span attribute

`indaba.arbiter.invalid_answers` (integer): how many answer files were ignored because they were not valid. Absent
when none.

## Ordering

`RulingRequested` precedes `RulingAnswered` for the same `id`. A cancelled run dispatches only the first. Records
for one run are appended in the order the events arrive, like all others.
