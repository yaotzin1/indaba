import type { RunRecord } from '@indaba/engine';
import { describe, expect, it } from 'vitest';
import { MAX_REPLAY_WAIT_MS, replay } from '../src/index.js';
import { output, root, stepStart, T } from './fixtures.js';

async function collect(records: readonly RunRecord[], speed: 1 | 10) {
  const waits: number[] = [];
  const got: RunRecord[] = [];
  const sleep = async (ms: number): Promise<void> => {
    waits.push(ms);
  };
  for await (const record of replay(records, { speed, sleep })) {
    got.push(record);
  }
  return { waits, got };
}

describe('replay', () => {
  const records = [root(T(0)), stepStart('a', T(4)), output('a', 1, 'x\n', T(6))];

  it('gives every record, in order, waiting the gaps they originally had', async () => {
    const { waits, got } = await collect(records, 1);
    expect(got).toEqual(records);
    expect(waits).toEqual([2000, 2000]);
  });

  it('divides the waits by the speed', async () => {
    expect((await collect(records, 10)).waits).toEqual([400, 200]);
  });

  it('never waits longer than the cap, however long the real gap was', async () => {
    const { waits } = await collect([root(T(0)), stepStart('a', T(3000))], 1);
    expect(waits).toEqual([MAX_REPLAY_WAIT_MS]);
  });

  it('does not wait for a record at the same time or earlier, or for one without a usable time', async () => {
    const odd: RunRecord[] = [
      root(T(5)),
      stepStart('a', T(5)),
      stepStart('b', T(2)),
      { type: 'unknown', text: 'garbage' },
      { ...(stepStart('c') as Extract<RunRecord, { type: 'span_started' }>), at: 'not a date' },
    ];
    const { waits, got } = await collect(odd, 1);
    expect(got).toHaveLength(5);
    expect(waits).toEqual([]);
  });

  it('stops at once when the signal is aborted', async () => {
    const controller = new AbortController();
    const got: RunRecord[] = [];
    for await (const record of replay(records, {
      speed: 1,
      signal: controller.signal,
      sleep: async () => {},
    })) {
      got.push(record);
      controller.abort();
    }
    expect(got).toHaveLength(1);
  });

  it('really waits with the default timer, and a signal cuts the wait short', async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 20);
    const got: RunRecord[] = [];
    for await (const record of replay([root(T(0)), stepStart('a', T(1))], {
      speed: 1,
      signal: controller.signal,
    })) {
      got.push(record);
    }
    expect(Date.now() - started).toBeLessThan(900);
    expect(got.length).toBeLessThanOrEqual(2);
  });

  it('gives nothing when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const got: RunRecord[] = [];
    for await (const r of replay(records, { speed: 1, signal: controller.signal })) {
      got.push(r);
    }
    expect(got).toEqual([]);
  });

  it('finishes a short gap quickly at ten times the speed, with the default timer', async () => {
    const got: RunRecord[] = [];
    for await (const r of replay([root(T(0)), stepStart('a', T(1))], { speed: 10 })) {
      got.push(r);
    }
    expect(got).toHaveLength(2);
  });
});
