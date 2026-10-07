import { join } from 'node:path';
import { sanitize, TraceReader } from '@indaba/engine';
import type { Io } from './main.js';
import { redact } from './redact.js';
import type { RunChild } from './run-child.js';
import type { TuiModule, TuiWatchResult } from './tui-loader.js';

export const RUN_TUI_USAGE_NEEDS_TERMINAL =
  '--tui draws a dashboard and needs a terminal. Run "indaba run" and follow it with "indaba watch --plain".\n';

export const RUN_TUI_INSTALL =
  '--tui needs @indaba/tui (npm install @indaba/tui). Nothing was started. "indaba run" works without it.\n';

export interface RunTuiOptions {
  /** The variables the run starts with, and whose secrets are redacted from what is printed. Decided by the caller. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** NO_COLOR was set. Decided by the caller; this module reads no environment. */
  readonly noColor: boolean;
  /** The pause between looks for the new run's files. */
  readonly pollMs?: number;
  /** How long to wait for them before giving up. */
  readonly waitMs?: number;
  /** Tests replace the wait. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * `indaba run --tui`: the run is a program of its own, so that nothing the screen does can stop it by accident. The new
 * run is the one whose files appear after the child started. Returns the exit status of the command.
 *
 * `args` is the `run` command line without `--tui`; `projectDir` is where the run's `.indaba` lives.
 */
export async function runWithDashboard(
  args: readonly string[],
  projectDir: string,
  io: Io,
  options: RunTuiOptions,
): Promise<number> {
  const { terminal, startRun, loadTui } = io;
  if (terminal === undefined || startRun === undefined) {
    io.stderr.write(RUN_TUI_USAGE_NEEDS_TERMINAL);
    return 2;
  }
  const loaded = loadTui === undefined ? { missing: 'not available' } : await loadTui();
  if ('missing' in loaded) {
    io.stderr.write(RUN_TUI_INSTALL);
    return 2;
  }

  const directory = join(projectDir, '.indaba', 'traces');
  const reader = new TraceReader(directory);
  const before = new Set((await reader.listRuns()).map((r) => r.runId));

  const child = startRun(['run', ...args], { cwd: io.cwd, environment: options.environment });
  let exitCode: number | undefined;
  void child.exited.then((code) => {
    exitCode = code;
  });
  // Ctrl+C on the command line is the same as choosing "cancel": the run stops and tears down its worktree.
  const onAbort = (): void => child.cancel();
  io.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    let runId: string | undefined;
    try {
      runId = await appears(reader, before, () => exitCode !== undefined, options);
    } catch (error) {
      // Whatever went wrong while looking, the run was started by us: it does not stay behind without a screen.
      child.cancel();
      await child.exited;
      throw error;
    }
    if (runId === undefined) {
      return await failedToStart(child, io, options, exitCode);
    }
    return await show(child, runId, directory, loaded.tui, io, options);
  } finally {
    io.signal?.removeEventListener('abort', onAbort);
  }
}

/** The id of the run the child started: a run in the directory that was not there before. */
async function appears(
  reader: TraceReader,
  before: ReadonlySet<string>,
  gone: () => boolean,
  options: RunTuiOptions,
): Promise<string | undefined> {
  const pollMs = options.pollMs ?? 100;
  const polls = Math.ceil((options.waitMs ?? 60_000) / pollMs);
  const sleep = options.sleep ?? realSleep;
  for (let n = 0; n < polls; n++) {
    const ended = gone();
    const fresh = (await reader.listRuns()).find((r) => !before.has(r.runId));
    if (fresh !== undefined) {
      return fresh.runId;
    }
    if (ended) {
      return undefined;
    }
    await sleep(pollMs);
  }
  return undefined;
}

async function failedToStart(
  child: RunChild,
  io: Io,
  options: RunTuiOptions,
  exitCode: number | undefined,
): Promise<number> {
  if (exitCode === undefined) {
    // It is still alive but wrote nothing: the person is not left with a run they cannot see.
    child.cancel();
    exitCode = await child.exited;
  }
  // The child's error text is untrusted too: redacted, and stripped of control sequences like all agent text.
  const reason = sanitize(redact(child.stderr().trim(), options.environment));
  io.stderr.write(`The run did not start${reason === '' ? '' : `:\n${reason}`}\n`);
  return exitCode === 0 ? 1 : exitCode;
}

async function show(
  child: RunChild,
  runId: string,
  directory: string,
  tui: TuiModule,
  io: Io,
  options: RunTuiOptions,
): Promise<number> {
  const { terminal } = io;
  if (terminal === undefined) {
    return 2;
  }
  let result: TuiWatchResult;
  try {
    result = await tui.watch({
      directory,
      runId,
      replay: false,
      speed: 1,
      attached: true,
      ascii: false,
      color: !options.noColor,
      stdout: terminal.stdout,
      stdin: terminal.stdin,
      ...(io.signal === undefined ? {} : { signal: io.signal }),
    });
  } catch (error) {
    // The screen failing is no reason to stop the run: say where it is and leave it going.
    child.release();
    const reason = redact(error instanceof Error ? error.message : String(error), options.environment);
    io.stderr.write(`The dashboard failed (${reason}). The run continues: indaba watch ${runId} --plain\n`);
    return 1;
  }

  if (result.quit === 'cancel') {
    child.cancel();
    await child.exited;
    return 130;
  }
  if (result.quit === 'detach') {
    child.release();
    io.stdout.write(`The run continues in the background: indaba watch ${runId}\n`);
    return 0;
  }
  // The person left a run that had already ended: its status is the command's, and there is nothing to wait for.
  child.release();
  return result.code;
}
