import { emptyRun, type RunRecord, type RunState, reduceRun } from '@indaba/engine';
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
  /** The screen started the run, so quitting asks what to do with it. */
  readonly attached: boolean;
  readonly ascii: boolean;
  readonly color: boolean;
  /** How often incoming records are folded into the screen. Under 250 ms keeps a new event on screen in time. */
  readonly flushMs?: number;
  /** Called once, when the person quits. */
  readonly onFinish: (result: AppResult) => void;
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
  const inbox = useRef<RunRecord[]>([]);
  const reported = useRef(false);

  // Fold what arrived into the run, a few times a second at most, so a chatty agent cannot flood the screen.
  useEffect(() => {
    let alive = true;
    const flush = (): void => {
      if (inbox.current.length > 0) {
        const batch = inbox.current.splice(0);
        setRun((previous) => batch.reduce(reduceRun, previous));
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
      } catch {
        // a source that fails ends like one that finished: the screen shows what it has
      } finally {
        flush();
      }
    })();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [props.source, props.flushMs]);

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
    if (press !== undefined) {
      dispatch({ press, context });
    }
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

  const screen = buildScreen(run, clampUi(ui, context), layout, {
    ascii: props.ascii,
    attached: props.attached,
  });
  return h(ScreenView, { screen, layout, color: props.color, ascii: props.ascii });
}
