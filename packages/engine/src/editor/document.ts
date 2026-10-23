import {
  type Document,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  type Pair,
  parseAllDocuments,
  Scalar,
  Document as YamlDocument,
  type Node as YamlNode,
} from 'yaml';
import type { GuardRegistry } from '../guard/registry.js';
import type { Path, Problem } from '../parser/diagnose.js';
import { pathText } from '../parser/diagnose.js';
import { WorkflowParser } from '../parser/parser.js';

/** The largest text a document reads, in UTF-8 bytes; a workflow is a few kilobytes (spec, section 8). */
export const MAX_DOCUMENT_BYTES = 1024 * 1024;
/** The most aliases a document expands, so an alias bomb is refused before it grows (spec, section 6). */
export const MAX_ALIASES = 100;
/** How deep a value given to `set` may nest; deeper is refused, so a hostile value cannot exhaust the stack. */
const MAX_VALUE_DEPTH = 64;

/** Keys that would reach an object's prototype in any reader of the result (AC-02). */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** The options every read of a workflow uses (the parser's), plus the editor's alias cap. */
const OPTIONS = { schema: 'core', uniqueKeys: true, strict: true, logLevel: 'silent' } as const;

/** An edit or a parse the document refused: unsafe, not YAML, or naming something that is not there. */
export class WorkflowDocumentError extends Error {
  constructor(
    message: string,
    /** The path the refusal is about, when it is about one. */
    readonly path?: string,
  ) {
    super(message);
    this.name = 'WorkflowDocumentError';
  }
}

interface Parsed {
  readonly doc: Document;
  readonly lines: LineCounter;
  readonly plain: unknown;
}

/** Reads a text as the parser does, refusing what the editor must not hold (AC-01, AC-07). */
function read(text: string): Parsed {
  if (Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new WorkflowDocumentError(`the text is larger than ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MiB`);
  }
  const lines = new LineCounter();
  const docs = Array.from(parseAllDocuments(text, { ...OPTIONS, lineCounter: lines }));
  if (docs.length > 1) {
    throw new WorkflowDocumentError('a workflow file holds exactly one document');
  }
  const doc = docs[0];
  if (doc === undefined) {
    throw new WorkflowDocumentError('the document root must be a mapping');
  }
  const problem = doc.errors[0] ?? doc.warnings[0];
  if (problem !== undefined) {
    throw new WorkflowDocumentError(`invalid YAML: ${problem.message}`);
  }
  if (!isMap(doc.contents)) {
    throw new WorkflowDocumentError('the document root must be a mapping');
  }
  let plain: unknown;
  try {
    plain = doc.toJS({ maxAliasCount: MAX_ALIASES });
  } catch (error) {
    throw new WorkflowDocumentError(
      `the text expands too many aliases (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return { doc, lines, plain };
}

function checkPath(path: Path, what: 'read' | 'edit'): void {
  if (what === 'edit' && path.length === 0) {
    throw new WorkflowDocumentError('an edit needs a path below the root', '$');
  }
  for (const part of path) {
    if (typeof part === 'number') {
      if (!Number.isSafeInteger(part) || part < 0) {
        throw new WorkflowDocumentError(`${String(part)} is not an index`, pathText(path));
      }
    } else if (typeof part !== 'string' || FORBIDDEN_KEYS.has(part)) {
      throw new WorkflowDocumentError(`the key ${JSON.stringify(part)} is not allowed`, pathText(path));
    }
  }
}

/** Throws unless `value` is plain JSON: null, a boolean, a finite number, a string, or arrays and objects of those. */
function checkValue(value: unknown, path: string, depth = 0, seen = new Set<object>()): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new WorkflowDocumentError('a number must be finite', path);
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new WorkflowDocumentError(`a ${typeof value} is not plain JSON`, path);
  }
  if (depth >= MAX_VALUE_DEPTH) {
    throw new WorkflowDocumentError('the value nests too deeply', path);
  }
  if (seen.has(value)) {
    throw new WorkflowDocumentError('the value contains itself', path);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (!(i in value)) {
        throw new WorkflowDocumentError('a list must have no holes', `${path}[${i}]`);
      }
      checkValue(value[i], `${path}[${i}]`, depth + 1, seen);
    }
  } else {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new WorkflowDocumentError('only plain objects are plain JSON', path);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new WorkflowDocumentError('a key must be a string', path);
    }
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new WorkflowDocumentError(`the key ${JSON.stringify(key)} is not allowed`, `${path}.${key}`);
      }
      checkValue((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1, seen);
    }
  }
  seen.delete(value);
}

/** Walks plain data by a path; `undefined` when a step of it is not there (own properties only). */
function walk(plain: unknown, path: Path): { found: boolean; value: unknown; through: string | undefined } {
  let node: unknown = plain;
  for (let i = 0; i < path.length; i += 1) {
    const part = path[i];
    if (Array.isArray(node) && typeof part === 'number') {
      if (part >= node.length) {
        return { found: false, value: undefined, through: undefined };
      }
      node = node[part];
    } else if (
      node !== null &&
      typeof node === 'object' &&
      !Array.isArray(node) &&
      typeof part === 'string'
    ) {
      if (!Object.hasOwn(node, part)) {
        return { found: false, value: undefined, through: undefined };
      }
      node = (node as Record<string, unknown>)[part];
    } else {
      return { found: false, value: undefined, through: pathText(path.slice(0, i)) };
    }
  }
  return { found: true, value: node, through: undefined };
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function keyOf(pair: Pair): unknown {
  return isScalar(pair.key) ? pair.key.value : pair.key;
}

/** The node at a path in the yaml document, or undefined. */
function nodeAt(doc: Document, path: Path): YamlNode | undefined {
  let node: unknown = doc.contents;
  for (const part of path) {
    if (isMap(node) && typeof part === 'string') {
      const pair = node.items.find((item) => keyOf(item) === part);
      node = pair?.value ?? undefined;
    } else if (isSeq(node) && typeof part === 'number') {
      node = node.items[part];
    } else {
      return undefined;
    }
    if (node === undefined || node === null) {
      return undefined;
    }
  }
  return node as YamlNode;
}

function pairAt(doc: Document, path: Path): Pair | undefined {
  const parent = path.length === 0 ? undefined : nodeAt(doc, path.slice(0, -1));
  const key = path[path.length - 1];
  return isMap(parent) && typeof key === 'string'
    ? parent.items.find((item) => keyOf(item) === key)
    : undefined;
}

/** The text of a value as yaml writes it at the start of a line, at indent 0, without a final newline. */
function render(value: unknown, keepType?: Scalar.Type): string {
  const doc = new YamlDocument(value);
  if (isScalar(doc.contents)) {
    if (typeof value === 'string' && value.includes('\n')) {
      // A block scalar cannot sit after a key on one line; a quoted one can.
      doc.contents.type = Scalar.QUOTE_DOUBLE;
    } else if (keepType !== undefined && typeof value === 'string') {
      doc.contents.type = keepType;
    }
  }
  return doc.toString({ lineWidth: 0 }).replace(/\n$/, '');
}

const isCollection = (value: unknown): boolean => value !== null && typeof value === 'object';
const isEmptyCollection = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.length === 0
    : isCollection(value) && Object.keys(value as object).length === 0;

const lineStart = (text: string, offset: number): number => text.lastIndexOf('\n', offset - 1) + 1;
function lineEnd(text: string, offset: number): number {
  const end = text.indexOf('\n', offset);
  return end < 0 ? text.length : end + 1;
}
const indentOf = (text: string, offset: number): number => offset - lineStart(text, offset);
const indented = (block: string, indent: string): string =>
  block
    .split('\n')
    .map((line) => (line === '' ? line : `${indent}${line}`))
    .join('\n');

/** The text after the colon of a pair, up to the start of its value: where a block value begins. */
function colonEnd(text: string, pair: Pair): number | undefined {
  const keyEnd = (pair.key as YamlNode | null)?.range?.[1];
  if (keyEnd === undefined) {
    return undefined;
  }
  const colon = text.indexOf(':', keyEnd);
  return colon < 0 ? undefined : colon + 1;
}

/** Whether only spaces come before `offset` on its line: the place is a block item that owns its lines. */
const ownsLine = (text: string, offset: number): boolean =>
  text.slice(lineStart(text, offset), offset).trim() === '';

/** A text edit: replace `[from, to)` with `insert`. */
interface Splice {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/** The value that, set at a path's first missing part, holds `value` at the rest of it (`[1, 'x']` is `[null, {x}]`). */
function nest(rest: Path, value: unknown): unknown {
  return rest.reduceRight<unknown>(
    (inner, part) =>
      typeof part === 'number' ? [...Array.from({ length: part }, () => null), inner] : { [part]: inner },
    value,
  );
}

const apply = (text: string, s: Splice): string => `${text.slice(0, s.from)}${s.insert}${text.slice(s.to)}`;

/** A value placed after `key:` (or `- `) on a line indented by `indent`: inline for a scalar or `[]`, else a block. */
function afterKey(value: unknown, indent: number): string {
  if (!isCollection(value) || isEmptyCollection(value)) {
    return ` ${render(value)}`;
  }
  return `\n${indented(render(value), ' '.repeat(indent + 2))}`;
}

/** The lines of a sequence item of `value` at `indent` (the column of its dash). */
function seqItem(value: unknown, indent: number): string {
  const pad = ' '.repeat(indent);
  if (!isCollection(value) || isEmptyCollection(value)) {
    return `${pad}- ${render(value)}\n`;
  }
  const [first = '', ...rest] = render(value).split('\n');
  return `${pad}- ${first}\n${rest.map((line) => (line === '' ? '\n' : `${pad}  ${line}\n`)).join('')}`;
}

/** The end of the last line a node's text takes, newline included. */
function nodeLinesEnd(text: string, node: YamlNode): number | undefined {
  const end = node.range?.[1];
  return end === undefined ? undefined : lineEnd(text, Math.max(end - 1, node.range?.[0] ?? 0));
}

const isBlankLine = (line: string): boolean => line.trim() === '';

/** The end of the blank lines that start at `offset` (a line start). */
function blankAfter(text: string, offset: number): number {
  let at = offset;
  while (at < text.length) {
    const end = lineEnd(text, at);
    if (!isBlankLine(text.slice(at, end))) {
      break;
    }
    at = end;
  }
  return at;
}

/** The start of the blank lines that end at `offset` (a line start). */
function blankBefore(text: string, offset: number): number {
  let at = offset;
  while (at > 0) {
    const start = lineStart(text, at - 1);
    if (!isBlankLine(text.slice(start, at))) {
      break;
    }
    at = start;
  }
  return at;
}

/**
 * The text a block sequence item owns: the comment lines right above its dash, its lines, and no blank line after it
 * (a blank line between items is the list's, not the item's). Undefined when the item does not have lines of its own.
 */
function itemBlock(text: string, node: YamlNode): { from: number; to: number } | undefined {
  const start = node.range?.[0];
  if (start === undefined) {
    return undefined;
  }
  const dash = text.lastIndexOf('-', start);
  const nodeEnd = nodeLinesEnd(text, node);
  if (
    dash < 0 ||
    nodeEnd === undefined ||
    !ownsLine(text, dash) ||
    text.slice(dash + 1, start).trim() !== ''
  ) {
    return undefined;
  }
  let from = lineStart(text, dash);
  while (from > 0) {
    const above = lineStart(text, from - 1);
    if (!text.slice(above, from).trim().startsWith('#')) {
      break;
    }
    from = above;
  }
  const dashEnd = lineEnd(text, dash);
  let to = Math.max(nodeEnd, dashEnd);
  while (to > dashEnd) {
    const last = lineStart(text, to - 1);
    if (!isBlankLine(text.slice(last, to))) {
      break;
    }
    to = last;
  }
  return { from, to };
}

function blocksOf(text: string, seq: YamlNode): { from: number; to: number }[] | undefined {
  if (!isSeq(seq) || seq.flow === true) {
    return undefined;
  }
  const blocks: { from: number; to: number }[] = [];
  for (const item of seq.items) {
    const block = itemBlock(text, item as YamlNode);
    if (block === undefined) {
      return undefined;
    }
    blocks.push(block);
  }
  return blocks;
}

/** Whether the list puts a blank line between its items; new and moved items follow it. */
function separated(text: string, blocks: readonly { from: number; to: number }[]): boolean {
  for (let i = 0; i + 1 < blocks.length; i += 1) {
    const a = blocks[i];
    const b = blocks[i + 1];
    if (a !== undefined && b !== undefined && text.slice(a.to, b.from) !== '') {
      return true;
    }
  }
  return false;
}

/** The splice that removes item `index` of a block list with more than one item, and the blank lines it separated. */
function removeItem(text: string, seq: YamlNode): (index: number) => Splice | undefined {
  return (index) => {
    const blocks = blocksOf(text, seq);
    const block = blocks?.[index];
    if (blocks === undefined || block === undefined) {
      return undefined;
    }
    return index < blocks.length - 1
      ? { from: block.from, to: blankAfter(text, block.to), insert: '' }
      : { from: blankBefore(text, block.from), to: block.to, insert: '' };
  };
}

/** The splice that puts `item` (whole lines) as item `index` of a block list of at least one item. */
function insertItem(
  text: string,
  seq: YamlNode,
  index: number,
  item: string,
  /** The list's style when it is known from before (a move reads it before it takes an item out). */
  blankBetween?: boolean,
): Splice | undefined {
  const blocks = blocksOf(text, seq);
  if (blocks === undefined || blocks.length === 0) {
    return undefined;
  }
  const sep = (blankBetween ?? separated(text, blocks)) ? '\n' : '';
  const lines = item.endsWith('\n') ? item : `${item}\n`;
  const before = blocks[index];
  if (before !== undefined) {
    return { from: before.from, to: before.from, insert: `${lines}${sep}` };
  }
  const last = blocks[blocks.length - 1];
  if (last === undefined) {
    return undefined;
  }
  const lead = last.to === text.length && !text.endsWith('\n') ? '\n' : '';
  return { from: last.to, to: last.to, insert: `${lead}${sep}${lines}` };
}

/**
 * A workflow file held as its text, edited by path (specs/workflow-editor, AC-01 to AC-07). An edit changes only the
 * text it is about: every byte outside it (comments, blank lines, key order, quoting, indentation) stays as it was. Each
 * edit is checked by reading the new text back; an edit the text splice cannot make exactly is made through the yaml
 * document model instead, which keeps comments and order but may respace the file.
 */
export class WorkflowDocument {
  private text: string;
  private parsed: Parsed;

  private constructor(text: string, parsed: Parsed) {
    this.text = text;
    this.parsed = parsed;
  }

  /** Reads a workflow text. Throws on text that is not YAML, holds several documents, or whose root is not a mapping. */
  static parse(text: string): WorkflowDocument {
    return new WorkflowDocument(text, read(text));
  }

  /** A minimal workflow: `version`, `name` and no steps. */
  static create(init: { readonly name: string }): WorkflowDocument {
    if (typeof init.name !== 'string') {
      throw new WorkflowDocumentError('a name is a string', '$.name');
    }
    return WorkflowDocument.parse(
      `version: "${WorkflowParser.SUPPORTED_VERSION}"\nname: ${render(init.name)}\nsteps: []\n`,
    );
  }

  clone(): WorkflowDocument {
    return new WorkflowDocument(this.text, this.parsed);
  }

  has(path: Path): boolean {
    checkPath(path, 'read');
    return walk(this.parsed.plain, path).found;
  }

  /** The plain JSON at a path; `undefined` when it is not there. */
  get(path: Path): unknown {
    checkPath(path, 'read');
    const { found, value } = walk(this.parsed.plain, path);
    return found ? structuredClone(value) : undefined;
  }

  /** Sets a path to a plain JSON value, creating the maps and lists on the way (a string key a map, a number a list). */
  set(path: Path, value: unknown): void {
    checkPath(path, 'edit');
    const at = pathText(path);
    checkValue(value, at);
    const through = this.scalarOnTheWay(path);
    if (through !== undefined) {
      throw new WorkflowDocumentError(`${through} is a value, not a map or a list`, at);
    }
    const parent = walk(this.parsed.plain, path.slice(0, -1));
    const index = path[path.length - 1];
    if (
      parent.found &&
      Array.isArray(parent.value) &&
      typeof index === 'number' &&
      index > parent.value.length
    ) {
      // A list grows by one at its end; a gap would fill with nulls nobody asked for.
      throw new WorkflowDocumentError(
        `the list has ${parent.value.length} items, so ${index} is past its end`,
        at,
      );
    }
    this.commit(
      this.spliceSet(path, value),
      () => {
        const back = walk(this.parsed.plain, path);
        return back.found && equal(back.value, value);
      },
      (doc) => doc.setIn(path, doc.createNode(value)),
    );
  }

  /** Removes what is at a path. Throws when nothing is there. */
  remove(path: Path): void {
    checkPath(path, 'edit');
    if (!walk(this.parsed.plain, path).found) {
      throw new WorkflowDocumentError('there is nothing at this path', pathText(path));
    }
    const parentPath = path.slice(0, -1);
    const before = walk(this.parsed.plain, parentPath).value;
    const index = path[path.length - 1];
    const expected = Array.isArray(before)
      ? before.filter((_, i) => i !== index)
      : Object.fromEntries(Object.entries(before as Record<string, unknown>).filter(([k]) => k !== index));
    this.commit(
      this.spliceRemove(path),
      () => equal(walk(this.parsed.plain, parentPath).value, expected),
      (doc) => {
        doc.deleteIn(path);
      },
    );
  }

  /** Adds a step after the step `after`, or at the end. */
  addStep(step: Readonly<Record<string, unknown>>, options: { readonly after?: string } = {}): void {
    checkValue(step, '$.steps[]');
    const steps = this.stepList();
    const index = options.after === undefined ? steps.length : this.indexOfStep(options.after) + 1;
    this.insertStep(step, index);
  }

  /** Removes the step `id`. Other steps' `depends_on` is not touched; `problems()` reports what dangles (AC-03). */
  removeStep(id: string): void {
    this.remove(['steps', this.indexOfStep(id)]);
  }

  /** Moves the step `id` after the step `after`, or to the front, with its text (comments included) unchanged. */
  moveStep(id: string, options: { readonly after?: string } = {}): void {
    const from = this.indexOfStep(id);
    if (options.after === id) {
      throw new WorkflowDocumentError('a step cannot move after itself', `$.steps[${from}]`);
    }
    const target = options.after === undefined ? -1 : this.indexOfStep(options.after);
    const steps = this.stepList();
    const value = steps[from] as Record<string, unknown>;
    const order = steps.filter((_, i) => i !== from);
    const to = target < 0 ? 0 : (target > from ? target - 1 : target) + 1;
    order.splice(to, 0, value);
    this.commit(
      this.spliceMove(from, to),
      () => equal(walk(this.parsed.plain, ['steps']).value, order),
      (doc) => {
        const list = doc.getIn(['steps'], true);
        if (isSeq(list)) {
          const [item] = list.items.splice(from, 1);
          list.items.splice(to, 0, item);
        }
      },
    );
  }

  /** The problems of the current text, as `indaba validate` reports them, each placed (AC-05). */
  problems(
    options: { readonly guards?: GuardRegistry; readonly runners?: { has(name: string): boolean } } = {},
  ): readonly Problem[] {
    return new WorkflowParser(options.guards, undefined, options.runners).diagnose(this.text);
  }

  toString(): string {
    return this.text;
  }

  // ---------- internals ----------

  private stepList(): readonly unknown[] {
    const steps = walk(this.parsed.plain, ['steps']).value;
    if (steps === undefined || steps === null) {
      return [];
    }
    if (!Array.isArray(steps)) {
      throw new WorkflowDocumentError('steps is not a list', '$.steps');
    }
    return steps;
  }

  private indexOfStep(id: string): number {
    const index = this.stepList().findIndex(
      (step) => step !== null && typeof step === 'object' && (step as Record<string, unknown>).id === id,
    );
    if (index < 0) {
      throw new WorkflowDocumentError(`no step has the id ${JSON.stringify(id)}`, '$.steps');
    }
    return index;
  }

  private insertStep(step: Readonly<Record<string, unknown>>, index: number): void {
    if (!walk(this.parsed.plain, ['steps']).found) {
      this.set(['steps'], [step]);
      return;
    }
    const steps = this.stepList();
    const expected = [...steps.slice(0, index), step, ...steps.slice(index)];
    this.commit(
      this.spliceInsert(['steps'], index, step),
      () => equal(walk(this.parsed.plain, ['steps']).value, expected),
      (doc) => {
        const list = doc.getIn(['steps'], true);
        if (isSeq(list)) {
          list.items.splice(index, 0, doc.createNode(step));
        } else {
          doc.setIn(['steps'], doc.createNode(expected));
        }
      },
    );
  }

  /** The first part of `path` that is a scalar in the document, as a path; undefined when the way is open. */
  private scalarOnTheWay(path: Path): string | undefined {
    for (let i = 1; i < path.length; i += 1) {
      const { found, value } = walk(this.parsed.plain, path.slice(0, i));
      if (!found) {
        return undefined;
      }
      const next = path[i];
      const fits =
        (typeof next === 'number' && Array.isArray(value)) ||
        (typeof next === 'string' && value !== null && typeof value === 'object' && !Array.isArray(value));
      if (!fits) {
        return pathText(path.slice(0, i));
      }
    }
    return undefined;
  }

  /**
   * Applies a splice, reads the text back and checks it says what the edit meant; when there is no splice, or its
   * result reads wrong, makes the edit on the yaml document model instead. Nothing changes if both fail.
   */
  private commit(splice: Splice | undefined, check: () => boolean, model: (doc: Document) => void): void {
    const before = { text: this.text, parsed: this.parsed };
    if (splice !== undefined) {
      const next = apply(this.text, splice);
      try {
        this.parsed = read(next);
        this.text = next;
        if (check()) {
          return;
        }
      } catch {
        // Fall through to the document model.
      }
      this.text = before.text;
      this.parsed = before.parsed;
    }
    const doc = this.parsed.doc.clone();
    model(doc);
    const next = doc.toString({ lineWidth: 0 });
    try {
      this.parsed = read(next);
      this.text = next;
      if (check()) {
        return;
      }
    } catch {
      // Report below.
    }
    this.text = before.text;
    this.parsed = before.parsed;
    throw new WorkflowDocumentError('the edit could not be made', '$');
  }

  /** The splice that sets `path` to `value`, or undefined when only the model can do it. */
  private spliceSet(path: Path, value: unknown): Splice | undefined {
    const { doc } = this.parsed;
    const text = this.text;
    const existing = nodeAt(doc, path);
    const key = path[path.length - 1];
    if (existing !== undefined && existing.range !== undefined && existing.range !== null) {
      const [start, end] = existing.range;
      if (isScalar(existing) && !isCollection(value)) {
        return { from: start, to: end, insert: render(value, existing.type) };
      }
      // A collection, or a value becoming one: replace the value after its key. In a list, the model does it.
      if (typeof key !== 'string') {
        return undefined;
      }
      const pair = pairAt(doc, path);
      const after = pair === undefined ? undefined : colonEnd(text, pair);
      const keyStart = (pair?.key as YamlNode | null)?.range?.[0];
      if (after === undefined || keyStart === undefined) {
        return undefined;
      }
      const insert = afterKey(value, indentOf(text, keyStart));
      const block = (isMap(existing) || isSeq(existing)) && existing.flow !== true;
      if (block) {
        // A block collection takes whole lines; the new value takes them.
        const close = nodeLinesEnd(text, existing);
        return close === undefined ? undefined : { from: after, to: close, insert: `${insert}\n` };
      }
      return { from: after, to: end, insert };
    }
    const parentPath = path.slice(0, -1);
    const parent = nodeAt(doc, parentPath);
    if (parent === undefined) {
      // Create the missing containers on the way: set the first missing one to the value nested inside it.
      for (let i = path.length - 1; i > 0; i -= 1) {
        if (walk(this.parsed.plain, path.slice(0, i)).found) {
          return this.spliceSet(path.slice(0, i + 1), nest(path.slice(i + 1), value));
        }
      }
      return this.spliceSet(path.slice(0, 1), nest(path.slice(1), value));
    }
    if (isMap(parent) && typeof key === 'string') {
      return this.spliceAddKey(parentPath, parent, key, value);
    }
    if (isSeq(parent) && typeof key === 'number' && key === parent.items.length) {
      return this.spliceInsert(parentPath, key, value);
    }
    return undefined;
  }

  /** The splice that adds `key: value` at the end of a block map. */
  private spliceAddKey(mapPath: Path, map: YamlNode, key: string, value: unknown): Splice | undefined {
    const text = this.text;
    if (!isMap(map)) {
      return undefined;
    }
    const line = (indent: number): string =>
      `${' '.repeat(indent)}${render(key)}:${afterKey(value, indent)}\n`;
    const last = map.items[map.items.length - 1];
    // An empty map is always written `{}`, a flow map, so this comes before flow maps go to the model.
    if (last === undefined) {
      // An empty `{}` after a key: replace it with a block of one key.
      const pair = pairAt(this.parsed.doc, mapPath);
      const after = pair === undefined ? undefined : colonEnd(text, pair);
      const keyStart = (pair?.key as YamlNode | null)?.range?.[0];
      const end = map.range?.[1];
      if (after === undefined || keyStart === undefined || end === undefined) {
        return undefined;
      }
      const indent = indentOf(text, keyStart) + 2;
      return { from: after, to: end, insert: `\n${line(indent).replace(/\n$/, '')}` };
    }
    if (map.flow === true) {
      return undefined;
    }
    const firstKey = (map.items[0]?.key as YamlNode | null)?.range?.[0];
    const lastValue = (last.value as YamlNode | null) ?? (last.key as YamlNode | null);
    const lastEnd = lastValue === null ? undefined : nodeLinesEnd(text, lastValue);
    if (firstKey === undefined || lastEnd === undefined) {
      return undefined;
    }
    // A map that is the first thing after a dash (`- id: a`) is indented at its first key, which is what we want.
    const indent = indentOf(text, firstKey);
    const at = lastEnd === text.length && !text.endsWith('\n') ? text.length : lastEnd;
    const lead = at === text.length && !text.endsWith('\n') ? '\n' : '';
    return { from: at, to: at, insert: `${lead}${line(indent)}` };
  }

  /** The splice that inserts `value` as item `index` of a block sequence (or of `[]`). */
  private spliceInsert(seqPath: Path, index: number, value: unknown): Splice | undefined {
    const text = this.text;
    const seq = nodeAt(this.parsed.doc, seqPath);
    if (!isSeq(seq)) {
      return undefined;
    }
    if (seq.items.length === 0 || seq.flow === true) {
      if (seq.items.length > 0) {
        return undefined;
      }
      // `steps: []` becomes a block with one item.
      const pair = pairAt(this.parsed.doc, seqPath);
      const after = pair === undefined ? undefined : colonEnd(text, pair);
      const keyStart = (pair?.key as YamlNode | null)?.range?.[0];
      const end = seq.range?.[1];
      if (after === undefined || keyStart === undefined || end === undefined) {
        return undefined;
      }
      const item = seqItem(value, indentOf(text, keyStart) + 2).replace(/\n$/, '');
      return { from: after, to: end, insert: `\n${item}` };
    }
    const first = seq.items[0] as YamlNode | undefined;
    const firstStart = first?.range?.[0];
    if (first === undefined || firstStart === undefined) {
      return undefined;
    }
    const dash = text.lastIndexOf('-', firstStart);
    if (dash < 0 || !ownsLine(text, dash)) {
      return undefined;
    }
    return insertItem(text, seq, index, seqItem(value, indentOf(text, dash)));
  }

  /** The splice that removes what is at `path`, or undefined when only the model can do it. */
  private spliceRemove(path: Path): Splice | undefined {
    const { doc } = this.parsed;
    const text = this.text;
    const parentPath = path.slice(0, -1);
    const parent = nodeAt(doc, parentPath);
    const key = path[path.length - 1];
    const only = (isMap(parent) || isSeq(parent)) && parent.items.length === 1;
    if (only && parentPath.length > 0 && !(parent as { flow?: boolean }).flow) {
      // The last entry goes: the collection becomes `[]` or `{}` after its key.
      const pair = pairAt(doc, parentPath);
      const after = pair === undefined ? undefined : colonEnd(text, pair);
      const end = parent === undefined ? undefined : nodeLinesEnd(text, parent);
      if (after === undefined || end === undefined) {
        return undefined;
      }
      return { from: after, to: end, insert: `${isSeq(parent) ? ' []' : ' {}'}\n` };
    }
    if (isSeq(parent) && typeof key === 'number' && parent.flow !== true) {
      return removeItem(text, parent)(key);
    }
    if (isMap(parent) && typeof key === 'string' && parent.flow !== true) {
      const pair = parent.items.find((item) => keyOf(item) === key);
      const keyStart = (pair?.key as YamlNode | null)?.range?.[0];
      const valueNode = (pair?.value as YamlNode | null) ?? (pair?.key as YamlNode | null);
      const end = valueNode === null || valueNode === undefined ? undefined : nodeLinesEnd(text, valueNode);
      if (keyStart === undefined || end === undefined || !ownsLine(text, keyStart)) {
        return undefined;
      }
      return { from: lineStart(text, keyStart), to: end, insert: '' };
    }
    return undefined;
  }

  /** Moves step `from`, with its own lines, to place `to` of the list without it: one splice over the whole text. */
  private spliceMove(from: number, to: number): Splice | undefined {
    const text = this.text;
    const seq = nodeAt(this.parsed.doc, ['steps']);
    const blocks = seq === undefined ? undefined : blocksOf(text, seq);
    const block = blocks?.[from];
    if (seq === undefined || blocks === undefined || block === undefined) {
      return undefined;
    }
    if (blocks.length === 1 || from === to) {
      return { from: 0, to: 0, insert: '' };
    }
    const removal = removeItem(text, seq)(from);
    if (removal === undefined) {
      return undefined;
    }
    const without = apply(text, removal);
    let reduced: Parsed;
    try {
      reduced = read(without);
    } catch {
      return undefined;
    }
    const seqWithout = nodeAt(reduced.doc, ['steps']);
    const insertion =
      seqWithout === undefined
        ? undefined
        : insertItem(without, seqWithout, to, text.slice(block.from, block.to), separated(text, blocks));
    return insertion === undefined
      ? undefined
      : { from: 0, to: text.length, insert: apply(without, insertion) };
  }
}
