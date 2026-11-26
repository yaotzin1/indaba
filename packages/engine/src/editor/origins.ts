import type { OriginMap, OriginPosition, WorkflowDefinition } from '@indaba/core';
import {
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  type Pair,
  parseAllDocuments,
  type Node as YamlNode,
} from 'yaml';
import { YAML_OPTIONS } from '../parser/decode.js';

/** The step keys whose position an explanation can show (specs/plan-explain, AC-02, AC-03). */
const STEP_KEYS = [
  'runner',
  'permissions',
  'isolation',
  'timeout_seconds',
  'stall',
  'on_failure',
  'guards',
  'mcp_policy',
  'decision_type',
  'arbiter',
] as const;

function pairOf(map: YamlNode | null | undefined, key: string): Pair | undefined {
  if (!isMap(map)) {
    return undefined;
  }
  for (const item of map.items) {
    if (isScalar(item.key) && item.key.value === key) {
      return item as Pair;
    }
  }
  return undefined;
}

function childNode(map: YamlNode | null | undefined, key: string): YamlNode | undefined {
  const value = pairOf(map, key)?.value;
  return value === null || value === undefined ? undefined : (value as YamlNode);
}

/**
 * Where each setting of an explanation was written, found by reading the YAML document again with a line counter, as
 * `diagnose` does; the parser and the model are not changed (specs/plan-explain, C-02, AC-12).
 *
 * The map has an entry only for a key that is written **directly** where it is named: a step's own key, a role's key,
 * or a key of `defaults`. A key that arrives by an alias or is missing has no entry, and the explanation then shows its
 * origin without a line, never with a wrong one. The first document is read; a text that is not one workflow gives an
 * empty map (the parser reports it). The workflow is the parsed value of the same text and is used only to skip a step or
 * role the two do not agree on.
 */
export function readOrigins(source: string, workflow: WorkflowDefinition): OriginMap {
  const origins = new Map<string, OriginPosition>();
  const lines = new LineCounter();
  const [doc] = Array.from(parseAllDocuments(source, { ...YAML_OPTIONS, lineCounter: lines }));
  const root = doc?.contents as YamlNode | null | undefined;
  if (doc === undefined || doc.errors.length > 0 || !isMap(root)) {
    return origins;
  }

  const record = (path: string, pair: Pair | undefined): void => {
    const offset = isScalar(pair?.key) ? pair.key.range?.[0] : undefined;
    if (offset !== undefined) {
      const { line, col } = lines.linePos(offset);
      origins.set(path, { line, column: col });
    }
  };

  const steps = childNode(root, 'steps');
  if (isSeq(steps)) {
    steps.items.forEach((item, index) => {
      const id = childNode(item as YamlNode, 'id');
      if (!isScalar(id) || id.value !== workflow.steps[index]?.id) {
        return;
      }
      for (const key of STEP_KEYS) {
        record(`$.steps[${index}].${key}`, pairOf(item as YamlNode, key));
      }
    });
  }

  const roles = childNode(root, 'roles');
  if (isMap(roles)) {
    for (const name of Object.keys(workflow.roles)) {
      const role = childNode(roles, name);
      record(`$.roles.${name}.runner`, pairOf(role, 'runner'));
      record(`$.roles.${name}.permissions`, pairOf(role, 'permissions'));
    }
  }

  const defaults = childNode(root, 'defaults');
  record('$.defaults.permissions', pairOf(defaults, 'permissions'));
  record('$.defaults.mcp_policy', pairOf(defaults, 'mcp_policy'));
  return origins;
}
