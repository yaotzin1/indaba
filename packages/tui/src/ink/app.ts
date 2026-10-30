import {
  type BoardFileRecord,
  emptyRun,
  type Logger,
  type RunRecord,
  type RunState,
  reduceRun,
} from '@indaba/engine';
import { type BoardPane, boardKey } from '../board-screen.js';
import { type BoardState, emptyBoard, reduceBoard } from '../board-state.js';
import { computeLayout } from '../layout.js';
import { buildScreen } from '../screen.js';
import { clampUi, initialUi, type KeyName, reduceUi, type UiContext, type UiState } from '../ui-state.js';
import {
  h,
  type Key,
  type ReactElement,
  useApp,
  useEffect,
  useInput,
  useReducer,
  useRef,
  useState,
  useWindowSize,
} from './adapter.js';
import { ScreenView } from './view.js';

export interface AppResult {
  readonly quit: UiState['quit'];
  readonly run: RunState;
}

export interface AppProps {
  /** Records of the run, from a live follow or a replay. The screen ends cleanly when it ends. */
  readonly source: AsyncIterable<RunRecord>;
  /** Records of the run's board, from a live follow. Without one the board pane says there is no board. */
  readonly board?: AsyncIterable<BoardFileRecord>;
  /** The screen started the run, so quitting asks what to do with it. */
  readonly attached: boolean;
  readonly ascii: boolean;
  readonly color: boolean;
  /** How often incoming records are folded into the screen. Under 250 ms keeps a new event on screen in time. */
  readonly flushMs?: number;
  /** Called once, when the person quits. */
  readonly onFinish: (result: AppResult) => void;
  /** Told when the source of records fails. */
  readonly logger?: Logger;
}

const DEFAULT_FLUSH_MS = 50;

/** Ink's key event as the name the screen's own state machine knows. */
export function keyName(input: string, key: Key): KeyName | undefined {
  if (key.ctrl && input === 'c') {
    return 'ctrl-c';
  }
  if (key.upArrow) return 'up';
  if (key.downArrow) return 'down';
  if (key.pageUp) return 'pageup';
  if (key.pageDown) return 'pagedown';
  if (key.home) return 'home';
  if (key.end) return 'end';
  if (key.tab) return 'tab';
  if (key.escape) return 'escape';
  if (key.return) return 'enter';
  if (key.ctrl || key.meta || input === '') {
    return undefined;
  }
  return { char: input };
}

/** The run says its board could not be written: the root span carries the event (specs/run-blackboard, C-09). */
function saysBoardDegraded(record: RunRecord): boolean {
  return record.type === 'span_ended' && record.events.some((e) => e.name === 'indaba.board.degraded');
}

type UiAction = { readonly press: KeyName; readonly context: UiContext } | { readonly clamp: UiContext };

function uiReducer(ui: UiState, action: UiAction): UiState {
  return 'clamp' in action ? clampUi(ui, action.clamp) : reduceUi(ui, action.press, action.context);
}

/** The terminal dashboard of one run. State of the run comes from records; state of the screen is its own. */
export function App(props: AppProps): ReactElement {
  const { exit } = useApp();
  const size = useWindowSize();
  const [run, setRun] = useState<RunState>(emptyRun);
  const [ui, dispatch] = useReducer(uiReducer, undefined, initialUi);
  const [boardState, setBoardState] = useState<BoardState>(emptyBoard);
  const [degraded, setDegraded] = useState(false);
  const inbox = useRef<RunRecord[]>([]);
  const boardInbox = useRef<BoardFileRecord[]>([]);
  const reported = useRef(false);

  // Fold what arrived into the run, a few times a second at most, so a chatty agent cannot flood the screen.
  useEffect(() => {
    let alive = true;
    const flush = (): void => {
      if (inbox.current.length > 0) {
        const batch = inbox.current.splice(0);
        setRun((previous) => batch.reduce(reduceRun, previous));
        if (batch.some(saysBoardDegraded)) {
          setDegraded(true);
        }
      }
      if (boardInbox.current.length > 0) {
        const batch = boardInbox.current.splice(0);
        setBoardState((previous) => batch.reduce(reduceBoard, previous));
      }
    };
    const timer = setInterval(flush, props.flushMs ?? DEFAULT_FLUSH_MS);
    void (async () => {
      try {
        for await (const record of props.source) {
          if (!alive) {
            break;
          }
          inbox.current.push(record);
        }
      } catch (error) {
        // a source that fails ends like one that finished: the screen shows what it has, and the log says why
        props.logger?.info('tui.dashboard', 'the run source failed; the screen shows what it has', {
          reason: error instanceof Error ? error.message : String(error),
        });
      } finally {
        flush();
      }
    })();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [props.source, props.flushMs]);

  // the board is followed beside the run: its own source, its own failure
  useEffect(() => {
    const source = props.board;
    if (source === undefined) {
      return undefined;
    }
    let alive = true;
    void (async () => {
      try {
        for await (const record of source) {
          if (!alive) {
            break;
          }
          boardInbox.current.push(record);
        }
      } catch (error) {
        props.logger?.info('tui.dashboard', 'the board source failed; the pane shows what it has', {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [props.board]);

  const layout = computeLayout(size.columns, size.rows);
  const selectedStep = run.steps[ui.selected];
  const context: UiContext = {
    steps: run.steps.length,
    outputLines:
      selectedStep === undefined ? 0 : selectedStep.output.length + (selectedStep.partialLine === '' ? 0 : 1),
    pageSize: Math.max(1, layout.detailRows - 3),
    attached: props.attached,
  };

  useInput((input, key) => {
    const press = keyName(input, key);
    if (press === undefined) {
      return;
    }
    if (ui.board && ui.focus === 'board' && !ui.help && !ui.confirmQuit) {
      const next = boardKey(boardState, press, {
        pageSize: context.pageSize,
        ...(selectedStep === undefined ? {} : { stepId: selectedStep.id }),
      });
      if (next !== undefined) {
        setBoardState(next);
        return;
      }
    }
    dispatch({ press, context });
  });

  // after the run changed, keep the selection and the scroll inside what exists
  useEffect(() => {
    dispatch({ clamp: context });
  }, [context.steps, context.outputLines]);

  useEffect(() => {
    if (ui.quit !== 'none' && !reported.current) {
      reported.current = true;
      props.onFinish({ quit: ui.quit, run });
      exit();
    }
  }, [ui.quit]);

  const pane: BoardPane | undefined = props.board === undefined ? undefined : { state: boardState, degraded };
  const screen = buildScreen(
    run,
    clampUi(ui, context),
    layout,
    { ascii: props.ascii, attached: props.attached },
    pane,
  );
  return h(ScreenView, { screen, layout, color: props.color, ascii: props.ascii });
}
