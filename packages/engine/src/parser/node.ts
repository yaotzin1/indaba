import { IndabaError } from '@indaba/core';
import type { ErrorBag } from './error-bag.js';
import { InputReferenceError, type InterpolationField, type Interpolator } from './interpolator.js';

/** A decoded YAML mapping. `yaml` is asked for Maps so key order and odd keys (`__proto__`, `1`) survive. */
export type YamlMap = ReadonlyMap<unknown, unknown>;

export function isYamlMap(value: unknown): value is YamlMap {
  return value instanceof Map;
}

/** Typed, error-accumulating view over a decoded YAML mapping; messages carry the document path. */
export class Node {
  constructor(
    private readonly data: YamlMap,
    readonly path: string,
    private readonly errors: ErrorBag,
    private readonly interpolator?: Interpolator,
  ) {}

  has(key: string): boolean {
    return this.data.has(key);
  }

  /** Keys of this mapping that are not in `allowed`, in document order. */
  unknownKeys(allowed: readonly string[]): string[] {
    return [...this.data.keys()].map(String).filter((key) => !allowed.includes(key));
  }

  /** How a key is set: `absent` (missing or null), `mapping`, or `other` (a scalar or a list). */
  kind(key: string): 'absent' | 'mapping' | 'other' {
    const value = this.present(key);
    return value === undefined ? 'absent' : isYamlMap(value) ? 'mapping' : 'other';
  }

  /** Absent or null counts as missing. */
  private present(key: string): unknown {
    return this.data.get(key) ?? undefined;
  }

  /** The raw decoded value of a key (absent and null are `undefined`), for a reader that checks it itself. */
  rawValue(key: string): unknown {
    return this.present(key);
  }

  string(
    key: string,
    required = true,
    interpolate: boolean | InterpolationField = false,
  ): string | undefined {
    const value = this.present(key);
    if (value === undefined) {
      if (required) {
        this.errors.add(`${this.path}.${key} is required`);
      }
      return undefined;
    }
    if (typeof value !== 'string' || (required && value.trim() === '')) {
      this.errors.add(`${this.path}.${key} must be a non-empty string`);
      return undefined;
    }
    return interpolate === false
      ? value
      : this.resolve(value, key, interpolate === true ? 'plain' : interpolate);
  }

  /** A goal's text and the text and path inputs it refers to (specs/workflow-inputs, AC-10). */
  goalText(key: string): { readonly text: string | undefined; readonly inputs: readonly string[] } {
    const value = this.present(key);
    if (value === undefined || typeof value !== 'string' || this.interpolator === undefined) {
      return { text: this.string(key, false, false), inputs: [] };
    }
    try {
      const { text, inputs } = this.interpolator.interpolateGoal(value);
      return { text, inputs };
    } catch (error) {
      this.report(error, key, undefined);
      return { text: undefined, inputs: [] };
    }
  }

