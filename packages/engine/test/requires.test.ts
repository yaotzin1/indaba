import { WorkflowValidationError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { WorkflowParser } from '../src/index.js';

const BASE = `version: "1.0"
name: w
steps:
  - id: a
    runner: shell
    commands: ["echo hi"]
`;

function parse(requires: string) {
  return new WorkflowParser().parse(`${BASE}requires:\n${requires}`);
}

function problems(requires: string): readonly string[] {
  try {
    parse(requires);
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return error.problems;
    }
    throw error;
  }
  return [];
}

describe('requires (AC-07 to AC-09)', () => {
  it('reads every kind with its optional fields', () => {
    const workflow = parse(`  - { kind: env, name: TOKEN, description: a token, critical: true }
  - { kind: file, name: docs/brief.md, description: the brief, how: ask the team }
  - { kind: account, name: Google, description: an OAuth client }
`);
    expect(workflow.requires).toEqual([
      { kind: 'env', name: 'TOKEN', description: 'a token', critical: true },
      { kind: 'file', name: 'docs/brief.md', description: 'the brief', how: 'ask the team' },
      { kind: 'account', name: 'Google', description: 'an OAuth client' },
    ]);
  });

  it('has no requires when the file has none', () => {
    expect(new WorkflowParser().parse(BASE).requires).toBeUndefined();
  });

  it('names the path of an unknown key', () => {
    expect(problems('  - { kind: env, name: T, description: d, colour: red }\n')).toContain(
      '$.requires[0].colour is not a requires setting',
    );
  });

  it('refuses an unknown kind, a missing description and a non-boolean critical', () => {
    const found = problems(`  - { kind: wish, name: T, description: d }
  - { kind: env, name: T }
  - { kind: env, name: T, description: d, critical: sometimes }
`);
    expect(found.some((p) => p.startsWith('$.requires[0].kind must be one of'))).toBe(true);
    expect(found).toContain('$.requires[1].description is required');
    expect(found).toContain('$.requires[2].critical must be true or false');
  });

  it('bounds description at 300 and how at 500 characters', () => {
    const found = problems(
      `  - { kind: env, name: T, description: "${'d'.repeat(301)}", how: "${'h'.repeat(501)}" }\n`,
    );
    expect(found).toContain('$.requires[0].description must be at most 300 characters');
    expect(found).toContain('$.requires[0].how must be at most 500 characters');
    expect(
      problems(`  - { kind: env, name: T, description: "${'d'.repeat(300)}", how: "${'h'.repeat(500)}" }\n`),
    ).toEqual([]);
  });

  it.each(['/etc/passwd', '\\\\server\\share', 'C:/x', '../x', 'a/../../x', 'a\\..\\x'])(
    'refuses the file name %s at parse time (AC-09)',
    (name) => {
      const found = problems(`  - { kind: file, name: '${name}', description: d }\n`);
      expect(found.some((p) => p.startsWith('$.requires[0].name must be a path inside the project'))).toBe(
        true,
      );
    },
  );

  it('does not confine a name that is not a file', () => {
    expect(problems('  - { kind: tool, name: ../odd, description: d }\n')).toEqual([]);
  });
});
