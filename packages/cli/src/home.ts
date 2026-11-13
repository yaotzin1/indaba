import { join } from 'node:path';
import type { Logger } from '@indaba/core';
import { BoardReader, TraceReader } from '@indaba/engine';
import type { Io } from './main.js';
import { redact } from './redact.js';
import type { UiRunControl } from './server-loader.js';
import type { HomeRunControl, TuiHomeOptions, TuiHomeResult, TuiLoad, TuiModule } from './tui-loader.js';

/** What bare `indaba` does on a terminal (specs/tui-home): open Home, or fall back to the usage error it has always had. */
export type HomeGate =
  /** Not for Home: write the usage error exactly as before. */
  | { readonly kind: 'usage' }
  /** Home cannot start, and said why; this is the exit status. */
  | { readonly kind: 'exit'; readonly code: number }
  | {
      readonly kind: 'open';
      readonly tui: TuiModule & { readonly run: (options: TuiHomeOptions) => Promise<TuiHomeResult> };
      readonly terminal: NonNullable<Io['terminal']>;
    };

const NEEDS_RAW_MODE =
  'The home screen needs a terminal that can be put in raw mode, and this one cannot.\n' +
  'Use indaba watch --plain to list and read runs as plain text.\n';

function canBeRaw(stdin: NodeJS.ReadableStream): boolean {
  return typeof (stdin as { setRawMode?: unknown }).setRawMode === 'function';
}

/**
 * Decides, in this order: no terminal, or `INDABA_NO_TUI=1`, is the usage error as today; a terminal that cannot do raw
 * mode is refused with the reason; `@indaba/tui` that cannot be loaded says so on one line and then gives the usage error;
 * one without `run` (an older version) gives the usage error with nothing added. Only then is Home opened.
 */
export async function homeGate(
  io: Io,
  loadTui: () => Promise<TuiLoad>,
  /** `INDABA_NO_TUI` was exactly `1`; read by `main`, the one place that reads the environment. */
  disabled: boolean,
): Promise<HomeGate> {
  const { terminal } = io;
  if (terminal === undefined || disabled) {
    return { kind: 'usage' };
  }
  if (!canBeRaw(terminal.stdin)) {
    io.stderr.write(NEEDS_RAW_MODE);
    return { kind: 'exit', code: 1 };
  }
  const loaded = await loadTui();
  if ('missing' in loaded) {
    io.stderr.write(`The home screen (@indaba/tui) could not be loaded (${loaded.missing}).\n`);
    return { kind: 'usage' };
  }
  const { run } = loaded.tui;
  if (run === undefined) {
    return { kind: 'usage' };
  }
  return { kind: 'open', tui: { ...loaded.tui, run }, terminal };
}

/** What `main` read from the environment for Home. */
export interface HomeSettings {
  readonly ascii: boolean;
  readonly color: boolean;
  /** Only to redact a failure message: the values of credentials in it are replaced. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** The control that starts and stops runs, when this command can start runs (the same one `indaba ui` uses). */
  readonly control?: UiRunControl;
}

type Environment = Readonly<Record<string, string | undefined>>;

/** Every string in a value, with the credentials of the environment replaced; the shape is kept. */
export function redactDeep(value: unknown, environment: Environment): unknown {
  if (typeof value === 'string') {
    return redact(value, environment);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, environment));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactDeep(item, environment)]),
    );
  }
  return value;
}

/**
 * What the screen gets of the control: the same answers, with every string cleared of credentials before it can be drawn,
 * and a refusal re-made with its name, code and detail redacted. `detach` is the control's, or nothing when it has none.
 */
export function homeRunControl(control: UiRunControl, environment: Environment): HomeRunControl {
  const clear = <T>(value: T): T => redactDeep(value, environment) as T;
  const remake = (error: unknown): Error => {
    if (!(error instanceof Error)) {
      return new Error(redact(String(error), environment));
    }
    const made = new Error(redact(error.message, environment));
    made.name = error.name;
    const { code, detail } = error as { code?: unknown; detail?: unknown };
    return Object.assign(made, {
      ...(typeof code === 'string' ? { code } : {}),
      ...(detail === undefined ? {} : { detail: clear(detail) }),
    });
  };
  // Every call the screen makes is guarded the same way: what it returns is cleared of credentials, and what it throws
  // is made again with its message and detail cleared, so nothing a control says can reach the screen as it was.
  const guarded = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return clear(await call());
    } catch (error) {
      throw remake(error);
    }
  };
  const guardedNow = <T>(call: () => T): T => {
    try {
      return clear(call());
    } catch (error) {
      throw remake(error);
    }
  };
  return {
    list: () => guarded(() => control.list()),
    start: (request) => guarded(() => control.start(request)),
    startStatus: (startId) => guardedNow(() => control.startStatus(startId)),
    stop: (runId) => guardedNow(() => control.stop(runId)),
    isAlive: (runId) => guardedNow(() => control.isAlive(runId)),
    stopAll: () => guarded(() => control.stopAll()),
    detach: () => guardedNow(() => control.detach?.()),
  };
}

/** Opens Home on the runs of the project and returns the command's exit status. */
export async function runHome(
  io: Io,
  gate: Extract<HomeGate, { kind: 'open' }>,
  logger: Logger,
  settings: HomeSettings,
): Promise<number> {
  const directory = join(io.cwd, '.indaba', 'traces');
  const traces = new TraceReader(directory);
  const boards = new BoardReader(directory);
  try {
    const result = await gate.tui.run({
      // an error from reading the traces is drawn on the screen, so the credentials in it are replaced first
      ...(settings.control === undefined
        ? {}
        : { runs: homeRunControl(settings.control, settings.environment) }),
      listRuns: async () => {
        try {
          return await traces.listRuns();
        } catch (error) {
          throw new Error(
            redact(error instanceof Error ? error.message : String(error), settings.environment),
          );
        }
      },
      openRun: (runId, signal) => ({
        source: traces.follow(runId, signal),
        board: boards.follow(runId, signal),
      }),
      ascii: settings.ascii,
      color: settings.color,
      stdout: gate.terminal.stdout,
      stdin: gate.terminal.stdin,
      ...(io.signal === undefined ? {} : { signal: io.signal }),
      logger,
    });
    return result.code;
  } catch (error) {
    // The screen failing leaves no run behind (Home starts none): say why, redacted, and fail.
    const reason = redact(error instanceof Error ? error.message : String(error), settings.environment);
    logger.info('tui.home', 'the home screen failed', { reason });
    io.stderr.write(`The home screen failed (${reason}). indaba watch --plain lists the runs as text.\n`);
    return 1;
  } finally {
    // Whatever ended the screen, a run started here is let go, never stopped by leaving; detach is idempotent.
    try {
      settings.control?.detach?.();
    } catch {
      logger.info('tui.home', 'the runs could not be released');
    }
  }
}
