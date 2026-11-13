import type {
  RunRecord,
  RunSummary,
  StartRunRequest,
  StartStatusResponse,
  StopRunResponse,
} from '@indaba/engine';
import { createLogger, type LogRecord } from '@indaba/engine';
import { describe, expect, it, vi } from 'vitest';

// as dashboard.test.ts: a fake terminal cannot show colour, and Ink reads CI as "draw only the last frame"
vi.hoisted(() => {
  process.env.FORCE_COLOR = '1';
  process.env.CI = 'true';
});

import { type HomeOptions, run } from '../src/home.js';
import type { RunControlPort } from '../src/run-flow.js';
import { sampleRecords } from './fixtures.js';
import { makeRun } from './home-fixtures.js';
import { refusal, USE, workflow } from './run-flow-fixtures.js';
import { FakeStdin, FakeStdout, KEY, sleep, until } from './terminal.js';

async function* endless(records: readonly RunRecord[]): AsyncGenerator<RunRecord> {
  yield* records;
  await new Promise<void>(() => {});
}

interface Fake extends RunControlPort {
  readonly requests: StartRunRequest[];
  readonly stopped: string[];
  detached: number;
  stoppedAll: number;
  alive: Set<string>;
  /** What start does for each request, in order; the last repeats. */
  starts: Array<() => Promise<{ startId: string }>>;
  statuses: Array<StartStatusResponse | undefined>;
  stopAnswer: StopRunResponse | undefined;
  stopAllError: Error | undefined;
  statusCalls: number;
  aliveCalls: number;
}

function fakeControl(over: Partial<Fake> = {}): Fake {
  const fake: Fake = {
    requests: [],
    stopped: [],
    detached: 0,
    stoppedAll: 0,
    alive: new Set(),
    starts: [() => Promise.resolve({ startId: 'web-1' })],
    statuses: [{ state: 'running', runId: 'r1' }],
    stopAnswer: { state: 'stopping' },
    stopAllError: undefined,
    statusCalls: 0,
    aliveCalls: 0,
    list: async () => ({ workflows: [workflow({ id: 'w1', name: 'review' })], truncated: false }),
    start: (request) => {
      fake.requests.push(request);
      const index = Math.min(fake.requests.length - 1, fake.starts.length - 1);
      return (fake.starts[index] ?? (() => Promise.reject(new Error('no start'))))();
    },
    startStatus: () => {
      const index = Math.min(fake.statusCalls, fake.statuses.length - 1);
      fake.statusCalls += 1;
      return fake.statuses[index];
    },
    stop: (runId) => {
      fake.stopped.push(runId);
      if (fake.stopAnswer?.state === 'stopping') {
        // the run ends a moment after it was asked to
        setTimeout(() => fake.alive.delete(runId), 15);
      }
      return fake.stopAnswer;
    },
    isAlive: (runId) => {
      fake.aliveCalls += 1;
      return fake.alive.has(runId);
    },
    detach: () => {
      fake.detached += 1;
    },
    stopAll: async () => {
      fake.stoppedAll += 1;
      if (fake.stopAllError !== undefined) {
        throw fake.stopAllError;
      }
      fake.alive.clear();
    },
    ...over,
  };
  return fake;
}

const confirmation =
  (hash = 'h1') =>
  () =>
    Promise.reject(refusal('confirmation_required', { contentHash: hash, use: USE }));

function start(
  control: Fake | undefined,
  extra: Partial<HomeOptions> = {},
  size: [number, number] = [100, 24],
) {
  const stdout = new FakeStdout(size[0], size[1]);
  const stdin = new FakeStdin();
  const listRuns = async (): Promise<RunSummary[]> => [
    makeRun({ runId: 'r1', workflow: 'review', status: 'running' }),
    makeRun({ runId: 'old', workflow: 'earlier' }),
  ];
  const done = run({
    listRuns,
    openRun: () => ({ source: endless(sampleRecords()) }),
    ...(control === undefined ? {} : { runs: control }),
    pollMs: 5,
    ascii: false,
    color: false,
    stdout: stdout as unknown as NodeJS.WritableStream,
    stdin: stdin as unknown as NodeJS.ReadableStream,
    ...extra,
  });
  return { stdout, stdin, done };
}

const seen = (stdout: FakeStdout, text: string): boolean => stdout.frames.slice(-4).join('').includes(text);

