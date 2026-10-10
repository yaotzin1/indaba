# API surface contract: Workflow inputs

> **Immutable during stage 6.** Nothing locks this file; it holds because agents hold it. An implementation that
> finds this wrong stops and returns to stage 3; it does not edit this file.
>
> Builds on `specs/workflow-editor` (schema and catalog) and `specs/ruling-channel` (the channel directory and its
> atomic-file rules). Neither is edited here.

## Semver classification

**minor** (the packages are below 1.0). Every addition is optional: a workflow without `inputs` and a caller that passes
no second argument behave exactly as before.

Two things would be a major after 1.0 and are listed under "Defaults introduced or changed": a literal `${{ inputs.`
in an existing goal now means a reference, and `WorkflowDefinition` gains a member.

## Public symbols added

### `@indaba/core`

```ts
/** The five kinds of input. A closed set: a plugin cannot add one. */
export const InputType = { Text: 'text', Path: 'path', Choice: 'choice', Number: 'number', Boolean: 'boolean' } as const;
export type InputType = (typeof InputType)[keyof typeof InputType];

export const PathKind = { File: 'file', Directory: 'directory', Any: 'any' } as const;
export type PathKind = (typeof PathKind)[keyof typeof PathKind];

interface InputBase {
  readonly name: string;               // [A-Za-z][A-Za-z0-9_-]*, at most 64
  readonly description: string;        // non-empty, at most 300
}
interface ListInput {
  readonly list: boolean;              // default false
  readonly minItems: number;           // default 1 without a default, else 0
  readonly maxItems: number;           // default 20, at most 100; 1 when not a list
}

export interface TextInput extends InputBase, ListInput {
  readonly type: 'text';
  readonly maxLength: number;          // default 2000, at most 10000
  readonly multiline: boolean;         // default false
  readonly default?: string | readonly string[];
}
export interface PathInput extends InputBase, ListInput {
  readonly type: 'path';
  readonly kind: PathKind;             // default 'any'
  readonly mustExist: boolean;         // default true
  readonly extensions: readonly string[]; // at most 10, each like ".md"; only with kind 'file'
  readonly default?: string | readonly string[];
}
export interface ChoiceInput extends InputBase, ListInput {
  readonly type: 'choice';
  readonly choices: readonly string[]; // 1 to 50 distinct, each at most 100 characters
  readonly default?: string | readonly string[];
}
export interface NumberInput extends InputBase {
  readonly type: 'number';
  readonly integer: boolean;           // default false
  readonly min?: number;
  readonly max?: number;
  readonly default?: number;
}
export interface BooleanInput extends InputBase {
  readonly type: 'boolean';
  readonly default?: boolean;
}
export type InputDefinition = TextInput | PathInput | ChoiceInput | NumberInput | BooleanInput;

/** A checked value. A path is the stored form: relative, with `/`. */
export type InputValue = string | number | boolean | readonly string[];

export interface ResolvedInputs {
  readonly values: Readonly<Record<string, InputValue>>;
  /** Names that were asked for (prompt, form or channel) rather than given as options or defaults. */
  readonly asked: readonly string[];
  /** SHA-256 of `canonicalInputs(...)`, 64 lowercase hex characters. Computed by the engine. */
  readonly digest: string;
}

export const InputProblemCode = {
  Missing: 'missing', Unknown: 'unknown', WrongType: 'wrong_type', NotAChoice: 'not_a_choice',
  OutOfRange: 'out_of_range', TooLong: 'too_long', BadCharacters: 'bad_characters', TooMany: 'too_many',
  TooFew: 'too_few', OutsideDirectory: 'outside_directory', NotFound: 'not_found', WrongKind: 'wrong_kind',
  WrongExtension: 'wrong_extension', Duplicate: 'duplicate',
} as const;
export type InputProblemCode = (typeof InputProblemCode)[keyof typeof InputProblemCode];

export interface InputProblem {
  readonly input: string;
  readonly code: InputProblemCode;
  /** Plain words, as in spec.md section 9. Quotes at most 80 characters of a value. */
  readonly message: string;
}

/** Pure checks of one raw value. No I/O. A list input is checked element by element by the caller. */
export type InputCheck<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: InputProblem };
export function checkTextValue(input: TextInput, raw: string): InputCheck<string>;
export function checkChoiceValue(input: ChoiceInput, raw: string): InputCheck<string>;
export function checkNumberValue(input: NumberInput, raw: string): InputCheck<number>;
export function checkBooleanValue(input: BooleanInput, raw: string): InputCheck<boolean>;
/** The lexical part of the path rules: separators, `..`, drive letters, UNC and device paths, control characters. */
export function normalizeInputPath(input: PathInput, raw: string): InputCheck<string>;

/** What a wizard or form renders for one input. */
export interface InputDescription {
  readonly name: string;
  readonly type: InputType;
  readonly description: string;
  readonly list: boolean;
  readonly choices?: readonly string[];
  readonly limits: Readonly<Record<string, number | boolean | string>>;
  readonly default?: InputValue;
  readonly hasDefault: boolean;
}
export function describeInputs(inputs: Readonly<Record<string, InputDefinition>>): readonly InputDescription[];

/** The text the digest is taken over (data-model.md). Declaration order is irrelevant: names are sorted. */
export function canonicalInputs(
  inputs: Readonly<Record<string, InputDefinition>>,
  values: Readonly<Record<string, InputValue>>,
): string;
```

