import type { RunRecord } from '@indaba/engine';
import { describe, expect, it, vi } from 'vitest';

// as dashboard.test.ts: a fake terminal cannot show colour, and Ink reads CI as "draw only the last frame"
vi.hoisted(() => {
  process.env.FORCE_COLOR = '1';
  process.env.CI = 'true';
});

import { runDashboard } from '../src/dashboard.js';
import { root, sampleRecords, status, stepStart, T, TRACE } from './fixtures.js';
import { FakeStdin, FakeStdout, KEY, sleep, until } from './terminal.js';

/** The same wait with more time: the whole suite runs these files side by side, and a loaded machine draws late. */
const wait = (check: () => boolean): Promise<void> => until(check, 8000);

const thought = (id: string, seq: number, text: string): RunRecord => ({
  type: 'thought',
  at: T(4),
  traceId: TRACE,
  spanId: `s-${id}`,
  seq,
  text,
  cut: false,
});

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

function start(records: readonly RunRecord[], size: [number, number] = [120, 40]) {
  const stdout = new FakeStdout(size[0], size[1]);
  const stdin = new FakeStdin();
  const input = feed([...records, thought('plan', 1, 'pondering the plan\n')]);
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

describe('the panes of running steps in the dashboard (AC-01, AC-02)', () => {
  it('draws a pane for each running step above the output, and keeps the step list and the output', async () => {
    const { stdout, stdin, done } = start(sampleRecords());
    await wait(() => lately(stdout).includes('compiling'));
    const picture = lately(stdout);
    expect(picture).toContain('running  plan');
    expect(picture).toContain('running  build');
    expect(picture).toContain('line two');
    stdin.type('q');
    await done;
  });

  it('shows the reasoning of the selected step with r, and the output again with o', async () => {
    const { stdout, stdin, done } = start(sampleRecords());
    await wait(() => stdout.text.includes('pondering the plan') || lately(stdout).includes('line two'));
    stdin.type('r');
    await wait(() => lately(stdout).includes('pondering the plan') && lately(stdout).includes('reasoning'));
    stdin.type('o');
    await wait(() => lately(stdout).includes('output'));
    stdin.type('q');
    await done;
  });

  it('focuses a pane with ], enlarges it with Enter, and puts it back with Esc', async () => {
    const { stdout, stdin, done } = start(sampleRecords());
    await wait(() => lately(stdout).includes('running  build'));
    stdin.type(']');
    stdin.type(']');
    await sleep(20);
    stdin.type('\r');
    await wait(() => lately(stdout).includes('enlarged, Esc to return'));
    // the enlarged step is the second pane's, not the one selected in the list
    expect(lately(stdout)).toContain('compiling');
    stdin.type(KEY.escape);
    await wait(
      () => !lately(stdout).includes('enlarged, Esc to return') && lately(stdout).includes('running  plan'),
    );
    stdin.type('q');
    await done;
  });

  it('enlarges with z as well, and leaves the board key as it was', async () => {
    const { stdout, stdin, done } = start(sampleRecords());
    await wait(() => lately(stdout).includes('running  plan'));
    stdin.type('z');
    await wait(() => lately(stdout).includes('enlarged, Esc to return'));
    stdin.type('b');
    await sleep(40);
    // the board is blocked while a pane is enlarged
    expect(lately(stdout)).toContain('enlarged, Esc to return');
    stdin.type(KEY.escape);
    await wait(() => !lately(stdout).includes('enlarged, Esc to return'));
    stdin.type('b');
    await wait(() => lately(stdout).includes('board'));
    stdin.type('q');
    await done;
  });

  it('closes an enlarged pane when its step finishes, and says so', async () => {
    const { stdout, stdin, done, push } = start(sampleRecords());
    await wait(() => lately(stdout).includes('running  plan'));
    stdin.type('z');
    await wait(() => lately(stdout).includes('enlarged, Esc to return'));
    push({ ...status('plan', 'COMPLETED', undefined, T(9)) });
    await wait(() => lately(stdout).includes('step is no longer running'));
    expect(lately(stdout)).not.toContain('enlarged, Esc to return');
    // the next key takes the line of news away
    stdin.type('j');
    // a picture drawn after the key has the usual key line again, so the line of news is gone
    await wait(
      () => since(stdout).includes('q quit') && !since(stdout).includes('step is no longer running'),
    );
    stdin.type('q');
    await done;
  });

  it('survives a resize, down to the smallest terminal, while a pane is enlarged', async () => {
    const { stdout, stdin, done } = start(sampleRecords());
    await wait(() => lately(stdout).includes('running  plan'));
    stdin.type('z');
    await wait(() => lately(stdout).includes('enlarged, Esc to return'));
    stdout.resize(40, 8);
    await sleep(60);
    stdout.resize(200, 50);
    await wait(() => lately(stdout).includes('enlarged, Esc to return'));
    stdin.type(KEY.escape);
    await sleep(20);
    stdin.type('q');
    await expect(done).resolves.toMatchObject({ quit: 'close' });
  });

  it('draws no pane at the smallest terminal, where the list and detail are all there is room for', async () => {
    const { stdout, stdin, done } = start(sampleRecords(), [40, 8]);
    await wait(() => lately(stdout).includes('plan'));
    await sleep(40);
    expect(lately(stdout)).not.toContain('running  plan');
    stdin.type('q');
    await done;
  });

  it('adds a run that has only a header and no step to nothing', async () => {
    const { stdout, stdin, done } = start([root(), stepStart('idle')]);
    await wait(() => lately(stdout).length > 0);
    await sleep(40);
    expect(lately(stdout)).not.toContain('running  idle');
    stdin.type('q');
    await done;
  });
});
