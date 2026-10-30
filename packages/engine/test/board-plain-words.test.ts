import { BoardKind, RunBoard, WorkflowValidationError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../src/index.js';
import { FixedClock } from './support.js';

// AC-40: what a person reads about the board uses plain words. The workflow field paths are the author's own spelling
// (`board.digest_chars`) and are left out before the words are checked.
const BANNED = /digest|settle|supersede|degraded|jsonl/i;
const PATH = /steps\[\d+\](?:\.[a-z_]+|\[\d+\])*/g;

const HEAD = 'version: "1.0"\nname: t\nroles:\n  a: {runner: shell}\n  b: {runner: shell}\n';

/** One invalid board per message the parser and validator can produce for the field. */
const INVALID: readonly string[] = [
  'board: 5',
  'board: {write: [note]}',
  'board: {read: {roles: [a]}}',
  'board: {read: {steps: []}}',
  'board: {read: {steps: [1]}}',
  'board: {read: {steps: [x]}}',
  'board: {read: {steps: [nowhere]}}',
  'board: {read: {kinds: []}}',
  'board: {read: {kinds: [bogus]}}',
  'board: {post: note}',
  'board: {post: [bogus]}',
  'board: {post: [critique]}',
  'board: {post: [decision]}',
  'board: {digest_chars: 1}',
  'board: {digest_chars: lots}',
  'board: {digest_chars: 300.5}',
];

/** The problems of a workflow made of these step lines, which must be invalid. */
function problemsIn(steps: string): string[] {
  try {
    parseWorkflow(`${HEAD}steps:\n${steps}`);
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return [...error.problems];
    }
    throw error;
  }
  throw new Error(`Expected a validation error for: ${steps}`);
}

function problemsOf(board: string): string[] {
  return problemsIn(
    `  - {id: base, runner: shell, commands: [echo]}\n  - {id: x, role: a, runner: claude, depends_on: [base], ${board}}\n`,
  );
}

describe('plain words in what a person reads about the board (AC-40)', () => {
  it('keeps the banned words out of every board message of the parser and validator', () => {
    const messages = INVALID.flatMap(problemsOf);
    expect(messages.length).toBeGreaterThanOrEqual(INVALID.length);
    for (const message of messages) {
      expect(message.replace(PATH, ''), message).not.toMatch(BANNED);
    }
  });

  it('keeps them out of the messages about a shell step and a debate step', () => {
    const shell = problemsIn('  - {id: s, runner: shell, commands: [echo], board: {read: {}}}\n');
    const debate = problemsIn(
      '  - {id: d, role: a, runner: claude, consensus_with: [b], board: {post: [note]}}\n',
    );
    expect(shell).toHaveLength(1);
    expect(debate).toHaveLength(1);
    for (const message of [...shell, ...debate]) {
      expect(message.replace(PATH, ''), message).not.toMatch(BANNED);
    }
  });
});

describe('the id syntax of a step id and a scope (AC-02)', () => {
  const board = () => new RunBoard({ traceId: 'abc', workflow: 'w', clock: new FixedClock() });
  const base = { attempt: 1, source: 'agent', sender: 'w', kind: BoardKind.Note, text: 'hi' } as const;

  it('records every step id the workflow format accepts', () => {
    const b = board();
    for (const id of ['a', 'A-b_9', '9', '_', '-']) {
      expect(b.post({ ...base, stepId: id }), id).toBeDefined();
    }
  });

  it('records nothing for an id the format refuses, the same ones the validator refuses', () => {
    const b = board();
    for (const id of ['a b', '../x', 'a/b', 'a.b', 'é', 'a\n']) {
      expect(b.post({ ...base, stepId: id }), JSON.stringify(id)).toBeUndefined();
      // a JSON string is a valid YAML double-quoted scalar, so the id reaches the validator as it is
      const problems = problemsIn(`  - {id: ${JSON.stringify(id)}, runner: shell, commands: [echo]}\n`);
      expect(problems.join(' '), JSON.stringify(id)).toContain('step id');
    }
    expect(b.records()).toHaveLength(1); // only the start record
  });

  it('records only the scopes of the format', () => {
    const b = board();
    for (const scope of ['step', 'variant:1', 'variant:123456']) {
      expect(b.post({ ...base, stepId: 'a', scope }), scope).toBeDefined();
    }
    for (const scope of ['', 'Step', 'variant:', 'variant:1234567', 'variant:-1', 'variant:1 ', '../x']) {
      expect(b.post({ ...base, stepId: 'a', scope }), scope).toBeUndefined();
    }
  });
});
