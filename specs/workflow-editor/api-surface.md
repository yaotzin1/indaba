# API surface contract: Workflow editor, schema and catalog

> Builds on `specs/debate-findings` (the format it describes) and the registries of the three arbiter specs.

## Semver classification

**minor**. New exports and two new commands. Existing interfaces gain **optional** members only (`description`),
which no implementer is forced to write and no caller is forced to read.

## Public symbols added

### `@indaba/core`

```ts
// Optional on each: one line a wizard shows next to the name. Built-ins provide it; a plugin may.
//   Runner.description?: string
//   Guard.description?: string
//   Adjudicator.description?: string   (specs/debate-arbiter, AC-17)
//   Voter.description?: string          (specs/voter-arbiter, AC-13)

export interface Described { readonly name: string; readonly description: string }   // "" when none
```

`AdjudicatorRegistry`, `VoterRegistry` and `PromptRegistry` each gain or already have `describe(): readonly Described[]`.

### `@indaba/engine`

```ts
export type Path = readonly (string | number)[];

export interface Problem {
  readonly path: string;                       // "$.steps[0].role", as the parser writes it
  readonly message: string;
  readonly severity: 'error' | 'warning';
  readonly line?: number;                      // 1-based; absent when the path is not in the text
  readonly column?: number;
}

export class WorkflowDocument {
  static parse(text: string): WorkflowDocument;             // throws on non-YAML, several documents, a non-mapping root
  static create(init: { readonly name: string }): WorkflowDocument;
  clone(): WorkflowDocument;
  has(path: Path): boolean;
  get(path: Path): unknown;                                 // plain JSON
  set(path: Path, value: unknown): void;                    // creates intermediate maps and lists
  remove(path: Path): void;
  addStep(step: Readonly<Record<string, unknown>>, options?: { readonly after?: string }): void;
  removeStep(id: string): void;
  moveStep(id: string, options?: { readonly after?: string }): void;
  problems(options?: { readonly guards?: GuardRegistry; readonly runners?: { has(name: string): boolean } }): readonly Problem[];
  toString(): string;
}

export function workflowJsonSchema(): Readonly<Record<string, unknown>>;   // draft 2020-12

export interface Catalog {
  readonly catalog: 1;
  readonly runners: readonly Described[];
  readonly guards: readonly Described[];
  readonly arbiters: readonly Described[];
  readonly voters: readonly Described[];
  readonly prompts: readonly Described[];
  readonly values: {                                        // the enumerated values of the format
    readonly decisionTypes: readonly string[];
    readonly isolation: readonly string[];
    readonly failureActions: readonly string[];
    readonly mcpPolicies: readonly string[];
    readonly promptAdditions: readonly string[];
  };
}
export function catalogOf(bundle: EngineBundle): Catalog;
```

`WorkflowParser` gains `diagnose(source: string): readonly Problem[]` (errors and warnings, with positions), which
`problems()` and `indaba validate` share; `parse` is unchanged. `EngineBundle` gains the adjudicator, voter and prompt
registries so `catalogOf` can list them.

### `indaba` (CLI)

`indaba schema` and `indaba catalog [--json] [--plugin <spec>]`.

## Workflow schema, CLI, events and attributes

| Surface | Name | Change |
| :--- | :--- | :--- |
| workflow file | none | no change |
| CLI | `schema` | added: prints the JSON Schema |
| CLI | `catalog` | added: prints the catalog; `--json` for machines, `--plugin` repeatable |
| CLI | `validate` | output unchanged (it now goes through `diagnose`) |
| exit codes | `schema`, `catalog` | `0`, `1` when a plugin fails to load, `2` for a usage error |

## Defaults introduced

- Schema draft 2020-12; catalog version `1`. Changing the catalog shape is a major for its readers and bumps `catalog`.
- Problem positions are 1-based.
- A `description` is cut at 200 characters in the catalog.

## Checks

- [ ] `@indaba/core` imports no `node:` module (`architecture.test.ts`)
- [ ] No new runtime dependency (`yaml` is already recorded); the schema checker, if any, is a devDependency with a licence check recorded in the plan
- [ ] Round-trip test: editing one field changes only its line
- [ ] Conformance test: the schema and the parser agree on every example and fixture
- [ ] `docs/workflow-format.md` links the schema; `docs/extending.md` documents `description`; `README.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md` updated
- [ ] No `any`, no `!`, no suppression comment
