import type { BoardFileRecord, Logger, RunRecord, RunSummary } from '@indaba/engine';
import { buildHomeScreen } from '../home-screen.js';
import { type HomeContext, type HomeEvent, type HomeState, initialHome, reduceHome } from '../home-state.js';
import { computeLayout } from '../layout.js';
import { type FlowEvent, isRunControlError, type RunControlPort } from '../run-flow.js';
import { buildFlowScreen, isDialog } from '../run-flow-screen.js';
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

/** How often a start or a stop is looked at while it is waited for. */
export const DEFAULT_POLL_MS = 500;

export interface HomeAppProps {
  readonly listRuns: () => Promise<readonly RunSummary[]>;
  readonly openRun?: (runId: string, signal: AbortSignal) => RunFeed;
  /** Starts and stops runs; without it Home only lists and opens them. */
  readonly runs?: RunControlPort;
  readonly pollMs?: number;
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

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Home: the runs of the project, the picker that starts one, and the dashboard of the one the person opens. */
export function HomeApp(props: HomeAppProps): ReactElement {
  const { exit } = useApp();
  const size = useWindowSize();
  const [state, dispatch] = useReducer(reducer, undefined, initialHome);
  const [opened, setOpened] = useState<Opened | undefined>(undefined);
  const reported = useRef(false);
  const control = props.runs;
  const pollMs = props.pollMs ?? DEFAULT_POLL_MS;

  const layout = computeLayout(size.columns, size.rows);
  const isOwnedAndAlive = (runId: string): boolean =>
    control !== undefined && state.owned.includes(runId) && control.isAlive(runId);
  // Read afresh at each key: a run that ended since the last drawing must not make quitting ask about it.
  const contextNow = (): HomeContext => ({
    attached: props.attached || state.owned.some(isOwnedAndAlive),
    canOpen: props.openRun !== undefined,
    pageSize: Math.max(1, layout.listRows - 1),
    canControl: control !== undefined,
    canStop: isOwnedAndAlive,
  });
  const context = contextNow();

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
            props.logger?.info('tui.home', 'the list of runs could not be read', { generation });
            dispatch({ event: { failed: messageOf(error), generation }, context });
          }
        },
      );
    return () => {
      current = false;
    };
  }, [state.generation]);

  // Does what the dialog in front of Home asked for, once per ask. Leaving the screen, or the dialog asking for the next
  // thing, disposes the timer and drops an answer that is late, so nothing runs after the screen is gone.
  useEffect(() => {
    const flow = state.flow;
    if (flow === undefined || flow.effect === undefined || control === undefined) {
      return undefined;
    }
    const effect = flow.effect;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = (event: FlowEvent): void => {
      if (current) {
        dispatch({ event: { flow: event }, context });
      }
    };
    const later = (action: () => FlowEvent, failed: (message: string) => FlowEvent): void => {
      timer = setTimeout(() => {
        try {
          send(action());
        } catch (error) {
          send(failed(messageOf(error)));
        }
      }, pollMs);
    };
    switch (effect.type) {
      case 'list':
        void Promise.resolve()
          .then(() => control.list())
          .then(
            (listed) => send({ listed }),
            (error: unknown) => send({ listFailed: messageOf(error) }),
          );
        break;
      case 'start':
        props.logger?.info('tui.home', 'a run is being started', { workflowId: effect.request.workflowId });
        void Promise.resolve()
          .then(() => control.start(effect.request))
          .then(
            (started) => send({ started }),
            (error: unknown) =>
              send(isRunControlError(error) ? { refused: error } : { threw: messageOf(error) }),
          );
        break;
      case 'poll':
        later(
          () => ({ status: control.startStatus(effect.startId) }),
          (threw) => ({ threw }),
        );
        break;
      case 'stop':
        props.logger?.info('tui.home', 'a run is being stopped', { runId: effect.runId });
        try {
          send({ stopped: control.stop(effect.runId) });
        } catch (error) {
          send({ stopThrew: messageOf(error) });
        }
        break;
      case 'pollStop':
        later(
          () => ({ alive: control.isAlive(effect.runId) }),
          (stopThrew) => ({ stopThrew }),
        );
        break;
    }
    return () => {
      current = false;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [state.flow?.seq]);

  // Open the run the person chose; leaving it stops following it.
  useEffect(() => {
    const runId = state.open;
    if (runId === undefined || props.openRun === undefined) {
      return undefined;
    }
    const controller = new AbortController();
    try {
      setOpened({ runId, feed: props.openRun(runId, controller.signal) });
    } catch {
      // no text of the failure: it may carry a path or a credential, and the screen does not need it
      props.logger?.info('tui.home', 'a run could not be opened');
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
        dispatch({ event: { press }, context: contextNow() });
      }
    },
    { isActive: state.open === undefined },
  );

  // Leaving: `detach` lets the runs started here go on, `cancel` stops them and waits (and stays if that fails).
  useEffect(() => {
    if (state.quit === 'none' || reported.current) {
      return;
    }
    const quit = state.quit;
    const finish = (): void => {
      if (!reported.current) {
        reported.current = true;
        props.onFinish(quit);
        exit();
      }
    };
    if (quit === 'cancel' && control !== undefined) {
      props.logger?.info('tui.home', 'the runs started here are being stopped');
      void control.stopAll().then(finish, (error: unknown) => {
        props.logger?.info('tui.home', 'the runs could not be stopped');
        dispatch({ event: { quitFailed: `The runs could not be stopped: ${messageOf(error)}` }, context });
      });
      return;
    }
    if (control !== undefined) {
      try {
        control.detach();
      } catch {
        props.logger?.info('tui.home', 'the runs could not be released');
      }
    }
    finish();
  }, [state.quit]);

  if (state.open !== undefined && opened !== undefined && opened.runId === state.open) {
    const runId = opened.runId;
    return h(App, {
      key: runId,
      source: opened.feed.source,
      ...(opened.feed.board === undefined ? {} : { board: opened.feed.board }),
      // a run started here asks what to do with it when the dashboard is left; one started elsewhere never does
      attached: isOwnedAndAlive(runId),
      ascii: props.ascii,
      color: props.color,
      embedded: true,
      ...(props.logger === undefined ? {} : { logger: props.logger }),
      onFinish: (result) => {
        if (result.quit === 'cancel' && control !== undefined) {
          try {
            control.stop(runId);
          } catch {
            props.logger?.info('tui.home', 'a run could not be stopped');
          }
        }
        dispatch({ event: { left: true }, context });
      },
    });
  }
  if (state.flow !== undefined) {
    const screen = buildFlowScreen(state.flow, layout, { ascii: props.ascii });
    return h(ScreenView, {
      screen,
      layout,
      color: props.color,
      ascii: props.ascii,
      ...(isDialog(state.flow) && layout.mode !== 'too-small' ? { dialog: true } : {}),
    });
  }
  const screen = buildHomeScreen(state, layout, {
    ascii: props.ascii,
    canOpen: context.canOpen,
    canControl: context.canControl === true,
  });
  return h(ScreenView, { screen, layout, color: props.color, ascii: props.ascii });
}
