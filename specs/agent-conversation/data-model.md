# Data model: Agent conversation

Files only; there is no database. Every file is JSON, UTF-8, written whole and atomically (a temporary file in the same
directory, then a rename), at most 8 KiB, with mode `0600` where the platform has modes. A reader never fails on a file: one
that does not parse, is too large, or names an unknown `type` is skipped with a warning event. Every id is
`[a-z0-9-]{1,64}` and is validated before any path is built from it. Text members are cleaned of control characters and redacted
with the event stream's function before they are written. Nothing here holds a prompt, an environment, a key or a path outside
the project.

## The channel: `.indaba/conversation/`

```
.indaba/conversation/
  live/<taskId>.json        a run that can be talked to (removed when the run ends)
  requests/<id>.json        a prompt waiting for a person (removed when answered or withdrawn)
  inbox/<id>.json           what the person sends: a message, an ask, an answer, a change, a take-over, a reopen
  outbox/<id>.json          a receipt or a reply for the sender (kept for the sender to read)
```

### `live/<taskId>.json`

```json
{
  "type": "live",
  "version": 1,
  "taskId": "t-0001",
  "traceId": "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
  "workflow": "review-debate",
  "pid": 12345,
  "startedAt": "2026-10-11T09:00:00.000Z",
  "banner": "Architect decides: questions. You decide: the rest.",
  "steps": ["fix", "review"]
}
```

`banner` is the plain-words choice of AC-16 and is rewritten (atomically) when the choice changes. A `live` file whose `pid` is gone
is stale: it is ignored and removed by the next command that lists it.

### `requests/<id>.json` (a question waiting for a person)

```json
{
  "type": "question",
  "version": 1,
  "id": "q-0007-1",
  "questionId": "q-0007",
  "taskId": "t-0001",
  "traceId": "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
  "workflow": "review-debate",
  "stepId": "fix",
  "attempt": 1,
  "scope": "step",
  "stage": "asked",
  "mode": "attended",
  "question": "Which of the two invoices is the final one?",
  "allowed": ["answer", "delegate", "skip", "stop"],
  "offered": [
    { "kind": "panel", "label": "Ask the panel (antigravity, opencode)" },
    { "kind": "role:antigravity", "label": "Ask antigravity" },
    { "kind": "fresh:claude", "label": "Ask a new copy of claude" }
  ],
  "recoverable": [
    { "id": "step:review", "label": "the review in step review, 3 rounds, no agreement", "messages": 9 }
  ],
  "panelAsksLeft": 3,
  "model": null,
  "requestedAt": "2026-10-11T09:03:00.000Z",
  "pid": 12345
}
```

- `id` is unique per prompt (a question can be prompted again after a panel answer); `questionId` is the same for all prompts of a
  question.
