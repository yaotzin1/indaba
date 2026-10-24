import type {
  CatalogEntry,
  CatalogPermissionsView,
  EditorCatalog,
  JsonObject,
  JsonValue,
  WorkflowEdit,
  WorkflowPath,
  WorkflowProblem,
} from '@indaba/core';

/**
 * What the form of a workflow shows, read from the JSON Schema of the format and the catalog (specs/web-app-editing-forms,
 * AC-06 to AC-11). Pure: no React, no request. The schema decides the kind of each field; the catalog and the document
 * decide the choices; nothing here copies the format a second time.
 */

/** One choice of a field. `missing` marks the value the file holds that the choices do not (AC-06). */
export interface Choice {
  readonly value: string;
  readonly description: string;
  readonly missing: boolean;
}

export type FieldKind =
  | { readonly kind: 'text'; readonly multiline: boolean }
  | { readonly kind: 'integer' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'fixed' }
  | { readonly kind: 'choice'; readonly choices: readonly Choice[] }
  | { readonly kind: 'list' }
  | { readonly kind: 'multi'; readonly choices: readonly Choice[] }
  | { readonly kind: 'group'; readonly fields: readonly Field[] }
  /** `runners`: those the step may run on, in order, each with what the catalog says of its levels (AC-16). */
  | { readonly kind: 'permissions'; readonly runners: readonly RunnerLevels[] }
  /** Not rendered: edited in the source view (AC-07). `why` says what it holds. */
  | { readonly kind: 'source'; readonly why: SourceReason };

/** A runner a step may run on, and what each permission level means for it; undefined when the catalog does not say. */
export interface RunnerLevels {
  readonly runner: string;
  readonly levels: CatalogPermissionsView | undefined;
}

export type SourceReason = 'not_in_form' | 'unknown_key' | 'other_shape';

export interface Field {
  readonly key: string;
  readonly path: WorkflowPath;
  /** The schema's sentence for it, when it has one. */
  readonly description: string;
  readonly required: boolean;
  readonly value: JsonValue | undefined;
  readonly kind: FieldKind;
}

/** The fields a form edits in the source view whatever they hold (spec AC-07): their shapes are not a form's yet. */
const SOURCE_ONLY = new Set(['artifacts', 'mcp_servers', 'agent', 'guards']);

/** Where the document says what a schema is: a JSON object. */
type Schema = JsonObject;

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const objectAt = (value: JsonValue | undefined, key: string): JsonObject | undefined => {
  if (!isObject(value)) {
    return undefined;
  }
  const found = Object.hasOwn(value, key) ? value[key] : undefined;
  return isObject(found) ? found : undefined;
};

const listAt = (value: JsonValue | undefined, key: string): readonly JsonValue[] | undefined => {
  if (!isObject(value)) {
    return undefined;
  }
  const found = Object.hasOwn(value, key) ? value[key] : undefined;
  return Array.isArray(found) ? found : undefined;
};

const stringAt = (value: JsonValue | undefined, key: string): string | undefined => {
  if (!isObject(value) || !Object.hasOwn(value, key)) {
    return undefined;
  }
  const found = value[key];
  return typeof found === 'string' ? found : undefined;
};

const valueAt = (value: JsonValue | undefined, key: string): JsonValue | undefined =>
  isObject(value) && Object.hasOwn(value, key) ? value[key] : undefined;

const strings = (value: readonly JsonValue[] | undefined): readonly string[] =>
  (value ?? []).filter((v): v is string => typeof v === 'string');

