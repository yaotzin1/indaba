import { DEFAULT_READ_KINDS, type StepDefinition } from '@indaba/core';

/**
 * The line `indaba plan` prints under a step that has a `board` field (specs/run-blackboard): what the step reads from
 * the notes between steps and what it may post. Plain words; the workflow's own field names are not repeated.
 */
export function describeBoard(step: StepDefinition): string | undefined {
  const board = step.board;
  if (board === undefined) {
    return undefined;
  }
  const posts = board.post.length === 0 ? 'nothing' : board.post.join(', ');
  const read = board.read;
  if (read === undefined) {
    return `board: reads nothing; may post ${posts}`;
  }
  const from = read.steps === undefined ? 'all ancestors' : read.steps.join(', ');
  const kinds = (read.kinds ?? DEFAULT_READ_KINDS).join(', ');
  return `board: reads ${from} (${kinds}), at most ${board.digestChars} characters; may post ${posts}`;
}