- `stage` is `asked`, `delegate_answered` (a model answered what the person delegated), `panel_answered` (the same, for the panel)
  or `panel_no_agreement`. `allowed` lists the choices the stage permits: `answer`, `delegate`, `use` (take the model's answer),
  `again`, `skip`, `stop`.
- `model`, when a model answered, is `{ "answeredBy", "answerer", "text", "dissent": [ { "role", "text" } ], "outcome", "rounds",
  "spent": { ... a metering report ... } }`, with `text` at most 2000 characters and each dissent at most 500.
- `offered` and `recoverable` are present only where the stage allows `delegate`. `recoverable` lists at most 20, newest first.
- A request is written for the file channel and for any front end; the terminal prompt shows the same content from the same
  object.

### `inbox/<id>.json` (what the person sends)

One of these, selected by `type`:

```json
{ "type": "message", "version": 1, "id": "m-0003", "target": { "step": "fix" }, "text": "Use the 2025 invoice.", "now": false, "taskId": "t-0001", "at": "..." }
{ "type": "ask", "version": 1, "id": "a-0004", "target": { "step": "fix" }, "to": "fresh:claude", "text": "Why did you delete that file?", "taskId": "t-0001", "at": "..." }
{ "type": "answer", "version": 1, "id": "r-0005", "requestId": "q-0007-1",
  "choice": { "kind": "answer", "text": "The 2025 one." }, "at": "..." }
{ "type": "answer", "version": 1, "id": "r-0006", "requestId": "q-0007-1",
  "choice": { "kind": "delegate", "to": "panel", "recoverFrom": "step:review", "note": "Remember the audit." }, "at": "..." }
{ "type": "reopen", "version": 1, "id": "o-0008", "questionId": "q-0007", "text": "Actually the 2024 one.", "taskId": "t-0001", "at": "..." }
{ "type": "take_over", "version": 1, "id": "k-0009", "questionId": "q-0007", "taskId": "t-0001", "at": "..." }
{ "type": "mode", "version": 1, "id": "c-0010", "taskId": "t-0001", "stepId": null, "change": { "type": "mode", "mode": "trusted", "answerers": ["panel", "role:antigravity"] }, "at": "..." }
{ "type": "decider", "version": 1, "id": "c-0011", "taskId": "t-0001", "stepId": "fix", "change": { "type": "decider_set", "decider": { "role": "architect", "decides": ["questions"] } }, "at": "..." }
```

`choice.kind` is one of `answer`, `delegate`, `use`, `again` (with `note`), `skip`, `stop`; an answer that the stage does not
allow, or whose `requestId` no longer waits, is refused with a receipt of state `refused`. `text` is 1 to 2000 characters, `note` at most 500.
`taskId` is optional when exactly one run is live. The `at` of a file is informational; the engine stamps the injected clock on
what it records.

### `outbox/<id>.json`

```json
{ "type": "receipt", "version": 1, "id": "m-0003", "state": "queued", "stepId": "fix", "reason": "It will be read after the current turn.", "at": "..." }
{ "type": "receipt", "version": 1, "id": "m-0003", "state": "delivered", "stepId": "fix", "pass": 2, "at": "..." }
{ "type": "reply", "version": 1, "id": "a-0004", "answeredBy": "same-model-instance", "answerer": "claude",
  "text": "I deleted it because ...", "label": "explained by a new call of claude from the step's last reply", "spent": { ... }, "at": "..." }
```

`state` is `queued`, `delivered`, `undelivered` or `refused` (`reason` in plain words). A reply's `label` is fixed text; its `spent` is a
metering report (`reported`, `estimated` or `unmetered` with a reason, never zero for a gap).

## Additions to the run board (specs/run-blackboard, follow-up)

A `post` record gains these optional members; a reader that predates them ignores them.

| Key | Type | Meaning |
| :--- | :--- | :--- |
| `source` | `"person"` | a new value beside `agent` and `engine`: a message, a reopen, an answer typed by the person |
| `answers` | integer | the `seq` of the question this entry answers |
| `answered_by` | string | `person`, `panel`, `role`, `same-model-instance`, `decider`, `skipped`, or `plugin:<kind>` |
| `decided_by` | string | the decider's role, when `answered_by` is `decider` |
| `mode` | string | `attended`, `trusted` or `decider`: the choice in force when it was decided |
| `scope` | string | gains `panel:<n>` for the messages of a panel discussion |

A change of choice is an engine `note` whose text is the plain-words sentence ("From now on the panel answers the questions of
step fix. Changed by you at 09:12 from the dashboard.").

## The asset manifest: `assets.lock.json`

Present in a folder that holds **downloaded** assets. It is written only by the helper (`specs/asset-helper`); the resolver reads
it and verifies each asset against it, and never writes it. A folder without it is the user's own and needs no acceptance.

```json
{
  "type": "assets",
  "version": 1,
  "entries": [
    {
      "kind": "skill",
      "name": "architect",
      "version": "1.2.0",
      "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "source": "https://example.invalid/skills/architect",
      "license": "MIT",
      "licenseNote": "",
      "accepted": true,
      "acceptedAt": "2026-10-11T09:00:00.000Z",
      "path": "skills/architect/SKILL.md"
    }
  ]
}
```

- `kind` is `skill` or `prompt`; `name` matches `[A-Za-z0-9_-]{1,64}`; `path` is relative to the folder and is exactly
  `skills/<name>/SKILL.md` or `prompts/<name>.md`. Any other `path` makes the entry invalid.
- `sha256` is the digest of the exact bytes of that file as the user accepted them. The resolver computes the digest of what it
  reads and compares; a difference is "changed since you accepted it", and nothing is used.
- `accepted` must be `true`. An entry with `false`, or no entry, is "not accepted yet".
- `source` is the string the user named when asking for the download; it is recorded and shown, never fetched by the resolver.
- `license` is a short identifier or text; `licenseNote` holds the fact the helper showed ("unknown", "not open source", "GPL-3.0,
  not MIT-compatible"). The resolver does not judge either: the user's acceptance stands, and `plan` lists both so the user sees
  them again.
- A manifest over 256 KiB, with more than 2,000 entries, or that does not parse makes the folder invalid for downloaded assets
  (plain-words error naming the folder); the user's own folders are unaffected.

## Asset files (the runtime format)

```
<asset folder>/
  skills/<name>/SKILL.md      the first block, then the text
  prompts/<name>.md           the first block (optional), then the text
  assets.lock.json            present only in a downloaded folder
```

The first block is between two lines of exactly `---` at the start of the file:

```
---
name: architect
description: Decides questions of design, favouring the simpler option.
license: MIT
source: https://example.invalid/skills/architect
---
You are the architect. When you are asked a question, ...
```

`name` equals the folder name (a skill) or the file name without `.md` (a prompt). The keys are `name`, `description` (one line, at most
300), and optional `license` and `source` (one line each). Unknown keys are ignored; a line that is not `key: value` is an error. The
body is UTF-8 text, at most 8000 characters, with no NUL; nothing in it is expanded or run. This is Indaba's runtime format for the
user's workflow; it resembles the `SKILL.md` files of this repository's development workflow (`.agents/skills`) and shares nothing with
them.

## Phase 2: `.indaba/asks/<id>.json`

```json
{ "type": "ask", "version": 1, "id": "a-0001", "traceId": "...", "question": "...", "to": "panel", "stepId": "review",
  "answer": "...", "dissent": [ { "role": "antigravity", "text": "..." } ], "outcome": "reached", "rounds": 2,
  "spent": { ... }, "at": "2026-10-11T10:00:00.000Z" }
```

Written by `indaba ask` for a finished run and read by nothing else. Not the run's board, not the decision ledger.
