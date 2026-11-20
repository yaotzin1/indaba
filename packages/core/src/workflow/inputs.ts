/**
 * Workflow inputs (specs/workflow-inputs): what a workflow asks of the person who runs it, and the pure checks of what
 * they answered. Nothing here reads the file system, the clock or the environment, and nothing imports `node:`.
 * Resolving a path through links and hashing the result are the engine's.
 */

/** The five kinds of input. A closed set: a plugin cannot add one (C-12). */
export const InputType = {
  Text: 'text',
  Path: 'path',
  Choice: 'choice',
  Number: 'number',
  Boolean: 'boolean',
} as const;
export type InputType = (typeof InputType)[keyof typeof InputType];

export const PathKind = { File: 'file', Directory: 'directory', Any: 'any' } as const;
export type PathKind = (typeof PathKind)[keyof typeof PathKind];

/**
 * The limits of the format. Design choices that keep a careless or hostile value bounded, not measurements (C-13).
 */
export const INPUT_LIMITS = {
  nameLength: 64,
  descriptionLength: 300,
  textDefault: 2000,
  textMax: 10000,
  listDefault: 20,
  listMax: 100,
  choicesMax: 50,
  choiceLength: 100,
  extensionsMax: 10,
  /** How much of a typed value a message may quote. */
  quoted: 80,
  /** The characters of text and path values one step's Inputs section may hold (AC-21). */
  promptTotal: 50000,
  /** `--input` options in one command. */
  options: 200,
} as const;

interface InputBase {
  /** `[A-Za-z][A-Za-z0-9_-]*`, at most 64 characters. */
  readonly name: string;
  /** Non-empty, at most 300 characters; shown in prompts and forms. */
  readonly description: string;
}

interface ListInput {
  readonly list: boolean;
  /** 1 when the input has no default, otherwise 0. */
  readonly minItems: number;
  /** At most 100; 1 when the input is not a list. */
  readonly maxItems: number;
}

export interface TextInput extends InputBase, ListInput {
  readonly type: 'text';
  readonly maxLength: number;
  readonly multiline: boolean;
  readonly default?: string | readonly string[];
}

export interface PathInput extends InputBase, ListInput {
  readonly type: 'path';
  readonly kind: PathKind;
  readonly mustExist: boolean;
  /** Each like ".md", compared without regard to case; only with `kind: file`. */
  readonly extensions: readonly string[];
  readonly default?: string | readonly string[];
}

export interface ChoiceInput extends InputBase, ListInput {
  readonly type: 'choice';
  readonly choices: readonly string[];
  readonly default?: string | readonly string[];
}

export interface NumberInput extends InputBase {
  readonly type: 'number';
  readonly integer: boolean;
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
  Missing: 'missing',
  Unknown: 'unknown',
  WrongType: 'wrong_type',
  NotAChoice: 'not_a_choice',
  OutOfRange: 'out_of_range',
  TooLong: 'too_long',
  BadCharacters: 'bad_characters',
  TooMany: 'too_many',
  TooFew: 'too_few',
  OutsideDirectory: 'outside_directory',
  NotFound: 'not_found',
  WrongKind: 'wrong_kind',
  WrongExtension: 'wrong_extension',
  Duplicate: 'duplicate',
} as const;
export type InputProblemCode = (typeof InputProblemCode)[keyof typeof InputProblemCode];

export interface InputProblem {
  readonly input: string;
  readonly code: InputProblemCode;
  /** Plain words (spec.md section 9). Quotes at most 80 characters of a value. */
  readonly message: string;
}

/** The answer of a pure check of one raw value. A list input is checked element by element by the caller. */
export type InputCheck<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: InputProblem };

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Whether `name` may name an input. */
export function isInputName(name: string): boolean {
  return name.length <= INPUT_LIMITS.nameLength && NAME_PATTERN.test(name);
}

/** A value as a message may quote it: cut to 80 characters, with control characters shown as spaces. */
export function quoteValue(value: string): string {
  const characters = Array.from(value, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return isControl(code) || isBidirectional(code) ? ' ' : char;
  });
  return characters.length > INPUT_LIMITS.quoted
    ? `${characters.slice(0, INPUT_LIMITS.quoted).join('')}...`
    : characters.join('');
}

function fail<T>(input: string, code: InputProblemCode, message: string): InputCheck<T> {
  return { ok: false, problem: { input, code, message } };
}

const isControl = (code: number): boolean => code < 0x20 || (code >= 0x7f && code <= 0x9f);
const isBidirectional = (code: number): boolean =>
  (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);

/**
 * The first character a value may not hold, with its 1-based position in characters; undefined when it holds none.
 * `newline` and `tab` say which of those two a caller allows.
 */