Changed in `@indaba/core` (additive):

```ts
export interface WorkflowDefinition {
  // existing members unchanged
  readonly inputs?: Readonly<Record<string, InputDefinition>>;  // absent when the file has no `inputs`
}
export interface StepDefinition {
  // existing members unchanged
  /** Names of the text and path inputs the step's goal refers to; the prompt lists exactly these. Absent when none. */
  readonly goalInputs?: readonly string[];
}
```

### `@indaba/engine`

```ts
export interface InputDeclarations {
  readonly declarations: Readonly<Record<string, InputDefinition>>;
  readonly problems: readonly string[];          // each with its path in the file
}
/** Reads only the `inputs` key. Needs no values; a front end builds its form from this. */
export function readInputDeclarations(source: string): InputDeclarations;

/** Raw values as given: one array per input, with a single element for an input that is not a list. */
export interface SuppliedInputs { readonly values: Readonly<Record<string, readonly string[]>>; }

export interface InputFileSystem {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<{ readonly isFile: boolean; readonly isDirectory: boolean } | undefined>;
  readText(path: string, maxCharacters: number): Promise<string>;   // UTF-8; refuses a longer file
}
export interface ResolveInputsOptions {
  readonly workDir: string;
  readonly fileSystem?: InputFileSystem;         // default: node:fs; tests replace it
  readonly asked?: readonly string[];            // names obtained by asking, recorded in `ResolvedInputs.asked`
}
export type ResolveInputsResult =
  | { readonly ok: true; readonly inputs: ResolvedInputs }
  | { readonly ok: false; readonly problems: readonly InputProblem[]; readonly missing: readonly InputDefinition[] };
/** Checks every value, applies defaults, confines every path, reports every problem at once. */
export function resolveInputs(
  declarations: Readonly<Record<string, InputDefinition>>,
  supplied: SuppliedInputs,
  options: ResolveInputsOptions,
): Promise<ResolveInputsResult>;

export interface ParseOptions {
  /** Resolved values: references expand as in spec.md AC-10. */
  readonly inputs?: ResolvedInputs;
  /** Render every input reference as `<input: name>`; for `validate` and `plan`. Ignored when `inputs` is given. */
  readonly placeholders?: boolean;
}
// WorkflowParser.parse(source: string, options?: ParseOptions): WorkflowDefinition
// WorkflowParser.parseFile(path: string, options?: ParseOptions): Promise<WorkflowDefinition>
// parseWorkflow(source: string, options?: ParseOptions): WorkflowDefinition
// With no options and a file that declares inputs and refers to them: WorkflowValidationError("... needs a value")

/** The fixed sentence that opens the Inputs section; a test pins it. */
export const INPUTS_NOTICE: string;
/** The Inputs section for a step: the listed inputs, fenced and labelled as data. Empty string when none. */
export function buildInputsSection(
  declarations: Readonly<Record<string, InputDefinition>>,
  inputs: ResolvedInputs,
  names: readonly string[],
): string;

// WorkflowEngineOptions gains:
//   readonly inputs?: ResolvedInputs;   // the declarations come from the WorkflowDefinition
```

The channel (stacked on `specs/ruling-channel`, whose directory helpers it reuses):

```ts
export interface PendingInputRequest {
  readonly id: string;
  readonly workflow: string;
  readonly declarations: readonly InputDescription[];
  readonly given: readonly string[];            // names already set
  readonly requestedAt: string;
  readonly pid: number;
}
export function listPendingInputRequests(projectDir: string): Promise<readonly PendingInputRequest[]>;
export function answerInputRequest(projectDir: string, id: string, answer: SuppliedInputs): Promise<void>;
/** Writes a request and waits for its answer; resolves undefined when the signal aborts. */
export function requestInputs(
  projectDir: string,
  request: Omit<PendingInputRequest, 'id' | 'requestedAt' | 'pid'>,
  signal?: AbortSignal,
): Promise<SuppliedInputs | undefined>;
```

### `indaba` (CLI) and `@indaba/tui`

