# Plan: The local web view, step 3b (edit a workflow through forms)

Against [`api-surface.md`](api-surface.md). Read [`spec.md`](spec.md) first.

## The round trip

```
page (form field)          server                         command line
  edit(text, [op]) ─────►  POST /api/v1/workflows/edit
                           checks the body (limits) ────►  WorkflowEditor.edit
                                                            WorkflowDocument.parse(text)
                                                            apply each op (set, remove, addStep, ...)
                                                            text' = toString()
                                                            problems = the store's problems of text'
                                                            value = document.get([])
  ◄──────────────────────  200 { text', value, problems }  ◄─
```

`GET /api/v1/editor` is answered from `WorkflowEditor.info()`, computed once when `indaba ui` starts: the schema and the
catalog do not change while it runs (plugins load at start).

## Command line

- `run-control/editor.ts`: `createWorkflowEditor({ parse, diagnose, catalog })`. The problems are those of the store
  (`problemsOf` moves to a small shared module so both use one function): errors only, each with `path`, line and column,
  sentences cleaned. `WorkflowDocumentError` from `parse` is `not_editable`; from an edit it is `edit_refused` with the
  edit's index and the error's `path`. Any other error propagates (a defect, answered `500`).
- `value` is `document.get([])`, narrowed to a JSON object by a checking function (the document guarantees plain JSON;
  the narrowing is for the compiler, not trust).
- `main.ts` builds the catalog from the same bundle `uiBackendsFor` creates, with the arbiter `human` listed as
  `indaba catalog` does (`LISTED_HUMAN_ARBITER` unless a terminal adjudicator is given).

## Server

- `workflow-editor.ts`: the interface, the error, the limits, and `editsOf(body)`, which validates and copies the
  edits into fresh objects or returns the refusal (a sentence naming the edit's index). Pure, tested alone.
- `server.ts`: the two routes; `methodsOf` gains the edit path; `editorRefusal` maps the two codes to `422`.
  `CONTRACT_VERSION` `1.3.0`.

## Page

- `form-model.ts` (pure): reading the schema (unwrap the optional `null` branch, pick the branch for the current value,
  the kind of each field), the field list of the header, a role and a step in schema order, which fields go to the source
  view, the permissions presets (exact match, C-04), `nextStepId`, where each problem goes (field, step, top), and how a
  field's entry becomes an edit (`set`, or `remove` when cleared, none when unchanged or invalid).
- `FormView.ts`: renders from `form-model`; text fields keep the person's entry locally and commit on blur and Enter;
  choices commit at once. Edits are queued: each is sent with the text the previous answer returned, and an answer is
  dropped if the draft changed under it (spec section 5).
- `SourceScreen.ts`: holds the draft as before and gains the view switch, the editor info, and the value; the form view
  and the source view share `text`, `problems`, Save, the conflict view, the leave guard and Run. The check of step 3a is
  skipped for a text whose problems an edit already returned.
- `client.ts`: `editor()` (`undefined` on `404 editor_unavailable`) and `editWorkflow(text, edits)` answering `edited`,
  `not_editable` or `refused`.
- `messages.ts`: a `form` section; every word of the form comes from it.

## Stage 5: analyze

| Question | Answer |
| :--- | :--- |
| A published signature broken without the right version? | No. Additive types and resources; `path` is optional; `WorkflowEditor` is a new optional option. Minor, recorded in `CHANGELOG.md`. |
| A `node:` import or I/O in `@indaba/core`? | No. Declarations only in `web-contract`. |
| A new runtime dependency? | No. `yaml` is already the engine's; the page uses React it already bundles. |
| Untrusted data reaching a shell, a path, a URL or a log? | No shell, path or URL is built from a request. The log records hold a code and an index only. The text is parsed as data (`yaml` core schema), prototype keys refused by `WorkflowDocument`. |
| A wall clock, randomness or environment read in decision logic? | No. `nextStepId` is a function of the ids. |
| An unbounded loop, retry or buffer? | No. The body is capped; `edits`, path parts, key length and value depth are bounded before the editor runs; the page queues at most one request at a time per view. |

No finding returns the plan to stage 3.

## Tests

- Server: each limit at its bound and one past it; each malformed edit; extra fields not passed on; `404` without the
  backend; `403` without `Origin`; `422` mapping; `GET /api/v1/editor`.
- Command line: each op through the real `WorkflowDocument`; a commented fixture keeps every line outside the edited one;
  `not_editable` for non-YAML, two documents, a list root; `edit_refused` with index and path; problems carry `path`.
- Page (happy-dom, fake client): fields from the schema; choices from the catalog and the document; an unknown runner
  marked and kept; a source-only field's button; commit on blur and Enter, not per key; clearing an optional field sends
  `remove`; a required field cannot be cleared; presets set and Custom kept; add, remove (asks), move; problems at the
  field with `aria-invalid` and `aria-describedby`; the queue order and a dropped stale answer; the switch keeps the
  draft; no form without the editor.
- End to end: the built `indaba ui`, edit a field through the resource, the comments of the file survive, save.
