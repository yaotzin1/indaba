import { RunnerError } from '@indaba/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeProcessSpawner, type ProcessSpec, type PtyModule, type PtyProcess } from '../src/index.js';
import { TMP } from './support.js';

// A pid that no process owns, so the tree kill the supervisor issues hits nothing.
const NO_SUCH_PID = 2147483646;

interface FakeTerm {
  readonly module: PtyModule;
  readonly killed: () => number;
  readonly emit: (data: string) => void;
  readonly exit: (exitCode: number) => void;
}

function fakeTerm(options: { killThrows?: boolean } = {}): FakeTerm {
  const data: ((d: string) => void)[] = [];
  const exits: ((e: { exitCode: number }) => void)[] = [];
  let kills = 0;
  const term: PtyProcess = {
    pid: NO_SUCH_PID,
    onData: (l) => data.push(l),
    onExit: (l) => exits.push(l),
    kill: () => {
      kills += 1;
      if (options.killThrows === true) {
        throw new Error('already gone');
      }
    },
  };
  return {
    module: { spawn: () => term },
    killed: () => kills,
    emit: (d) => {
      for (const l of data) {
        l(d);
      }
    },
    exit: (exitCode) => {
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
    timeoutSeconds: 60,
    onData: () => undefined,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('pty supervision with a fake terminal', () => {
  it('times out, kills the terminal and reports 124', async () => {
    vi.useFakeTimers();
    const fake = fakeTerm();
    const spawner = new NodeProcessSpawner({ loadPty: async () => fake.module });
    const pending = spawner.run(spec({ timeoutSeconds: 1 }));
    await vi.advanceTimersByTimeAsync(1000 + 3000 + 10);
    const result = await pending;

    expect(result).toEqual({ exitCode: 124, timedOut: true, aborted: false, mode: 'pty' });
    expect(fake.killed()).toBe(1);
  });

  it('survives a terminal that throws when killed', async () => {
    vi.useFakeTimers();
    const fake = fakeTerm({ killThrows: true });
    const spawner = new NodeProcessSpawner({ loadPty: async () => fake.module });
    const pending = spawner.run(spec({ timeoutSeconds: 1 }));
    await vi.advanceTimersByTimeAsync(4010);

    expect((await pending).timedOut).toBe(true);
    expect(fake.killed()).toBe(1);
  });

  it('aborts while running and reports 130', async () => {
    vi.useFakeTimers();
    const fake = fakeTerm();
    const controller = new AbortController();
    const seen: string[] = [];
    const spawner = new NodeProcessSpawner({ loadPty: async () => fake.module });
    const pending = spawner.run(spec({ onData: (_s, chunk) => seen.push(chunk) }), controller.signal);
    await vi.advanceTimersByTimeAsync(5);
    fake.emit('hello');
    controller.abort();
    await vi.advanceTimersByTimeAsync(3010);
    const result = await pending;

    expect(seen).toEqual(['hello']);
    expect(result).toEqual({ exitCode: 130, timedOut: false, aborted: true, mode: 'pty' });
  });

  it('does not kill a terminal that exited on its own', async () => {
    const fake = fakeTerm();
    const spawner = new NodeProcessSpawner({ loadPty: async () => fake.module });
    const pending = spawner.run(spec());
    await new Promise((resolve) => setImmediate(resolve));
    fake.exit(7);

    expect(await pending).toEqual({ exitCode: 7, timedOut: false, aborted: false, mode: 'pty' });
    expect(fake.killed()).toBe(0);
  });

  it('an already aborted signal never spawns a terminal', async () => {
    let spawned = false;
    const module: PtyModule = {
      spawn: () => {
        spawned = true;
        throw new Error('must not spawn');
      },
    };
    const controller = new AbortController();
    controller.abort();
    const result = await new NodeProcessSpawner({ loadPty: async () => module }).run(
      spec(),
      controller.signal,
    );

    expect(spawned).toBe(false);
    expect(result).toEqual({ exitCode: 130, timedOut: false, aborted: true, mode: 'pty' });
  });
});

describe('empty commands', () => {
  it('rejects with a RunnerError on pipes', async () => {
    const spawner = new NodeProcessSpawner({ loadPty: async () => undefined });

    await expect(spawner.run(spec({ command: [], usePty: false }))).rejects.toThrow(RunnerError);
  });

  it('falls through the pty to the same rejection', async () => {
    const fake = fakeTerm();
    const spawner = new NodeProcessSpawner({ loadPty: async () => fake.module });

    await expect(spawner.run(spec({ command: [] }))).rejects.toThrow(/empty command/);
  });
});

describe('piped start failures', () => {
  it('names only the program when the error carries no code', async () => {
    const spawner = new NodeProcessSpawner({ loadPty: async () => undefined });
    const error = await spawner
      .run(
        spec({ command: ['indaba-no-such-binary-xyz'], usePty: false, cwd: `${TMP}/indaba-missing-dir-xyz` }),
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RunnerError);
    expect((error as Error).message).toMatch(/^Cannot start "indaba-no-such-binary-xyz": /);
  });
});
