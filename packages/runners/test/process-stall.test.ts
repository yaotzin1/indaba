import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NodeProcessSpawner,
  type ProcessSpec,
  type PtyModule,
  type PtyProcess,
  STALL_EXIT_CODE,
} from '../src/index.js';
import { executeProcess } from '../src/process-runner.js';
import { FakeSpawner, isAlive, nodeScript, TMP, waitUntil } from './support.js';

// A pid that no process owns, so the tree kill the supervisor issues hits nothing.
const NO_SUCH_PID = 2147483646;

function fakeTerm() {
  const data: ((d: string) => void)[] = [];
  const exits: ((e: { exitCode: number }) => void)[] = [];
  let kills = 0;
  const term: PtyProcess = {
    pid: NO_SUCH_PID,
    onData: (l) => data.push(l),
    onExit: (l) => exits.push(l),
    kill: () => {
      kills += 1;
    },
  };
  const module: PtyModule = { spawn: () => term };
  return {
    module,
    killed: () => kills,
    emit: (d: string) => {
      for (const l of data) {
        l(d);
      }
    },
    exit: (exitCode: number) => {
      for (const l of exits) {
        l({ exitCode });
      }
    },
  };
}

function spec(overrides: Partial<ProcessSpec> = {}): ProcessSpec {
  return {
    command: ['agent', 'go'],
    cwd: TMP,
    env: {},
    usePty: true,
    timeoutSeconds: 600,
    onData: () => undefined,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the silence timer on a terminal (specs/step-stalls, AC-05)', () => {
  it('stops an attempt that is silent for stallSeconds and reports a stall, not a timeout', async () => {
    vi.useFakeTimers();
    const fake = fakeTerm();
    const spawner = new NodeProcessSpawner({ loadPty: async () => fake.module });
    const pending = spawner.run(spec({ stallSeconds: 60 }));
    await vi.advanceTimersByTimeAsync(60_000 + 3010);

    expect(await pending).toEqual({
      exitCode: STALL_EXIT_CODE,
      timedOut: false,
      aborted: false,
      stalled: true,
      mode: 'pty',
    });
    expect(fake.killed()).toBe(1);
  });

  it('is restarted by every chunk of output', async () => {
    vi.useFakeTimers();
    const fake = fakeTerm();
    const spawner = new NodeProcessSpawner({ loadPty: async () => fake.module });
    const pending = spawner.run(spec({ stallSeconds: 60 }));
    await vi.advanceTimersByTimeAsync(50_000);
    fake.emit('still here');
    await vi.advanceTimersByTimeAsync(50_000);
    fake.emit('and again');
    await vi.advanceTimersByTimeAsync(50_000);
    fake.exit(0);

    expect(await pending).toEqual({ exitCode: 0, timedOut: false, aborted: false, mode: 'pty' });
    expect(fake.killed()).toBe(0);
  });

  it('is a timeout when the timeout elapses first (AC-10)', async () => {
    vi.useFakeTimers();
    const fake = fakeTerm();
    const spawner = new NodeProcessSpawner({ loadPty: async () => fake.module });
    const pending = spawner.run(spec({ timeoutSeconds: 30, stallSeconds: 60 }));
    await vi.advanceTimersByTimeAsync(30_000 + 3010);

    expect(await pending).toEqual({ exitCode: 124, timedOut: true, aborted: false, mode: 'pty' });
  });

  it('does nothing when no stallSeconds is given, however long the silence (AC-20)', async () => {
    vi.useFakeTimers();
    const fake = fakeTerm();
    const spawner = new NodeProcessSpawner({ loadPty: async () => fake.module });
    const pending = spawner.run(spec());
    await vi.advanceTimersByTimeAsync(500_000);
    fake.exit(0);

    expect(await pending).toEqual({ exitCode: 0, timedOut: false, aborted: false, mode: 'pty' });
    expect(fake.killed()).toBe(0);
  });

  it('is not started by a run that was aborted before it began', async () => {
    const fake = fakeTerm();
    const controller = new AbortController();
    controller.abort();
    const spawner = new NodeProcessSpawner({ loadPty: async () => fake.module });

    expect(await spawner.run(spec({ stallSeconds: 60 }), controller.signal)).toEqual({
      exitCode: 130,
      timedOut: false,
      aborted: true,
      mode: 'pty',
    });
  });
});

describe('the silence timer on pipes, with a real child', () => {
  const spawner = new NodeProcessSpawner();
  const piped = (code: string, overrides: Partial<ProcessSpec> = {}): ProcessSpec =>
    spec({ command: nodeScript(code), usePty: false, ...overrides });

  it('stops a child that goes quiet and kills its whole tree', async () => {
    // The parent prints its grandchild's pid once, then says nothing.
    const quiet =
      'const c = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], ' +
      '{ stdio: "ignore" }); console.log(c.pid); setTimeout(() => {}, 60000)';
    let output = '';
    const outcome = await spawner.run(
      piped(quiet, {
        stallSeconds: 1,
        onData: (_stream, chunk) => {
          output += chunk;
        },
      }),
    );
    const pid = Number.parseInt(output.trim().split('\n')[0] ?? '', 10);

    expect(outcome.exitCode).toBe(STALL_EXIT_CODE);
    expect(outcome.stalled).toBe(true);
    expect(outcome.timedOut).toBe(false);
    expect(Number.isInteger(pid)).toBe(true);
    expect(await waitUntil(() => !isAlive(pid))).toBe(true);
  });

  it('lets a child live that keeps talking, on either stream', async () => {
    const chatty =
      'let n = 0; const t = setInterval(() => { (n % 2 ? process.stderr : process.stdout).write("x"); ' +
      'if (++n === 8) { clearInterval(t); } }, 400)';
    const outcome = await spawner.run(piped(chatty, { stallSeconds: 1 }));

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stalled).toBeUndefined();
  });
});

describe('a stalled attempt as a result (specs/step-stalls, AC-06)', () => {
  const request = { prompt: 'p', workdir: TMP };

  it('asks the spawner for the silence limit only when the request has one', async () => {
    const spawner = new FakeSpawner();
    await executeProcess({ spawner, command: ['x'], request, usePty: false });
    await executeProcess({
      spawner,
      command: ['x'],
      request: { ...request, stallSeconds: 90 },
      usePty: false,
    });

    expect('stallSeconds' in (spawner.specs[0] ?? {})).toBe(false);
    expect(spawner.specs[1]?.stallSeconds).toBe(90);
  });

  it('turns a stalled outcome into a failed result that says so and nothing more', async () => {
    const spawner = new FakeSpawner(() => ({ exitCode: STALL_EXIT_CODE, stalled: true }));
    const result = await executeProcess({
      spawner,
      command: ['x'],
      request: { ...request, stallSeconds: 90 },
      usePty: false,
    });

    expect(result.stalled).toBe(true);
    expect(result.exitCode).toBe(STALL_EXIT_CODE);
    expect(result.succeeded()).toBe(false);
    expect(result.errorOutput).toContain('Stalled: no activity for 90 seconds.');
    expect(result.errorOutput).not.toContain('Timed out');
  });

  it('leaves an ordinary result without the flag', async () => {
    const result = await executeProcess({
      spawner: new FakeSpawner(),
      command: ['x'],
      request: { ...request, stallSeconds: 90 },
      usePty: false,
    });

    expect(result.stalled).toBeUndefined();
    expect(result.errorOutput).toBe('');
  });
});
