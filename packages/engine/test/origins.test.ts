import {
  DEFAULT_MAX_ROUNDS,
  DEFAULT_TIMEOUT_SECONDS,
  type ExplainedStep,
  type ExplainFacts,
  explainPlan,
  type Origin,
  type OriginMap,
  resolvePermissions,
  type StepPermissions,
  type WorkflowDefinition,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { parseWorkflow, readOrigins } from '../src/index.js';

// specs/plan-explain, T-07 and T-08: where each setting was written, against what the parser resolved.

const facts: ExplainFacts = {
  timeoutSeconds: { value: DEFAULT_TIMEOUT_SECONDS, by: 'engine' },
  debateRounds: { value: DEFAULT_MAX_ROUNDS, by: 'engine' },
  runnerDefault: () => undefined,
};

function explain(source: string): {
  workflow: WorkflowDefinition;
  steps: readonly ExplainedStep[];
  origins: OriginMap;
} {
  const workflow = parseWorkflow(source);
  const origins = readOrigins(source, workflow);
  return { workflow, origins, steps: explainPlan(workflow, origins, facts).steps };
}

function originOf(step: ExplainedStep | undefined, key: string): Origin | undefined {
  return step?.settings.find((s) => s.key === key)?.origin;
}

/** The one-based line and column of the first line that carries `marker`, counting the indentation of its key. */
function at(source: string, marker: string): { line: number; column: number } {
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex((l) => l.includes(marker));
  if (index < 0) {
    throw new Error(`no line has ${marker}`);
  }
  const text = lines[index] ?? '';
  return { line: index + 1, column: text.length - text.trimStart().length + 1 };
}

type State = 'absent' | 'empty' | 'written';
const STATES: readonly State[] = ['absent', 'empty', 'written'];

function block(state: State, marker: string, indent: string): string {
  switch (state) {
    case 'absent':
      return '';
    case 'empty':
      return `${indent}permissions: {} # ${marker}\n`;
    case 'written':
      return `${indent}permissions: { level: read } # ${marker}\n`;
  }
}

function matrix(step: State, role: State, defaults: State): string {
  const defaultsBlock = defaults === 'absent' ? '' : `defaults:\n${block(defaults, 'D', '  ')}`;
  return `version: "1.0"
name: m
${defaultsBlock}roles:
  dev:
    runner: claude-code
${block(role, 'R', '    ')}steps:
  - id: a
    role: dev
    goal: g
${block(step, 'S', '    ')}`;
}

describe('readOrigins against resolvePermissions: every combination of written, empty and absent blocks', () => {
  for (const step of STATES) {
    for (const role of STATES) {
      for (const defaults of STATES) {
        it(`step ${step}, role ${role}, defaults ${defaults}`, () => {
          const source = matrix(step, role, defaults);
          const { workflow, steps } = explain(source);
          const only = steps[0];
          const stepBlock = workflow.steps[0]?.permissions;
          const winner =
            step !== 'absent' ? 'S' : role !== 'absent' ? 'R' : defaults !== 'absent' ? 'D' : undefined;

          // what the run resolves
          const resolved: StepPermissions | undefined = resolvePermissions({
            ...(winner === 'S' && stepBlock !== undefined ? { step: stepBlock } : {}),
            ...(winner === 'R' && workflow.roles.dev?.permissions !== undefined
              ? { role: workflow.roles.dev.permissions }
              : {}),
            ...(winner === 'D' && workflow.defaultPermissions !== undefined
              ? { defaults: workflow.defaultPermissions }
              : {}),
          });
          expect(stepBlock).toEqual(resolved);

          const origin = originOf(only, 'permissions.fs.write');
          if (winner === undefined) {
            expect(origin).toBeUndefined();
            return;
          }
          const position = at(source, `# ${winner}`);
          const expected: Origin =
            winner === 'S'
              ? { kind: 'file', ...position }
              : winner === 'R'
                ? { kind: 'role', ref: 'dev', ...position }
                : { kind: 'workflow_defaults', ...position };
          expect(origin).toEqual(expected);
          // the level is shown only when some layer wrote one, with the same origin
          expect(originOf(only, 'permissions.level')).toEqual(
            (stepBlock?.level ?? undefined) === undefined ? undefined : expected,
          );
        });
      }
    }
  }
});

describe('readOrigins: constructs of YAML', () => {
  const base = (steps: string, head = ''): string =>
    `version: "1.0"\nname: o\n${head}roles:\n  dev: {runner: claude-code}\nsteps:\n${steps}`;

  it('gives the line and column of the key of a step, in block style', () => {
    const source = base(
      '  - id: a\n    role: dev\n    goal: g\n    isolation: git_worktree\n    timeout_seconds: 60\n',
    );
    const { steps } = explain(source);
    expect(originOf(steps[0], 'isolation')).toEqual({ kind: 'file', line: 9, column: 5 });
    expect(originOf(steps[0], 'timeout_seconds')).toEqual({ kind: 'file', line: 10, column: 5 });
  });

  it('works in flow style, where several keys share a line', () => {
    const source = base('  - {id: a, role: dev, goal: g, isolation: git_worktree}\n');
    const { steps } = explain(source);
    const origin = originOf(steps[0], 'isolation');
    expect(origin?.kind).toBe('file');
    expect(origin?.line).toBe(6);
    expect(origin?.column).toBe((source.split('\n')[5] ?? '').indexOf('isolation') + 1);
  });

  it('follows an anchor and its alias: the key of each step is where it is written', () => {
    const source = base(
      '  - id: a\n    role: dev\n    goal: g\n    permissions: &p {level: read}\n  - id: b\n    role: dev\n    goal: g\n    permissions: *p\n',
    );
    const { steps } = explain(source);
    expect(originOf(steps[0], 'permissions.level')).toEqual({ kind: 'file', line: 9, column: 5 });
    expect(originOf(steps[1], 'permissions.level')).toEqual({ kind: 'file', line: 13, column: 5 });
  });

  it('reads a file with CRLF line ends: the lines are the same', () => {
    const lf = base('  - id: a\n    role: dev\n    goal: g\n    isolation: git_worktree\n');
    const crlf = lf.replaceAll('\n', '\r\n');
    expect(originOf(explain(crlf).steps[0], 'isolation')).toEqual(
      originOf(explain(lf).steps[0], 'isolation'),
    );
    expect(originOf(explain(crlf).steps[0], 'isolation')?.line).toBe(9);
  });

  it('gives a line to the role that wrote the runner and to the defaults that wrote the mcp policy', () => {
    const source = `version: "1.0"
name: o
mcp_servers:
  docs: { command: run }
defaults:
  mcp_policy: optional
roles:
  dev:
    runner: claude-code
steps:
  - id: a
    role: dev
    goal: g
    mcp: [docs]
`;
    const { steps } = explain(source);
    expect(originOf(steps[0], 'runner')).toEqual({ kind: 'role', ref: 'dev', line: 9, column: 5 });
    expect(originOf(steps[0], 'mcp_policy')).toEqual({ kind: 'workflow_defaults', line: 6, column: 3 });
  });

  it('gives a line to a step that sits after one it does not match, by index and id', () => {
    const source = base(
      '  - id: first\n    role: dev\n    goal: g\n  - id: second\n    role: dev\n    goal: g\n    isolation: git_worktree\n    depends_on: [first]\n',
    );
    const { steps } = explain(source);
    expect(steps.map((s) => s.id)).toEqual(['first', 'second']);
    expect(originOf(steps[1], 'isolation')?.line).toBe(12);
  });

  it('gives an empty map, and still every origin, when it is given no usable source', () => {
    const source = base('  - id: a\n    role: dev\n    goal: g\n    isolation: git_worktree\n');
    const workflow = parseWorkflow(source);
    expect(readOrigins('', workflow).size).toBe(0);
    expect(readOrigins(': : :\n- [', workflow).size).toBe(0);
    expect(readOrigins('just text', workflow).size).toBe(0);
    const [step] = explainPlan(workflow, readOrigins('', workflow), facts).steps;
    expect(originOf(step, 'isolation')).toEqual({ kind: 'file' });
    expect(originOf(step, 'runner')).toEqual({ kind: 'role', ref: 'dev' });
  });

  it('reads the first document of a multi-document text and gives no line to a step the second one holds', () => {
    const first = base('  - id: a\n    role: dev\n    goal: g\n    isolation: git_worktree\n');
    const workflow = parseWorkflow(first);
    const both = `${first}---\n${first.replace('isolation: git_worktree', 'timeout_seconds: 5')}`;
    const origins = readOrigins(both, workflow);
    expect(origins.get('$.steps[0].isolation')).toEqual({ line: 9, column: 5 });
    expect(origins.has('$.steps[0].timeout_seconds')).toBe(false);
  });

  it('does not expand aliases, so an alias bomb costs nothing', () => {
    const lines = ['a0: &a0 [x, x]'];
    for (let i = 1; i < 40; i += 1) {
      lines.push(`a${i}: &a${i} [*a${i - 1}, *a${i - 1}]`);
    }
    const source = `${lines.join('\n')}\nversion: "1.0"\nname: o\nroles:\n  dev: {runner: claude-code}\nsteps:\n  - id: a\n    role: dev\n    goal: g\n`;
    const workflow = parseWorkflow(base('  - id: a\n    role: dev\n    goal: g\n'));
    expect(() => readOrigins(source, workflow)).not.toThrow();
  });

  it('leaves a step out when its id is not the one the model has at that index', () => {
    const workflow = parseWorkflow(
      base('  - id: a\n    role: dev\n    goal: g\n    isolation: git_worktree\n'),
    );
    const other = base('  - id: z\n    role: dev\n    goal: g\n    isolation: git_worktree\n');
    expect([...readOrigins(other, workflow).keys()].filter((k) => k.startsWith('$.steps'))).toEqual([]);
  });
});
