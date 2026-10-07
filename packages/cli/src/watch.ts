import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  emptyRun,
  formatEvent,
  formatPlain,
  isRunId,
  type RunRecord,
  type RunState,
  type RunSummary,
  reduceRun,
  summariseRun,
  TraceReader,
  watchExitCode,
} from '@indaba/engine';
import type { Io } from './main.js';
import type { TuiLoad } from './tui-loader.js';

export const WATCH_USAGE = `Usage: indaba watch [run] [options]

Follow a run from the files it writes under .indaba/traces, or read a finished one. With no run it lists them,
newest first. A run is its 32-character id (printed when it ends), a unique start of it, or "latest".

Options:
  -w, --workdir <dir>   The project directory (default: .)
      --plain           Line-oriented output, even on a terminal that could show the dashboard
      --ascii           Draw the dashboard without box or arrow characters
      --output          Also print each line of output a step streams
      --replay          Replay a finished run with its original timing
      --speed <n>       Replay speed: 1 (as it happened) or 10 (default: 1)
      --stale <secs>    Give up on a run that writes nothing for this long (default: 120)
      --color           Colour the states (never the only sign of one); NO_COLOR turns it off

On a terminal, with @indaba/tui installed, a run opens as a dashboard (q quits, ? lists the keys); anywhere else,
and with --plain or --output, it prints lines. Install the dashboard with: npm install @indaba/tui

Exit status mirrors the run: 0 completed, 1 failed, 2 escalated, 130 cancelled, 3 when the files end without a
final state or the run goes quiet.
`;

export interface WatchOptions {
  /** Replaces the wait between replayed records. Tests inject one. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** NO_COLOR was set: no colour, whatever was asked. Decided by the caller; this module reads no environment. */
  readonly noColor?: boolean;
  /** Loads the optional terminal view. Without it the command only prints lines. */
  readonly loadTui?: () => Promise<TuiLoad>;
}

class WatchUsage extends Error {}

interface Parsed {
  readonly run: string | undefined;
  readonly workdir: string;
  readonly output: boolean;
  readonly replay: boolean;
  readonly speed: number;
  readonly staleMs: number;
  readonly color: boolean;
  readonly plain: boolean;
  readonly ascii: boolean;
  readonly noColor: boolean;
  readonly help: boolean;
}

function parseWatch(args: readonly string[], noColor: boolean): Parsed {
  let parsed: ReturnType<typeof parseOptions>;
  try {
    parsed = parseOptions(args);
  } catch (error) {
    throw new WatchUsage(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    throw new WatchUsage(`Too many arguments: ${positionals.slice(1).join(' ')}`);
  }

  const speed = values.speed === undefined ? 1 : Number(values.speed);
  if (speed !== 1 && speed !== 10) {
    throw new WatchUsage(`--speed must be 1 or 10, got "${values.speed ?? ''}"`);
  }
  const stale = values.stale === undefined ? 120 : Number(values.stale);
  if (!Number.isFinite(stale) || stale <= 0) {
    throw new WatchUsage(`--stale must be a positive number of seconds, got "${values.stale ?? ''}"`);
  }
  return {
    run: positionals[0],
    workdir: values.workdir ?? '.',
    output: values.output === true,
    replay: values.replay === true,
    speed,
    staleMs: stale * 1000,
    color: values.color === true && !noColor,
    plain: values.plain === true,
    ascii: values.ascii === true,
    noColor,
    help: values.help === true,
  };
}

function parseOptions(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      workdir: { type: 'string', short: 'w' },
      plain: { type: 'boolean' },
      ascii: { type: 'boolean' },
      output: { type: 'boolean' },
      replay: { type: 'boolean' },
      speed: { type: 'string' },
      stale: { type: 'string' },
      color: { type: 'boolean' },
    },
  });
}

function listing(runs: readonly RunSummary[]): string {
  const rows = runs.map((r) => `${r.runId}  ${r.status.padEnd(9)}  ${r.startedAt ?? '-'}`);
  return `${rows.join('\n')}\n`;
}

/** A run named by the person: "latest", the whole id, or a start of it that fits only one run. */
function pick(name: string, runs: readonly RunSummary[]): { id: string } | { error: string } {
  if (name === 'latest') {
    const newest = runs[0];
    return newest === undefined ? { error: 'There are no runs to show.' } : { id: newest.runId };
  }
  if (!isRunId(name)) {
    return { error: `"${name}" is not a run id: it is lowercase hexadecimal, or "latest".` };
  }
  const exact = runs.find((r) => r.runId === name);
  if (exact !== undefined) {
    return { id: exact.runId };
  }
  const matches = runs.filter((r) => r.runId.startsWith(name));
  if (matches.length === 1 && matches[0] !== undefined) {
    return { id: matches[0].runId };
  }
  return matches.length === 0
    ? { error: `No run starts with "${name}".` }
    : { error: `"${name}" fits ${matches.length} runs; give more of it:\n${listing(matches)}` };
}

function print(io: Io, lines: readonly string[]): void {
  if (lines.length > 0) {
    io.stdout.write(`${lines.join('\n')}\n`);
  }
}

/** Reads one record: where it leaves the state, and what to print for it. */
function step(state: RunState, record: RunRecord, output: boolean): { state: RunState; lines: string[] } {
  const next = reduceRun(state, record);
  return { state: next, lines: formatEvent(next, record, { output }) };
}

