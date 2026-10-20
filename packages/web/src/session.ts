/**
 * The token `indaba ui` puts in the address fragment. A fragment is never sent to a server, so it is the one place a
 * printed address can carry a secret to the page. The page reads it once, removes it from the address bar (and so
 * from history and from anything copied out of it), and keeps it in memory only (AC-02).
 */

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/** The token in a fragment such as `#token=abc`, or undefined when there is none or it is not shaped like one. */
export function tokenFromFragment(hash: string): string | undefined {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of text.split('&')) {
    const equals = part.indexOf('=');
    if (equals > 0 && part.slice(0, equals) === 'token') {
      const value = part.slice(equals + 1);
      return TOKEN.test(value) ? value : undefined;
    }
  }
  return undefined;
}

export interface AddressBar {
  readonly hash: string;
  readonly pathname: string;
  readonly search: string;
}

export interface History {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

/** Reads the token and removes the fragment, keeping the path and query the person opened. */
export function takeToken(location: AddressBar, history: History): string | undefined {
  const token = tokenFromFragment(location.hash);
  if (location.hash !== '') {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }
  return token;
}
