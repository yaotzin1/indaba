# Self-review: Workflow editor, schema and catalog

> **Status**: done, 2026-10-23, over its three pull requests (#61 diagnostics, #62 the document and the schema, and
> the catalog on `feat/workflow-editor-catalog`). Stages 1 to 7 ran; stage 8 is the maintainer's merge. The spec was
> amended before stage 6 (C-01 to C-03) and the contract during it (`api-surface.md`, amendments of 2026-10-23).

Answers to [`.agents/rules/review.md`](../../.agents/rules/review.md).

## 1. Boundary and layering

`@indaba/core` gained optional `description` members on `Runner`, `Guard` and `Adjudicator`, `Described`, and
`AdjudicatorRegistry.describe()`: declarations and one pure method; no `node:` import (`architecture.test.ts`).
`WorkflowDocument`, `diagnose`, the schema and `catalogOf` are in `@indaba/engine`, which already owns `yaml` and the
parser. `catalogOf` takes a structural `CatalogSources`, since `EngineBundle` is the command line's. The commands
`schema` and `catalog` are in `indaba`. A plugin's runner, guard or adjudicator is described and listed exactly as a
built-in is; no built-in has access a plugin lacks.

## 2. Determinism and failure isolation

None of the new code reads a clock, randomness or the environment, or starts a process. `WorkflowDocument` reads and
writes no file. Each edit is checked by reading the result back; an edit that reads back wrong leaves the document as it
was and throws, so a document never holds a text its own reader refuses.

## 3. Public surface and semver

Minor, as classified: new exports (`WorkflowDocument`, `WorkflowDocumentError`, `MAX_DOCUMENT_BYTES`, `MAX_ALIASES`,
`Problem`, `Path`, `pathText`, `WorkflowParser.diagnose`, `workflowJsonSchema`, `catalogOf`, `Catalog`,
`CatalogSources`, `Describes`, `MAX_DESCRIPTION`, `Described`, the three `describe()`), optional members only on
existing interfaces, and two commands. `validate`'s output is unchanged: `diagnose` uses its sentences as they are.
The catalog's shape is versioned (`catalog: 1`), with `voters`, `prompts` and `values.promptAdditions` present and
empty so their specs can fill them without a new version. Every addition is in `CHANGELOG.md`.

## 4. Security

- A workflow text is untrusted. The document refuses text over 1 MiB before parsing and more than 100 aliases (an
  alias bomb is tested), uses the parser's yaml options, refuses `__proto__`, `constructor` and `prototype` in a path
  or a value, and accepts only plain JSON (functions, dates, maps, class instances, cycles, symbols, sparse arrays,
  non-finite numbers and nesting past 64 are refused, each tested).
- Descriptions come from plugins: the catalog drops control sequences, joins lines and cuts at 200 characters
  (tested with an escape sequence and a long text). A description never reaches a trace.
- The descriptions of the built-ins say what they do, including that the `shell` runner passes each line to the system
  shell (a first draft said "no shell", which was wrong and was corrected before commit; a test holds it).
- The schema and the catalog name fields and runners, never an environment value; an API runner's description names
  the variable it needs, not its key or address.

## 5. Observability and honest numbers

No span or attribute. Log records: `cli.schema` `the schema was printed`, `cli.catalog` `the catalog was printed`
(counts only). Positions are given only where the text has the path or an ancestor of it; the limits are labelled
starting values.

## 6. Dependencies and packaging

No runtime dependency. `ajv` 8.20.0 is a root devDependency for the conformance test only, licence-checked (MIT, its
tree MIT and BSD-3-Clause, no install scripts) and recorded with a `Workflow-Change:` trailer. `pnpm audit`: no known
vulnerabilities. `pnpm smoke` boots the packed install.

## 7. Verification

```
$ pnpm qa
 Test Files  107 passed (107)
      Tests  2001 passed | 2 skipped (2003)
Statements   : 96.19% ( 7999/8315 )
Branches     : 91.04% ( 5879/6457 )
Functions    : 95.93% ( 1746/1820 )
Lines        : 96.49% ( 7701/7981 )

$ pnpm e2e
 Test Files  11 passed (11)
      Tests  34 passed (34)

$ pnpm smoke
smoke-pack: 6 packages packed and audited; indaba 0.1.0-alpha.2 boots without @indaba/tui and @indaba/server, and the installed server finds its page

$ node scripts/check-workflow.mjs
workflow.ai.yml matches the repository

$ node scripts/security-audit.mjs --source
security audit: no findings (source, manifests, tsconfig, biome.json)

$ node --test scripts/*.test.mjs
# pass 83
# fail 0

$ pnpm audit --audit-level low
No known vulnerabilities found
```

Tests that would catch a regression: `engine/test/diagnose.test.ts` (diagnose's sentences equal validate's on every
example and 17 broken files, and each kind is placed), `engine/test/document.test.ts` (whole texts compared for every
kind of edit; every example renamed with only its name line changed), `engine/test/schema.test.ts` (the schema and the
parser agree on 64 files; every key the parser reads is in the schema and the reverse, which was checked by adding a
key to the parser), `engine/test/catalog.test.ts` and `cli/test/catalog.test.ts`. CI ran parts 1 and 2 on Linux, macOS
and Windows.

## Known gaps

- **The document model as fallback** respaces a file (the `yaml` library's writer collapses the spaces before an inline
  comment, for one). It is used only for what the text splice does not do: flow collections (`[{...}]`), and a value
  set inside a list item. Both are rare in hand-written workflows; a splice for them is worth writing if the forms
  edit such files.
- **The parser still has no size or alias limit** (spec, section 6): the editor is stricter than `run`. Its own change.
- **`diagnose` reads where a sentence is from how it is worded.** A new message in the parser or the validator that
  names its place in a new way is placed at its nearest known ancestor, not wrongly; the test over the examples and the
  fixtures shows when that happens.
