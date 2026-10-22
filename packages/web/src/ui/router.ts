import { useCallback, useEffect, useState } from 'react';

/**
 * Where the person is: the only state the page keeps of its own, and it lives in the address so a reload or a shared
 * link opens the same thing (C-05). Two screens in delivery step 1.
 */
export type Route =
  | { readonly name: 'runs' }
  | { readonly name: 'run'; readonly runId: string; readonly step: string | undefined }
  | { readonly name: 'missing' };

const SEGMENT = /^[A-Za-z0-9._-]{1,200}$/;

function decode(part: string): string | undefined {
  try {
    const text = decodeURIComponent(part);
    return SEGMENT.test(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

export function parseRoute(pathname: string, search: string): Route {
  const parts = pathname.split('/').filter((part) => part !== '');
  if (parts.length === 0 || (parts.length === 1 && parts[0] === 'runs')) {
    return { name: 'runs' };
  }
  if (parts.length === 2 && parts[0] === 'runs') {
    const runId = decode(parts[1] ?? '');
    if (runId === undefined) {
      return { name: 'missing' };
    }
    const wanted = new URLSearchParams(search).get('step');
    const step = wanted === null ? undefined : decode(wanted);
    return { name: 'run', runId, step };
  }
  return { name: 'missing' };
}

export function hrefOf(route: Route): string {
  switch (route.name) {
    case 'runs':
    case 'missing':
      return '/';
    case 'run':
      return `/runs/${encodeURIComponent(route.runId)}${
        route.step === undefined ? '' : `?step=${encodeURIComponent(route.step)}`
      }`;
  }
}

export type Navigate = (route: Route, options?: { readonly replace?: boolean }) => void;

export interface Place {
  readonly pathname: string;
  readonly search: string;
}

export interface Navigator {
  readonly location: Place;
  readonly history: Pick<History, 'pushState' | 'replaceState'>;
  addEventListener(type: 'popstate', listener: () => void): void;
  removeEventListener(type: 'popstate', listener: () => void): void;
}

/** The route of the address bar, and a way to change it that Back and Forward follow. */
export function useRoute(win: Navigator): readonly [Route, Navigate] {
  const read = useCallback(() => parseRoute(win.location.pathname, win.location.search), [win]);
  const [route, setRoute] = useState<Route>(read);

  useEffect(() => {
    const onPop = (): void => setRoute(read());
    win.addEventListener('popstate', onPop);
    return () => win.removeEventListener('popstate', onPop);
  }, [win, read]);

  const navigate = useCallback<Navigate>(
    (next, options) => {
      const href = hrefOf(next);
      // Going where the page already is adds no history entry: a link inside a clickable row fires both, and Back
      // would otherwise need two presses to leave a run.
      if (options?.replace === true || href === `${win.location.pathname}${win.location.search}`) {
        win.history.replaceState(null, '', href);
      } else {
        win.history.pushState(null, '', href);
      }
      setRoute(next);
    },
    [win],
  );
  return [route, navigate];
}

/** A click that should stay in the page: a plain left click, with no key held that asks for a new tab or window. */
export function isPlainClick(event: {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
