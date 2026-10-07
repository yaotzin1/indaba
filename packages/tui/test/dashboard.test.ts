import type { RunRecord } from '@indaba/engine';
import { describe, expect, it, vi } from 'vitest';

// the colour library decides at load time whether the terminal can show colour; a fake one cannot, so say it can
// and Ink reads CI the same way: with it set Ink would draw only the last frame, which the dashboard must not depend on
vi.hoisted(() => {
  process.env.FORCE_COLOR = '1';
  process.env.CI = 'true';
});

import { runDashboard } from '../src/dashboard.js';
import { keyName } from '../src/ink/app.js';
import { sampleRecords } from './fixtures.js';
import { FakeStdin, FakeStdout, KEY, sleep, until } from './terminal.js';

async function* finite(records: readonly RunRecord[]): AsyncGenerator<RunRecord> {
  for (const r of records) {
    yield r;
  }
}

/** A source that never ends, like a run that is still going. */
async function* endless(records: readonly RunRecord[]): AsyncGenerator<RunRecord> {
  yield* records;
  await new Promise<void>(() => {});
}

function start(
  source: AsyncIterable<RunRecord>,
  extra: { attached?: boolean; ascii?: boolean; color?: boolean } = {},
) {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  const done = runDashboard({
    source,
    attached: extra.attached ?? false,
    ascii: extra.ascii ?? false,
    color: extra.color ?? false,
    stdout: stdout as unknown as NodeJS.WritableStream,
    stdin: stdin as unknown as NodeJS.ReadableStream,
    flushMs: 5,
  });
  return { stdout, stdin, done };
}

