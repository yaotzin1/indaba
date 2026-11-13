import type { BoardFileRecord, Logger, RunRecord, RunSummary } from '@indaba/engine';
import { buildHomeScreen } from '../home-screen.js';
import { type HomeContext, type HomeEvent, type HomeState, initialHome, reduceHome } from '../home-state.js';
import { computeLayout } from '../layout.js';
import {
  h,
  type ReactElement,
  useApp,
  useEffect,
  useInput,
  useReducer,
  useRef,
  useState,
  useWindowSize,
} from './adapter.js';
import { App, keyName } from './app.js';
import { ScreenView } from './view.js';

/** The records a run's dashboard follows. */
export interface RunFeed {
  readonly source: AsyncIterable<RunRecord>;
  readonly board?: AsyncIterable<BoardFileRecord>;
}

export interface HomeAppProps {
  readonly listRuns: () => Promise<readonly RunSummary[]>;
  readonly openRun?: (runId: string, signal: AbortSignal) => RunFeed;
  readonly attached: boolean;
  readonly ascii: boolean;
  readonly color: boolean;
  readonly logger?: Logger;
  /** Called once, when the person quits. */
  readonly onFinish: (quit: Exclude<HomeState['quit'], 'none'>) => void;
}

type Action = { readonly event: HomeEvent; readonly context: HomeContext };

const reducer = (state: HomeState, action: Action): HomeState =>
  reduceHome(state, action.event, action.context);

interface Opened {
  readonly runId: string;
  readonly feed: RunFeed;
}

/** Home: the runs of the project, and the dashboard of the one the person opens. */
export function HomeApp(props: HomeAppProps): ReactElement {
  const { exit } = useApp();
  const size = useWindowSize();
  const [state, dispatch] = useReducer(reducer, undefined, initialHome);
  const [opened, setOpened] = useState<Opened | undefined>(undefined);
  const reported = useRef(false);

  const layout = computeLayout(size.columns, size.rows);
  const context: HomeContext = {
    attached: props.attached,
    canOpen: props.openRun !== undefined,
    pageSize: Math.max(1, layout.listRows - 1),
  };

  // Fetch the list for each generation. An answer that arrives after the person left, or after a newer fetch began,
  // is dropped here and, as a second guard, by the reducer.
  useEffect(() => {
    let current = true;
    const generation = state.generation;
    void Promise.resolve()
      .then(() => props.listRuns())
      .then(
        (runs) => {
          if (current) {
            dispatch({ event: { runs, generation }, context });
          }
        },
        (error: unknown) => {
          if (current) {
            const failed = error instanceof Error ? error.message : String(error);
            props.logger?.info('tui.home', 'the list of runs could not be read', { generation });
            dispatch({ event: { failed, generation }, context });
          }
        },
      );
    return () => {
      current = false;
    };
  }, [state.generation]);

  // Open the run the person chose; leaving it stops following it.
  useEffect(() => {
    const runId = state.open;
    if (runId === undefined || props.openRun === undefined) {
      return undefined;
    }
    const controller = new AbortController();
    try {
      setOpened({ runId, feed: props.openRun(runId, controller.signal) });
    } catch (error) {
      props.logger?.info('tui.home', 'a run could not be opened', {
        reason: error instanceof Error ? error.message : String(error),
      });
      dispatch({ event: { left: true }, context });
    }
    return () => {
      controller.abort();
      setOpened(undefined);
    };
  }, [state.open]);

  useInput(
    (input, key) => {
      const press = keyName(input, key);
      if (press !== undefined) {
        dispatch({ event: { press }, context });
      }
    },
    { isActive: state.open === undefined },
  );

  useEffect(() => {
    if (state.quit !== 'none' && !reported.current) {
      reported.current = true;
      props.onFinish(state.quit);
      exit();
    }
  }, [state.quit]);

  if (state.open !== undefined && opened !== undefined && opened.runId === state.open) {
    return h(App, {
      key: opened.runId,
      source: opened.feed.source,
      ...(opened.feed.board === undefined ? {} : { board: opened.feed.board }),
      attached: false,
      ascii: props.ascii,
      color: props.color,
      embedded: true,
      ...(props.logger === undefined ? {} : { logger: props.logger }),
      onFinish: () => dispatch({ event: { left: true }, context }),
    });
  }
  const screen = buildHomeScreen(state, layout, { ascii: props.ascii, canOpen: context.canOpen });
  return h(ScreenView, { screen, layout, color: props.color, ascii: props.ascii });
}
