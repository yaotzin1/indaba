import { createLogger, type Logger, type LogRecord, type RunRecord, type RunSummary } from '@indaba/engine';
import { describe, expect, it, vi } from 'vitest';

// as dashboard.test.ts: a fake terminal cannot show colour, and Ink reads CI as "draw only the last frame"
vi.hoisted(() => {
  process.env.FORCE_COLOR = '1';
  process.env.CI = 'true';
});

import { type HomeOptions, run } from '../src/home.js';
import { sampleRecords } from './fixtures.js';
import { makeRun, runs } from './home-fixtures.js';
import { FakeStdin, FakeStdout, KEY, sleep, until } from './terminal.js';

/** A source that never ends, like a run that is still going. */
async function* endless(records: readonly RunRecord[]): AsyncGenerator<RunRecord> {
  yield* records;
  await new Promise<void>(() => {});
}

function start(extra: Partial<HomeOptions> = {}, size: [number, number] = [100, 24]) {
  const stdout = new FakeStdout(size[0], size[1]);
  const stdin = new FakeStdin();
  const done = run({
    listRuns: async () => runs(3),
    ascii: false,
    color: false,
    stdout: stdout as unknown as NodeJS.WritableStream,
    stdin: stdin as unknown as NodeJS.ReadableStream,
    ...extra,
  });
  return { stdout, stdin, done };
}

const recordingLogger = (): { logger: Logger; records: LogRecord[] } => {
  const records: LogRecord[] = [];
  return {
    logger: createLogger({ sinks: [{ write: (r) => void records.push(r) }], clock: () => new Date(0) }),
    records,
  };
};