describe('runDashboard', () => {
  it('draws the steps and their output as the records arrive', async () => {
    const { stdout, stdin, done } = start(endless(sampleRecords()));
    await until(() => stdout.text.includes('build') && stdout.text.includes('line two'));
    stdin.type('q');
    const result = await done;
    expect(result.quit).toBe('close');
    expect(result.run.steps.map((s) => s.id)).toEqual(['plan', 'build']);
  });

  it('moves the selection with the keys and shows the other step output', async () => {
    const { stdout, stdin, done } = start(endless(sampleRecords()));
    await until(() => stdout.text.includes('line two'));
    stdin.type(KEY.down);
    await until(() => stdout.text.includes('compiling'));
    stdin.type('q');
    await done;
  });

  it('opens help and closes it again', async () => {
    const { stdout, stdin, done } = start(endless(sampleRecords()));
    await until(() => stdout.text.includes('plan'));
    stdin.type('?');
    await until(() => stdout.text.includes('Keys'));
    stdin.type('?');
    await sleep(30);
    stdin.type('q');
    expect((await done).quit).toBe('close');
  });

  it('keeps going after the source ends, until the person quits', async () => {
    const { stdout, stdin, done } = start(finite(sampleRecords()));
    await until(() => stdout.text.includes('compiling') || stdout.text.includes('line two'));
    let finished = false;
    void done.then(() => {
      finished = true;
    });
    await sleep(60);
    expect(finished).toBe(false);
    stdin.type('q');
    await done;
  });

  it('shows what it has when the source fails', async () => {
    async function* failing(): AsyncGenerator<RunRecord> {
      yield* sampleRecords();
      throw new Error('the file went away');
    }
    const { stdout, stdin, done } = start(failing());
    await until(() => stdout.text.includes('plan'));
    stdin.type('q');
    expect((await done).run.steps).toHaveLength(2);
  });

  it('asks what to do with a run the screen started, and detaches or cancels as told', async () => {
    const detach = start(endless(sampleRecords()), { attached: true });
    await until(() => detach.stdout.text.includes('plan'));
    detach.stdin.type('q');
    await until(() => detach.stdout.text.includes('d detach'));
    detach.stdin.type('d');
    expect((await detach.done).quit).toBe('detach');

    const cancel = start(endless(sampleRecords()), { attached: true });
    await until(() => cancel.stdout.text.includes('plan'));
    cancel.stdin.type(KEY.ctrlC);
    await until(() => cancel.stdout.text.includes('c cancel'));
    cancel.stdin.type('c');
    expect((await cancel.done).quit).toBe('cancel');
  });

  it('stays when the person answers n, and still quits after', async () => {
    const t = start(endless(sampleRecords()), { attached: true });
    await until(() => t.stdout.text.includes('plan'));
    t.stdin.type('q');
    await until(() => t.stdout.text.includes('d detach'));
    t.stdin.type('n');
    await sleep(40);
    t.stdin.type('q');
    await sleep(20);
    t.stdin.type('d');
    expect((await t.done).quit).toBe('detach');
  });

  it('gives the terminal back: raw mode is on while it runs and off after', async () => {
    const { stdout, stdin, done } = start(endless(sampleRecords()));
    await until(() => stdout.text.includes('plan'));
    expect(stdin.rawMode).toBe(true);
    stdin.type('q');
    await done;
    expect(stdin.rawMode).toBe(false);
    expect(stdin.rawHistory).toContain(true);
  });

  it('draws the notice, and no panes, on a terminal that is too small', async () => {
    const stdout = new FakeStdout(30, 5);
    const stdin = new FakeStdin();
    const done = runDashboard({
      source: endless(sampleRecords()),
      attached: false,
      ascii: true,
      color: false,
      stdout: stdout as unknown as NodeJS.WritableStream,
      stdin: stdin as unknown as NodeJS.ReadableStream,
      flushMs: 5,
    });
    await until(() => stdout.text.includes('Terminal too small'));
    stdin.type('q');
    await done;
  });

  it('draws colour only when asked', async () => {
    const on = start(endless(sampleRecords()), { color: true });
    await until(() => on.stdout.text.includes('plan'));
    on.stdin.type('q');
    await on.done;
    const off = start(endless(sampleRecords()), { color: false });
    await until(() => off.stdout.text.includes('plan'));
    off.stdin.type('q');
    await off.done;
    const esc = String.fromCharCode(27);
    const colored = (text: string): boolean => new RegExp(`${esc}\\[3[0-7]m`).test(text);
    expect(colored(off.stdout.text)).toBe(false);
    expect(colored(on.stdout.text)).toBe(true);
  });

  it('does not let an agent write control sequences to the terminal', async () => {
    const esc = String.fromCharCode(27);
    const records = [
      ...sampleRecords(),
      {
        type: 'output',
        at: new Date(Date.UTC(2026, 9, 5, 12, 0, 9)).toISOString(),
        traceId: 'a'.repeat(32),
        spanId: 's-build',
        seq: 2,
        text: `${esc}]0;owned${String.fromCharCode(7)}${esc}[2Jtail\n`,
        cut: false,
      } satisfies RunRecord,
    ];
    const { stdout, stdin, done } = start(endless(records));
    await until(() => stdout.text.includes('plan'));
    stdin.type(KEY.down);
    await until(() => stdout.text.includes('tail'));
    expect(stdout.text).not.toContain('owned');
    expect(stdout.text).not.toContain(`${esc}]0;`);
    expect(stdout.text).not.toContain(`${esc}[2J${'t'}`);
    stdin.type('q');
    await done;
  });

  it('restores the terminal when the screen throws', async () => {
    // a source that throws is absorbed; a throwing stdout is not, and must still release raw mode
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    let calls = 0;
    const original = stdout.write.bind(stdout);
    stdout.write = (chunk: string, callback?: () => void): boolean => {
      calls += 1;
      if (calls > 3) {
        throw new Error('broken pipe');
      }
      return original(chunk, callback);
    };
    const attempt = runDashboard({
      source: endless(sampleRecords()),
      attached: false,
      ascii: false,
      color: false,
      stdout: stdout as unknown as NodeJS.WritableStream,
      stdin: stdin as unknown as NodeJS.ReadableStream,
      flushMs: 5,
    });
    const timeout = sleep(1500).then(() => 'hung');
    const outcome = await Promise.race([attempt.then(() => 'ended').catch(() => 'threw'), timeout]);
    if (outcome === 'hung') {
      stdin.type('q');
      await attempt.catch(() => undefined);
    }
    expect(stdin.rawMode).toBe(false);
  });
});

describe('keyName', () => {
  const none = {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageUp: false,
    pageDown: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  };
  it('names the keys the screen knows', () => {
    expect(keyName('', { ...none, upArrow: true })).toBe('up');
    expect(keyName('', { ...none, downArrow: true })).toBe('down');
    expect(keyName('', { ...none, pageUp: true })).toBe('pageup');
    expect(keyName('', { ...none, pageDown: true })).toBe('pagedown');
    expect(keyName('', { ...none, home: true })).toBe('home');
    expect(keyName('', { ...none, end: true })).toBe('end');
    expect(keyName('', { ...none, tab: true })).toBe('tab');
    expect(keyName('', { ...none, escape: true })).toBe('escape');
    expect(keyName('', { ...none, return: true })).toBe('enter');
    expect(keyName('c', { ...none, ctrl: true })).toBe('ctrl-c');
    expect(keyName('q', none)).toEqual({ char: 'q' });
  });

  it('ignores a modified or empty key, so ctrl-d or alt-q is not d or q', () => {
    expect(keyName('d', { ...none, ctrl: true })).toBeUndefined();
    expect(keyName('q', { ...none, meta: true })).toBeUndefined();
    expect(keyName('', none)).toBeUndefined();
  });
});