/** How the parser writes a path: `$`, then `.key` or `[index]`. */
export function pathText(path: WorkflowPath): string {
  return `$${path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${part}`)).join('')}`;
}

/** A schema without its "or null" (the parser takes null as absent), and whether that was there. */
export function unwrap(schema: Schema): Schema {
  const anyOf = listAt(schema, 'anyOf');
  if (anyOf === undefined) {
    return schema;
  }
  const others = anyOf.filter((branch) => !(isObject(branch) && branch.type === 'null'));
  const only = others[0];
  if (others.length === 1 && others.length < anyOf.length && isObject(only)) {
    const description = stringAt(schema, 'description');
    return description === undefined || stringAt(only, 'description') !== undefined
      ? only
      : { ...only, description };
  }
  return schema;
}

/** The JSON type of a value, as a schema names it. */
function typeOf(value: JsonValue): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value;
}

/** The branch of an `anyOf` that fits the value: the first one when there is none yet. */
function branchFor(schema: Schema, value: JsonValue | undefined): Schema | undefined {
  const anyOf = listAt(schema, 'anyOf');
  if (anyOf === undefined) {
    return schema;
  }
  const branches = anyOf.filter(isObject);
  if (value === undefined) {
    return branches[0];
  }
  return branches.find((branch) => branch.type === typeOf(value));
}

/** What the person sees for a field, before the catalog and the document refine it. */
function kindOf(schema: Schema, value: JsonValue | undefined, path: WorkflowPath): FieldKind {
  const branch = branchFor(schema, value);
  if (branch === undefined) {
    return { kind: 'source', why: 'other_shape' };
  }
  const fits = (type: string): boolean => value === undefined || typeOf(value) === type;
  if (Object.hasOwn(branch, 'const')) {
    return { kind: 'fixed' };
  }
  const enumerated = listAt(branch, 'enum');
  if (enumerated !== undefined) {
    if (value !== undefined && typeof value !== 'string') {
      return { kind: 'source', why: 'other_shape' };
    }
    return { kind: 'choice', choices: choicesOf(strings(enumerated), [], value) };
  }
  switch (branch.type) {
    case 'string':
      return fits('string') ? { kind: 'text', multiline: false } : { kind: 'source', why: 'other_shape' };
    case 'integer':
      return fits('integer') ? { kind: 'integer' } : { kind: 'source', why: 'other_shape' };
    case 'boolean':
      return fits('boolean') ? { kind: 'boolean' } : { kind: 'source', why: 'other_shape' };
    case 'array': {
      const items = objectAt(branch, 'items');
      const ofStrings = items !== undefined && items.type === 'string';
      const allStrings =
        value === undefined || (Array.isArray(value) && value.every((v) => typeof v === 'string'));
      return ofStrings && allStrings ? { kind: 'list' } : { kind: 'source', why: 'other_shape' };
    }
    case 'object': {
      const properties = objectAt(branch, 'properties');
      if (properties === undefined || !fits('object')) {
        return { kind: 'source', why: 'other_shape' };
      }
      return { kind: 'group', fields: fieldsOf(branch, value, path) };
    }
    default:
      return { kind: 'source', why: 'other_shape' };
  }
}

/** The fields of a mapping, in the schema's order, then any key the format does not know. */
export function fieldsOf(schema: Schema, value: JsonValue | undefined, path: WorkflowPath): readonly Field[] {
  const properties = objectAt(schema, 'properties') ?? {};
  const required = new Set(strings(listAt(schema, 'required')));
  const fields: Field[] = Object.keys(properties).map((key) => {
    const raw = objectAt(properties, key) ?? {};
    const property = unwrap(raw);
    const own = valueAt(value, key);
    const at = [...path, key];
    return {
      key,
      path: at,
      description: stringAt(property, 'description') ?? '',
      required: required.has(key),
      value: own,
      kind: SOURCE_ONLY.has(key) ? { kind: 'source', why: 'not_in_form' } : kindOf(property, own, at),
    };
  });
  if (isObject(value)) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) {
        fields.push({
          key,
          path: [...path, key],
          description: '',
          required: false,
          value: value[key],
          kind: { kind: 'source', why: 'unknown_key' },
        });
      }
    }
  }
  return fields;
}

/** Choices from names and their lines, with the file's value added and marked when it is not one of them. */
function choicesOf(
  names: readonly string[],
  entries: readonly CatalogEntry[],
  value: JsonValue | undefined,
): readonly Choice[] {
  const described = new Map(entries.map((e) => [e.name, e.description]));
  const choices: Choice[] = names.map((name) => ({
    value: name,
    description: described.get(name) ?? '',
    missing: false,
  }));
  if (typeof value === 'string' && !names.includes(value)) {
    choices.push({ value, description: '', missing: true });
  }
  return choices;
}

/** A list of the file's values as choices: each known name, then the ones the file holds that are not known. */
function multiOf(names: readonly string[], value: JsonValue | undefined): readonly Choice[] {
  const held = Array.isArray(value) ? strings(value) : [];
  return [
    ...names.map((name) => ({ value: name, description: '', missing: false })),
    ...held.filter((v) => !names.includes(v)).map((v) => ({ value: v, description: '', missing: true })),
  ];
}

/** What the document and the catalog know, for the choices of a field. */
export interface Context {
  readonly catalog: EditorCatalog;
  readonly roles: readonly string[];
  readonly stepIds: readonly string[];
}

/** The ids of the steps and the names of the roles of a document. */
export function contextOf(value: JsonObject, catalog: EditorCatalog): Context {
  const steps = listAt(value, 'steps') ?? [];
  return {
    catalog,
    roles: Object.keys(objectAt(value, 'roles') ?? {}),
    stepIds: steps.map((step) => stringAt(step, 'id')).filter((id): id is string => id !== undefined),
  };
}

/** A field with the choices the catalog and the document give (AC-06), by where it is in the file. */
function refine(
  field: Field,
  context: Context,
  stepId: string | undefined,
  runners: readonly RunnerLevels[] = [],
): Field {
  const { kind } = field;
  const [first, , key] = field.path;
  const inStep = first === 'steps' && field.path.length === 3;
  const inRole = first === 'roles' && field.path.length === 3;
  const names = (entries: readonly CatalogEntry[]) => entries.map((e) => e.name);
  if (kind.kind === 'text' && (inStep || inRole) && key === 'runner') {
    const runners = context.catalog.runners;
    return { ...field, kind: { kind: 'choice', choices: choicesOf(names(runners), runners, field.value) } };
  }
  if (kind.kind === 'text' && inStep && key === 'role') {
    return { ...field, kind: { kind: 'choice', choices: choicesOf(context.roles, [], field.value) } };
  }
  if (kind.kind === 'text' && inStep && key === 'arbiter') {
    const arbiters = context.catalog.arbiters;
    return { ...field, kind: { kind: 'choice', choices: choicesOf(names(arbiters), arbiters, field.value) } };
  }
  if (kind.kind === 'text' && inStep && key === 'goal') {
    return { ...field, kind: { kind: 'text', multiline: true } };
  }
  if (kind.kind === 'list' && inStep && key === 'depends_on') {
    const others = context.stepIds.filter((id) => id !== stepId);
    return { ...field, kind: { kind: 'multi', choices: multiOf(others, field.value) } };
  }
  if (kind.kind === 'list' && inStep && key === 'consensus_with') {
    return { ...field, kind: { kind: 'multi', choices: multiOf(context.roles, field.value) } };
  }
  if (kind.kind === 'group' && inStep && key === 'permissions') {
    return { ...field, kind: { kind: 'permissions', runners } };
  }
  if (kind.kind === 'group' && inStep && key === 'on_failure') {
    return {
      ...field,
      kind: {
        kind: 'group',
        fields: kind.fields.map((f) =>
          f.kind.kind === 'text' && f.key === 'target'
            ? { ...f, kind: { kind: 'choice', choices: choicesOf(context.stepIds, [], f.value) } }
            : f,
        ),
      },
    };
  }
  return field;
}

/** The schema of the items of a top-level list or map property (`steps`, `roles`). */
function memberSchema(schema: Schema, key: 'steps' | 'roles'): Schema {
  const property = unwrap(objectAt(objectAt(schema, 'properties'), key) ?? {});
  return (key === 'steps' ? objectAt(property, 'items') : objectAt(property, 'additionalProperties')) ?? {};
}

/** The workflow's own fields: everything at the top but the roles and the steps, which have sections of their own. */
export function headerFields(schema: Schema, value: JsonObject): readonly Field[] {
  return fieldsOf(schema, value, []).filter((f) => f.key !== 'roles' && f.key !== 'steps');
}

export interface Member {
  readonly name: string;
  readonly index: number;
  readonly fields: readonly Field[];
  /** Whether it is a mapping; one that is not (a step written as a string, say) is edited in the source view. */
  readonly mapping: boolean;
}

/** The roles of a document, each with its fields and their choices. */
export function roleMembers(schema: Schema, value: JsonObject, context: Context): readonly Member[] {
  const roles = objectAt(value, 'roles') ?? {};
  const member = memberSchema(schema, 'roles');
  return Object.keys(roles).map((name, index) => {
    const role = roles[name];
    return {
      name,
      index,
      mapping: isObject(role),
      fields: fieldsOf(member, role, ['roles', name]).map((f) => refine(f, context, undefined)),
    };
  });
}

/** The runner names of a value that is one name or a list of names. */
function runnerNames(value: JsonValue | undefined): readonly string[] {
  if (typeof value === 'string') {
    return [value];
  }
  return Array.isArray(value) ? strings(value) : [];
}

/**
 * The runners a step may run on, in order: its own, else its role's, each with what the catalog says of its levels. The
 * form never decides which runner can do what (AC-16): a runner the catalog does not describe has no levels here.
 */
function runnersOf(
  step: JsonValue | undefined,
  roles: JsonObject | undefined,
  catalog: EditorCatalog,
): readonly RunnerLevels[] {
  const own = runnerNames(valueAt(step, 'runner'));
  const role = typeof valueAt(step, 'role') === 'string' ? roles?.[String(valueAt(step, 'role'))] : undefined;
  const names = own.length > 0 ? own : runnerNames(valueAt(role, 'runner'));
  return names.map((runner) => ({
    runner,
    levels: catalog.runners.find((entry) => entry.name === runner)?.permissions,
  }));
}

/** The steps of a document in file order, each with its fields and their choices. */
export function stepMembers(schema: Schema, value: JsonObject, context: Context): readonly Member[] {
  const steps = listAt(value, 'steps') ?? [];
  const member = memberSchema(schema, 'steps');
  return steps.map((step, index) => {
    const id = stringAt(step, 'id');
    const runners = runnersOf(step, objectAt(value, 'roles'), context.catalog);
    return {
      name: id ?? '',
      index,
      mapping: isObject(step),
      fields: fieldsOf(member, step, ['steps', index]).map((f) => refine(f, context, id, runners)),
    };
  });
}

/** Every path a field of the form is shown at, groups' fields included: where a problem can be put. */
export function fieldPaths(fields: readonly Field[]): readonly string[] {
  return fields.flatMap((f) => [
    pathText(f.path),
    ...(f.kind.kind === 'group' ? fieldPaths(f.kind.fields) : []),
  ]);
}

export interface PlacedProblems {
  readonly byField: ReadonlyMap<string, readonly WorkflowProblem[]>;
  readonly byStep: ReadonlyMap<number, readonly WorkflowProblem[]>;
  readonly top: readonly WorkflowProblem[];
}

/** The path one level up: `$.a.b[0]` is `$.a.b`, `$.a.b` is `$.a`; the root has none. */
function parentOf(path: string): string | undefined {
  const cut = Math.max(path.lastIndexOf('.'), path.lastIndexOf('['));
  return cut <= 0 ? undefined : path.slice(0, cut);
}

const STEP_PATH = /^\$\.steps\[(\d+)\]$/;

/** Where each problem is shown (AC-11): at its field or the nearest one above it, else its step, else the top. */
export function placeProblems(
  problems: readonly WorkflowProblem[],
  paths: readonly string[],
): PlacedProblems {
  const known = new Set(paths);
  const byField = new Map<string, WorkflowProblem[]>();
  const byStep = new Map<number, WorkflowProblem[]>();
  const top: WorkflowProblem[] = [];
  for (const problem of problems) {
    let at: string | undefined = problem.path;
    let placed = false;
    while (at !== undefined && !placed) {
      if (known.has(at)) {
        byField.set(at, [...(byField.get(at) ?? []), problem]);
        placed = true;
      } else {
        const step = at.match(STEP_PATH);
        if (step !== null) {
          const index = Number(step[1]);
          byStep.set(index, [...(byStep.get(index) ?? []), problem]);
          placed = true;
        }
      }
      at = parentOf(at);
    }
    if (!placed) {
      top.push(problem);
    }
  }
  return { byField, byStep, top };
}

/** The permissions presets of the parent's C-16, and what is none of them. */
export type Preset = 'none' | 'read_only' | 'folders' | 'full' | 'custom';

/**
 * Which preset a step's permissions are: exactly one, or custom (spec C-04). A missing `terminal` is its default, deny.
 * A block that writes a `level` is a preset only when it is the shape the preset writes (specs/agent-permissions, AC-16);
 * one that does not is read as before.
 */
export function presetOf(permissions: JsonValue | undefined): Preset {
  if (permissions === undefined || permissions === null) {
    return 'none';
  }
  if (
    !isObject(permissions) ||
    Object.keys(permissions).some((k) => k !== 'fs' && k !== 'terminal' && k !== 'level')
  ) {
    return 'custom';
  }
  const level = valueAt(permissions, 'level');
  if (level !== undefined && level !== null && level !== 'read' && level !== 'edit' && level !== 'full') {
    return 'custom';
  }
  const fs = valueAt(permissions, 'fs');
  if (fs !== undefined && fs !== null && !isObject(fs)) {
    return 'custom';
  }
  if (isObject(fs) && Object.keys(fs).some((k) => k !== 'read' && k !== 'write')) {
    return 'custom';
  }
  const read = valueAt(fs, 'read');
  const write = valueAt(fs, 'write');
  const isStrings = (v: JsonValue | undefined): boolean =>
    v === undefined || v === null || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
  if (!isStrings(read) || !isStrings(write)) {
    return 'custom';
  }
  const globs = Array.isArray(write) ? strings(write) : [];
  const terminal = valueAt(permissions, 'terminal');
  if (level === 'full') {
    // `full` names no folders and no terminal rule (AC-03).
    return (fs === undefined || fs === null) && (terminal === undefined || terminal === null)
      ? 'full'
      : 'custom';
  }
  if (level === 'read') {
    return globs.length === 0 && (terminal === undefined || terminal === null || terminal === 'deny')
      ? 'read_only'
      : 'custom';
  }
  if (level === 'edit') {
    return globs.length > 0 &&
      !globs.includes('**') &&
      (terminal === undefined || terminal === null || terminal === 'deny')
      ? 'folders'
      : 'custom';
  }
  if (terminal === 'allow') {
    return globs.length === 1 && globs[0] === '**' ? 'full' : 'custom';
  }
  if (terminal !== undefined && terminal !== null && terminal !== 'deny') {
    return 'custom';
  }
  if (globs.length === 0) {
    return 'read_only';
  }
  return globs.includes('**') ? 'custom' : 'folders';
}

/**
 * Whether a block is shown under a preset's name but has no `level`: the old shape (AC-16). The old Full access
 * (`write: ["**"]`, `terminal: allow`) is one of these, and is not the level `full`: it keeps the guard.
 */
export function isOldStyle(permissions: JsonValue | undefined): boolean {
  const preset = presetOf(permissions);
  return (
    isObject(permissions) &&
    valueAt(permissions, 'level') === undefined &&
    (preset === 'read_only' || preset === 'folders' || preset === 'full')
  );
}

/** The level a preset writes. */
export function levelOfPreset(preset: 'read_only' | 'folders' | 'full'): 'read' | 'edit' | 'full' {
  return preset === 'read_only' ? 'read' : preset === 'folders' ? 'edit' : 'full';
}

/** The globs a step may change, as its permissions list them. */
export function writeGlobs(permissions: JsonValue | undefined): readonly string[] {
  return strings(listAt(objectAt(permissions, 'fs'), 'write'));
}

/**
 * The permissions of a preset, as a whole block, keeping what the step lets its agent read (spec C-04); undefined for
 * "not set", which removes the key. `folders` are the globs of "edit only these folders". The shapes are the ones of
 * AC-16: `{ level: read }`, `{ level: edit, fs: { write } }`, `{ level: full }`.
 */
export function presetValue(
  preset: Exclude<Preset, 'custom'>,
  current: JsonValue | undefined,
  folders: readonly string[],
): JsonObject | undefined {
  if (preset === 'none') {
    return undefined;
  }
  const read = valueAt(objectAt(current, 'fs'), 'read');
  const keepRead = Array.isArray(read) ? { read } : {};
  const hasRead = Object.keys(keepRead).length > 0;
  if (preset === 'full') {
    return { level: 'full' };
  }
  if (preset === 'read_only') {
    return hasRead ? { level: 'read', fs: keepRead } : { level: 'read' };
  }
  return { level: 'edit', fs: { ...keepRead, write: [...folders] } };
}

/**
 * The edits that make a block a preset, one per path, so the rest of the file stays as it was written: the level is
 * set and the keys the new shape forbids are removed (AC-16). A block that is not a mapping is replaced whole.
 */
export function presetEdits(
  preset: Exclude<Preset, 'custom'>,
  current: JsonValue | undefined,
  path: WorkflowPath,
  folders: readonly string[],
): readonly WorkflowEdit[] {
  if (preset === 'none') {
    return [{ op: 'remove', path }];
  }
  if (!isObject(current)) {
    const value = presetValue(preset, current, folders);
    return value === undefined ? [{ op: 'remove', path }] : [{ op: 'set', path, value }];
  }
  const edits: WorkflowEdit[] = [{ op: 'set', path: [...path, 'level'], value: levelOfPreset(preset) }];
  const fs = valueAt(current, 'fs');
  const fsIsMapping = isObject(fs);
  if (preset === 'folders') {
    edits.push(
      fsIsMapping
        ? { op: 'set', path: [...path, 'fs', 'write'], value: [...folders] }
        : { op: 'set', path: [...path, 'fs'], value: { write: [...folders] } },
    );
  } else if (fs !== undefined) {
    const onlyWrite = fsIsMapping && Object.keys(fs).every((k) => k === 'write');
    if (preset === 'full' || !fsIsMapping || onlyWrite) {
      edits.push({ op: 'remove', path: [...path, 'fs'] });
    } else if (valueAt(fs, 'write') !== undefined) {
      edits.push({ op: 'remove', path: [...path, 'fs', 'write'] });
    }
  }
  if (valueAt(current, 'terminal') !== undefined) {
    edits.push({ op: 'remove', path: [...path, 'terminal'] });
  }
  return edits;
}

/** What the catalog says of a level on the runners of a step (AC-17). */
export type LevelCheck =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'refused'; readonly runner: string; readonly note: string }
  | {
      readonly kind: 'ok';
      /** Per runner: whether the folders are only checked after the step, and whether commands are not limited. */
      readonly runners: readonly {
        readonly runner: string;
        readonly checkedAfter: boolean;
        readonly commandsNotLimited: boolean;
      }[];
    };

/**
 * Whether every runner of a step can hold `level`, from the catalog and nowhere else (AC-16, AC-17). A runner the catalog
 * says nothing about (an older server) makes the answer `unknown`, and the form then refuses nothing.
 */
export function checkLevel(runners: readonly RunnerLevels[], level: 'read' | 'edit' | 'full'): LevelCheck {
  if (runners.length === 0 || runners.some((r) => r.levels === undefined)) {
    return { kind: 'unknown' };
  }
  const found: { runner: string; checkedAfter: boolean; commandsNotLimited: boolean }[] = [];
  for (const { runner, levels } of runners) {
    const capability = levels?.[level];
    if (capability === undefined || capability.mode === 'unsupported') {
      return { kind: 'refused', runner, note: capability?.note ?? 'not_offered' };
    }
    found.push({
      runner,
      checkedAfter: capability.mode === 'after' || capability.scope === 'guard',
      commandsNotLimited: capability.note === 'commands_not_limited',
    });
  }
  return { kind: 'ok', runners: found };
}

/** The id of a new step: `step-N` with the smallest N no step has (spec C-05). */
export function nextStepId(ids: readonly string[]): string {
  const taken = new Set(ids);
  let n = 1;
  while (taken.has(`step-${n}`)) {
    n += 1;
  }
  return `step-${n}`;
}

/** Lines of a list field, as the person typed them: trimmed, empty ones dropped. */
export const linesOf = (entry: string): readonly string[] =>
  entry
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

const sameJson = (a: JsonValue | undefined, b: JsonValue | undefined): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export type EntryResult =
  | { readonly kind: 'edit'; readonly edit: WorkflowEdit }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'required' }
  | { readonly kind: 'not_integer' };

/**
 * The edit a person's entry makes (AC-08): `set` its path, `remove` it when an optional field is cleared, nothing when
 * it is unchanged; a required field cannot be cleared and a number field takes whole numbers.
 */
export function entryEdit(field: Field, entry: JsonValue | undefined): EntryResult {
  const cleared = entry === undefined || entry === '' || (Array.isArray(entry) && entry.length === 0);
  if (cleared) {
    if (field.required) {
      return { kind: 'required' };
    }
    return field.value === undefined
      ? { kind: 'unchanged' }
      : { kind: 'edit', edit: { op: 'remove', path: field.path } };
  }
  return sameJson(entry, field.value)
    ? { kind: 'unchanged' }
    : { kind: 'edit', edit: { op: 'set', path: field.path, value: entry } };
}

/** The value of an entry in a number field, or undefined when it is not a whole number. */
export function integerOf(entry: string): number | undefined {
  const trimmed = entry.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** A field's value as the text a text, number or list field starts from. */
export function entryText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (Array.isArray(value)) {
    return strings(value).join('\n');
  }
  return typeof value === 'object' ? '' : String(value);
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The first line at or after `from` (0-based) whose key is `key`, as YAML writes a block mapping key or list item. */
function lineOfKeyFrom(
  lines: readonly string[],
  key: string,
  from: number,
  until: number,
): number | undefined {
  const pattern = new RegExp(`^\\s*(?:-\\s+)?["']?${escapeRegExp(key)}["']?\\s*:`);
  for (let i = from; i < until; i += 1) {
    if (pattern.test(lines[i] ?? '')) {
      return i;
    }
  }
  return undefined;
}

