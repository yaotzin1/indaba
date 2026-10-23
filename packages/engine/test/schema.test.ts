import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DecisionType, FailureAction, Isolation, McpPolicy, WorkflowValidationError } from '@indaba/core';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { WorkflowParser, WorkflowValidator, workflowJsonSchema } from '../src/index.js';

/** specs/workflow-editor, T6 and T7: the schema states the structure the parser reads, and they agree (AC-10). */

const examples = fileURLToPath(new URL('../../../examples', import.meta.url));

/** The parser with its rules across fields switched off: what remains is its structural reading. */
class StructureOnly extends WorkflowValidator {
  override validate(): string[] {
    return [];
  }
}
const structural = new WorkflowParser(undefined, new StructureOnly());

function parserAccepts(text: string): boolean {
  try {
    structural.parse(text);
    return true;
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return false;
    }
    throw error;
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
const check = ajv.compile(workflowJsonSchema());
const schemaAccepts = (text: string): boolean =>
  check(parse(text, { schema: 'core', uniqueKeys: true, strict: true }) as unknown);

const head = 'version: "1.0"\nname: x\n';
const step = (lines: string): string => `${head}steps:\n  - id: a\n${lines}`;

/** Files the parser reads without a structural error. Many break a rule across fields, which the schema leaves out. */
const VALID: Readonly<Record<string, string>> = {
  minimal: `${head}steps:\n  - id: a\n    runner: shell\n    commands: [x]\n`,
  nullsAreAbsent: step(
    '    role:\n    goal:\n    depends_on:\n    guards:\n    isolation:\n    mcp_policy:\n',
  ),
  runnerList: step('    runner: [acp, openrouter]\n'),
  agentPreset: step('    runner: acp\n    agent: claude\n'),
  agentCommand: step('    runner: acp\n    agent:\n      command: [my-agent, --serve]\n      auth: oauth\n'),
  agentEmptyPreset: step('    runner: acp\n    agent:\n      preset: ""\n'),
  permissions: step(
    '    permissions:\n      fs:\n        read: [src]\n        write: []\n      terminal: allow\n',
  ),
  permissionsEmpty: step('    permissions:\n      fs:\n'),
  guards: step('    guards:\n      - type: git_diff_empty\n        paths: [src]\n'),
  onFailure: step('    on_failure:\n      action: retry_step\n      target: a\n      max_retries: 2\n'),
  onFailureIntegerAsFloat: step('    on_failure:\n      action: escalate\n      max_retries: 2.0\n'),
  debate: step('    role: r\n    consensus_with: [s]\n    decision_type: majority\n    arbiter: human\n'),
  roles: `${head}roles:\n  r:\n    runner: openrouter\n    model: m\n    mcp: [docs]\n    agent:\n      preset: codex\nsteps:\n  - id: a\n`,
  servers: `${head}mcp_servers:\n  docs:\n    command: npx\n    args: [-y, d]\n    env:\n      K: v\n  t:\n    url: https://x\nsteps:\n  - id: a\n`,
  defaults: `${head}defaults:\n  mcp_policy: optional\nsteps: []\n`,
  artifacts: `${head}artifacts:\n  spec: docs/spec.md\nsteps:\n  - id: a\n    goal: "{{ artifacts.spec }}"\n`,
  unknownKeys: `${head}governance: {}\nsteps:\n  - id: a\n    whatever: 1\n`,
  noSteps: head,
  emptyGoalString: step('    goal: ""\n    role: ""\n'),
};

/** Files the parser refuses for their structure: each breaks one rule the schema states. */
const INVALID: Readonly<Record<string, string>> = {
  noVersion: 'name: x\nsteps: []\n',
  otherVersion: 'version: "2.0"\nname: x\n',
  versionNumber: 'version: 1.0\nname: x\n',
  noName: 'version: "1.0"\n',
  blankName: 'version: "1.0"\nname: "  "\n',
  nameNotString: 'version: "1.0"\nname: 3\n',
  stepsNotList: `${head}steps: {}\n`,
  stepNotMap: `${head}steps: [x]\n`,
  stepNullItem: `${head}steps:\n  -\n`,
  noId: `${head}steps:\n  - runner: shell\n`,
  blankId: `${head}steps:\n  - id: " "\n`,
  idNumber: `${head}steps:\n  - id: 3\n`,
  runnerEmptyList: step('    runner: []\n'),
  runnerTwice: step('    runner: [acp, acp]\n'),
  runnerBlank: step('    runner: ""\n'),
  runnerNumber: step('    runner: 7\n'),
  agentNumber: step('    agent: 3\n'),
  agentBlank: step('    agent: ""\n'),
  agentNeither: step('    agent:\n      auth: x\n'),
  agentEmptyCommand: step('    agent:\n      command: []\n'),
  dependsNotList: step('    depends_on: a\n'),
  dependsItem: step('    depends_on: [3]\n'),
  goalNumber: step('    goal: 3\n'),
  isolationOther: step('    isolation: docker\n'),
  decisionOther: step('    decision_type: vote\n'),
  arbiterShape: step('    arbiter: "a b"\n'),
  policyOther: step('    mcp_policy: maybe\n'),
  guardNoType: step('    guards:\n      - paths: [x]\n'),
  guardNotMap: step('    guards: [x]\n'),
  onFailureNoAction: step('    on_failure:\n      target: a\n'),
  onFailureAction: step('    on_failure:\n      action: retry\n'),
  retriesNull: step('    on_failure:\n      action: fail\n      max_retries:\n'),
  retriesFraction: step('    on_failure:\n      action: fail\n      max_retries: 1.5\n'),
  terminalOther: step('    permissions:\n      terminal: maybe\n'),
  fsNotMap: step('    permissions:\n      fs: [x]\n'),
  permissionsNotMap: step('    permissions: yes\n'),
  roleNoRunner: `${head}roles:\n  r:\n    model: m\nsteps: []\n`,
  roleNull: `${head}roles:\n  r:\nsteps: []\n`,
  rolesNotMap: `${head}roles: [r]\nsteps: []\n`,
  modelNumber: `${head}roles:\n  r:\n    runner: x\n    model: 3\nsteps: []\n`,
  serverNotMap: `${head}mcp_servers:\n  d: npx\nsteps: []\n`,
  serverEnv: `${head}mcp_servers:\n  d:\n    command: x\n    env:\n      K: 3\nsteps: []\n`,
  artifactNumber: `${head}artifacts:\n  a: 3\nsteps: []\n`,
  defaultsNotMap: `${head}defaults: optional\nsteps: []\n`,
  defaultsPolicy: `${head}defaults:\n  mcp_policy: maybe\nsteps: []\n`,
};

describe('the schema and the parser agree (AC-10)', () => {
  const exampleFiles = readdirSync(examples)
    .filter((name) => name.endsWith('.yml'))
    .map((name): [string, string] => [name, readFileSync(join(examples, name), 'utf8')]);

  it.each([...exampleFiles, ...Object.entries(VALID)])('both accept %s', (_name, text) => {
    expect(parserAccepts(text)).toBe(true);
    expect(schemaAccepts(text), JSON.stringify(check.errors)).toBe(true);
  });

  it.each(Object.entries(INVALID))('both refuse %s', (_name, text) => {
    expect(parserAccepts(text)).toBe(false);
    expect(schemaAccepts(text)).toBe(false);
  });
});

describe('the schema (AC-08, AC-09)', () => {
  const schema = workflowJsonSchema() as {
    $schema: string;
    description: string;
    properties: Record<string, unknown>;
  };

  it('is a draft 2020-12 schema that compiles in strict mode', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(() =>
      new Ajv2020({ strict: true, strictTypes: false }).compile(workflowJsonSchema()),
    ).not.toThrow();
  });

  it('says that rules across fields are not in it', () => {
    expect(schema.description).toMatch(/Rules across fields are not stated here/);
  });

  it('describes every field', () => {
    const undescribed: string[] = [];
    const visit = (node: unknown, at: string): void => {
      if (node === null || typeof node !== 'object') {
        return;
      }
      const record = node as Record<string, unknown>;
      const properties = record.properties as Record<string, unknown> | undefined;
      for (const [key, field] of Object.entries(properties ?? {})) {
        const text = JSON.stringify(field);
        if (!text.includes('"description"')) {
          undescribed.push(`${at}.${key}`);
        }
        visit(field, `${at}.${key}`);
      }
      for (const key of ['anyOf', 'items', 'additionalProperties']) {
        const inner = record[key];
        for (const item of Array.isArray(inner) ? inner : [inner]) {
          visit(item, at);
        }
      }
    };
    visit(schema, '$');
    expect(undescribed).toEqual([]);
  });

  it('takes its enumerations from the parser’s own constants', () => {
    const text = JSON.stringify(schema);
    for (const constants of [DecisionType, FailureAction, Isolation, McpPolicy]) {
      expect(text).toContain(JSON.stringify(Object.values(constants)));
    }
  });

  it('is a fresh copy each call', () => {
    const a = workflowJsonSchema() as { title: string };
    a.title = 'changed';
    expect((workflowJsonSchema() as { title: string }).title).toBe('Indaba workflow file');
  });
});

describe('no field without the schema (AC-10)', () => {
  it('names every key the parser reads, and none it does not', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/parser/parser.ts', import.meta.url)), 'utf8');
    const read = new Set(
      [
        ...source.matchAll(
          /\.(?:string|int|stringList|stringOrList|stringOrMap|map|nodeList|nodeMap|stringMap)\('([a-z_]+)'/g,
        ),
      ].map((m) => m[1] ?? ''),
    );
    const named = new Set<string>();
    const visit = (node: unknown): void => {
      if (node === null || typeof node !== 'object') {
        return;
      }
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'properties' && value !== null && typeof value === 'object') {
          for (const name of Object.keys(value)) {
            named.add(name);
          }
        }
        visit(value);
      }
    };
    visit(workflowJsonSchema());
    // `read`, `write` and the agent's keys are read through helpers on a nested node; they are found the same way.
    expect([...read].filter((key) => !named.has(key)).sort()).toEqual([]);
    expect([...named].filter((key) => !read.has(key)).sort()).toEqual([]);
  });
});