  int(key: string, fallback: number): number {
    if (!this.has(key)) {
      return fallback;
    }
    const value = this.data.get(key);
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.errors.add(`${this.path}.${key} must be an integer`);
      return fallback;
    }
    return value;
  }

  /** True or false; absent is undefined. Anything else records an error. */
  bool(key: string): boolean | undefined {
    const value = this.present(key);
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'boolean') {
      this.errors.add(`${this.path}.${key} must be true or false`);
      return undefined;
    }
    return value;
  }

  /** A whole number in `min`..`max`, or undefined when absent. Anything else records `message` and gives undefined. */
  boundedInt(key: string, min: number, max: number, message: string): number | undefined {
    const value = this.present(key);
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      this.errors.add(message);
      return undefined;
    }
    return value;
  }

  stringList(key: string, interpolate: boolean | InterpolationField = false): string[] {
    const value = this.present(key);
    if (value === undefined) {
      return [];
    }
    if (!Array.isArray(value)) {
      this.errors.add(`${this.path}.${key} must be a list of strings`);
      return [];
    }
    const out: string[] = [];
    value.forEach((item: unknown, i) => {
      if (typeof item !== 'string') {
        this.errors.add(`${this.path}.${key}[${i}] must be a string`);
        return;
      }
      if (interpolate === 'paths') {
        out.push(...this.expand(item, key, i));
      } else {
        out.push(
          interpolate === false
            ? item
            : (this.resolve(item, key, interpolate === true ? 'plain' : interpolate, i) ?? item),
        );
      }
    });
    return out;
  }

  /**
   * A string, or a non-empty list of strings. Undefined when absent, and when it is malformed (the
   * problem is recorded). An empty string or list is malformed.
   */
  stringOrList(key: string, required = false): string[] | undefined {
    const value = this.present(key);
    if (value === undefined) {
      if (required) {
        this.errors.add(`${this.path}.${key} is required`);
      }
      return undefined;
    }
    const items = Array.isArray(value) ? (value as unknown[]) : [value];
    const out: string[] = [];
    for (const [i, item] of items.entries()) {
      if (typeof item !== 'string' || item.trim() === '') {
        this.errors.add(
          `${this.path}.${key}${Array.isArray(value) ? `[${i}]` : ''} must be a non-empty string`,
        );
        return undefined;
      }
      out.push(item);
    }
    if (out.length === 0) {
      this.errors.add(`${this.path}.${key} must not be an empty list`);
      return undefined;
    }
    if (new Set(out).size !== out.length) {
      this.errors.add(`${this.path}.${key} lists the same runner twice`);
      return undefined;
    }
    return out;
  }

  /** Either a string (returned as `text`) or a mapping (returned as `node`); anything else is an error. */
  stringOrMap(key: string): { readonly text?: string; readonly node?: Node } | undefined {
    const value = this.present(key);
    if (value === undefined) {
      return undefined;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      return { text: value };
    }
    const node = isYamlMap(value) ? this.asNode(value, `${this.path}.${key}`) : undefined;
    if (node === undefined) {
      if (!isYamlMap(value)) {
        this.errors.add(`${this.path}.${key} must be a name or a mapping`);
      }
      return undefined;
    }
    return { node };
  }

  map(key: string): Node | undefined {
    const value = this.present(key);
    return value === undefined ? undefined : this.asNode(value, `${this.path}.${key}`);
  }

  nodeList(key: string): Node[] {
    const value = this.present(key);
    if (value === undefined) {
      return [];
    }
    if (!Array.isArray(value)) {
      this.errors.add(`${this.path}.${key} must be a list`);
      return [];
    }
    const nodes: Node[] = [];
    value.forEach((item: unknown, i) => {
      const node = this.asNode(item, `${this.path}.${key}[${i}]`);
      if (node !== undefined) {
        nodes.push(node);
      }
    });
    return nodes;
  }

  /** Entries in document order. */
  nodeMap(key: string): [string, Node][] {
    const map = this.map(key);
    if (map === undefined) {
      return [];
    }
    const nodes: [string, Node][] = [];
    for (const [name, item] of map.data) {
      const node = this.asNode(item, `${map.path}.${String(name)}`);
      if (node !== undefined) {
        nodes.push([String(name), node]);
      }
    }
    return nodes;
  }

  stringMap(key: string): [string, string][] {
    const map = this.map(key);
    if (map === undefined) {
      return [];
    }
    const out: [string, string][] = [];
    for (const [name, item] of map.data) {
      if (typeof item !== 'string') {
        this.errors.add(`${map.path}.${String(name)} must be a string`);
        continue;
      }
      out.push([String(name), item]);
    }
    return out;
  }

  private asNode(value: unknown, path: string): Node | undefined {
    if (!isYamlMap(value)) {
      this.errors.add(`${path} must be a mapping`);
      return undefined;
    }
    return new Node(value, path, this.errors, this.interpolator);
  }

  private resolve(value: string, key: string, field: InterpolationField, index?: number): string | undefined {
    if (this.interpolator === undefined) {
      return value;
    }
    try {
      return this.interpolator.interpolate(value, field);
    } catch (error) {
      this.report(error, key, index);
      return undefined;
    }
  }

  /** One entry of `input_artifacts` or `outputs`, which a list input may turn into several. */
  private expand(value: string, key: string, index: number): readonly string[] {
    if (this.interpolator === undefined) {
      return [value];
    }
    try {
      return this.interpolator.expand(value);
    } catch (error) {
      this.report(error, key, index);
      return [value];
    }
  }

  private report(error: unknown, key: string, index: number | undefined): void {
    const place = `${this.path}.${key}${index === undefined ? '' : `[${index}]`}`;
    if (error instanceof InputReferenceError) {
      this.errors.add(`${place} ${error.tail}`);
      return;
    }
    if (error instanceof IndabaError) {
      this.errors.add(`${this.path}.${key}: ${error.message}`);
      return;
    }
    throw error;
  }
}