function firstForbidden(
  value: string,
  allowNewline: boolean,
  allowTab = true,
): { readonly position: number; readonly what: string } | undefined {
  let position = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    position += 1;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
        continue;
      }
      return { position, what: 'a broken character' };
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return { position, what: 'a broken character' };
    }
    if (code === 0x0a && allowNewline) {
      continue;
    }
    if (code === 0x0a) {
      return { position, what: 'a line break, and this input takes a single line' };
    }
    if (code === 0x09 && allowTab) {
      continue;
    }
    if (isControl(code)) {
      return { position, what: 'a hidden control character' };
    }
    if (isBidirectional(code)) {
      return { position, what: 'a text-direction control character' };
    }
  }
  return undefined;
}

const badCharacters = <T>(name: string, found: { position: number; what: string }): InputCheck<T> =>
  fail(
    name,
    InputProblemCode.BadCharacters,
    `"${name}" contains a character that cannot be used (${found.what} at position ${found.position}).`,
  );

/** A text value: line endings become `\n`; control characters, NUL, direction controls and broken characters are refused. */
export function checkTextValue(input: TextInput, raw: string): InputCheck<string> {
  const value = raw.replace(/\r\n?/g, '\n');
  const length = Array.from(value).length;
  if (length > input.maxLength) {
    return fail(
      input.name,
      InputProblemCode.TooLong,
      `"${input.name}" is longer than the ${input.maxLength} characters it may have (it has ${length}).`,
    );
  }
  const found = firstForbidden(value, input.multiline);
  if (found !== undefined) {
    return badCharacters(input.name, found);
  }
  return { ok: true, value };
}

export function checkChoiceValue(input: ChoiceInput, raw: string): InputCheck<string> {
  if (input.choices.includes(raw)) {
    return { ok: true, value: raw };
  }
  return fail(
    input.name,
    InputProblemCode.NotAChoice,
    `"${input.name}" must be one of: ${input.choices.join(', ')}. "${quoteValue(raw)}" is not.`,
  );
}

const NUMERAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
/** The most significant digits a number may have, so the value is the one that was typed (a double holds 15). */
const MAX_DIGITS = 15;

/** A numeral whose number reads back the same and is written without an exponent. */
function holdsExactly(raw: string, value: number): boolean {
  const digits = raw.replace(/^-/, '').replace('.', '').replace(/^0+/, '');
  return digits.length <= MAX_DIGITS && !String(value).includes('e');
}

/** What a number input takes, in words: "a whole number from 1 to 5". */
function numberWords(input: NumberInput): string {
  const kind = input.integer ? 'a whole number' : 'a number';
  if (input.min !== undefined && input.max !== undefined) {
    return `${kind} from ${input.min} to ${input.max}`;
  }
  if (input.min !== undefined) {
    return `${kind} of at least ${input.min}`;
  }
  if (input.max !== undefined) {
    return `${kind} of at most ${input.max}`;
  }
  return kind;
}

/** Whether a number satisfies the declaration's `integer`, `min` and `max`. */
export function numberFits(input: NumberInput, value: number): boolean {
  return (
    Number.isFinite(value) &&
    (!input.integer || Number.isInteger(value)) &&
    (input.min === undefined || value >= input.min) &&
    (input.max === undefined || value <= input.max)
  );
}

/** A decimal numeral with `.` as the separator: no locale, no thousands separator, no exponent, no `NaN`. */
export function checkNumberValue(input: NumberInput, raw: string): InputCheck<number> {
  const parsed = NUMERAL.test(raw) ? Number(raw) : Number.NaN;
  const number = holdsExactly(raw, parsed) ? parsed : Number.NaN;
  if (!numberFits(input, number)) {
    return fail(
      input.name,
      Number.isFinite(number) && (!input.integer || Number.isInteger(number))
        ? InputProblemCode.OutOfRange
        : InputProblemCode.WrongType,
      `"${input.name}" must be ${numberWords(input)}; "${quoteValue(raw)}" is not.`,
    );
  }
  // -0 is written 0 everywhere, so the digest does not depend on how a person typed it.
  return { ok: true, value: number === 0 ? 0 : number };
}

export function checkBooleanValue(input: BooleanInput, raw: string): InputCheck<boolean> {
  if (raw === 'true' || raw === 'false') {
    return { ok: true, value: raw === 'true' };
  }
  return fail(
    input.name,
    InputProblemCode.WrongType,
    `"${input.name}" must be true or false; "${quoteValue(raw)}" is not.`,
  );
}

interface SplitPath {
  /** `''` for a relative path, `/` for a rooted one, `X:` (upper case) for a drive. */
  readonly root: string;
  readonly segments: readonly string[];
  /** The path climbed above where it started (`..` with nothing left to remove). */
  readonly escapes: boolean;
}

/** Separators become `/`; `.` and empty segments go; `..` removes one segment before it. Nothing is touched. */
function splitPath(root: string, rest: string): SplitPath {
  const segments: string[] = [];
  let escapes = false;
  for (const segment of rest.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        escapes = true;
      } else {
        segments.pop();
      }
      continue;
    }
    segments.push(segment);
  }
  return { root, segments, escapes };
}