```ts
// Io gains (the binary supplies it when stdin and stdout are terminals; tests replace it):
interface Io {
  readonly askInputs?: (
    declarations: readonly InputDescription[],
    missing: readonly string[],
  ) => Promise<SuppliedInputs | undefined>;       // undefined: the person closed it
}
// packages/cli: terminalInputAsker(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream): Io['askInputs']
// packages/tui:  collectInputs(declarations: readonly InputDescription[], missing: readonly string[]): Promise<SuppliedInputs | undefined>
```

## Workflow fields

| Field | Where | Meaning |
| :--- | :--- | :--- |
| `inputs` | top level | mapping from input name to a declaration; absent means none |
| `inputs.<name>.type` | declaration | `text`, `path`, `choice`, `number` or `boolean` |
| `inputs.<name>.description` | declaration | plain words, at most 300 characters; required |
| `inputs.<name>.default` | declaration | makes the input optional; must satisfy the declaration |
| `inputs.<name>.list` | `text`, `path`, `choice` | the value is a list (default `false`) |
| `inputs.<name>.min_items`, `max_items` | list inputs | bounds on the list (defaults 1 or 0, and 20; at most 100) |
| `inputs.<name>.max_length`, `multiline` | `text` | defaults 2000 (at most 10000), `false` |
| `inputs.<name>.choices` | `choice` | 1 to 50 distinct strings |
| `inputs.<name>.integer`, `min`, `max` | `number` | whole numbers only, bounds |
| `inputs.<name>.kind`, `must_exist`, `extensions` | `path` | `file`, `directory` or `any`; default `true`; at most 10, with `kind: file` |
| `${{ inputs.<name> }}` | `goal`, `input_artifacts`, `outputs` | a reference; an error in `commands` and anywhere else |

## CLI

| Option | Commands | Meaning |
| :--- | :--- | :--- |
| `--input <name>=<value>` | `run`, `plan`, `validate` | repeatable; a list input is repeated; at most 200 in all |
| `--input-file <name>=<path>` | `run` | the value of a `text` input read from a file inside the working directory |

`plan` prints an **Inputs** block (name, type, set, default, missing) and a warning for a declared input no step uses.
`validate` and `plan` need no values. Exit codes are unchanged: a bad or missing input is `2` (`EXIT_USAGE`), a
cancelled form or request is `130`.

## Events and span attributes

| Name | Where | Meaning |
| :--- | :--- | :--- |
| `indaba.inputs.count` | root span attribute | number of declared inputs that have a value |
| `indaba.inputs.digest` | root span attribute | the SHA-256 digest of the resolved inputs |
| `indaba.inputs.asked` | root span attribute | number of inputs obtained by asking |
| `indaba.inputs.invalid_answers` | root span attribute | answer files ignored (channel only) |
| `inputs_resolved` | event-stream record | `{ names, types, digest, asked, values }` where `values` holds `choice`, `number`, `boolean` and `path` values and, for `text`, only `{ length }` |
| `input_requested` | event-stream record | `{ id, names }` (stacked on the channel) |
| `input_answered` | event-stream record | `{ id }` |

The details are in `events.md`.

## Defaults introduced or changed

- **A workflow without `inputs` is unchanged**, in `validate`, `plan`, `run` and every trace.
- **`WorkflowDefinition.inputs` and `StepDefinition.goalInputs` are optional members.** An embedder that builds a
  definition by hand needs no change; one that spreads or serialises a definition sees a new key only when the file has
  inputs.
- **A literal `${{ inputs.<name> }}` in a goal, `input_artifacts` or `outputs` is now a reference.** Before, it was
  passed through as text. If the input is not declared the file now fails validation naming it. This is the one changed
  behaviour; the changelog lists it under "Changed".
- **`parseWorkflow` called with no second argument** behaves as before, except that a file that declares inputs and
  refers to them fails with "needs a value" instead of passing the label through.
- **No new runtime dependency.** Hashing is `node:crypto`, in `@indaba/engine`.
- **Not in the public surface:** the limits (2000, 10000, 20, 100, 50, 50000, 200). They are constants; an engine option
  may raise them and nothing else may.

## Failure contract

| Call | Failure |
| :--- | :--- |
| `readInputDeclarations` | never throws for a bad file; `problems` lists them. A source that is not YAML returns the YAML problem |
| `resolveInputs` | never throws for a bad value; returns `ok: false` with every problem. Throws only for a programming error (an empty `workDir`) |
| `parseWorkflow` | `WorkflowValidationError` with every problem, as today |
| `requestInputs` | resolves `undefined` when the signal aborts; removes its request file |
| `answerInputRequest` | rejects an unknown or expired id, naming it |