/** Presses the keys of a whole start, up to the run appearing in its dashboard. */
async function startRun(stdout: FakeStdout, stdin: FakeStdin): Promise<void> {
  await until(() => stdout.text.includes('review'));
  stdin.type('n');
  await until(() => seen(stdout, 'Start a workflow'));
  await until(() => seen(stdout, 'app / review'));
  stdin.type('\r');
  await until(() => seen(stdout, 'Confirm what review will use'));
  stdin.type('y');
  await until(() => stdout.text.includes('line two'));
}

describe('starting a run from Home (tui-run-control)', () => {
  it('offers n and s only when a control was supplied', async () => {
    const { stdout, stdin, done } = start(undefined);
    await until(() => stdout.text.includes('review'));
    stdin.type('?');
    await until(() => seen(stdout, 'Keys'));
    expect(stdout.frames.slice(-3).join('')).not.toContain('start a workflow');
    stdin.type('n');
    await sleep(30);
    expect(stdout.text).not.toContain('Start a workflow');
    stdin.type('?');
    stdin.type('q');
    await done;
  });

  it('picks a workflow, confirms what it uses, starts it and shows it as a run started here (AC-02, AC-05)', async () => {
    const control = fakeControl({
      starts: [confirmation('h1'), () => Promise.resolve({ startId: 'web-1' })],
    });
    control.alive.add('r1');
    const { stdout, stdin, done } = start(control);
    await startRun(stdout, stdin);
    expect(control.requests).toEqual([{ workflowId: 'w1' }, { workflowId: 'w1', confirmedHash: 'h1' }]);
    // the run started here asks what to do with it when its dashboard is left
    stdin.type('q');
    await until(() => seen(stdout, 'cancel the run'));
    // n stays in the dashboard; the next q asks again, and d goes back to Home with the run still going
    stdin.type('n');
    await sleep(20);
    stdin.type('q');
    await until(() => seen(stdout, 'cancel the run'));
    stdin.type('d');
    await until(() => seen(stdout, 'earlier'));
    // leaving Home asks too, because a run started here is alive
    stdin.type('q');
    await until(() => seen(stdout, 'stop the run'));
    stdin.type('d');
    await expect(done).resolves.toEqual({ quit: 'detach', code: 0 });
    expect(control.stopped).toEqual([]);
  });

  it('asks for full access separately and sends both hashes (AC-02)', async () => {
    const control = fakeControl({
      starts: [
        confirmation('h1'),
        () =>
          Promise.reject(
            refusal('full_access_required', {
              contentHash: 'h1',
              steps: [{ stepId: 'deploy', runners: ['claude-code'] }],
            }),
          ),
        () => Promise.resolve({ startId: 'web-1' }),
      ],
    });
    control.alive.add('r1');
    const { stdout, stdin, done } = start(control);
    await until(() => stdout.text.includes('review'));
    stdin.type('n');
    await until(() => seen(stdout, 'app / review'));
    stdin.type('\r');
    await until(() => seen(stdout, 'Confirm what review will use'));
    stdin.type('y');
    await until(() => seen(stdout, 'FULL access'));
    expect(stdout.frames.slice(-3).join('')).toContain('deploy');
    // y and Enter do not grant full access
    stdin.type('y');
    stdin.type('\r');
    await sleep(30);
    expect(control.requests).toHaveLength(2);
    stdin.type('a');
    await until(() => stdout.text.includes('line two'));
    expect(control.requests[2]).toEqual({
      workflowId: 'w1',
      confirmedHash: 'h1',
      fullAccessConfirmedHash: 'h1',
    });
    // leave the dashboard of the run (it asks, as the run is ours), then leave Home and stop what was started here
    stdin.type('q');
    await until(() => seen(stdout, 'cancel the run'));
    stdin.type('d');
    await until(() => seen(stdout, 'earlier'));
    stdin.type('q');
    await until(() => seen(stdout, 'stop the run'));
    stdin.type('c');
    await expect(done).resolves.toEqual({ quit: 'cancel', code: 130 });
    expect(control.stoppedAll).toBe(1);
  });

  it('says the file changed when it changes between the two confirmations (AC-10)', async () => {
    const control = fakeControl({
      starts: [confirmation('old'), confirmation('new')],
    });
    const { stdout, stdin, done } = start(control);
    await until(() => stdout.text.includes('review'));
    stdin.type('n');
    await until(() => seen(stdout, 'app / review'));
    stdin.type('\r');
    await until(() => seen(stdout, 'Confirm what review will use'));
    stdin.type('y');
    await until(() => seen(stdout, 'changed since you looked'));
    stdin.type('y');
    await until(() => control.requests.length === 3);
    expect(control.requests.map((r) => r.confirmedHash)).toEqual([undefined, 'old', 'new']);
    stdin.type('n');
    await sleep(20);
    stdin.type('q');
    await done;
  });

  it('shows a refusal at the cap, and goes back on any key', async () => {
    const control = fakeControl({
      starts: [() => Promise.reject(refusal('too_many_runs', {}, '4 runs are alive'))],
    });
    const { stdout, stdin, done } = start(control);
    await until(() => stdout.text.includes('review'));
    stdin.type('n');
    await until(() => seen(stdout, 'app / review'));
    stdin.type('\r');
    await until(() => seen(stdout, '4 runs are alive'));
    stdin.type('x');
    await until(() => seen(stdout, 'earlier'));
    stdin.type('q');
    await done;
  });

  it('calls a start the control no longer knows lost, and a failed start by its reason', async () => {
    const lost = fakeControl({
      starts: [confirmation(), () => Promise.resolve({ startId: 'web-1' })],
      statuses: [undefined],
    });
    const a = start(lost);
    await until(() => a.stdout.text.includes('review'));
    a.stdin.type('n');
    await until(() => seen(a.stdout, 'app / review'));
    a.stdin.type('\r');
    await until(() => seen(a.stdout, 'Confirm what review'));
    a.stdin.type('y');
    await until(() => seen(a.stdout, 'start was lost'));
    a.stdin.type('x');
    await sleep(20);
    a.stdin.type('q');
    await a.done;

    const failing = fakeControl({
      starts: [confirmation(), () => Promise.resolve({ startId: 'web-2' })],
      statuses: [{ state: 'starting' }, { state: 'failed', failure: 'needs inputs: use indaba run' }],
    });
    const b = start(failing);
    await until(() => b.stdout.text.includes('review'));
    b.stdin.type('n');
    await until(() => seen(b.stdout, 'app / review'));
    b.stdin.type('\r');
    await until(() => seen(b.stdout, 'Confirm what review'));
    b.stdin.type('y');
    await until(() => seen(b.stdout, 'needs inputs'));
    b.stdin.type('x');
    await sleep(20);
    b.stdin.type('q');
    await b.done;
  });

  it('does not leave while a start is being waited for, and polls no more once it is over (AC-11, AC-12)', async () => {
    const control = fakeControl({
      starts: [confirmation(), () => Promise.resolve({ startId: 'web-1' })],
      statuses: [{ state: 'starting' }],
    });
    const { stdout, stdin, done } = start(control);
    await until(() => stdout.text.includes('review'));
    stdin.type('n');
    await until(() => seen(stdout, 'app / review'));
    stdin.type('\r');
    await until(() => seen(stdout, 'Confirm what review'));
    stdin.type('y');
    await until(() => seen(stdout, 'waiting for the run to appear'));
    stdin.type(KEY.ctrlC);
    stdin.type('q');
    await sleep(40);
    // still here: it did not leave, and it said what it is waiting for
    expect(stdout.frames.slice(-3).join('')).toContain('waiting for the run to appear');
    // the control now answers that the start failed, which ends the wait
    control.statuses = [{ state: 'failed', failure: 'gone' }];
    await until(() => seen(stdout, 'gone'));
    stdin.type('x');
    await sleep(20);
    stdin.type('q');
    await done;
    const calls = control.statusCalls;
    await sleep(60);
    expect(control.statusCalls).toBe(calls);
  });

  it('shows a start that throws something other than a refusal as a failure', async () => {
    const control = fakeControl({ starts: [() => Promise.reject(new Error('socket hang up'))] });
    const { stdout, stdin, done } = start(control);
    await until(() => stdout.text.includes('review'));
    stdin.type('n');
    await until(() => seen(stdout, 'app / review'));
    stdin.type('\r');
    await until(() => seen(stdout, 'socket hang up'));
    stdin.type('x');
    await sleep(20);
    stdin.type('q');
    await done;
  });

  it('does not start a workflow that is not valid', async () => {
    const control = fakeControl({
      list: async () => ({
        workflows: [workflow({ valid: false, problems: ['steps: needs one'], name: 'broken' })],
        truncated: false,
      }),
    });
    const { stdout, stdin, done } = start(control);
    await until(() => stdout.text.includes('review'));
    stdin.type('n');
    await until(() => seen(stdout, '(not valid)'));
    stdin.type('\r');
    await sleep(40);
    expect(control.requests).toHaveLength(0);
    stdin.type(KEY.escape);
    await sleep(20);
    stdin.type('q');
    await done;
  });
});

