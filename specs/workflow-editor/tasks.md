# Tasks: Workflow editor, schema and catalog

Each task is checkable on its own; tests come with the code. Run `pnpm qa` after each group.

Order (spec C-03): part 2 first (its first pull request also carries T5b), then part 3, then part 1.

## Part 1: descriptions and the catalog

- [ ] T1. `description?` on `Runner`, `Guard`, `Adjudicator`; `Described`; `describe()` on the adjudicator registry; describe the built-ins (AC-11). Includes `specs/debate-arbiter` T16.
- [ ] T2. The runner and guard registries expose `describe()`; `EngineBundle` exposes the adjudicator registry; `voters`, `prompts` and `values.promptAdditions` are empty (C-01).
- [ ] T3. `catalogOf` and the `Catalog` shape; descriptions cut at 200 and cleaned (AC-12, AC-13). Tests: a plugin's contribution appears; a runner without a description is listed with an empty one.
- [ ] T4. `indaba catalog [--json] [--plugin]`: output, exit codes, a failing plugin.

## Part 2: diagnostics and the schema

- [ ] T5. `WorkflowParser.diagnose` and `Problem` (C-02): positions from the `yaml` document for a path, a step, a top-level key, a YAML error; the messages equal `validate`'s for every example and a table of fixtures (AC-05).
- [ ] T5b. The workflow store of `indaba ui` answers problems from `diagnose` (AC-15); the source view's tests show a line for a structural problem.
- [ ] T6. `workflowJsonSchema()` for the root, roles, steps, guards, `on_failure`, permissions, MCP servers and `defaults`, enumerations from the parser's constants, descriptions; check what the parser does with unknown keys and copy it (AC-08, AC-09).
- [ ] T7. The conformance test (AC-10) with the devDependency after the licence check; fixtures for valid and invalid structure.
- [ ] T8. `indaba schema`.

## Part 3: the editor

- [ ] T9. `WorkflowDocument.parse` / `create` / `clone` with the parser's options, the 1 MiB and alias limits; refusals (AC-01, AC-07). Tests: 1 MiB plus one byte, an alias bomb, two documents, a sequence root.
- [ ] T10. `get`, `set`, `remove`, `has` with path rules and plain-JSON check; forbidden keys (AC-02).
- [ ] T11. `addStep`, `removeStep`, `moveStep` (AC-03).
- [ ] T12. `toString` and the round-trip test on a heavily commented example (AC-04); editing an invalid document (AC-06).
- [ ] T13. `problems()` equals `validate` for the same text, including positions (AC-05).

## Documentation and gates

- [ ] T14. `docs/workflow-format.md` (link to the schema, a section for tool authors), `docs/extending.md` (`description`), `docs/getting-started.md` (the two commands), `README.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`.
- [ ] T15. `pnpm qa`, `pnpm e2e`, the node gates; coverage at least 85% on all four metrics.
- [ ] T16. Fill `review.md`.
