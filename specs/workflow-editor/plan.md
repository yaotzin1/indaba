# Plan: Workflow editor, schema and catalog

> Stage 3. Contract: [`api-surface.md`](api-surface.md). Behaviour: [`spec.md`](spec.md).
> The three parts are independent and can ship in three pull requests: descriptions and catalog, then schema, then
> the editor.

## Where each piece goes

| Piece | Package | Why there |
| :--- | :--- | :--- |
| `description` members, `Described`, `describe()` | `@indaba/core` | extension contracts |
| `WorkflowDocument`, `Problem`, `diagnose` | `@indaba/engine` (`src/editor/`, `parser/`) | owns `yaml` and the parser |
| `workflowJsonSchema` | `@indaba/engine` (`src/editor/schema.ts`) | beside the format it describes |
| `catalogOf` | `@indaba/engine` (`src/editor/catalog.ts`) | reads the registries the bundle holds |
| `schema`, `catalog` commands | `indaba` | front end |

## Editing with comments preserved

`WorkflowDocument` holds a `yaml` `Document` from `parseDocument(text, options)`, with the parser's limits
(`maxAliasCount`, a single document, the size check done before parsing). `set`/`remove`/`get` map to
`doc.setIn`/`deleteIn`/`getIn`; values are validated as plain JSON and converted with `doc.createNode`. The `yaml`
library keeps comments, blank lines between entries, key order and scalar styles for nodes that are not touched; AC-04
tests that on a commented example, not just asserts it. `addStep`/`moveStep` operate on the `steps` sequence by
looking up the item with the given `id`. Intermediate containers are created as maps or sequences according to the
next key (string: map, number: sequence).

## Diagnostics with positions

The parser's `ErrorBag` holds strings such as `$.steps[0].role "x" ...`. `diagnose` needs the path separately: the bag
gains `addAt(path, message)` and keeps the existing `add` (which splits a leading `$...` path off the message, so no
call site has to change at once). A path becomes a position by walking the `yaml` document with the same keys and
reading `node.range` (`[start, valueEnd, nodeEnd]`) converted through `LineCounter`. `WorkflowValidator.warnings` gains
a path where it has one.

## Schema

A hand-written TypeScript object, one function per section (`rootSchema`, `roleSchema`, `stepSchema`, ...), each field
with its `description`. Enumerations are imported from the same constants the parser uses (`DecisionType`, `Isolation`,
`FailureAction`, `McpPolicy`), so they cannot differ. `additionalProperties` is `true` at the root only if the parser
ignores unknown root keys; the plan task T6 checks what the parser does and the schema copies it.

## Conformance test (AC-10)

For every `examples/*.workflow.ai.yml` and a table of valid and structurally invalid fixtures: the schema accepts
exactly what the parser's structural checks accept. The schema checker is **ajv** as a devDependency of the test
package only: MIT licensed; its tree (`fast-deep-equal` MIT, `json-schema-traverse` MIT, `require-from-string` MIT,
`fast-uri` BSD-3-Clause) is open source and compatible. The licence check is repeated at install time by task T0, and
if any entry fails, the test falls back to a small structural walker written in the repository. Nothing here ships.

## Catalog

`catalogOf` reads `runners.names()` (and a `description` if a runner has one), the guard registry, the new adjudicator,
voter and prompt registries, and the enumerations. It is a plain function over the bundle, so the CLI calls it after
loading plugins and a server calls it in-process.

## Decisions recorded

- **No new runtime dependency.** `yaml` is already one.
- **Hand-maintained schema, tested against the parser**, not generated (spec section 4).
- **Positions, not just messages**, because an editor cannot underline a sentence.
- **`ErrorBag.add` keeps its signature.** The path is split off the message it already contains.

## Analysis (stage 5)

| Check | Result |
| :--- | :--- |
| Published signature broken? | No. Optional members and new exports. `diagnose` is new; `parse` is unchanged. Minor. |
| `node:` import in core? | No. Core gets optional fields and `Described`. |
| New runtime dependency? | None. One devDependency (ajv), with the licence check above. |
| Untrusted data to shell, path, URL or log? | The workflow text is untrusted: parsed with the parser's limits, edited by path with forbidden keys refused, values checked as plain JSON. No file, network or process access in the library. |
| Wall clock, randomness, environment? | None. |
| Unbounded loop or buffer? | Document size is limited before parsing; alias count limited; description cut at 200. |
| Secrets? | The catalog and schema list names and types only. |
| Behaviour change for `validate`? | Its output must not change. A snapshot test over the examples and the parser-error table compares `validate` before and after the move to `diagnose`. |

**Flag for review.** The `ErrorBag` change touches every parser error site. It is behaviour-preserving, but it is the
widest edit in this feature, so it is its own task (T5) with the snapshot test written first.
