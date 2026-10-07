import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { type RunRecord, serializeRecord, type UnknownRecord } from '@indaba/engine';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index.js';
import type { RunChild, RunStarter } from '../src/run-child.js';
import { RUN_TUI_INSTALL, RUN_TUI_USAGE_NEEDS_TERMINAL, runWithDashboard } from '../src/run-tui.js';
import type { TuiLoad, TuiWatchOptions, TuiWatchResult } from '../src/tui-loader.js';
import { captureIo, makeTempDir } from './support.js';

type Writable = Exclude<RunRecord, UnknownRecord>;

const OLD = 'a'.repeat(32);
/** Built from fragments so the file itself holds nothing shaped like a credential. */
const SECRET = ['sk', 'or', 'v1', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('-');
const NEW = 'b'.repeat(32);

function started(traceId: string): string {
  const record: Writable = {
    type: 'span_started',
    at: '2026-10-05T12:00:00.000Z',
    traceId,
    spanId: 'r1',
    parentSpanId: undefined,
    name: 'indaba.task demo',
    attributes: { 'indaba.workflow.name': 'demo', 'indaba.task.id': 't' },
  };
  return `${serializeRecord(record)}\n`;
}

async function writeRun(dir: string, traceId: string): Promise<void> {
  const traces = join(dir, '.indaba', 'traces');
  await mkdir(traces, { recursive: true });
  await writeFile(join(traces, `${traceId}.events.jsonl`), started(traceId));
}

interface FakeChild extends RunChild {
  readonly calls: string[];
  finish(code: number): void;
}

/** A child that has already written its files (unless `writes` is false) and exits when told to. */
function fakeChild(project: string, writes: boolean, stderr = ''): FakeChild {
  const calls: string[] = [];
  let finish: (code: number) => void = () => undefined;
  const exited = new Promise<number>((resolveExit) => {
    finish = resolveExit;
  });
  if (writes) {
    void writeRun(project, NEW);
  }
  return {
    calls,
    exited,
    finish,
    stderr: () => stderr,
    cancel: () => {
      calls.push('cancel');
      finish(130);
    },
    release: () => {
      calls.push('release');
    },
  };
}

interface Setup {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly started: { args: readonly string[]; cwd: string }[];
  readonly watched: TuiWatchOptions[];
  readonly child: FakeChild | undefined;
}

interface Scenario {
  readonly args?: string[];
  readonly watch?: (options: TuiWatchOptions) => Promise<TuiWatchResult>;
  readonly writes?: boolean;
  readonly stderr?: string;
  readonly terminal?: boolean;
  readonly tui?: boolean;
  readonly signal?: AbortSignal;
  readonly env?: Record<string, string | undefined>;
  /** The child exits at once with this code. */
  readonly exits?: number;
}

async function runWith(scenario: Scenario = {}): Promise<Setup> {
  const dir = await makeTempDir();
  await writeRun(dir, OLD);
  const started: Setup['started'] = [];
  const watched: TuiWatchOptions[] = [];
  let child: FakeChild | undefined;
  const startRun: RunStarter = (args, options) => {
    started.push({ args, cwd: options.cwd });
    child = fakeChild(dir, scenario.writes !== false, scenario.stderr);
    if (scenario.exits !== undefined) {
      child.finish(scenario.exits);
    }
    return child;
  };
  const load: TuiLoad =
    scenario.tui === false
      ? { missing: 'Cannot find package' }
      : {
          tui: {
            watch: async (options) => {
              watched.push(options);
              return (
                scenario.watch?.(options) ??
                Promise.resolve({ quit: 'close', code: 0 } satisfies TuiWatchResult)
              );
            },
          },
        };
  const captured = captureIo(dir, scenario.env ?? {}, scenario.signal);
  const io: Io = {
    ...captured.io,
    startRun,
    loadTui: async () => load,
    ...(scenario.terminal === false
      ? {}
      : { terminal: { stdin: new PassThrough(), stdout: new PassThrough() } }),
  };
  const code = await main(['run', 'wf.yml', '--tui', ...(scenario.args ?? [])], io);
  return { code, out: captured.stdout(), err: captured.stderr(), started, watched, child };
}

describe('indaba run --tui', () => {
  it('starts the run in a process of its own, without the flag, and shows the run that appeared', async () => {
    const r = await runWith({ args: ['--timeout', '5'] });
    expect(r.started).toHaveLength(1);
    expect(r.started[0]?.args).toEqual(['run', 'wf.yml', '--timeout', '5']);
    expect(r.watched).toHaveLength(1);
    expect(r.watched[0]).toMatchObject({ runId: NEW, attached: true, replay: false, speed: 1 });
    expect(r.watched[0]?.directory.endsWith(join('.indaba', 'traces'))).toBe(true);
    expect(r.code).toBe(0);
  });

  it('passes the status of a run that had ended when the person left', async () => {
    const r = await runWith({ watch: async () => ({ quit: 'close', code: 1 }) });
    expect(r.code).toBe(1);
    expect(r.child?.calls).toEqual(['release']);
  });

  it('detach leaves the run going and says how to follow it', async () => {
    const r = await runWith({ watch: async () => ({ quit: 'detach', code: 0 }) });
    expect(r.child?.calls).toEqual(['release']);
    expect(r.out).toContain(`indaba watch ${NEW}`);
    expect(r.code).toBe(0);
  });

  it('cancel stops the run, waits for it to tear down and reports an interrupted run', async () => {
    const r = await runWith({ watch: async () => ({ quit: 'cancel', code: 130 }) });
    expect(r.child?.calls).toEqual(['cancel']);
    expect(r.code).toBe(130);
  });

  it('cancels the run when the command line is interrupted', async () => {
    const controller = new AbortController();
    const r = await runWith({
      signal: controller.signal,
      watch: async () => {
        controller.abort();
        return { quit: 'close', code: 130 };
      },
    });
    expect(r.child?.calls).toContain('cancel');
  });

  it('turns colour off for NO_COLOR', async () => {
    const r = await runWith({ env: { NO_COLOR: '1' } });
    expect(r.watched[0]?.color).toBe(false);
  });

  it('leaves the run going when the dashboard itself fails, and says where it is', async () => {
    const r = await runWith({
      watch: async () => {
        throw new Error('ink broke');
      },
    });
    expect(r.child?.calls).toEqual(['release']);
    expect(r.err).toContain('ink broke');
    expect(r.err).toContain(`indaba watch ${NEW} --plain`);
    expect(r.code).toBe(1);
  });

  it('reports why a run that never started did not, with secrets redacted', async () => {
    const r = await runWith({
      writes: false,
      exits: 1,
      stderr: `bad workflow, key ${SECRET}\n`,
      env: { OPENROUTER_API_KEY: SECRET },
    });
    expect(r.watched).toHaveLength(0);
    expect(r.err).toContain('The run did not start');
    expect(r.err).toContain('bad workflow');
    expect(r.err).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(r.code).toBe(1);
  });

  it('strips terminal control sequences from the reason a run did not start', async () => {
    const esc = String.fromCharCode(27);
    const r = await runWith({
      writes: false,
      exits: 1,
      stderr: `bad ${esc}[2Jworkflow ${esc}]0;title`,
    });
    expect(r.err).toContain('bad workflow');
    expect(r.err).not.toContain(esc);
  });

  it('never reports success for a run that did not start, even when the process exited cleanly', async () => {
    const r = await runWith({ writes: false, exits: 0 });
    expect(r.code).toBe(1);
  });

  it('loads the dashboard package by itself when no loader is given, as the binary does', async () => {
    const dir = await makeTempDir();
    const captured = captureIo(dir);
    let started = 0;
    const io: Io = {
      ...captured.io,
      terminal: { stdin: new PassThrough(), stdout: new PassThrough() },
      // The program exits at once, so the dashboard is never drawn; what matters is that it was reached at all.
      startRun: () => {
        started += 1;
        return { ...fakeChild(dir, false), exited: Promise.resolve(1) };
      },
    };
    const code = await main(['run', 'wf.yml', '--tui'], io);
    expect(started).toBe(1);
    expect(captured.stderr()).not.toContain('needs @indaba/tui');
    expect(code).toBe(1);
  }, 30_000); // a cold import of Ink, React and yoga under a loaded machine

  it('needs a terminal and starts nothing without one', async () => {
    const r = await runWith({ terminal: false });
    expect(r.started).toHaveLength(0);
    expect(r.err).toBe(RUN_TUI_USAGE_NEEDS_TERMINAL);
    expect(r.code).toBe(2);
  });

  it('says how to install the dashboard, and starts nothing, when it is missing', async () => {
    const r = await runWith({ tui: false });
    expect(r.started).toHaveLength(0);
    expect(r.err).toBe(RUN_TUI_INSTALL);
    expect(r.code).toBe(2);
  });

  it('stops at once for a working directory that does not exist', async () => {
    const r = await runWith({ args: ['--workdir', 'nowhere'] });
    expect(r.started).toHaveLength(0);
    expect(r.out).toContain('Working directory does not exist');
    expect(r.code).toBe(1);
  });

  it('is an option of run only', async () => {
    const captured = captureIo(await makeTempDir());
    expect(await main(['validate', 'wf.yml', '--tui'], captured.io)).toBe(2);
    expect(captured.stderr()).toContain("Unknown option '--tui'");
  });
});

describe('runWithDashboard: when looking for the run fails', () => {
  it('stops the run it started, and still reports the failure', async () => {
    const dir = await makeTempDir();
    let child: FakeChild | undefined;
    const captured = captureIo(dir);
    const io: Io = {
      ...captured.io,
      terminal: { stdin: new PassThrough(), stdout: new PassThrough() },
      loadTui: async () => ({ tui: { watch: async () => ({ quit: 'close', code: 0 }) } }),
      startRun: () => {
        child = fakeChild(dir, false);
        return child;
      },
    };
    await expect(
      runWithDashboard(['wf.yml'], dir, io, {
        environment: {},
        noColor: false,
        sleep: async () => {
          throw new Error('the disk went away');
        },
      }),
    ).rejects.toThrow('the disk went away');
    expect(child?.calls).toEqual(['cancel']);
  });
});

describe('runWithDashboard: a run that stays silent', () => {
  it('cancels a process that is alive but writes no files, and gives up', async () => {
    const dir = await makeTempDir();
    let child: FakeChild | undefined;
    const captured = captureIo(dir);
    const io: Io = {
      ...captured.io,
      terminal: { stdin: new PassThrough(), stdout: new PassThrough() },
      loadTui: async () => ({ tui: { watch: async () => ({ quit: 'close', code: 0 }) } }),
      startRun: () => {
        child = fakeChild(dir, false);
        return child;
      },
    };
    let slept = 0;
    const code = await runWithDashboard(['wf.yml'], dir, io, {
      environment: {},
      noColor: false,
      pollMs: 10,
      waitMs: 30,
      sleep: async () => {
        slept += 1;
      },
    });
    expect(slept).toBe(3);
    expect(child?.calls).toEqual(['cancel']);
    expect(captured.stderr()).toContain('The run did not start');
    expect(code).toBe(130);
  });
});
