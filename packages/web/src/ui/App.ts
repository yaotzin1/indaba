import {
  createElement as h,
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { ApiFailure, type Client, type Failure, type StreamState } from '../client.js';
import type { Clock } from '../format.js';
import { messages } from '../messages.js';
import { Blocking } from './parts.js';
import { RunScreen } from './RunScreen.js';
import { RunsScreen } from './RunsScreen.js';
import { hrefOf, isPlainClick, type Navigator, useRoute } from './router.js';
import { SettingsScreen } from './SettingsScreen.js';
import { StaleContext } from './stale.js';
import { applyTheme, readTheme, type Store, saveTheme, THEMES, type Theme } from './theme.js';

export interface AppProps {
  /** Undefined when the address carried no token: the page can only say how to get one. */
  readonly client: Client | undefined;
  readonly clock: Clock;
  readonly win: Navigator;
  /** The address the page was opened at, named when the server stops answering. */
  readonly origin: string;
  readonly root: { readonly dataset: DOMStringMap };
  readonly store: Store | undefined;
  /** How often running durations move on, in ms. */
  readonly tickMs?: number;
  /** How often a start is asked about; tests make it short. */
  readonly pollMs?: number;
}

function blockingOf(failure: Failure, origin: string): ReactElement {
  switch (failure.kind) {
    case 'unauthorized':
      return h(Blocking, {
        title: messages.blocking.tokenTitle,
        body: messages.blocking.tokenBody,
        action: messages.blocking.tokenAction,
      });
    case 'newer_contract':
      return h(Blocking, {
        title: messages.blocking.newerTitle,
        body: messages.blocking.newerBody,
        action: messages.blocking.newerAction,
      });
    case 'unreachable':
      return h(Blocking, {
        title: messages.blocking.stoppedTitle,
        body: messages.blocking.stoppedBody(origin),
        action: messages.blocking.stoppedAction,
      });
    default:
      return h(Blocking, {
        title: messages.blocking.stoppedTitle,
        body: failure.message,
        action: messages.blocking.stoppedAction,
      });
  }
}

function ThemeSwitch(props: {
  readonly theme: Theme;
  readonly onChange: (theme: Theme) => void;
}): ReactElement {
  return h(
    'fieldset',
    { className: 'theme' },
    h('legend', null, messages.theme.legend),
    ...THEMES.map((theme) =>
      h(
        'label',
        { key: theme },
        h('input', {
          type: 'radio',
          name: 'theme',
          value: theme,
          checked: props.theme === theme,
          onChange: () => props.onChange(theme),
        }),
        messages.theme[theme],
      ),
    ),
  );
}

/** The page: a header, and the one screen the address names, or a message that blocks it. */
export function App(props: AppProps): ReactElement {
  const { client, clock, win, origin, root, store } = props;
  const [route, navigate] = useRoute(win);
  const [fatal, setFatal] = useState<Failure | undefined>(
    client === undefined ? { kind: 'unauthorized' } : undefined,
  );
  const [live, setLive] = useState<StreamState>('connecting');
  const [theme, setTheme] = useState<Theme>(() => readTheme(store));
  const [now, setNow] = useState(() => clock.now());
  // Bumped when the server answers again, so the screens (and their streams) start afresh.
  const [attempt, setAttempt] = useState(0);
  const [checking, setChecking] = useState<'idle' | 'checking' | 'down'>('idle');
  // Whether this server starts runs; asked once. Until it answers the page offers no Run button.
  const [canRun, setCanRun] = useState(false);
  // The notice that closing indaba ui stops its runs is shown until the first run of this session (AC-11).
  const [noticeSeen, setNoticeSeen] = useState(false);
  const onNoticeSeen = useCallback(() => setNoticeSeen(true), []);

  useEffect(() => applyTheme(root, theme), [root, theme]);

  useEffect(() => {
    const timer = setInterval(() => setNow(clock.now()), props.tickMs ?? 1000);
    return () => clearInterval(timer);
  }, [clock, props.tickMs]);

  useEffect(() => {
    if (client === undefined) {
      return;
    }
    let current = true;
    client.contract().then(
      () =>
        // Only a question of whether to show the Run button: an answer it cannot use means no button, not a broken
        // page. The screens report a missing token or a stopped server on their own.
        client.workflows().then(
          (list) => {
            if (current) {
              setCanRun(list !== undefined);
            }
          },
          () => undefined,
        ),
      (error: unknown) => {
        if (current && error instanceof ApiFailure) {
          setFatal(error.failure);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [client]);

  const onFatal = useCallback((failure: Failure) => setFatal(failure), []);
  const onLive = useCallback((state: StreamState) => setLive(state), []);
  const changeTheme = useCallback(
    (next: Theme) => {
      setTheme(next);
      saveTheme(store, next);
    },
    [store],
  );
  const checkAgain = useCallback(() => {
    if (client === undefined) {
      return;
    }
    setChecking('checking');
    client.contract().then(
      () => {
        setChecking('idle');
        setLive('connecting');
        setAttempt((n) => n + 1);
      },
      (error: unknown) => {
        if (error instanceof ApiFailure && error.failure.kind !== 'server') {
          setFatal(error.failure);
        }
        setChecking('down');
      },
    );
  }, [client]);
  const home = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (isPlainClick(event)) {
      event.preventDefault();
      navigate({ name: 'runs' });
    }
  };
  const toSettings = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (isPlainClick(event)) {
      event.preventDefault();
      navigate({ name: 'settings' });
    }
  };

  let content: ReactElement;
  if (fatal !== undefined || client === undefined) {
    content = blockingOf(fatal ?? { kind: 'unauthorized' }, origin);
  } else if (route.name === 'settings') {
    content = h(SettingsScreen, { key: attempt, client, onFatal });
  } else if (route.name === 'run') {
    content = h(RunScreen, {
      key: `${route.runId}:${attempt}`,
      client,
      clock,
      now,
      runId: route.runId,
      step: route.step,
      navigate,
      onFatal,
      onLive,
    });
  } else {
    content = h(RunsScreen, {
      key: attempt,
      client,
      clock,
      navigate,
      onFatal,
      onLive,
      canRun,
      noticeSeen,
      onNoticeSeen,
      ...(props.pollMs === undefined ? {} : { pollMs: props.pollMs }),
    });
  }

  return h(
    'div',
    null,
    h('a', { className: 'skip', href: '#content' }, messages.skipToContent),
    h(
      'header',
      { className: 'app' },
      h(
        'p',
        { className: 'brand' },
        h('img', { src: '/indaba-mark.svg', width: 30, height: 30, alt: '' }),
        messages.appName,
      ),
      h(
        'nav',
        { 'aria-label': messages.nav.label },
        h(
          'a',
          {
            href: hrefOf({ name: 'runs' }),
            onClick: home,
            'aria-current': route.name === 'runs' ? 'page' : route.name === 'run' ? 'true' : undefined,
          },
          messages.nav.runs,
        ),
        h(
          'a',
          {
            href: hrefOf({ name: 'settings' }),
            onClick: toSettings,
            'aria-current': route.name === 'settings' ? 'page' : undefined,
          },
          messages.nav.settings,
        ),
      ),
      // The Settings screen writes indaba.config and follows no stream, so neither badge is true there. A server that
      // starts runs is not read-only, so the page does not say it is.
      route.name === 'settings'
        ? h('span', { className: 'badge' }, messages.settings.badge)
        : canRun
          ? h('span', { className: 'badge', title: messages.canRunTitle }, messages.canRun)
          : h('span', { className: 'badge', title: messages.readOnlyTitle }, messages.readOnly),
      fatal === undefined && route.name !== 'settings'
        ? h('span', { className: 'badge live', 'data-state': live, role: 'status' }, messages.live[live])
        : null,
      h(ThemeSwitch, { theme, onChange: changeTheme }),
    ),
    fatal === undefined && live === 'unavailable'
      ? h(
          'div',
          { className: 'banner unavailable', role: 'alert' },
          h('strong', null, messages.unavailable.title),
          h('p', null, messages.unavailable.body),
          h('p', null, messages.unavailable.action),
          h(
            'button',
            { type: 'button', onClick: checkAgain, disabled: checking === 'checking' },
            checking === 'checking' ? messages.unavailable.checking : messages.unavailable.check,
          ),
          checking === 'down' ? h('p', { role: 'status' }, messages.unavailable.stillDown) : null,
        )
      : null,
    h(
      'main',
      { id: 'content', tabIndex: -1 },
      h(StaleContext.Provider, { value: live === 'reconnecting' || live === 'unavailable' }, content),
    ),
  );
}