describe('stopping and leaving (AC-04, AC-11)', () => {
  it('stops a run started here after one question, and says it was stopped', async () => {
    const control = fakeControl({ starts: [confirmation(), () => Promise.resolve({ startId: 'web-1' })] });
    control.alive.add('r1');
    const { stdout, stdin, done } = start(control);
    await startRun(stdout, stdin);
    // leave the dashboard (it asks, as the run is ours), and stay on Home
    stdin.type('q');
    await until(() => seen(stdout, 'cancel the run'));
    stdin.type('d');
    await until(() => seen(stdout, 'earlier'));
    stdin.type('s');
    await until(() => seen(stdout, 'Stop this run?'));
    expect(stdout.frames.slice(-3).join('')).toContain('run r1');
    stdin.type('y');
    await until(() => seen(stdout, 'The run was stopped'));
    expect(control.stopped).toEqual(['r1']);
    stdin.type('q');
    await done;
  });

  it('stops a run from its own dashboard with c', async () => {
    const control = fakeControl({ starts: [confirmation(), () => Promise.resolve({ startId: 'web-1' })] });
    control.alive.add('r1');
    const { stdout, stdin, done } = start(control);
    await startRun(stdout, stdin);
    stdin.type('q');
    await until(() => seen(stdout, 'cancel the run'));
    stdin.type('c');
    await until(() => control.stopped.length === 1);
    expect(control.stopped).toEqual(['r1']);
    await until(() => seen(stdout, 'earlier'));
    stdin.type('q');
    await done;
  });

  it('does not stop a run that was not started here, and says so', async () => {
    const control = fakeControl();
    const { stdout, stdin, done } = start(control);
    await until(() => stdout.text.includes('review'));
    stdin.type('s');
    await until(() => seen(stdout, 'not started from this screen'));
    expect(control.stopped).toEqual([]);
    stdin.type('q');
    await done;
  });

  it('reports a run that had already finished, and one the control does not know, without an error', async () => {
    const ended = fakeControl({
      stopAnswer: { state: 'ended' },
      starts: [confirmation(), () => Promise.resolve({ startId: 'web-1' })],
    });
    ended.alive.add('r1');
    const a = start(ended);
    await startRun(a.stdout, a.stdin);
    a.stdin.type('q');
    await until(() => seen(a.stdout, 'cancel the run'));
    a.stdin.type('d');
    await until(() => seen(a.stdout, 'earlier'));
    a.stdin.type('s');
    await until(() => seen(a.stdout, 'Stop this run?'));
    a.stdin.type('y');
    await until(() => seen(a.stdout, 'had already finished'));
    a.stdin.type('q');
    await until(() => seen(a.stdout, 'stop the run'));
    a.stdin.type('d');
    await a.done;

    const unknown = fakeControl({
      stopAnswer: undefined,
      starts: [confirmation(), () => Promise.resolve({ startId: 'web-1' })],
    });
    unknown.alive.add('r1');
    const b = start(unknown);
    await startRun(b.stdout, b.stdin);
    b.stdin.type('q');
    await until(() => seen(b.stdout, 'cancel the run'));
    b.stdin.type('d');
    await until(() => seen(b.stdout, 'earlier'));
    b.stdin.type('s');
    await until(() => seen(b.stdout, 'Stop this run?'));
    b.stdin.type('y');
    await until(() => seen(b.stdout, 'not started from this screen'));
    b.stdin.type('x');
    await sleep(20);
    b.stdin.type('q');
    await until(() => seen(b.stdout, 'stop the run'));
    b.stdin.type('d');
    await b.done;
  });

  it('asks nothing on quit when no run was started here, and releases nothing that is not alive', async () => {
    const control = fakeControl();
    const { stdout, stdin, done } = start(control);
    await until(() => stdout.text.includes('review'));
    stdin.type('q');
    await expect(done).resolves.toEqual({ quit: 'close', code: 0 });
    expect(control.stoppedAll).toBe(0);
  });

  it('detaches with d: the runs go on, exit 0, and detach is called once', async () => {
    const control = fakeControl({ starts: [confirmation(), () => Promise.resolve({ startId: 'web-1' })] });
    control.alive.add('r1');
    const { stdout, stdin, done } = start(control);
    await startRun(stdout, stdin);
    stdin.type('q');
    await until(() => seen(stdout, 'cancel the run'));
    stdin.type('d');
    await until(() => seen(stdout, 'earlier'));
    stdin.type('q');
    await until(() => seen(stdout, 'stop the run'));
    stdin.type('d');
    await expect(done).resolves.toEqual({ quit: 'detach', code: 0 });
    expect(control.detached).toBe(1);
    expect(control.stoppedAll).toBe(0);
  });

  it('stays open and says why when stopping the runs for a quit fails, and exits only after a stop that worked', async () => {
    const control = fakeControl({
      starts: [confirmation(), () => Promise.resolve({ startId: 'web-1' })],
      stopAllError: new Error('EPERM'),
    });
    control.alive.add('r1');
    const { stdout, stdin, done } = start(control);
    await startRun(stdout, stdin);
    stdin.type('q');
    await until(() => seen(stdout, 'cancel the run'));
    stdin.type('d');
    await until(() => seen(stdout, 'earlier'));
    stdin.type('q');
    await until(() => seen(stdout, 'stop the run'));
    stdin.type('c');
    await until(() => seen(stdout, 'could not be stopped: EPERM'));
    expect(control.stoppedAll).toBe(1);
    // still open: it did not exit, and it can be quit again once stopping works
    control.stopAllError = undefined;
    stdin.type('q');
    await until(() => seen(stdout, 'stop the run'));
    stdin.type('c');
    await expect(done).resolves.toEqual({ quit: 'cancel', code: 130 });
    expect(control.stoppedAll).toBe(2);
  });

  it('leaves no timer behind when the screen is left while a stop is being waited for', async () => {
    const control = fakeControl({
      starts: [confirmation(), () => Promise.resolve({ startId: 'web-1' })],
      stopAnswer: { state: 'stopping' },
    });
    control.alive.add('r1');
    // the run never ends: the stop is waited for as long as the screen is there
    control.stop = (runId) => {
      control.stopped.push(runId);
      return { state: 'stopping' };
    };
    const controller = new AbortController();
    const { stdout, stdin, done } = start(control, { signal: controller.signal });
    await startRun(stdout, stdin);
    stdin.type('q');
    await until(() => seen(stdout, 'cancel the run'));
    stdin.type('d');
    await until(() => seen(stdout, 'earlier'));
    stdin.type('s');
    await until(() => seen(stdout, 'Stop this run?'));
    stdin.type('y');
    await until(() => control.aliveCalls > 2);
    controller.abort();
    await expect(done).resolves.toMatchObject({ code: 130 });
    const calls = control.aliveCalls;
    await sleep(60);
    expect(control.aliveCalls).toBe(calls);
  });
});

describe('logging and secrets', () => {
  it('logs the start and the stop with ids only', async () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      sinks: [{ write: (r) => void records.push(r) }],
      clock: () => new Date(0),
    });
    const control = fakeControl({ starts: [confirmation(), () => Promise.resolve({ startId: 'web-1' })] });
    control.alive.add('r1');
    const { stdout, stdin, done } = start(control, { logger });
    await startRun(stdout, stdin);
    stdin.type('q');
    await until(() => seen(stdout, 'cancel the run'));
    stdin.type('c');
    await until(() => control.stopped.length === 1);
    await until(() => seen(stdout, 'earlier'));
    stdin.type('q');
    await done;
    const messages = records.map((r) => r.message);
    expect(messages).toContain('a run is being started');
    expect(messages).toContain('home opened');
    const logged = JSON.stringify(records);
    expect(logged).toContain('w1');
    // ids and kinds only: nothing of what a workflow file says
    expect(logged).not.toContain('npm test');
  });
});
