# Data model: Workflow inputs

Nothing is stored in a database. This file fixes the two shapes other code and other front ends depend on: the text the
inputs digest is taken over, and the channel files for asking.

## The canonical text and the digest

`canonicalInputs(declarations, values)` returns JSON text with no spaces, so that the same inputs give the same digest on
every machine and on every operating system:

- one object `{ "v": 1, "inputs": { ... } }`; `inputs` has one member per declared input, keys sorted by code point;
- each member is `{ "type": "<type>", "value": <value> }`; a list value is an array in the order given;
- a `path` value is the stored form (relative, `/` separators, no leading `./`, no trailing `/`); a `text` value has
  `\n` line endings; a `number` is written as `JSON.stringify` writes it, with `-0` as `0`; a `boolean` is `true` or
  `false`;
- an input that has a value only because of its default is included with that value (so a changed default changes the
  digest);
- an optional input with the empty default (`""`, `[]`) is included with it.

The digest is `SHA-256(UTF-8(canonicalInputs(...)))` as 64 lowercase hex characters. The text is never written to a
trace; only the digest and, per spec.md AC-23, the closed-vocabulary and path values and the length of a text value.

Example, for the workflow in spec.md section 9 given `specs/billing` and `specs/refunds`:

```
{"v":1,"inputs":{"specs":{"type":"path","value":["specs/billing","specs/refunds"]}}}
```

## Channel files (stacked on `specs/ruling-channel`)

They live in `.indaba/rulings/` beside the ruling files, are written whole and atomically (a temporary file in the same
directory, then a rename), and are removed when answered or when the run ends. The id matches `[A-Za-z0-9_-]+`.

`<id>.inputs.request.json`:

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `v` | number | `1` |
| `id` | string | the id in the file name |
| `workflow` | string | the workflow's `name` |
| `declarations` | `InputDescription[]` | what to ask for, in declaration order (api-surface.md) |
| `given` | string[] | names that already have a value and need no answer |
| `requestedAt` | string | ISO 8601 time, supplied by the injected clock |
| `pid` | number | the process that is waiting; a request whose process is gone is removed by `listPendingInputRequests` |

`<id>.inputs.answer.json`:

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `v` | number | `1` |
| `values` | `Record<string, string[]>` | the raw values, one array per input; a single element for an input that is not a list |

An answer that is not valid JSON, has another `v`, names an input that is not in the request, or exceeds the size limits
of spec.md AC-04 and AC-05 is removed and ignored; the request stays pending and `indaba.inputs.invalid_answers` counts
it. A valid answer is checked by `resolveInputs` like any other supplied value; if that finds a problem, the request is
rewritten with `given` unchanged and a `problems` array of `{ input, message }` so the form can show them next to the
fields, and the run keeps waiting.

## Types added

The TypeScript types are in `api-surface.md`. There is no change to an existing file format: a workflow without `inputs`
and every existing trace and ledger line are read and written exactly as before.
