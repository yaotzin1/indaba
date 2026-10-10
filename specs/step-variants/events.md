# Events: Step variants

## Dispatched events (`@indaba/core`)

| Event | Fields | Dispatched when |
| :--- | :--- | :--- |
| `VariantFinished` | `taskId`, `stepId`, `index`, `outcome` (`passed`, `failed` or `cancelled`) | a variant's attempt, outputs check and guards are done, in the order they finish |
| `SelectionMade` | `taskId`, `stepId`, `choice` (the chosen variant's index, or `null` for none), `source` (`examiners` or `arbiter`) | the choice is known, before the diff is applied |

Neither carries a diff, a summary, a reason, a note or a label: an event reaches listeners, plugins and the event
stream, and those must not receive what only the person ruling should see. `VariantFinished` is dispatched in
completion order, which varies; numbering and the order candidates are shown in do not (AC-18). A step with no
candidate dispatches `VariantFinished` events and no `SelectionMade`. A cancelled step dispatches no `SelectionMade`.
A step that escalates because the examiners chose `none` dispatches `SelectionMade` with `choice: null`; one that
escalates because nobody could decide dispatches none.

The examination itself dispatches whatever a debate dispatches today; this feature adds nothing there.

## Event-stream records (`.indaba/traces/<traceId>.events.jsonl`)

```json
{ "type": "variant_finished", "at": "2026-10-10T12:00:00.000Z", "traceId": "…", "stepId": "implement", "index": 2, "outcome": "passed" }
{ "type": "selection_made",   "at": "2026-10-10T12:01:40.000Z", "traceId": "…", "stepId": "implement", "choice": 2, "source": "examiners" }
```

A reader that does not know these types treats them as unknown records and skips them, as the existing reader does for
any unknown type; a test feeds it one.

## Spans

One child span per variant, a child of the step's span: `indaba.variant <step>#<n>`. Its own children are what a step
run once would have (runner spans). It records:

| Attribute | Type | Meaning |
| :--- | :--- | :--- |
| `indaba.variant.index` | integer | 1-based, declaration order |
| `indaba.variant.outcome` | string | `passed`, `failed` or `cancelled` |
| `indaba.variant.files_changed` | integer | only when it produced a diff |
| `indaba.variant.lines_added`, `indaba.variant.lines_removed` | integer | only when it produced a diff |

Token and cost attributes are the ones the runner spans already set; the variant span adds none, so a total is not
counted twice. The examination's spans are those of a debate.

The step's span records, when it has variants:

| Attribute | Type | Meaning |
| :--- | :--- | :--- |
| `indaba.variants.count` | integer | how many variants were declared |
| `indaba.variants.passed` | integer | how many were candidates |
| `indaba.selection.source` | string | `examiners` (the ballot was reached) or `arbiter` |
| `indaba.selection.choice` | integer | the chosen index; absent for `none`, an unresolved examination or no candidate |
| `indaba.selection.votes` | integer | how many examiners named the choice, in the last round |

When the arbiter ruled, the existing `indaba.arbiter.*` attributes are recorded as for a debate. The diff, the
summaries, the labels, the reasons and the note are in no attribute.

## Ordering

For one step: every `VariantFinished` precedes the examination, which precedes `SelectionMade`, which precedes the
application of the diff. Variants start in declaration order, at most `variants_concurrency` at a time; finishing order
is not guaranteed.
