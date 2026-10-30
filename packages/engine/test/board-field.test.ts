import { WorkflowValidationError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { parseWorkflow, workflowJsonSchema } from '../src/index.js';

const HEAD = 'version: "1.0"\nname: t\nroles:\n  a: {runner: shell}\n  b: {runner: shell}\n';

/** Steps `first`, `second` and `me` (depends on both), `other` unrelated; `me` carries the given board block. */
function workflowWith(board: string, extra = ''): string {
  return `${HEAD}steps:
  - {id: first, runner: shell, commands: [echo]}
  - {id: second, runner: shell, commands: [echo], depends_on: [first]}
  - {id: other, runner: shell, commands: [echo]}
  - id: me
    role: a
    runner: claude
    depends_on: [second]
${extra}    board:
${board
  .split('\n')
  .map((line) => `      ${line}`)
  .join('\n')}
`;
}

function problemsOf(yaml: string): string {
  try {
    parseWorkflow(yaml);
  } catch (error) {
    if (error instanceof WorkflowValidationError) {
      return error.problems.join('\n');
    }
    throw error;
  }
  throw new Error('Expected a validation error.');
}

function boardOf(board: string) {
  return parseWorkflow(workflowWith(board)).steps.find((s) => s.id === 'me')?.board;
}

describe('the board field of a step', () => {
  it('leaves a workflow without it exactly as before', () => {
    const plain = parseWorkflow(`${HEAD}steps:\n  - {id: x, runner: shell, commands: [echo]}\n`);
    expect(plain.steps[0]).not.toHaveProperty('board');
  });

  it('reads post and digest_chars, with the defaults', () => {
    expect(boardOf('post: [note, fact]\ndigest_chars: 500')).toEqual({
      post: ['note', 'fact'],
      digestChars: 500,
    });
    expect(boardOf('post: [result]')).toEqual({ post: ['result'], digestChars: 4000 });
  });

  it('reads read: an empty map means both defaults', () => {
    expect(boardOf('read: {}')).toEqual({ read: {}, post: [], digestChars: 4000 });
  });

  it('reads the steps and kinds of read', () => {
    expect(boardOf('read:\n  steps: [first]\n  kinds: [result, fact, critique]')).toEqual({
      read: { steps: ['first'], kinds: ['result', 'fact', 'critique'] },
      post: [],
      digestChars: 4000,
    });
  });

  it('accepts an ancestor reached through depends_on, transitively', () => {
    expect(boardOf('read:\n  steps: [first, second]')?.read?.steps).toEqual(['first', 'second']);
  });

  it('accepts a board on a debate step that only reads', () => {
    const yaml = `${HEAD}steps:
  - {id: first, runner: shell, commands: [echo]}
  - id: debate
    role: a
    runner: claude
    consensus_with: [b]
    depends_on: [first]
    board: {read: {}}
`;
    expect(parseWorkflow(yaml).steps[1]?.board?.read).toEqual({});
  });
});

describe('the board field, refused', () => {
  const CASES: [string, string, string][] = [
    ['a read that is not a mapping', 'read: yes', 'steps[3].board.read must be a mapping'],
    [
      'a read step that does not exist',
      'read:\n  steps: [nope]',
      'steps[3].board.read.steps[0] "nope" is not a step',
    ],
    [
      'a read step that is not an ancestor',
      'read:\n  steps: [first, other]',
      'steps[3].board.read.steps[1] "other" is not an ancestor of this step',
    ],
    [
      'the step itself in read',
      'read:\n  steps: [me]',
      'steps[3].board.read.steps[0] "me" is not an ancestor of this step',
    ],
    [
      'an empty list of read steps',
      'read:\n  steps: []',
      'steps[3].board.read.steps must name at least one step',
    ],
    ['a read step that is not text', 'read:\n  steps: [1]', 'steps[3].board.read.steps[0] must be a string'],
    [
      'a kind that does not exist',
      'read:\n  kinds: [note, bogus]',
      'steps[3].board.read.kinds[1] "bogus" is not a kind',
    ],
    ['an empty list of kinds', 'read:\n  kinds: []', 'steps[3].board.read.kinds must name at least one kind'],
    ['a post kind that does not exist', 'post: [bogus]', 'steps[3].board.post[0] "bogus" is not a kind'],
    [
      'a debate kind in post',
      'post: [note, critique]',
      'steps[3].board.post[1] "critique" cannot be posted by a step',
    ],
    [
      'a decision in post',
      'post: [decision]',
      'steps[3].board.post[0] "decision" cannot be posted by a step',
    ],
    ['a post that is not a list', 'post: note', 'steps[3].board.post must be a list of strings'],
    ['digest_chars too small', 'digest_chars: 199', 'steps[3].board.digest_chars must be from 200 to 20000'],
    [
      'digest_chars too large',
      'digest_chars: 20001',
      'steps[3].board.digest_chars must be from 200 to 20000',
    ],
    [
      'digest_chars that is not a number',
      'digest_chars: lots',
      'steps[3].board.digest_chars must be an integer',
    ],
    [
      'digest_chars that is fractional',
      'digest_chars: 300.5',
      'steps[3].board.digest_chars must be an integer',
    ],
    ['an unknown key', 'read: {}\nwrite: [note]', 'steps[3].board.write is not a board setting'],
    ['an unknown key in read', 'read:\n  roles: [a]', 'steps[3].board.read.roles is not a board setting'],
  ];

  it.each(CASES)('%s', (_name, board, expected) => {
    expect(problemsOf(workflowWith(board))).toContain(expected);
  });

  it('refuses a board that is not a mapping', () => {
    const yaml = `${HEAD}steps:
  - {id: x, runner: claude, role: a, board: 5}
`;
    expect(problemsOf(yaml)).toContain('steps[0].board must be a mapping');
  });

  it('accepts the limits of digest_chars', () => {
    expect(boardOf('digest_chars: 200')?.digestChars).toBe(200);
    expect(boardOf('digest_chars: 20000')?.digestChars).toBe(20000);
  });

  it('refuses a board on a shell step', () => {
    const yaml = `${HEAD}steps:\n  - {id: x, runner: shell, commands: [echo], board: {read: {}}}\n`;
    expect(problemsOf(yaml)).toContain(
      'steps[0].board is not allowed on a shell step: it has no prompt to add notes to and no reply to read posts from',
    );
  });

  it('refuses post on a debate step, which posts through the engine', () => {
    const yaml = `${HEAD}steps:
  - id: debate
    role: a
    runner: claude
    consensus_with: [b]
    board: {post: [note]}
`;
    expect(problemsOf(yaml)).toContain(
      "steps[0].board.post is not allowed on a debate step: the engine posts a debate's messages",
    );
  });

  it('reports every problem of one board together', () => {
    const problems = problemsOf(workflowWith('read:\n  kinds: [bogus]\npost: [decision]\ndigest_chars: 1'));
    expect(problems.split('\n')).toHaveLength(3);
  });
});

describe('the editor schema of the board field', () => {
  it('describes the board, refusing unknown keys and the kinds an agent may not post', () => {
    const text = JSON.stringify(workflowJsonSchema());
    expect(text).toContain('"digest_chars":{"type":"integer","minimum":200,"maximum":20000');
    expect(text).toContain('"enum":["note","question","result","fact"]');
    expect(text).toContain('"additionalProperties":false,"properties":{"read"');
  });
});

describe('a bare read: (what the final review found)', () => {
  it('is refused with the way to ask for the defaults, instead of reading nothing without a word', () => {
    const text = problemsOf(workflowWith('read:'));
    expect(text).toContain('steps[3].board.read must be a mapping; write read: {} for the defaults');
  });

  it('does not say it twice for a value that is not a mapping at all', () => {
    const text = problemsOf(workflowWith('read: 5'));
    expect(text.split('\n').filter((l) => l.includes('board.read'))).toHaveLength(1);
  });

  it('still takes read: {} as the defaults', () => {
    expect(() => parseWorkflow(workflowWith('read: {}'))).not.toThrow();
  });
});
