import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/600.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import '@fontsource/atkinson-hyperlegible-mono/400.css';
import 'apsw-gridwright/styles.css';
import '@xyflow/react/dist/base.css';
import './styles.css';
import { createElement as h, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from './client.js';
import { takeToken } from './session.js';
import { App } from './ui/App.js';

/**
 * Starts the page in a window: takes the token out of the address, and renders. Kept apart from the import of the
 * stylesheets so a test can start it in a document of its own.
 */
export function boot(win: Window & typeof globalThis): void {
  const token = takeToken(win.location, win.history);
  const client = token === undefined ? undefined : createClient({ token, fetch: win.fetch.bind(win) });
  const mount = win.document.getElementById('root');
  if (mount === null) {
    return;
  }
  let store: Storage | undefined;
  try {
    store = win.localStorage;
  } catch {
    store = undefined;
  }
  createRoot(mount).render(
    h(
      StrictMode,
      null,
      h(App, {
        client,
        clock: { now: () => win.Date.now() },
        win,
        origin: win.location.origin,
        root: win.document.documentElement,
        store,
      }),
    ),
  );
}

boot(window);