const realSleep = (ms: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function replay(
  io: Io,
  records: readonly RunRecord[],
  speed: number,
  output: boolean,
  sleep: (ms: number) => Promise<void>,
): Promise<RunState> {
  let state = emptyRun();
  let previous: number | undefined;
  for (const record of records) {
    if (io.signal?.aborted === true) {
      break;
    }
    if (record.type !== 'unknown') {
      const at = Date.parse(record.at);
      if (previous !== undefined && !Number.isNaN(at) && at > previous) {
        await sleep(Math.min((at - previous) / speed, 2000));
      }
      previous = Number.isNaN(at) ? previous : at;
    }
    const stepped = step(state, record, output);
    state = stepped.state;
    print(io, stepped.lines);
  }
  return state;
}

/**
 * Follows a run live: prints each notable record as it is written, then the final view. Gives up, and says so, when
 * the files stop growing for `staleMs`: a run that died leaves no final record.
 */
async function follow(
  io: Io,
  reader: TraceReader,
  runId: string,
  output: boolean,
  staleMs: number,
): Promise<{ state: RunState; quiet: boolean }> {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  io.signal?.addEventListener('abort', onAbort, { once: true });
  if (io.signal?.aborted === true) {
    controller.abort();
  }

  let state = emptyRun();
  let quiet = false;
  const records = reader.follow(runId, controller.signal);
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const silence = new Promise<'quiet'>((resolveQuiet) => {
        timer = setTimeout(() => resolveQuiet('quiet'), staleMs);
      });
      const next = await Promise.race([records.next(), silence]);
      clearTimeout(timer);
      if (next === 'quiet') {
        quiet = true;
        controller.abort();
        break;
      }
      if (next.done === true) {
        break;
      }
      const stepped = step(state, next.value, output);
      state = stepped.state;
      print(io, stepped.lines);
    }
  } finally {
    io.signal?.removeEventListener('abort', onAbort);
    await records.return(undefined);
  }
  return { state, quiet };
}

/**
 * The dashboard, when there is a terminal to draw it on and the person did not ask for lines. Returns the exit status
 * once it has run, or `undefined` to carry on with plain output (and says why when the view is wanted but unavailable).
 */
async function showScreen(
  io: Io,
  directory: string,
  runId: string,
  parsed: Parsed,
  options: WatchOptions,
): Promise<number | undefined> {
  if (io.terminal === undefined || parsed.plain || parsed.output || options.loadTui === undefined) {
    return undefined;
  }
  const loaded = await options.loadTui();
  if ('missing' in loaded) {
    io.stderr.write(
      'The dashboard needs @indaba/tui (npm install @indaba/tui); showing plain output. --plain hides this.\n',
    );
    return undefined;
  }
  try {
    const result = await loaded.tui.watch({
      directory,
      runId,
      replay: parsed.replay,
      speed: parsed.speed === 10 ? 10 : 1,
      attached: false,
      ascii: parsed.ascii,
      color: !parsed.noColor,
      stdout: io.terminal.stdout,
      stdin: io.terminal.stdin,
      ...(io.signal === undefined ? {} : { signal: io.signal }),
    });
    return result.code;
  } catch (error) {
    io.stderr.write(
      `The dashboard failed (${error instanceof Error ? error.message : String(error)}); showing plain output.\n`,
    );
    return undefined;
  }
}

/** `indaba watch`: see the usage text. Returns the exit status. */
export async function watch(args: readonly string[], io: Io, options: WatchOptions = {}): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parseWatch(args, options.noColor === true);
  } catch (error) {
    if (error instanceof WatchUsage) {
      io.stderr.write(`${error.message}\n\n${WATCH_USAGE}`);
      return 2;
    }
    throw error;
  }
  if (parsed.help) {
    io.stdout.write(WATCH_USAGE);
    return 0;
  }

  const directory = join(resolve(io.cwd, parsed.workdir), '.indaba', 'traces');
  const reader = new TraceReader(directory);
  const runs = await reader.listRuns();

  if (parsed.run === undefined) {
    if (runs.length === 0) {
      io.stdout.write(`No runs found in ${directory}\n`);
      return 1;
    }
    io.stdout.write(listing(runs));
    return 0;
  }

  const chosen = pick(parsed.run, runs);
  if ('error' in chosen) {
    io.stdout.write(`${chosen.error}\n`);
    return 1;
  }

  const screened = await showScreen(io, directory, chosen.id, parsed, options);
  if (screened !== undefined) {
    return screened;
  }

  const records = await reader.readAll(chosen.id);
  const finished = summariseRun(records).status !== 'running';

  if (parsed.replay) {
    const state = await replay(io, records, parsed.speed, parsed.output, options.sleep ?? realSleep);
    io.stdout.write(formatPlain(state, { color: parsed.color }));
    return io.signal?.aborted === true ? 130 : watchExitCode(state.status);
  }

  if (finished) {
    const state = records.reduce(reduceRun, emptyRun());
    io.stdout.write(formatPlain(state, { color: parsed.color, allOutput: parsed.output }));
    return watchExitCode(state.status);
  }

  const { state, quiet } = await follow(io, reader, chosen.id, parsed.output, parsed.staleMs);
  io.stdout.write(formatPlain(state, { color: parsed.color, allOutput: parsed.output }));
  if (io.signal?.aborted === true) {
    return 130;
  }
  if (quiet) {
    io.stdout.write(
      `The run has written nothing for ${Math.round(parsed.staleMs / 1000)} seconds: it may have died, or be waiting.\n`,
    );
  }
  return watchExitCode(state.status);
}
