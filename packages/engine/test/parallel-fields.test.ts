import { WorkflowValidationError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../src/index.js';

// specs/parallel-steps, slice 1: the workflow fields max_parallel, max_waits and touches (AC-03, AC-10).

const HEAD = 'version: "1.0"\nname: t\nroles:\n  w: {runner: shell}\n  a: {runner: claude-code}\n';

function problems(source: string): readonly string[] {
  try {
    parseWorkflow(source);
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return error.problems;
    }
    throw error;
  }
  return [];
}

describe('max_parallel and max_waits (AC-03)', () => {
  const steps = 'steps:\n  - id: s\n    runner: shell\n    commands: ["true"]\n';

  it('are absent by default', () => {
    const workflow = parseWorkflow(`${HEAD}${steps}`);
    expect(workflow.maxParallel).toBeUndefined();
    expect(workflow.maxWaits).toBeUndefined();
  });

  it('are read as whole numbers of at least 1', () => {
    const workflow = parseWorkflow(`${HEAD}max_parallel: 3\nmax_waits: 2\n${steps}`);
    expect(workflow.maxParallel).toBe(3);
    expect(workflow.maxWaits).toBe(2);
  });

  it.each(['0', '-1', '1.5', '"two"', 'true'])('reject max_parallel: %s, naming the field', (value) => {
    expect(problems(`${HEAD}max_parallel: ${value}\n${steps}`)).toContain(
      'max_parallel must be a whole number of at least 1',
    );
  });

  it.each(['0', '2.5', '"x"'])('reject max_waits: %s, naming the field', (value) => {
    expect(problems(`${HEAD}max_waits: ${value}\n${steps}`)).toContain(
      'max_waits must be a whole number of at least 1',
    );
  });
});

describe('touches (AC-10)', () => {
  it('is read on a shell step as a list of paths or globs', () => {
    const workflow = parseWorkflow(
      `${HEAD}steps:\n  - id: s\n    runner: shell\n    commands: ["true"]\n    touches: ["src/a/**", "docs/x.md"]\n`,
    );
    expect(workflow.steps[0]?.touches).toEqual(['src/a/**', 'docs/x.md']);
  });

  it('is absent when the step does not say', () => {
    const workflow = parseWorkflow(`${HEAD}steps:\n  - id: s\n    runner: shell\n    commands: ["true"]\n`);
    expect(workflow.steps[0]?.touches).toBeUndefined();
  });

  it('is accepted on a step whose runner is shell', () => {
    const workflow = parseWorkflow(
      `${HEAD}steps:\n  - id: s\n    runner: shell\n    commands: ["true"]\n    touches: ["a"]\n`,
    );
    expect(workflow.steps[0]?.touches).toEqual(['a']);
  });

  it('is refused on an agent step, naming the step', () => {
    expect(
      problems(`${HEAD}steps:\n  - id: build\n    role: a\n    goal: do\n    touches: ["a"]\n`),
    ).toContain(
      'step "build": touches is only for a shell step; an agent step declares its intent when it runs',
    );
  });

  it('must be a list of strings', () => {
    expect(
      problems(
        `${HEAD}steps:\n  - id: s\n    runner: shell\n    commands: ["true"]\n    touches: "a"\n`,
      ).some((p) => p.includes('touches must be a list of strings')),
    ).toBe(true);
  });
});