describe('Home on a terminal', () => {
  it('lists the runs, and q closes it with code 0 (AC-01)', async () => {
    const { stdout, stdin, done } = start();
    await until(() => stdout.text.includes('wf-2'));
    expect(stdout.text).toContain('runs (3)');
    stdin.type('q');
    await expect(done).resolves.toEqual({ quit: 'close', code: 0 });
  });

  it('gives the terminal back: raw mode is on while it is open and off after', async () => {
    const { stdout, stdin, done } = start();
    await until(() => stdout.text.includes('wf-0'));
    expect(stdin.rawMode).toBe(true);
    stdin.type('q');
    await done;
    expect(stdin.rawMode).toBe(false);
  });

  it('moves the selection and shows its details beside the list', async () => {
    const { stdout, stdin, done } = start();
    await until(() => stdout.text.includes('wf-0'));
    stdin.type(KEY.down);
    await until(() => stdout.text.includes('run      a1'));
    stdin.type('q');
    await done;
  });

  it('shows the keys with ? and hides them again', async () => {
    const { stdout, stdin, done } = start();
    await until(() => stdout.text.includes('wf-0'));
    stdin.type('?');
    await until(() => stdout.text.includes('Keys'));
    stdin.type(KEY.escape);
    await sleep(30);
    stdin.type('q');
    await done;
  });

  it('fetches the list again with r, and drops a slow older answer', async () => {
    const answers: Array<(value: RunSummary[]) => void> = [];
    const listRuns = vi.fn(() => new Promise<RunSummary[]>((resolve) => answers.push(resolve)));
    const { stdout, stdin, done } = start({ listRuns });
    await until(() => answers.length === 1);
    stdin.type('r');
    await until(() => answers.length === 2);
    answers[1]?.([makeRun({ runId: 'new1', workflow: 'newer' })]);
    await until(() => stdout.text.includes('newer'));
    answers[0]?.([makeRun({ runId: 'old1', workflow: 'older' })]);
    await sleep(40);
    expect(stdout.text).not.toContain('older');
    stdin.type('q');
    await done;
    expect(listRuns).toHaveBeenCalledTimes(2);
  });

  it('shows a failure and recovers with r', async () => {
    let calls = 0;
    const listRuns = async (): Promise<RunSummary[]> => {
      calls += 1;
      if (calls === 1) {
        throw new Error('disk gone');
      }
      return runs(1);
    };
    const { logger, records } = recordingLogger();
    const { stdout, stdin, done } = start({ listRuns, logger });
    await until(() => stdout.text.includes('disk gone'));
    expect(stdout.text).toContain('r tries again');
    stdin.type('r');
    await until(() => stdout.text.includes('wf-0'));
    stdin.type('q');
    await done;
    expect(records.some((r) => r.message === 'the list of runs could not be read')).toBe(true);
    // the reason is shown on the screen, never put in the log record's message
    expect(JSON.stringify(records)).not.toContain('disk gone');
  });

  it('says so when no way to list works at all (a listRuns that throws at once)', async () => {
    const { stdout, stdin, done } = start({
      listRuns: () => {
        throw new Error('sync failure');
      },
    });
    await until(() => stdout.text.includes('sync failure'));
    stdin.type('q');
    await done;
  });

  it('opens a run on Enter, shows its dashboard, and comes back to the list on q (AC-11)', async () => {
    const aborted: boolean[] = [];
    const openRun = vi.fn((_runId: string, signal: AbortSignal) => {
      signal.addEventListener('abort', () => aborted.push(true));
      return { source: endless(sampleRecords()) };
    });
    const listRuns = vi.fn(async () => runs(2));
    const { stdout, stdin, done } = start({ openRun, listRuns });
    await until(() => stdout.text.includes('wf-0'));
    stdin.type('\r');
    await until(() => stdout.text.includes('line two'));
    expect(openRun).toHaveBeenCalledWith('a0', expect.any(AbortSignal));
    stdin.type('q');
    // back on Home, with the list fetched again, and the run no longer followed
    await until(() => listRuns.mock.calls.length === 2);
    await until(() => aborted.length === 1);
    await until(() => stdout.frames.some((f, i) => i > 0 && f.includes('runs (2)')));
    stdin.type('q');
    await expect(done).resolves.toEqual({ quit: 'close', code: 0 });
  });

  it('ignores Enter when no way to open a run was given, and leaves it out of the keys', async () => {
    const { stdout, stdin, done } = start();
    await until(() => stdout.text.includes('wf-0'));
    stdin.type('\r');
    await sleep(40);
    expect(stdout.text).not.toContain('line two');
    expect(stdout.text).not.toContain('Enter open the run');
    stdin.type('q');
    await done;
  });

  it('does not draw again when a list arrives while a run is open (AC-12)', async () => {
    const answers: Array<(value: RunSummary[]) => void> = [];
    const listRuns = vi.fn(
      () =>
        new Promise<RunSummary[]>((resolve) => {
          answers.push(resolve);
        }),
    );
    const openRun = () => ({ source: endless(sampleRecords()) });
    const { stdout, stdin, done } = start({ listRuns, openRun });
    await until(() => answers.length === 1);
    answers[0]?.(runs(2));
    await until(() => stdout.text.includes('wf-0'));
    stdin.type('r');
    await until(() => answers.length === 2);
    stdin.type(String.fromCharCode(13));
    await until(() => stdout.text.includes('line two'));
    await sleep(40);
    const frames = stdout.frames.length;
    answers[1]?.([makeRun({ runId: 'late', workflow: 'latecomer' })]);
    await sleep(60);
    expect(stdout.frames.length).toBe(frames);
    expect(stdout.text).not.toContain('latecomer');
    stdin.type('q');
    await until(() => listRuns.mock.calls.length === 3);
    answers[2]?.(runs(1));
    await until(() => stdout.frames.slice(-3).join('').includes('runs (1)'));
    stdin.type('q');
    await done;
  });

  it('survives a run that cannot be opened: back to the list, logged', async () => {
    const { logger, records } = recordingLogger();
    const { stdout, stdin, done } = start({
      openRun: () => {
        throw new Error('no such trace');
      },
      logger,
    });
    await until(() => stdout.text.includes('wf-0'));
    stdin.type('\r');
    await until(() => records.some((r) => r.message === 'a run could not be opened'));
    // the list is still there, and no text of the failure was logged
    await until(() => stdout.frames.slice(-3).join('').includes('wf-0'));
    expect(JSON.stringify(records)).not.toContain('no such trace');
    stdin.type('q');
    await expect(done).resolves.toMatchObject({ quit: 'close' });
  });

  it('draws again when the terminal is resized, keeping the state', async () => {
    const { stdout, stdin, done } = start({}, [100, 24]);
    await until(() => stdout.text.includes('wf-0'));
    stdin.type(KEY.down);
    stdout.resize(60, 20);
    await sleep(40);
    stdout.resize(30, 6);
    await until(() => stdout.text.includes('Terminal too small'));
    stdout.resize(100, 24);
    // Ink ends a picture with a control sequence of its own, so the picture is among the last few writes
    await until(() => stdout.frames.slice(-3).join('').includes('run      a1'));
    stdin.type('q');
    await done;
  });

  it('asks detach or stop before leaving when the screen started a run', async () => {
    const { stdout, stdin, done } = start({ attached: true });
    await until(() => stdout.text.includes('wf-0'));
    stdin.type('q');
    await until(() => stdout.text.includes('stop the run'));
    stdin.type('d');
    await expect(done).resolves.toEqual({ quit: 'detach', code: 0 });
  });

  it('cancels with code 130 when the person chooses to stop', async () => {
    const { stdout, stdin, done } = start({ attached: true });
    await until(() => stdout.text.includes('wf-0'));
    stdin.type(KEY.ctrlC);
    await until(() => stdout.text.includes('stop the run'));
    stdin.type('c');
    await expect(done).resolves.toEqual({ quit: 'cancel', code: 130 });
  });

  it('ends with code 130 when the caller aborts, and restores the terminal', async () => {
    const controller = new AbortController();
    const { stdout, stdin, done } = start({ signal: controller.signal });
    await until(() => stdout.text.includes('wf-0'));
    controller.abort();
    await expect(done).resolves.toEqual({ quit: 'cancel', code: 130 });
    expect(stdin.rawMode).toBe(false);
  });

  it('ends at once when the signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { done } = start({ signal: controller.signal });
    await expect(done).resolves.toEqual({ quit: 'cancel', code: 130 });
  });

  it('writes nothing after it closed when a list arrives late (AC-12)', async () => {
    let answer: (value: RunSummary[]) => void = () => undefined;
    const listRuns = () =>
      new Promise<RunSummary[]>((resolve) => {
        answer = resolve;
      });
    const { stdout, stdin, done } = start({ listRuns });
    await until(() => stdout.text.includes('looking for runs'));
    stdin.type('q');
    await done;
    const frames = stdout.frames.length;
    answer(runs(2));
    await sleep(40);
    expect(stdout.frames.length).toBe(frames);
  });

  it('uses ASCII and no colour codes when asked', async () => {
    const { stdout, stdin, done } = start({
      ascii: true,
      color: false,
      listRuns: async () => [makeRun({ workflow: 'café', status: 'failed' })],
    });
    await until(() => stdout.text.includes('caf?'));
    expect(stdout.text).not.toContain('✗');
    expect(stdout.text).not.toContain('\u001b[3');
    stdin.type('q');
    await done;
  });

  it('logs when it opens and closes, with no text of the person', async () => {
    const { logger, records } = recordingLogger();
    const { stdout, stdin, done } = start({ logger });
    await until(() => stdout.text.includes('wf-0'));
    stdin.type('q');
    await done;
    expect(records.map((r) => r.message)).toEqual(expect.arrayContaining(['home opened', 'home closed']));
  });
});