/**
 * The 1-based line where a field's key is written, for "show in the source view" (AC-07), or undefined when the page
 * cannot find it (a flow mapping, a key written another way). A search of the text, not a parse: the page has no YAML
 * reader, and a wrong guess only puts the caret on another line.
 */
export function lineOfPath(
  text: string,
  path: WorkflowPath,
  stepIds: readonly (string | undefined)[],
): number | undefined {
  const lines = text.split('\n');
  const [first, second, ...rest] = path;
  if (typeof first !== 'string') {
    return undefined;
  }
  const top = lineOfKeyFrom(lines, first, 0, lines.length);
  if (top === undefined || second === undefined) {
    return top === undefined ? undefined : top + 1;
  }
  let start = top + 1;
  if (first === 'steps' && typeof second === 'number') {
    // The step begins at the line of its id, the one with this index among the ids that follow `steps:`.
    const id = stepIds[second];
    if (id === undefined) {
      return top + 1;
    }
    const idLine = new RegExp(
      `^\\s*(?:-\\s+)?["']?id["']?\\s*:\\s*["']?${escapeRegExp(id)}["']?\\s*,?\\s*(?:#.*)?$`,
    );
    const found = lines.findIndex((line, i) => i > top && idLine.test(line));
    if (found < 0) {
      return top + 1;
    }
    // A step's keys may come before its id: look from the dash that opens it, if it is just above at a lesser indent.
    const indent = (line: string | undefined): number => (line ?? '').search(/\S|$/);
    const dash = (line: string | undefined): boolean => /^\s*-\s/.test(line ?? '');
    let open = found;
    while (open > top + 1 && !dash(lines[open]) && indent(lines[open - 1]) >= indent(lines[found])) {
      open -= 1;
    }
    if (!dash(lines[open]) && dash(lines[open - 1]) && indent(lines[open - 1]) < indent(lines[found])) {
      open -= 1;
    }
    start = open;
  } else if (typeof second === 'string') {
    const at = lineOfKeyFrom(lines, second, start, lines.length);
    if (at === undefined) {
      return top + 1;
    }
    start = at;
  }
  let line = start;
  for (const part of rest) {
    if (typeof part !== 'string') {
      break;
    }
    const at = lineOfKeyFrom(lines, part, line, lines.length);
    if (at === undefined) {
      break;
    }
    line = at;
  }
  return line + 1;
}
