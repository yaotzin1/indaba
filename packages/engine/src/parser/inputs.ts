import {
  type BooleanInput,
  type ChoiceInput,
  checkChoiceValue,
  checkNumberValue,
  checkTextValue,
  INPUT_LIMITS,
  type InputCheck,
  type InputDefinition,
  isInputName,
  type NumberInput,
  normalizeInputPath,
  type PathInput,
  PathKind,
  type TextInput,
  WorkflowValidationError,
} from '@indaba/core';
import { decodeWorkflow } from './decode.js';
import { ErrorBag } from './error-bag.js';
import { isYamlMap, Node } from './node.js';

/** What a front end builds a form from: the declarations, and the problems that kept some out (each with its path). */
export interface InputDeclarations {
  readonly declarations: Readonly<Record<string, InputDefinition>>;
  readonly problems: readonly string[];
}

const TYPES = ['text', 'path', 'choice', 'number', 'boolean'] as const;
const LIST_TYPES: readonly string[] = ['text', 'path', 'choice'];
const COMMON_KEYS = ['type', 'description', 'default'] as const;
const KEYS_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  text: ['max_length', 'multiline', 'list', 'min_items', 'max_items'],
  path: ['kind', 'must_exist', 'extensions', 'list', 'min_items', 'max_items'],
  choice: ['choices', 'list', 'min_items', 'max_items'],
  number: ['integer', 'min', 'max'],
  boolean: [],
};
const PATH_KINDS: readonly string[] = [PathKind.File, PathKind.Directory, PathKind.Any];
const EXTENSION = /^\.[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;

const hasControl = (value: string): boolean =>
  Array.from(value).some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });

interface ListBounds {
  readonly list: boolean;
  readonly minItems: number;
  readonly maxItems: number;
}

/** `list`, `min_items` and `max_items` of a declaration that may be a list (AC-02, AC-05). */
function readList(node: Node, type: string, hasDefault: boolean, errors: ErrorBag): ListBounds {
  const list = LIST_TYPES.includes(type) ? (node.bool('list') ?? false) : false;
  const maxItems =
    node.boundedInt(
      'max_items',
      1,
      INPUT_LIMITS.listMax,
      `${node.path}.max_items must be a whole number from 1 to ${INPUT_LIMITS.listMax}`,
    ) ?? INPUT_LIMITS.listDefault;
  const minItems =
    node.boundedInt(
      'min_items',
      0,
      INPUT_LIMITS.listMax,
      `${node.path}.min_items must be a whole number from 0 to ${INPUT_LIMITS.listMax}`,
    ) ?? (hasDefault ? 0 : 1);
  if (!list) {
    for (const key of ['min_items', 'max_items']) {
      if (node.has(key) && LIST_TYPES.includes(type)) {
        errors.add(`${node.path}.${key} only belongs to an input with list: true`);
      }
    }
    return { list: false, minItems: hasDefault ? 0 : 1, maxItems: 1 };
  }
  if (minItems > maxItems) {
    errors.add(`${node.path}.min_items (${minItems}) is more than max_items (${maxItems})`);
  }
  return { list: true, minItems, maxItems };
}

/** The default of a declaration as a list of raw strings, or the single one; undefined when absent or not shaped right. */
function defaultOf(node: Node, bounds: ListBounds, errors: ErrorBag): readonly string[] | string | undefined {
  const raw = node.rawValue('default');
  if (raw === undefined) {
    return undefined;
  }
  if (bounds.list) {
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
      errors.add(`${node.path}.default must be a list of strings`);
      return undefined;
    }
    return raw as string[];
  }
  if (typeof raw !== 'string') {
    errors.add(`${node.path}.default must be a string`);
    return undefined;
  }
  return raw;
}

/** Checks a default (one string or a list) with the declaration's own rules; the checked form, or undefined. */
function checkedDefault(
  node: Node,
  bounds: ListBounds,
  raw: readonly string[] | string | undefined,
  check: (value: string) => InputCheck<string>,
  errors: ErrorBag,
): readonly string[] | string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const values = typeof raw === 'string' ? [raw] : raw;
  const checked: string[] = [];
  for (const value of values) {
    const result = check(value);
    if (!result.ok) {
      errors.add(`${node.path}.default: ${result.problem.message}`);
      return undefined;
    }
    checked.push(result.value);
  }
  if (bounds.list && (checked.length < bounds.minItems || checked.length > bounds.maxItems)) {
    errors.add(
      `${node.path}.default holds ${checked.length} items, but the input takes ${bounds.minItems} to ${bounds.maxItems}`,
    );
    return undefined;
  }
  return typeof raw === 'string' ? (checked[0] ?? raw) : checked;
}

