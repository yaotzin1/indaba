import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentMessage, ConsensusOutcome, ConsensusResult, MessageType } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { DISCUSSION_DIRECTORY, DiscussionStore, discussionOf } from '../src/index.js';
import { makeTempDir } from './support.js';

const TRACE = 'a'.repeat(32);
const ESC = String.fromCharCode(0x1b);
const same = (text: string): string => text;

const result = (...messages: AgentMessage[]): ConsensusResult =>
  new ConsensusResult(ConsensusOutcome.Stalled, 2, messages);

describe('discussionOf', () => {
  it('keeps every message in order and nothing else', () => {
    const view = discussionOf(
      'debate',
      result(
        new AgentMessage('claude', MessageType.Critique, 'first', 1),
        new AgentMessage('antigravity', MessageType.Agreement, 'second', 1),
      ),
      same,
    );
    expect(view).toEqual({
      stepId: 'debate',
      outcome: 'stalled',
      rounds: 2,
      messages: [
        { round: 1, sender: 'claude', type: 'CRITIQUE', content: 'first' },
        { round: 1, sender: 'antigravity', type: 'AGREEMENT', content: 'second' },
      ],
    });
  });

  it('drops control sequences and applies the redaction to every text, ruling included', () => {
    const secret = ['sk', 'live', '9'].join('-');
    const redact = (text: string) => text.split(secret).join('[redacted]');
    const view = discussionOf(
      'debate',
      result(new AgentMessage(`bot${ESC}[2J`, MessageType.Critique, `key ${secret}${ESC}[31m`, 1)),
      redact,
      { verdict: 'accept', decidedBy: 'human', note: `ok ${secret}` },
    );
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(JSON.stringify(view)).not.toContain(ESC);
    expect(view.ruling).toEqual({ verdict: 'accept', decidedBy: 'human', note: 'ok [redacted]' });
  });
});

describe('DiscussionStore', () => {
  it('keeps a discussion under its run and step, and reads it back', async () => {
    const dir = join(await makeTempDir(), DISCUSSION_DIRECTORY);
    const store = new DiscussionStore(dir);
    const view = discussionOf(
      'debate',
      result(new AgentMessage('claude', MessageType.Critique, 'text', 1)),
      same,
      { verdict: 'accept', decidedBy: 'human', note: 'fine' },
    );
    expect(await store.save(TRACE, view)).toBe(true);
    expect(JSON.parse(await readFile(join(dir, `${TRACE}.debate.json`), 'utf8'))).toMatchObject({
      rounds: 2,
    });
    expect(await store.read(TRACE, 'debate')).toEqual(view);
  });

  it('says nothing was kept for a run, a step or a name that is not an id', async () => {
    const store = new DiscussionStore(await makeTempDir());
    expect(await store.read(TRACE, 'debate')).toBeUndefined();
    for (const [trace, step] of [
      ['..', 'debate'],
      [TRACE, '../x'],
      [TRACE, 'a/b'],
      [TRACE, 'a\\b'],
      [TRACE, ''],
      ['A'.repeat(32), 'debate'],
    ] as const) {
      expect(await store.read(trace, step)).toBeUndefined();
    }
    const saved = await store.save('../escape', discussionOf('debate', result(), same));
    expect(saved).toBe(false);
    expect(await store.save(TRACE, discussionOf('../bad', result(), same))).toBe(false);
  });

  it('does not throw when the folder cannot be written', async () => {
    const base = await makeTempDir();
    const blocker = join(base, 'file');
    await writeFile(blocker, 'x');
    const store = new DiscussionStore(join(blocker, 'inside'));
    expect(await store.save(TRACE, discussionOf('debate', result(), same))).toBe(false);
  });

  it.each([
    ['not json', '{'],
    ['an array', '[]'],
    ['no outcome', JSON.stringify({ rounds: 1, messages: [] })],
    ['rounds as text', JSON.stringify({ outcome: 'x', rounds: '1', messages: [] })],
    ['messages as text', JSON.stringify({ outcome: 'x', rounds: 1, messages: 'no' })],
    ['a message without a sender', JSON.stringify({ outcome: 'x', rounds: 1, messages: [{ round: 1 }] })],
    ['a message that is not an object', JSON.stringify({ outcome: 'x', rounds: 1, messages: [3] })],
  ])('reads %s as no discussion', async (_name, body) => {
    const dir = await makeTempDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${TRACE}.debate.json`), body);
    expect(await new DiscussionStore(dir).read(TRACE, 'debate')).toBeUndefined();
  });

  it('cleans what a hand-edited file says, and ignores a ruling that is not one', async () => {
    const dir = await makeTempDir();
    await writeFile(
      join(dir, `${TRACE}.debate.json`),
      JSON.stringify({
        stepId: 'other',
        outcome: `st${ESC}[2Jalled`,
        rounds: 1,
        messages: [
          { round: 1, sender: `a${ESC}[31m`, type: 'CRITIQUE', content: `x${ESC}]8;;http://x${ESC}\\y` },
        ],
        ruling: { verdict: 1 },
      }),
    );
    const view = await new DiscussionStore(dir).read(TRACE, 'debate');
    expect(JSON.stringify(view)).not.toContain(ESC);
    expect(view?.stepId).toBe('debate');
    expect(view?.ruling).toBeUndefined();
  });

  it('reads a ruling that is well formed', async () => {
    const dir = await makeTempDir();
    await writeFile(
      join(dir, `${TRACE}.debate.json`),
      JSON.stringify({
        outcome: 'stalled',
        rounds: 1,
        messages: [],
        ruling: { verdict: 'reject', decidedBy: 'human', note: 'no' },
      }),
    );
    expect((await new DiscussionStore(dir).read(TRACE, 'debate'))?.ruling).toEqual({
      verdict: 'reject',
      decidedBy: 'human',
      note: 'no',
    });
  });
});
