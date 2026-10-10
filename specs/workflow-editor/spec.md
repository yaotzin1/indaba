# Specification: Workflow editor, schema and catalog

> **Status**: Draft
> **Stage entry**: 1
> **Semver impact**: minor (new exports, two new commands, optional `description` members on existing extension
> interfaces; nothing existing changes). Stacked on `specs/debate-findings`.

---

## 1. The problem

The maintainer plans a TUI, a web app and an Electron app, with a wizard that creates the declarative workflow file
and, later, GUIs that may edit parts of it. Three things stand in the way, and none of them is a screen:

1. **Writing a file back.** Indaba can only read a workflow (`parseWorkflow`). A wizard that edits an existing file
   must change one field without losing the author's comments, blank lines, key order or quoting.
2. **Knowing the rules.** The format is described in prose (`docs/workflow-format.md`) and enforced by hand-written
   code. A web or Electron form cannot render fields, types and allowed values from either, and would drift from
   `indaba validate` the first time a field is added.
3. **Knowing the choices.** A wizard has to offer "which runner, which guard, which arbiter, which voters, which
   prompt". Those lists are assembled at run time from built-ins and plugins, and nothing can print them.

## 2. User stories

- **US-01.** As the author of a wizard, I want to build a workflow file from nothing, set fields by path, add and
  remove steps, and get the YAML text, so the wizard never concatenates strings.
- **US-02.** As the author of an editing GUI, I want to change one field of an existing file and have everything else
  stay byte for byte as the person wrote it.
- **US-03.** As the author of a form, I want a machine-readable description of the file format, so a form is generated
  from it, not hand-copied from the docs.
- **US-04.** As the author of an editor, I want each problem with a file as a path, a message and a position, so I can
  underline the right text.
- **US-05.** As the author of a wizard, I want the list of runners, guard types, arbiters, voters and prompts that are
  available in this installation (plugins included), each with a one-line description.
- **US-06.** As a person using the command line, I want to print the schema and the catalog, to feed a tool or read.

## 3. Acceptance criteria

**Editing**

- [ ] AC-01. `WorkflowDocument.parse(text)` reads a workflow with the `yaml` package's document model, with the
  options the parser uses (core schema, unique keys, strict, exactly one document) and two limits of its own: text
  over 1 MiB is refused before it is parsed, and aliases are capped at 100. `WorkflowDocument.create({ name })`
  returns a minimal document (`version`, `name`, empty `steps`).
- [ ] AC-02. `get(path)`, `set(path, value)`, `remove(path)`, `has(path)` take a path as an array of keys and indexes
  (`['steps', 0, 'role']`). Values are plain JSON (strings, numbers, booleans, null, arrays, objects). A key named
  `__proto__`, `constructor` or `prototype`, a path through a scalar, or a value that is not plain JSON is an error
  naming the path.
- [ ] AC-03. `addStep(step, { after? })`, `removeStep(id)` and `moveStep(id, { after? })` edit the `steps` list by step
  id; `removeStep` does not touch other steps' `depends_on`, and `problems()` reports the dangling reference.
- [ ] AC-04. `toString()` returns the YAML. Anything not edited is byte for byte unchanged: comments, blank lines, key
  order, quoting and indentation. A test sets one field of a commented example and compares the text outside that
  line.
- [ ] AC-05. `problems()` returns the problems of the current text: `{ path, message, severity, line?, column? }`,
  `severity` being `error` or `warning`, `line` and `column` 1-based and present when the path exists in the text.
  Its errors and warnings are exactly those of `indaba validate` for the same text (same parser, same validator).
- [ ] AC-06. A document with problems can still be edited and written: a wizard goes through invalid states.
  Nothing in the editing API rejects a file for being semantically invalid, only for being unsafe (AC-02) or not YAML.
- [ ] AC-07. `parse(text)` of text that is not YAML, has more than one document, or whose root is not a mapping,
  throws with a message; it does not return a half-document.

**Schema**

- [ ] AC-08. `workflowJsonSchema()` returns a JSON Schema (draft 2020-12) of the workflow file: every top-level
  field, role field and step field, their types, enumerated values (decision types, isolation, failure actions,
  `arbiter`, `prompt_additions`, MCP policy), required fields, and a `description` for each taken from the same
  sentence the documentation uses. `indaba schema` prints it.
- [ ] AC-09. The schema states structure only. Rules across fields (a role must exist, a dependency must name a step,
  no cycle, a runner must be registered) are not in it; the schema says so in its top-level `description`, and
  `problems()` is where those come from.
- [ ] AC-10. A conformance test keeps the schema and the parser agreeing: every example workflow and every valid
  fixture passes the schema and the parser; every structurally invalid fixture is rejected by both. A field added to
  the parser without the schema fails the build.