function readText(node: Node, base: BaseFields, errors: ErrorBag): TextInput {
  const maxLength =
    node.boundedInt(
      'max_length',
      1,
      INPUT_LIMITS.textMax,
      `${node.path}.max_length must be a whole number from 1 to ${INPUT_LIMITS.textMax}`,
    ) ?? INPUT_LIMITS.textDefault;
  const multiline = node.bool('multiline') ?? false;
  const hasDefault = node.rawValue('default') !== undefined;
  const bounds = readList(node, 'text', hasDefault, errors);
  const input: TextInput = { type: 'text', ...base, ...bounds, maxLength, multiline };
  const value = checkedDefault(
    node,
    bounds,
    defaultOf(node, bounds, errors),
    (v) => checkTextValue(input, v),
    errors,
  );
  return value === undefined ? input : { ...input, default: value };
}

function readChoice(node: Node, base: BaseFields, errors: ErrorBag): ChoiceInput | undefined {
  const choices = node.stringList('choices');
  let valid = node.has('choices');
  if (!node.has('choices')) {
    errors.add(`${node.path}.choices is required for a choice input`);
  }
  if (choices.length < 1 || choices.length > INPUT_LIMITS.choicesMax) {
    if (node.has('choices')) {
      errors.add(`${node.path}.choices must list 1 to ${INPUT_LIMITS.choicesMax} choices`);
    }
    valid = false;
  }
  if (new Set(choices).size !== choices.length) {
    errors.add(`${node.path}.choices must not repeat a choice`);
    valid = false;
  }
  choices.forEach((choice, i) => {
    if (choice === '' || Array.from(choice).length > INPUT_LIMITS.choiceLength || hasControl(choice)) {
      errors.add(
        `${node.path}.choices[${i}] must be 1 to ${INPUT_LIMITS.choiceLength} characters with no control character`,
      );
      valid = false;
    }
  });
  const hasDefault = node.rawValue('default') !== undefined;
  const bounds = readList(node, 'choice', hasDefault, errors);
  if (!valid) {
    return undefined;
  }
  const input: ChoiceInput = { type: 'choice', ...base, ...bounds, choices };
  const value = checkedDefault(
    node,
    bounds,
    defaultOf(node, bounds, errors),
    (v) => checkChoiceValue(input, v),
    errors,
  );
  return value === undefined ? input : { ...input, default: value };
}

