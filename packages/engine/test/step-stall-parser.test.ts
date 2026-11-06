import { WorkflowValidationError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../src/index.js';

// specs/step-stalls, release 2: the stall block in the file (AC-04, AC-11, AC-13).

const HEAD = 'version: "1.0"\nname: t\nroles:\n  w: {runner: work}\n  c: {runner: work}\n';
const step = (extra: string, lead = '    role: w\n    goal: g\n') =>
  `${HEAD}steps:\n  - id: a\n${lead}${extra}`;

function problems(yaml: string): string {
  try {
    parseWorkflow(yaml);
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return error.problems.join('\n');
    }
    throw error;
  }
  return '';
}

const AFTER = 'step "a": stall.after_seconds must be a whole number from 60 to 3600';
const RETRIES = 'step "a": stall.retries must be a whole number from 0 to 3';
const SHAPE = 'step "a": stall takes after_seconds and retries only';

describe('stall in the file (AC-04)', () => {
  it('reads after_seconds and defaults retries to 0 (C-14)', () => {
    const s = parseWorkflow(step('    stall:\n      after_seconds: 300\n')).steps[0];
    expect(s?.stall).toEqual({ afterSeconds: 300, retries: 0 });
  });

  it('reads retries, which needs a worktree above 0', () => {
    const s = parseWorkflow(
      step('    isolation: git_worktree\n    stall:\n      after_seconds: 120\n      retries: 3\n'),
    ).steps[0];
    expect(s?.stall).toEqual({ afterSeconds: 120, retries: 3 });
  });

  it('accepts the ends of the range: 60 and 3600', () => {
    expect(parseWorkflow(step('    stall: {after_seconds: 60}\n')).steps[0]?.stall?.afterSeconds).toBe(60);
    expect(parseWorkflow(step('    stall: {after_seconds: 3600}\n')).steps[0]?.stall?.afterSeconds).toBe(
      3600,
    );
  });

  it('leaves a step without the block exactly as before (AC-20)', () => {
    const s = parseWorkflow(step('')).steps[0];
    expect(s !== undefined && 'stall' in s).toBe(false);
  });

  it('treats a null block as absent, like every other optional field', () => {
    const s = parseWorkflow(step('    stall:\n')).steps[0];
    expect(s !== undefined && 'stall' in s).toBe(false);
  });

  it('is accepted beside timeout_seconds, which is independent (AC-10)', () => {
    const s = parseWorkflow(step('    timeout_seconds: 900\n    stall: {after_seconds: 120}\n')).steps[0];
    expect(s?.timeoutSeconds).toBe(900);
    expect(s?.stall?.afterSeconds).toBe(120);
  });
});

describe('the numbers are checked before anything runs', () => {
  it.each([
    ['59', '59'],
    ['3601', '3601'],
    ['0', '0'],
    ['negative', '-60'],
    ['a fraction', '90.5'],
    ['text', '"90"'],
    ['not a number', '.nan'],
    ['infinity', '.inf'],
    ['a list', '[90]'],
    ['a mapping', '{n: 90}'],
    ['a boolean', 'true'],
  ])('refuses an after_seconds that is %s', (_label, value) => {
    expect(problems(step(`    stall: {after_seconds: ${value}}\n`))).toContain(AFTER);
  });

  it('refuses a missing after_seconds, and a null one', () => {
    expect(problems(step('    stall: {retries: 0}\n'))).toContain(AFTER);
    expect(problems(step('    stall:\n      after_seconds:\n'))).toContain(AFTER);
  });

  it.each([
    ['4', '4'],
    ['negative', '-1'],
    ['a fraction', '1.5'],
    ['text', '"1"'],
    ['null', 'null'],
  ])('refuses retries that are %s', (_label, value) => {
    const text = problems(
      step(`    isolation: git_worktree\n    stall: {after_seconds: 90, retries: ${value}}\n`),
    );
    // `null` is the same as absent: retries is then 0 and nothing is wrong.
    if (value === 'null') {
      expect(text).toBe('');
    } else {
      expect(text).toContain(RETRIES);
    }
  });

  it('says only the contract message and never the file text', () => {
    const text = problems(
      step('    stall: {after_seconds: 59}\n', '    role: w\n    goal: secret-prompt-text\n'),
    );
    expect(text).toContain(AFTER);
    expect(text).not.toContain('secret-prompt-text');
  });
});

describe('what the block may contain', () => {
  it('refuses an unknown key', () => {
    expect(problems(step('    stall: {after_seconds: 90, every: 5}\n'))).toContain(SHAPE);
  });

  it.each([
    ['a number', '5'],
    ['a string', '"90"'],
    ['a list', '[90]'],
    ['true', 'true'],
  ])('refuses a block that is %s', (_label, value) => {
    expect(problems(step(`    stall: ${value}\n`))).toContain(SHAPE);
  });
});

describe('where stall may be used (AC-11, AC-13)', () => {
  it('is refused on a shell step', () => {
    const text = problems(step('    stall: {after_seconds: 90}\n', '    runner: shell\n    commands: [x]\n'));
    expect(text).toContain('step "a": stall needs an agent step');
  });

  it('is refused on a debate step, by consensus_with and by decision_type', () => {
    const byRoles = problems(step('    consensus_with: [c]\n    stall: {after_seconds: 90}\n'));
    const byType = problems(step('    decision_type: majority\n    stall: {after_seconds: 90}\n'));
    expect(byRoles).toContain('step "a": stall is not supported on a debate step in this version');
    expect(byType).toContain('step "a": stall is not supported on a debate step in this version');
  });

  it('needs isolation: git_worktree for retries above 0', () => {
    const text = problems(step('    stall: {after_seconds: 90, retries: 1}\n'));
    expect(text).toContain('step "a": stall.retries above 0 needs isolation: git_worktree');
  });

  it('needs no isolation when retries is 0, explicitly or by default', () => {
    expect(problems(step('    stall: {after_seconds: 90, retries: 0}\n'))).toBe('');
    expect(problems(step('    stall: {after_seconds: 90}\n'))).toBe('');
  });

  it('does not count a step that merely depends on an isolated one: the step itself must say so', () => {
    const text = problems(
      `${HEAD}steps:\n  - id: base\n    role: w\n    goal: g\n    isolation: git_worktree\n` +
        '  - id: a\n    depends_on: [base]\n    role: w\n    goal: g\n    stall: {after_seconds: 90, retries: 1}\n',
    );
    expect(text).toContain('step "a": stall.retries above 0 needs isolation: git_worktree');
  });
});
