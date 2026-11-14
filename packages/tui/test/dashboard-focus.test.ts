import type { RunRecord } from '@indaba/engine';
import { describe, expect, it, vi } from 'vitest';

// as dashboard.test.ts: a fake terminal cannot show colour, and Ink reads CI as "draw only the last frame"
vi.hoisted(() => {
  process.env.FORCE_COLOR = '1';
  process.env.CI = 'true';
});

import { runDashboard } from '../src/dashboard.js';
import { sampleRecords } from './fixtures.js';
import { FakeStdin, FakeStdout, KEY, until } from './terminal.js';

/** The same wait with more time: the whole suite runs these files side by side, and a loaded machine draws late. */
const wait = (check: () => boolean): Promise<void> => until(check, 8000);

/** A source the test feeds, like a run that is still going. */
function feed(first: readonly RunRecord[]) {
  const queue: RunRecord[] = [...first];
  let wake: () => void = () => undefined;
  const source = (async function* () {
    for (;;) {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
        }
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  })();
  return {
    source,
    push: (...more: RunRecord[]) => {
      queue.push(...more);
      wake();
    },
  };
}

function start(records: readonly RunRecord[], size: [number, number] = [100, 30]) {
  const stdout = new FakeStdout(size[0], size[1]);
  const stdin = new FakeStdin();
  const input = feed([...records]);
  const typeKey = stdin.type.bind(stdin);
  stdin.type = (data: string): void => {
    typedAt.set(stdout, stdout.frames.length);
    typeKey(data);
  };
  const done = runDashboard({
    source: input.source,
    attached: false,
    ascii: false,
    color: false,
    stdout: stdout as unknown as NodeJS.WritableStream,
    stdin: stdin as unknown as NodeJS.ReadableStream,
    flushMs: 5,
  });
  return { stdout, stdin, done, push: input.push };
}

/** Where the screen was when the last key was typed: only what is drawn after a key can answer it. */
const typedAt = new WeakMap<FakeStdout, number>();

/** What was drawn since the last key. */
const since = (stdout: FakeStdout): string => stdout.frames.slice(typedAt.get(stdout) ?? 0).join('');

/** What was drawn from the last few writes: Ink ends a picture with a control sequence of its own. */
const lately = (stdout: FakeStdout): string => stdout.frames.slice(-4).join('');

describe('where the arrow keys are, and Tab and Shift-Tab (specs/tui-pane-focus)', () => {
  const SHIFT_TAB = '[Z';

  it('marks the area that has the keys, and moves the mark with Tab and Shift-Tab', async () => {
    const { stdout, stdin, done } = start(sampleRecords());
    await wait(() => lately(stdout).includes('▶ Steps'));
    expect(lately(stdout)).toContain('Tab Detail');
    stdin.type(KEY.tab);
    await wait(() => since(stdout).includes('▶ Detail'));
    stdin.type(SHIFT_TAB);
    await wait(() => since(stdout).includes('▶ Steps'));
    stdin.type(SHIFT_TAB);
    await wait(() => since(stdout).includes('▶ Detail'));
    stdin.type('q');
    await done;
  });
});