function readNumber(node: Node, base: BaseFields, errors: ErrorBag): NumberInput {
  const integer = node.bool('integer') ?? false;
  const bound = (key: 'min' | 'max'): number | undefined => {
    const raw = node.rawValue(key);
    if (raw === undefined) {
      return undefined;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      errors.add(`${node.path}.${key} must be a number`);
      return undefined;
    }
    return raw;
  };
  const min = bound('min');
  const max = bound('max');
  if (min !== undefined && max !== undefined && min > max) {
    errors.add(`${node.path}.min (${min}) is more than max (${max})`);
  }
  const input: NumberInput = {
    type: 'number',
    ...base,
    integer,
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
  const raw = node.rawValue('default');
  if (raw === undefined) {
    return input;
  }
  const checked = typeof raw === 'number' ? checkNumberValue(input, String(raw)) : undefined;
  if (checked === undefined || !checked.ok) {
    errors.add(
      `${node.path}.default ${checked === undefined ? 'must be a number' : `is not allowed: ${checked.problem.message}`}`,
    );
    return input;
  }
  return { ...input, default: checked.value };
}

function readBoolean(node: Node, base: BaseFields, errors: ErrorBag): BooleanInput {
  const raw = node.rawValue('default');
  if (raw === undefined) {
    return { type: 'boolean', ...base };
  }
  if (typeof raw !== 'boolean') {
    errors.add(`${node.path}.default must be true or false`);
    return { type: 'boolean', ...base };
  }
  return { type: 'boolean', ...base, default: raw };
}

function readPath(node: Node, base: BaseFields, errors: ErrorBag): PathInput | undefined {
  const kindName = node.string('kind', false) ?? PathKind.Any;
  let valid = true;
  if (!PATH_KINDS.includes(kindName)) {
    errors.add(`${node.path}.kind must be file, directory or any`);
    valid = false;
  }
  const kind = (PATH_KINDS.includes(kindName) ? kindName : PathKind.Any) as PathKind;
  const mustExist = node.bool('must_exist') ?? true;
  const extensions = node.stringList('extensions');
  if (node.has('extensions')) {
    if (kind !== PathKind.File) {
      errors.add(`${node.path}.extensions only belongs to an input with kind: file`);
      valid = false;
    }
    if (extensions.length > INPUT_LIMITS.extensionsMax) {
      errors.add(`${node.path}.extensions lists more than ${INPUT_LIMITS.extensionsMax} extensions`);
      valid = false;
    }
    extensions.forEach((extension, i) => {
      if (!EXTENSION.test(extension)) {
        errors.add(`${node.path}.extensions[${i}] must look like ".md"`);
        valid = false;
      }
    });
  }
  const hasDefault = node.rawValue('default') !== undefined;
  const bounds = readList(node, 'path', hasDefault, errors);
  if (!valid) {
    return undefined;
  }
  const input: PathInput = { type: 'path', ...base, ...bounds, kind, mustExist, extensions };
  const value = checkedDefault(
    node,
    bounds,
    defaultOf(node, bounds, errors),
    (v) => normalizeInputPath(input, v),
    errors,
  );
  return value === undefined ? input : { ...input, default: value };
}

interface BaseFields {
  readonly name: string;
  readonly description: string;
}

/** One declaration; undefined when it has a problem (each is recorded with its path). */
function readDeclaration(name: string, node: Node, errors: ErrorBag): InputDefinition | undefined {
  const before = errors.all().length;
  if (!isInputName(name)) {
    errors.add(
      `${node.path} is not a valid input name: use a letter, then letters, digits, _ or -, at most ${INPUT_LIMITS.nameLength} characters`,
    );
    return undefined;
  }
  const type = node.string('type');
  const known = TYPES.find((candidate) => candidate === type);
  if (type !== undefined && known === undefined) {
    errors.add(`${node.path}.type must be one of ${TYPES.join(', ')}`);
  }
  const description = node.string('description');
  if (description !== undefined && Array.from(description).length > INPUT_LIMITS.descriptionLength) {
    errors.add(`${node.path}.description is longer than ${INPUT_LIMITS.descriptionLength} characters`);
  }
  if (node.has('secret')) {
    errors.add(
      `${node.path}.secret: secrets are not supported as inputs yet. Keep keys in your environment, as for OPENROUTER_API_KEY.`,
    );
  }
  for (const key of node.unknownKeys([
    ...COMMON_KEYS,
    ...(known === undefined ? [] : (KEYS_BY_TYPE[known] ?? [])),
  ])) {
    if (key !== 'secret') {
      errors.add(
        known === undefined
          ? `${node.path}.${key} is not an input setting`
          : `${node.path}.${key} is not a setting of a ${known} input`,
      );
    }
  }
  if (known === undefined || description === undefined) {
    return undefined;
  }
  const base: BaseFields = { name, description };
  let input: InputDefinition | undefined;
  switch (known) {
    case 'text':
      input = readText(node, base, errors);
      break;
    case 'path':
      input = readPath(node, base, errors);
      break;
    case 'choice':
      input = readChoice(node, base, errors);
      break;
    case 'number':
      input = readNumber(node, base, errors);
      break;
    case 'boolean':
      input = readBoolean(node, base, errors);
      break;
  }
  return errors.all().length === before ? input : undefined;
}

/** The `inputs` mapping of a document, in declaration order. Without the key there are none. */
export function parseInputDeclarations(root: Node, errors: ErrorBag): Record<string, InputDefinition> {
  const declarations: Record<string, InputDefinition> = {};
  for (const [name, node] of root.nodeMap('inputs')) {
    const input = readDeclaration(name, node, errors);
    if (input !== undefined) {
      declarations[name] = input;
    }
  }
  return declarations;
}

/**
 * Reads only the `inputs` key of a workflow text; it needs no values and never throws for a bad file (AC-25). A front
 * end builds its form from the declarations; the problems each carry their path in the file.
 */
export function readInputDeclarations(source: string): InputDeclarations {
  let data: unknown;
  try {
    data = decodeWorkflow(source);
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return { declarations: {}, problems: error.problems };
    }
    throw error;
  }
  if (!isYamlMap(data)) {
    return { declarations: {}, problems: ['the document root must be a mapping'] };
  }
  const errors = new ErrorBag();
  const declarations = parseInputDeclarations(new Node(data, '$', errors), errors);
  return { declarations, problems: errors.all() };
}
