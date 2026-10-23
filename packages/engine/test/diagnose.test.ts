import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkflowValidationError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { pathText, WorkflowParser, WorkflowValidator } from '../src/index.js';

/** specs/workflow-editor, T-05: every problem `validate` reports, placed in the text, with its sentence unchanged. */

const examples = fileURLToPath(new URL('../../../examples', import.meta.url));

const head = 'version: "1.0"\nname: x\n';
const shell = (id: string, extra = ''): string =>
  `  - id: ${id}\n    runner: shell\n    commands: [x]\n${extra}`;

/** Structurally and semantically broken files, and valid ones with warnings. */
const FIXTURES: Readonly<Record<string, string>> = {
  syntax: `${head}steps:\n  - id: a\n   bad: [\n`,
  noRunner: `${head}steps:\n  - id: a\n    goal: g\n`,
  dangling: `${head}steps:\n${shell('a', '    depends_on: [nope]\n')}`,
  duplicate: `${head}steps:\n${shell('a')}${shell('a')}`,
  target: `${head}steps:\n${shell('a', '    on_failure:\n      action: retry_step\n      target: zz\n')}`,
  version: 'version: "2.0"\nname: x\nsteps: []\n',
  root: '- a\n- b\n',
  two: 'version: "1.0"\n---\nname: y\n',
  empty: '',
  noSteps: `${head}steps: []\n`,
  badEnum: `${head}steps:\n${shell('a', '    isolation: nope\n')}`,
  badType: `${head}steps:\n  - id: a\n    runner: shell\n    commands: 3\n`,
  unknownRole: `${head}steps:\n  - id: a\n    role: ghost\n    goal: g\n`,
  missingKey: `${head}steps:\n  - runner: shell\n    commands: [x]\n`,
  server: `${head}mcp_servers:\n  files:\n    url: ftp://x\nsteps:\n${shell('a')}`,
  roleServer: `${head}roles:\n  r:\n    runner: shell\n    mcp: [ghost]\nsteps:\n${shell('a')}`,
  warnings: `${head}steps:\n  - id: a\n    runner: claude-code\n    goal: g\n    permissions:\n      fs:\n        read: []\n        write: []\n`,
};

/** What `indaba validate` would print: the errors of `parse`, or the warnings when it parses. */
function validateSays(parser: WorkflowParser, text: string): { errors: string[]; warnings: string[] } {
  try {
    const workflow = parser.parse(text);
    return { errors: [], warnings: new WorkflowValidator().warnings(workflow) };
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return { errors: [...error.problems], warnings: [] };
    }
    throw error;
  }
}

describe('diagnose: the same sentences as validate (AC-05)', () => {
  const parser = new WorkflowParser();
  const texts: [string, string][] = [
    ...readdirSync(examples)
      .filter((name) => name.endsWith('.yml'))
      .map((name): [string, string] => [name, readFileSync(join(examples, name), 'utf8')]),
    ...Object.entries(FIXTURES),
  ];

  it.each(texts)('%s', (_name, text) => {
    const says = validateSays(parser, text);
    const problems = parser.diagnose(text);
    expect(problems.filter((p) => p.severity === 'error').map((p) => p.message)).toEqual(says.errors);
    expect(problems.filter((p) => p.severity === 'warning').map((p) => p.message)).toEqual(says.warnings);
  });

  it('finds every example valid, so the table above tests more than errors', () => {
    for (const [name, text] of texts.filter(([n]) => n.endsWith('.yml'))) {
      expect(validateSays(parser, text).errors, name).toEqual([]);
    }
  });
});

