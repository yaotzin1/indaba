# Data model: the board file

The contract for every reader (the TUI, `watch --plain`, the later web view, anything else). It is a file, not
an API; a reader needs no part of the engine.

## Where and how it is written

- Path: `.indaba/traces/<traceId>.board.jsonl`, beside `<traceId>.jsonl` and `<traceId>.events.jsonl`. The trace
  id is lowercase hexadecimal (validated as the other two are) and is the only thing that reaches the path.
- UTF-8, one JSON object per line, each line ended by `\n`, written whole by one serialized writer in `seq`
  order. A reader ignores a last line without its `\n` until it is completed.
- Append-only: no record is ever changed or removed. The file is not rotated. A resumed run appends to it.
- Field names on the wire are snake_case, as in the other two files; the types in `api-surface.md` are camelCase.
- Every record has a `type`. A reader keeps going on a `type` it does not know, or a line that is not JSON
  (it becomes an `unknown` record; nothing fails).
- The first record is `board` with `v` (the format version, `1`). A change that removes or reinterprets a field
  bumps `v`; adding a field or a record type does not.

## Records

### `board` (first line)

```json
{"type":"board","v":1,"at":"2026-10-11T09:00:00.000Z","trace_id":"3fa9c1","workflow":"review-debate"}
```

### `post`

```json
{"type":"post","seq":12,"at":"2026-10-11T09:02:11.201Z","step_id":"research","attempt":1,"scope":"step",
 "source":"agent","sender":"researcher","kind":"result","text":"Three endpoints need changing.","cut":false}
{"type":"post","seq":13,"at":"2026-10-11T09:02:11.202Z","step_id":"research","attempt":1,"scope":"step",
 "source":"agent","sender":"researcher","kind":"fact","key":"api.version","text":"3","cut":false}
{"type":"post","seq":20,"at":"2026-10-11T09:05:40.019Z","step_id":"review_debate","attempt":1,"scope":"step",
 "source":"engine","sender":"claude","kind":"critique","round":2,"text":"engine.ts:543 keeps stale rows.","cut":false}
```

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `seq` | integer, from 1 | identity and order; one counter for every record after `board` |
| `at` | string | ISO 8601 UTC, from the injected clock |
| `step_id` | string | the step that produced it |
| `attempt` | integer, from 1 | the attempt of that step |
| `scope` | string | `step`, or `variant:<n>` |
| `source` | `agent` or `engine` | an agent's line in its reply, or the engine itself |
| `sender` | string | the role that spoke, or the step id for an engine entry |
| `kind` | string | `note`, `question`, `result`, `fact`, `proposal`, `critique`, `agreement`, `tool_intent`, `decision` |
| `key` | string, facts only | matches `[a-z0-9][a-z0-9_.-]{0,63}` |
| `round` | integer, debate messages only | the debate round |
| `text` | string | one line; no control characters; redacted; at most 2000 characters |
| `cut` | boolean | the original text was longer and was cut |

### `settle`

```json
{"type":"settle","seq":31,"at":"2026-10-11T09:06:02.500Z","step_id":"research","attempt":1,"scope":"step",
 "outcome":"accepted"}
{"type":"settle","seq":44,"at":"2026-10-11T09:09:30.100Z","step_id":"research","attempt":1,"scope":"step",
 "outcome":"superseded","reason":"the retry of \"draft\" reset this step"}
```

It settles the entries of that step attempt and scope that have a lower `seq` and are not yet settled, or (for
`superseded`) are accepted. `outcome` is `accepted`, `discarded` or `superseded`. `reason` is optional, redacted
and at most 300 characters.

### `truncated`

```json
{"type":"truncated","seq":2001,"at":"2026-10-11T09:30:00.000Z","reason":"entries"}
```

`reason` is `entries` or `chars`. No `post` follows; `settle` records still do.

## Deriving the view

A reader that wants the same view as the engine does this, in order of `seq`:

1. Keep every `post`.
2. The state of a post is `pending`, unless a later `settle` with the same `step_id`, `attempt` and `scope`
   applies to it, in which case it is that settle's `outcome`; the latest applicable settle wins.
3. The current facts are the `accepted` posts with `kind` `fact`, the highest `seq` per `key`.
4. The default view shows `accepted` posts only. A view for people may also show `discarded` and `superseded`,
   marked as such, and `pending`, marked as pending.

## What is never in the file

Prompts, replies in full, a step's output, MCP server definitions, arguments, environment values, API keys, and
anything an agent wrote that was not a valid post line. Text that looks like a secret by the redaction function
is already redacted when it is written.

## Sizes

An entry's text is at most 2000 characters; a run holds at most 2000 entries and 1 MiB of entry text (design
choices, `spec.md` C-08). The largest file a run can make is therefore a few MiB. It is not rotated or compacted.
