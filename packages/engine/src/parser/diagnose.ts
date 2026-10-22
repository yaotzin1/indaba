import { type Document, isMap, isScalar, isSeq, LineCounter, type Pair, type Node as YamlNode } from 'yaml';

/** A path into a workflow file, as keys and indexes: `['steps', 0, 'role']`. */
export type Path = readonly (string | number)[];

/** One problem of a workflow text, placed in it (specs/workflow-editor, AC-05). */
export interface Problem {
  /** The place the sentence is about, as the parser writes paths: `$.steps[0].role`. */
  readonly path: string;
  /** The sentence `indaba validate` prints. */
  readonly message: string;
  readonly severity: 'error' | 'warning';
  /** 1-based; absent only when not even the root of the document could be placed. */
  readonly line?: number;
  readonly column?: number;
}

/** How a path is written in a sentence: `$`, then `.key` or `[index]`. */
export function pathText(path: Path): string {
  return `$${path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${part}`)).join('')}`;
}

/** A leading `$.a.b[0].c` (with an optional `:` after it), as the parser's structural checks begin a sentence. */
const LEADING_PATH = /^\$((?:\.[^\s.[\]:"]+|\[\d+\])*):?(?=\s|$)/;
const PATH_PART = /\.([^\s.[\]:"]+)|\[(\d+)\]/g;

function partsOf(text: string): Path {
  const parts: (string | number)[] = [];
  for (const match of text.matchAll(PATH_PART)) {
    parts.push(match[2] === undefined ? (match[1] ?? '') : Number(match[2]));
  }
  return parts;
}

/** What a sentence about a step goes on to name, mapped to the step's key it is about. */
const STEP_PHRASES: readonly (readonly [RegExp, Path])[] = [
  [/^depends on/, ['depends_on']],
  [/^uses unknown role/, ['role']],
  [/^uses unknown MCP server/, ['mcp']],
  [/^declares commands/, ['commands']],
  [/^uses the shell runner but declares no commands/, ['runner']],
  [/^declares permissions/, ['permissions']],
  [/^sets runner/, ['runner']],
  [/^has an arbiter/, ['arbiter']],
  [/^needs a role to take part/, ['consensus_with']],
];

/** The step a sentence names (`step "build"`, `step id "build"`, `duplicate step id "build"`), and the rest of it. */
const STEP_LABEL = /^(?:duplicate )?step (?:id )?"([^"]*)"\s*(.*)$/s;
const ROLE_LABEL = /^role "([^"]*)"/;
const SERVER_LABEL = /^mcp_servers\.([^\s]+)/;
const FIELD_AFTER = /^([a-z_]+(?:\.[a-z_]+)*)\b/;
const TOP_LEVEL = /^([a-z_]+)\b/;

function keyOf(pair: Pair): unknown {
  return isScalar(pair.key) ? pair.key.value : pair.key;
}

/** The node at a key or index of a map or sequence, or undefined when it is not there. */
function child(node: YamlNode | null | undefined, part: string | number): YamlNode | undefined {
  if (isMap(node) && typeof part === 'string') {
    const pair = node.items.find((item) => keyOf(item) === part);
    if (pair === undefined) {
      return undefined;
    }
    // A key with no value (`role:`) is placed at the key itself.
    return (pair.value as YamlNode | null) ?? (pair.key as YamlNode | null) ?? undefined;
  }
  if (isSeq(node) && typeof part === 'number') {
    return (node.items[part] as YamlNode | null | undefined) ?? undefined;
  }
  return undefined;
}

/** The deepest node along `path` that is in the document: the path's own, or its nearest ancestor's. */
function deepest(doc: Document, path: Path): YamlNode | undefined {
  let node: YamlNode | undefined = (doc.contents as YamlNode | null) ?? undefined;
  for (const part of path) {
    const next = child(node, part);
    if (next === undefined) {
      return node;
    }
    node = next;
  }
  return node;
}

/** The index of the step whose `id` is `id`; the last one, so a duplicate points at the second. */
function stepIndex(doc: Document, id: string): number | undefined {
  const steps = child((doc.contents as YamlNode | null) ?? undefined, 'steps');
  if (!isSeq(steps)) {
    return undefined;
  }
  let found: number | undefined;
  steps.items.forEach((item, i) => {
    const value = child(item as YamlNode, 'id');
    if (isScalar(value) && value.value === id) {
      found = i;
    }
  });
  return found;
}

/** The path a sentence is about, read from how the parser and the validator word it (spec C-02). */
export function pathOfSentence(doc: Document, message: string): Path {
  const leading = message.match(LEADING_PATH);
  if (leading !== null) {
    return partsOf(leading[1] ?? '');
  }
  const step = message.match(STEP_LABEL);
  if (step !== null) {
    const index = stepIndex(doc, step[1] ?? '');
    if (index === undefined) {
      return ['steps'];
    }
    const rest = step[2] ?? '';
    for (const [phrase, key] of STEP_PHRASES) {
      if (phrase.test(rest)) {
        return ['steps', index, ...key];
      }
    }
    const field = rest.match(FIELD_AFTER);
    const fieldPath = field === null ? [] : (field[1] ?? '').split('.');
    // Only a field the step has: "depends on" is a phrase, "on_failure.target" a field.
    if (fieldPath.length > 0 && child(deepest(doc, ['steps', index]), fieldPath[0] ?? '') !== undefined) {
      return ['steps', index, ...fieldPath];
    }
    return ['steps', index];
  }
  const role = message.match(ROLE_LABEL);
  if (role !== null) {
    return ['roles', role[1] ?? ''];
  }
  const server = message.match(SERVER_LABEL);
  if (server !== null) {
    return ['mcp_servers', server[1] ?? ''];
  }
  if (message.startsWith('unsupported version')) {
    return ['version'];
  }
  const top = message.match(TOP_LEVEL);
  if (top !== null && child((doc.contents as YamlNode | null) ?? undefined, top[1] ?? '') !== undefined) {
    return [top[1] ?? ''];
  }
  return [];
}

/** A sentence placed in the document: at its path, else its nearest ancestor, else nowhere. */
export function place(
  doc: Document,
  lines: LineCounter,
  message: string,
  severity: 'error' | 'warning',
): Problem {
  const path = pathOfSentence(doc, message);
  const node = deepest(doc, path);
  const offset = node?.range?.[0];
  if (offset === undefined) {
    return { path: pathText(path), message, severity };
  }
  const { line, col } = lines.linePos(offset);
  return { path: pathText(path), message, severity, line, column: col };
}

export { LineCounter };
