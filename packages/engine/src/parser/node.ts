import { IndabaError } from '@indaba/core';
import type { ErrorBag } from './error-bag.js';
import type { Interpolator } from './interpolator.js';

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

  /** Absent or null counts as missing. */
  private present(key: string): unknown {
    return this.data.get(key) ?? undefined;
  }

  string(key: string, required = true, interpolate = false): string | undefined {
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
    return interpolate ? this.resolve(value, key) : value;
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

  stringList(key: string, interpolate = false): string[] {
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
      out.push(interpolate ? (this.resolve(item, key) ?? item) : item);
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

  private resolve(value: string, key: string): string | undefined {
    if (this.interpolator === undefined) {
      return value;
    }
    try {
      return this.interpolator.interpolate(value);
    } catch (error) {
      if (error instanceof IndabaError) {
        this.errors.add(`${this.path}.${key}: ${error.message}`);
        return undefined;
      }
      throw error;
    }
  }
}
