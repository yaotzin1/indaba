import { createHash, timingSafeEqual } from 'node:crypto';

/** The `Host` values a request may carry: the loopback names, each with the server's own port. */
export function hostAllowed(host: string | undefined, port: number): boolean {
  if (host === undefined) {
    return false;
  }
  const value = host.toLowerCase();
  return value === `localhost:${port}` || value === `127.0.0.1:${port}` || value === `[::1]:${port}`;
}

/**
 * The `Origin` a write may carry: none (a client that is not a browser, which still needs the token), or this
 * server's own page under one of its loopback names.
 */
export function originAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined) {
    return true;
  }
  const value = origin.toLowerCase();
  return (
    value === `http://localhost:${port}` ||
    value === `http://127.0.0.1:${port}` ||
    value === `http://[::1]:${port}`
  );
}

/** The token of an `Authorization: Bearer <token>` header; undefined for anything else. */
export function bearerOf(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const match = header.match(/^Bearer ([A-Za-z0-9_-]{1,256})$/);
  return match?.[1];
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Compares in constant time; a missing token never matches. */
export function tokenMatches(given: string | undefined, token: string): boolean {
  if (given === undefined) {
    return false;
  }
  return timingSafeEqual(digest(given), digest(token));
}

/**
 * Inline script and third-party origins are forbidden (AC-16). Styles may be inline: a graph library positions its
 * nodes with `style` attributes, and an inline style cannot run code.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};
