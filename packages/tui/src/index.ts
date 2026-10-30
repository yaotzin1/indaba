import {
  isRunId,
  type Logger,
  noopLogger,
  type RunRecord,
  type RunState,
  TraceReader,
  watchExitCode,
} from '@indaba/engine';
import { runDashboard } from './dashboard.js';
import { replay } from './replay.js';

export type {
  BoardAction,
  BoardEntryKind,
  BoardEntryState,
  BoardFilters,
  BoardItem,
  BoardMode,
  BoardState,
} from './board-state.js';
export {
  activeFilters,
  BOARD_KINDS,
  boardAction,
  detailOf,
  emptyBoard,
  factsOf,
  reduceBoard,
  selectedIndex,
  visibleEntries,
} from './board-state.js';
export type { AppResult } from './ink/app.js';
export type { Layout } from './layout.js';
export { clip, computeLayout, fit, MIN_COLUMNS, MIN_ROWS, SPLIT_COLUMNS } from './layout.js';
export { MAX_REPLAY_WAIT_MS, replay } from './replay.js';
export type { Row, Screen, ScreenOptions, Tone } from './screen.js';
export { buildScreen, stepLine, stepTone, tooSmallRows } from './screen.js';
export type { SettingsActions, SettingsOptions, SettingsResult } from './settings.js';
export { editLoggingSettings } from './settings.js';
export type { SettingsScreenOptions } from './settings-screen.js';
export { buildSettingsScreen } from './settings-screen.js';
export type { Checked, Draft, DraftSink, SettingsKey, SettingsRow, SettingsUi } from './settings-state.js';
export {
  check as checkSettingsDraft,
  draftOf,
  initialSettingsUi,
  isDirty,
  reduceSettings,
  rowsOf,
  selectedSinkSettings,
} from './settings-state.js';
export type { KeyName, UiContext, UiState } from './ui-state.js';
export { clampUi, initialUi, reduceUi } from './ui-state.js';

export interface WatchOptions {
  /** `.indaba/traces` of the project. */
  readonly directory: string;
  /** A whole run id, as `indaba watch` has already resolved it. */
  readonly runId: string;
  readonly replay: boolean;
  readonly speed: 1 | 10;
  /** The screen started the run (`indaba run --tui`): quitting asks to detach or cancel. */
  readonly attached: boolean;
  readonly ascii: boolean;
  readonly color: boolean;
  readonly stdout: NodeJS.WritableStream;
  readonly stdin: NodeJS.ReadableStream;
  readonly signal?: AbortSignal;
  /**
   * Where the dashboard logs (specs/logging): when it opens and closes, and a run source that fails. Without one
   * nothing is logged. It logs nothing at `warn`: that level is also printed on standard error, over the screen.
   */
  readonly logger?: Logger;
}

export interface WatchResult {
  /** What the person chose: leave (`close`), leave the run going (`detach`), or stop it (`cancel`). */
  readonly quit: 'close' | 'detach' | 'cancel';
  /** The exit status for the command: the run's, once it has ended; 0 for leaving a run that is still going. */
  readonly code: number;
  readonly run: RunState;
}

function exitCodeFor(quit: WatchResult['quit'], run: RunState): number {
  if (quit === 'cancel') {
    return 130;
  }
  return run.status === 'running' ? 0 : watchExitCode(run.status);
}

/**
 * Shows a run on the terminal, live or replayed, until the person quits. Read-only: it starts nothing and stops
 * nothing; the caller decides what `detach` and `cancel` mean for a run it started.
 */
export async function watch(options: WatchOptions): Promise<WatchResult> {
  if (!isRunId(options.runId)) {
    throw new RangeError('A run id is lowercase hexadecimal.');
  }
  const logger = (options.logger ?? noopLogger).child({ runId: options.runId });
  const reader = new TraceReader(options.directory);
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  const source: AsyncIterable<RunRecord> = options.replay
    ? replay(await reader.readAll(options.runId), { speed: options.speed, signal: controller.signal })
    : reader.follow(options.runId, controller.signal);

  logger.info('tui.dashboard', 'the dashboard opened', {
    replay: options.replay,
    attached: options.attached,
  });
  try {
    const result = await runDashboard({
      logger,
      source,
      attached: options.attached,
      ascii: options.ascii,
      color: options.color,
      stdout: options.stdout,
      stdin: options.stdin,
    });
    const quit = result.quit === 'none' ? 'close' : result.quit;
    const code = exitCodeFor(quit, result.run);
    logger.info('tui.dashboard', 'the dashboard closed', { quit, code });
    return { quit, code, run: result.run };
  } finally {
    controller.abort();
    options.signal?.removeEventListener('abort', onAbort);
  }
}