**Catalog**

- [ ] AC-11. `Runner`, `Guard`, `Adjudicator`, `Voter` and prompts may carry a `description`. The built-ins are
  described. The registries list `{ name, description }`.
- [ ] AC-12. `indaba catalog [--json] [--plugin <spec>]` prints what this installation offers: runners, guard types,
  arbiters, voters, prompts, and the enumerated values of the format. `--plugin` loads plugins first, so their
  contributions are listed. The JSON shape is documented and versioned (`"catalog": 1`).
- [ ] AC-13. The catalog function behind it, `catalogOf(bundle)`, is exported so a web or Electron server can call it
  in-process.

**General**

- [ ] AC-14. Every new line is covered by tests; the 85% floor holds.

## 4. Non-goals

- The wizard or any screen. This delivers what a wizard calls.
- Generating the parser, the validator and the schema from one source. The schema is maintained by hand and kept
  honest by AC-10; a single-source refactor would justify its own spec if drift keeps happening.
- Merging, including or templating several files, or editing anything but one workflow file.
- Reading and writing files. `WorkflowDocument` works on text. A GUI that saves a file owns confining the path it
  writes to; the library and the two commands never write a file.
- Undo, history or collaborative editing. A document can be copied with `clone()`, which is all a GUI needs to keep
  its own history.
- Evaluating a plugin's code in a browser. The catalog is produced on the machine that has the plugins, then sent.

## 5. Behaviour on failure

| Situation | Expected behaviour |
| :--- | :--- |
| text that is not YAML | `parse` throws with the position of the first error |
| more than one YAML document | `parse` throws: one workflow per file |
| a path through a scalar, or with a forbidden key | the edit throws naming the path; the document is unchanged |
| a value that is not plain JSON (a function, a Date, a cycle) | the edit throws naming the path; unchanged |
| `removeStep` of an unknown id | throws naming the id |
| `problems()` on a file the parser rejects at the root | one error at path `$` |
| a position cannot be found for a path (the key is absent) | the problem has no `line` or `column` |
| a plugin fails to load for `catalog` | the command exits `1` naming the plugin, as `validate` does |
| the schema and the parser disagree | the conformance test fails the build |

## 6. Security and data handling

A workflow file is input from outside. `WorkflowDocument.parse` uses the parser's `yaml` options and adds a size limit (1 MiB)
and an alias cap (100), so a huge file or an alias bomb is refused before it is expanded. The parser itself has
neither limit today, which is a gap found while writing this spec: `indaba validate` and `indaba run` read whatever
size they are given. Closing it there changes behaviour for very large files, so it is left to its own change. The path-based edit API refuses the keys that would reach an object's
prototype, though it edits a YAML document and not a live JavaScript object. Values are checked to be plain JSON before
they are put into a document, so a function or an object with a hostile `toString` never serialises. The library does
no file or network access and starts no process. Descriptions and names in the catalog come from plugins, which run
with the user's privileges when loaded (as they do for `run`), and are printed after cleaning.

The catalog and the schema contain no secrets: they list names, types and descriptions, never environment values.

## 7. Where it lives

- `@indaba/core`: the optional `description` members on `Runner`, `Guard`, `Adjudicator`, `Voter`, and the registries'
  `describe()` (pure).
- `@indaba/engine`: `WorkflowDocument`, `problems()` with positions (a structured error list in the parser), the
  schema (`workflowJsonSchema`), `catalogOf`. It already depends on `yaml`.
- `indaba` (CLI): `schema` and `catalog`.

## 8. Clarifications

Defaults chosen here, inherited by every consumer:

- The editor's limits (1 MiB, 100 aliases) are stricter than the parser's, which has none. A real workflow is a few
  kilobytes.
- One document model, the `yaml` package's, because it is already a recorded runtime dependency and is the only
  maintained one in the tree that keeps comments. No new runtime dependency.
- The JSON Schema validator used by the conformance test is a **development** dependency only, chosen in the plan
  after a licence check; it does not ship.
- Schema draft 2020-12.
- Paths are arrays, not dotted strings, so a key containing a dot is unambiguous.
- Edits never validate semantics (AC-06): a wizard passes through invalid states, and validation is a separate call.
- Positions are 1-based line and column, as editors show them.
- The catalog carries a `catalog` version number so a front end can detect a shape it does not know.

## Artifacts not written

- `research.md`: the options were weighed in conversation; the one outside fact (that `yaml` keeps comments in its
  document model) is exercised by AC-04's test.
- `data-model.md`: the shapes are in api-surface.md.
- `events.md`: no event and no span attribute is added.
