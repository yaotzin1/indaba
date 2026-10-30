import { describe, expect, it } from 'vitest';
import { BoardKind, buildDigest, DEFAULT_READ_KINDS, parseBoardLines, RunBoard } from '../src/index.js';

const clock = { now: () => new Date(Date.UTC(2026, 9, 11, 9, 0, 0)) };
const SELECT = { steps: ['s'], forStep: 'later', kinds: DEFAULT_READ_KINDS, maxChars: 200 } as const;
const ALL = [BoardKind.Note, BoardKind.Question, BoardKind.Result, BoardKind.Fact];

describe('the digest at its smallest size (the final review)', () => {
  it('stays within 200 characters for an empty board', () => {
    const board = new RunBoard({ traceId: 'a'.repeat(32), workflow: 'w', clock });
    const digest = buildDigest(board, SELECT);
    expect(digest.chars).toBe(digest.text.length);
    expect(digest.text.length).toBeLessThanOrEqual(200);
  });

  it('stays within 200 characters when nothing fits among the most entries a board holds', () => {
    const board = new RunBoard({ traceId: 'a'.repeat(32), workflow: 'w', clock });
    for (let i = 0; i < 2000; i += 1) {
      board.post({
        stepId: 's',
        attempt: 1,
        source: 'agent',
        sender: 's',
        kind: BoardKind.Note,
        text: 'x'.repeat(300),
      });
    }
    board.settle({ stepId: 's', attempt: 1, outcome: 'accepted' });
    const digest = buildDigest(board, SELECT);
    expect(digest.entries).toBe(0);
    expect(digest.omitted).toBe(2000);
    expect(digest.text.length).toBeLessThanOrEqual(200);
  });
});

describe('code fences in a reply (the final review)', () => {
  const posts = (reply: string): string[] => parseBoardLines(reply, ALL).posts.map((p) => p.text);
  const tick = String.fromCharCode(96);
  const fence = (n: number, info = ''): string => `${tick.repeat(n)}${info}`;

  it('keeps a line inside a longer fence out of the posts, even when a shorter fence appears inside it', () => {
    const reply = [
      fence(4),
      fence(3),
      'BOARD note: still inside',
      fence(3),
      fence(4),
      'BOARD note: outside',
    ].join('\n');
    expect(posts(reply)).toEqual(['outside']);
  });

  it('does not let a fence with an info string close a fence', () => {
    const reply = [
      fence(3),
      fence(3, 'js'),
      'BOARD note: still inside',
      fence(3),
      'BOARD note: outside',
    ].join('\n');
    expect(posts(reply)).toEqual(['outside']);
  });

  it('closes a fence with one at least as long, and tilde fences are separate from backtick ones', () => {
    const reply = [
      fence(3),
      'BOARD note: a',
      fence(5),
      'BOARD note: b',
      '~~~',
      'BOARD note: c',
      fence(3),
      'BOARD note: d',
      '~~~',
    ].join('\n');
    // d is inside the tilde fence: a backtick fence cannot close it
    expect(posts(reply)).toEqual(['b']);
  });

  it('still reads a post after a fence that is never closed as inside it', () => {
    expect(posts([fence(3), 'BOARD note: lost'].join('\n'))).toEqual([]);
  });
});