/** Undefined for a UNC path, a device path, or a drive letter with no root: there is nothing to compare them with. */
function lexical(path: string): SplitPath | undefined {
  const slashed = path.replaceAll('\\', '/');
  if (slashed.startsWith('//')) {
    return undefined;
  }
  const drive = slashed.match(/^([A-Za-z]):(.*)$/s);
  if (drive !== null) {
    const rest = drive[2] ?? '';
    return rest.startsWith('/') ? splitPath(`${(drive[1] ?? '').toUpperCase()}:`, rest) : undefined;
  }
  return slashed.startsWith('/') ? splitPath('/', slashed) : splitPath('', slashed);
}

/** A Windows spelling (a drive letter): compared without regard to case, as the file system does. */
const foldsCase = (root: string): boolean => root.endsWith(':');

/**
 * The lexical part of the path rules (AC-18): the result is relative to the working directory, with `/` and no leading
 * `./` or trailing `/`; `.` is the directory itself. An absolute path is accepted only when `base`, the working
 * directory, is given and the path lies inside it; with nothing to compare against it is refused. A UNC or device path
 * (`\\server\x`, `\\?\x`, `\\.\x`), a drive letter without a root, a path that leaves the directory after the `..`
 * are removed, and one with a hidden control character are refused.
 */
export function normalizeInputPath(input: PathInput, raw: string, base?: string): InputCheck<string> {
  const outside = (): InputCheck<string> =>
    fail(
      input.name,
      InputProblemCode.OutsideDirectory,
      `"${quoteValue(raw)}" is outside the folder the workflow runs in. Choose a ${
        input.kind === PathKind.File ? 'file' : 'folder'
      } inside it.`,
    );
  if (raw.trim() === '') {
    return fail(input.name, InputProblemCode.Missing, `The value for "${input.name}" is empty.`);
  }
  const found = firstForbidden(raw, false, false);
  if (found !== undefined) {
    return badCharacters(input.name, found);
  }
  const split = lexical(raw);
  if (split === undefined) {
    return outside();
  }
  if (split.root === '') {
    return split.escapes ? outside() : { ok: true, value: split.segments.join('/') || '.' };
  }
  const start = base === undefined ? undefined : lexical(base);
  if (start === undefined || start.root === '' || start.root !== split.root.toUpperCase() || split.escapes) {
    return outside();
  }
  const fold = foldsCase(start.root);
  const same = (a: string, b: string): boolean => (fold ? a.toLowerCase() === b.toLowerCase() : a === b);
  const inside =
    split.segments.length >= start.segments.length &&
    start.segments.every((segment, i) => same(segment, split.segments[i] ?? ''));
  return inside
    ? { ok: true, value: split.segments.slice(start.segments.length).join('/') || '.' }
    : outside();
}

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

function limitsOf(input: InputDefinition): Record<string, number | boolean | string> {
  switch (input.type) {
    case 'text':
      return { maxLength: input.maxLength, multiline: input.multiline, ...listLimits(input) };
    case 'path':
      return {
        kind: input.kind,
        mustExist: input.mustExist,
        ...(input.extensions.length > 0 ? { extensions: input.extensions.join(',') } : {}),
        ...listLimits(input),
      };
    case 'choice':
      return listLimits(input);
    case 'number':
      return {
        integer: input.integer,
        ...(input.min !== undefined ? { min: input.min } : {}),
        ...(input.max !== undefined ? { max: input.max } : {}),
      };
    case 'boolean':
      return {};
  }
}

function listLimits(input: ListInput): Record<string, number> {
  return input.list ? { minItems: input.minItems, maxItems: input.maxItems } : {};
}

/** Each declaration in a form a wizard can render, in declaration order. */
export function describeInputs(
  inputs: Readonly<Record<string, InputDefinition>>,
): readonly InputDescription[] {
  return Object.values(inputs).map((input) => ({
    name: input.name,
    type: input.type,
    description: input.description,
    list: 'list' in input && input.list,
    ...(input.type === 'choice' ? { choices: input.choices } : {}),
    limits: limitsOf(input),
    ...(input.default !== undefined ? { default: input.default } : {}),
    hasDefault: input.default !== undefined,
  }));
}

/**
 * The text the digest is taken over (data-model.md): `{"v":1,"inputs":{...}}` with no spaces, one member per input
 * that has a value, keys sorted, so the same inputs give the same text on every machine whatever the declaration order.
 */
export function canonicalInputs(
  inputs: Readonly<Record<string, InputDefinition>>,
  values: Readonly<Record<string, InputValue>>,
): string {
  const members: Record<string, { type: InputType; value: InputValue }> = {};
  for (const name of Object.keys(inputs).sort()) {
    const input = inputs[name];
    const value = values[name];
    if (input !== undefined && Object.hasOwn(values, name) && value !== undefined) {
      members[name] = { type: input.type, value: value === 0 ? 0 : value };
    }
  }
  return JSON.stringify({ v: 1, inputs: members });
}
