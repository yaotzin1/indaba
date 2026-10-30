import type { BoardFileRecord, RunRecord } from '@indaba/engine';
import { describe, expect, it, vi } from 'vitest';

// as in dashboard.test.ts: the fake terminal must look like one that shows colour, and CI must not make Ink draw only once
vi.hoisted(() => {
  process.env.FORCE_COLOR = '1';
  process.env.CI = 'true';
});

import { runDashboard } from '../src/dashboard.js';
import { ROOT, sampleRecords, T, TRACE } from './fixtures.js';
import { FakeStdin, FakeStdout, sleep, until } from './terminal.js';

const AT = '2026-10-30T12:00:00.000Z';

async function* endless<T>(records: readonly T[]): AsyncGenerator<T> {
  yield* records;
  await new Promise<void>(() => {});
}

const board: readonly BoardFileRecord[] = [
  { type: 'board', v: 1, at: AT, traceId: TRACE, workflow: 'demo' },
  {
    type: 'post',
    seq: 1,
    at: AT,
    stepId: 'plan',
    attempt: 1,
    scope: 'step',
    source: 'agent',
    sender: 'plan',
    kind: 'note',
    text: 'the API is paged',
    cut: false,
  },
  {
    type: 'post',
    seq: 2,
    at: AT,
    stepId: 'plan',
    attempt: 1,
    scope: 'step',
    source: 'agent',
    sender: 'plan',
    kind: 'fact',
    key: 'api.version',
    text: 'v2',
    cut: false,
  },
  { type: 'settle', seq: 3, at: AT, stepId: 'plan', attempt: 1, scope: 'step', outcome: 'accepted' },
];

function start(
  extra: { board?: AsyncIterable<BoardFileRecord>; records?: readonly RunRecord[]; ascii?: boolean } = {},
) {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  const done = runDashboard({
    source: endless(extra.records ?? sampleRecords()),
    ...(extra.board === undefined ? {} : { board: extra.board }),
    attached: false,
    ascii: extra.ascii ?? false,
    color: false,
    stdout: stdout as unknown as NodeJS.WritableStream,
    stdin: stdin as unknown as NodeJS.ReadableStream,
    flushMs: 5,
  });
  return { stdout, stdin, done };
}

describe('the board pane of the dashboard (AC-33 to AC-38)', () => {
  it('opens with b, lists the entries read from the board, and closes with b', async () => {
    const { stdout, stdin, done } = start({ board: endless(board) });
    await until(() => stdout.text.includes('plan'));
    stdin.type('b');
    await until(() => stdout.text.includes('#1  plan  plan  ● Note  the API is paged'));
    expect(stdout.text).toContain('Board: notes between steps (2)');
    expect(stdout.text).toContain('Enter open');
    stdin.type('b');
    await until(() => stdout.text.includes('b board'));
    stdin.type('q');
    expect((await done).quit).toBe('close');
  });

  it('filters, opens an entry and goes back, with the keys of the board', async () => {
    const { stdout, stdin, done } = start({ board: endless(board) });
    await until(() => stdout.text.includes('plan'));
    stdin.type('b');
    await until(() => stdout.text.includes('the API is paged'));
    stdin.type('f');
    await until(() => stdout.text.includes('api.version: v2  (plan)'));
    stdin.type('f');
    await sleep(40);
    stdin.type('\r');
    await until(() => stdout.text.includes('Step: plan'));
    expect(stdout.text).toContain('Kind: ');
    stdin.type('\u001b');
    await sleep(80);
    stdin.type('s');
    await until(() => stdout.text.includes('Showing: step plan'));
    stdin.type('x');
    stdin.type('q');
    await done;
  });

  it('says there is no board when the run has no board source', async () => {
    const { stdout, stdin, done } = start();
    await until(() => stdout.text.includes('plan'));
    stdin.type('b');
    await until(() => stdout.text.includes('There is no board for this run.'));
    stdin.type('q');
    await done;
  });

  it('says there is no board file yet, until the first record arrives', async () => {
    const { stdout, stdin, done } = start({ board: endless([]) });
    await until(() => stdout.text.includes('plan'));
    stdin.type('b');
    await until(() => stdout.text.includes('No board file yet.'));
    stdin.type('q');
    await done;
  });

  it('says the board is incomplete when the run reported that it could not write it', async () => {
    const degraded: RunRecord = {
      type: 'span_ended',
      at: T(5),
      traceId: TRACE,
      spanId: ROOT,
      status: 'ok',
      statusMessage: undefined,
      attributes: {},
      events: [{ name: 'indaba.board.degraded', attributes: {} }],
    };
    const { stdout, stdin, done } = start({ board: endless(board), records: [...sampleRecords(), degraded] });
    await until(() => stdout.text.includes('plan'));
    stdin.type('b');
    await until(() => stdout.text.includes('The board is incomplete'));
    stdin.type('q');
    await done;
  });

  it('draws in ASCII when asked, and lists the board keys in the help', async () => {
    const { stdout, stdin, done } = start({ board: endless(board), ascii: true });
    await until(() => stdout.text.includes('plan'));
    stdin.type('b');
    await until(() => stdout.text.includes('o Note'));
    stdin.type('?');
    await until(() => stdout.text.includes('Board keys'));
    stdin.type('?');
    stdin.type('q');
    await done;
  });

  it('keeps going when the board source fails', async () => {
    async function* broken(): AsyncGenerator<BoardFileRecord> {
      yield* board;
      throw new Error('the file went away');
    }
    const { stdout, stdin, done } = start({ board: broken() });
    await until(() => stdout.text.includes('plan'));
    stdin.type('b');
    await until(() => stdout.text.includes('the API is paged'));
    stdin.type('q');
    expect((await done).quit).toBe('close');
  });
});