describe('diagnose: where each problem is (AC-05)', () => {
  const parser = new WorkflowParser();
  const at = (text: string) =>
    parser.diagnose(text).map(({ path, line, column }) => ({ path, line, column }));

  it('places a YAML syntax error where the yaml package found it', () => {
    expect(at(FIXTURES.syntax ?? '')).toEqual([{ path: '$', line: 5, column: 1 }]);
  });

  it('places a sentence that begins with a path at that path', () => {
    expect(at(FIXTURES.badEnum ?? '')).toEqual([{ path: '$.steps[0].isolation', line: 7, column: 16 }]);
    expect(at(FIXTURES.badType ?? '')).toEqual([{ path: '$.steps[0].commands', line: 6, column: 15 }]);
  });

  it('places a missing key at the mapping that lacks it', () => {
    expect(at(FIXTURES.missingKey ?? '')).toEqual([{ path: '$.steps[0].id', line: 4, column: 5 }]);
  });

  it('places a sentence about a step at the step, or the key it names', () => {
    expect(at(FIXTURES.noRunner ?? '')).toEqual([{ path: '$.steps[0]', line: 4, column: 5 }]);
    expect(at(FIXTURES.dangling ?? '')).toEqual([{ path: '$.steps[0].depends_on', line: 7, column: 17 }]);
    expect(at(FIXTURES.unknownRole ?? '')).toEqual([{ path: '$.steps[0].role', line: 5, column: 11 }]);
    expect(at(FIXTURES.target ?? '')).toEqual([
      { path: '$.steps[0].on_failure.max_retries', line: 8, column: 7 },
      { path: '$.steps[0].on_failure.target', line: 9, column: 15 },
    ]);
  });

  it('places a duplicate step id at the second step', () => {
    expect(at(FIXTURES.duplicate ?? '')).toEqual([{ path: '$.steps[1]', line: 7, column: 5 }]);
  });

  it('places sentences about a server, a role, the version and a top-level key', () => {
    expect(at(FIXTURES.server ?? '')[0]).toMatchObject({ path: '$.mcp_servers.files', line: 5, column: 5 });
    expect(at(FIXTURES.roleServer ?? '')[0]).toMatchObject({ path: '$.roles.r', line: 5, column: 5 });
    expect(at(FIXTURES.version ?? '')).toEqual([{ path: '$.version', line: 1, column: 10 }]);
    expect(at(FIXTURES.noSteps ?? '')).toEqual([{ path: '$.steps', line: 3, column: 8 }]);
  });

  it('places a root that is not a mapping, and a second document, at the start of each', () => {
    expect(at(FIXTURES.root ?? '')).toEqual([{ path: '$', line: 1, column: 1 }]);
    expect(at(FIXTURES.two ?? '')).toEqual([{ path: '$', line: 2, column: 1 }]);
  });

  it('places nothing in an empty text, which has no root', () => {
    expect(at('')).toEqual([{ path: '$', line: undefined, column: undefined }]);
  });

  it('places the warnings of a valid file, with severity warning', () => {
    const problems = parser.diagnose(FIXTURES.warnings ?? '');
    expect(problems.every((p) => p.severity === 'warning')).toBe(true);
    expect(problems.map((p) => p.path)).toEqual(['$.steps[0].permissions', '$.steps[0].permissions']);
    expect(problems[0]?.line).toBe(8);
  });

  it('places a step that is named but not in the text at the list of steps', () => {
    const doc = `${head}steps:\n${shell('a', '    on_failure:\n      action: retry_step\n      target: "b c"\n')}`;
    expect(parser.diagnose(doc).some((p) => p.path.startsWith('$.steps'))).toBe(true);
  });

  it('writes paths as the parser does', () => {
    expect(pathText([])).toBe('$');
    expect(pathText(['steps', 0, 'on_failure', 'target'])).toBe('$.steps[0].on_failure.target');
  });
});

describe('placing a sentence: the cases a real file rarely gives', () => {
  const placed = async (text: string, message: string) => {
    const { place, LineCounter } = await import('../src/parser/diagnose.js');
    const { parseDocument } = await import('yaml');
    const lines = new LineCounter();
    const doc = parseDocument(text, { lineCounter: lines });
    return place(doc, lines, message, 'error');
  };

  it('places a key with an empty value just after its colon, and one with no value at the key', async () => {
    const empty = await placed('name: x\nsteps:\n  - id: a\n    role:\n', '$.steps[0].role is empty');
    expect(empty).toMatchObject({ path: '$.steps[0].role', line: 4, column: 10 });
    const explicit = await placed('name: x\n? role\n', '$.role is empty');
    expect(explicit).toMatchObject({ path: '$.role', line: 2, column: 3 });
  });

  it('places a sentence about a step that is not in the text at the list of steps', async () => {
    expect(await placed('steps:\n  - id: a\n', 'step "ghost" needs a role or a runner')).toMatchObject({
      path: '$.steps',
      line: 2,
    });
    expect(await placed('name: x\nsteps: 3\n', 'step "a" needs a role or a runner')).toMatchObject({
      path: '$.steps',
    });
  });

  it('places a field a step does not have at the step', async () => {
    expect(await placed('steps:\n  - id: a\n', 'step "a" on_failure.target "z" is not a step')).toMatchObject(
      {
        path: '$.steps[0]',
        line: 2,
        column: 5,
      },
    );
  });

  it('places a sentence it cannot read, or a top-level key that is absent, at the root', async () => {
    expect(await placed('name: x\n', 'something new went wrong')).toMatchObject({
      path: '$',
      line: 1,
      column: 1,
    });
    expect(await placed('name: x\n', 'roles must be a mapping')).toMatchObject({ path: '$', line: 1 });
  });

  it('gives no position when the document has no root', async () => {
    const problem = await placed('', 'the document root must be a mapping');
    expect(problem).toEqual({ path: '$', message: 'the document root must be a mapping', severity: 'error' });
  });
});
