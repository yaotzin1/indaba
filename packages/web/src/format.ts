import { messages } from './messages.js';

/** A duration in words a person reads at a glance: `under 1 s`, `41 s`, `3 min 2 s`, `1 h 4 min`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return messages.time.underASecond;
  }
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
  }
  return `${seconds} s`;
}

/** Milliseconds between two ISO times, or undefined when either is missing or unreadable. */
export function between(start: string | undefined, end: string | undefined): number | undefined {
  if (start === undefined || end === undefined) {
    return undefined;
  }
  const a = Date.parse(start);
  const b = Date.parse(end);
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : undefined;
}

/** Dollars with two decimals; a positive amount under a cent says so instead of showing $0.00. */
export function formatMoney(usd: number): string {
  if (usd > 0 && usd < 0.005) {
    return messages.cost.lessThanCent;
  }
  return `$${usd.toFixed(2)}`;
}

/** The cost of one model call: undefined is unknown, never zero (AC-19). */
export function formatCallCost(usd: number | undefined): string {
  return usd === undefined ? messages.cost.unknown : formatMoney(usd);
}

/**
 * The cost of a run: `unknown` when no call had a price, `at least $x (partial)` when some had none, `$0.00 (no model
 * calls)` when nothing was called. Never a number the reader would act on that the data does not support.
 */
export function formatRunCost(cost: {
  readonly usd: number;
  readonly unknown: number;
  readonly calls: number;
}): string {
  if (cost.calls === 0) {
    return messages.cost.noCalls(formatMoney(0));
  }
  if (cost.unknown >= cost.calls) {
    return messages.cost.unknown;
  }
  if (cost.unknown > 0) {
    return messages.cost.partial(formatMoney(cost.usd));
  }
  return formatMoney(cost.usd);
}

/** Token counts: `812`, `8.1k`, `1.2M`; undefined is unknown. */
export function formatTokens(n: number | undefined): string {
  if (n === undefined) {
    return messages.cost.unknown;
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}

export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  /** The time zone times are shown in; undefined is the browser's. */
  readonly timeZone?: string;
}

function dayKey(ms: number, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms);
}

/** When something happened, relative to today: `today 14:02`, `yesterday 18:40`, `12 Oct 14:02`, or `–`. */
export function formatWhen(iso: string | undefined, clock: Clock): string {
  if (iso === undefined) {
    return '–';
  }
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) {
    return '–';
  }
  const zone = clock.timeZone;
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
  const now = clock.now();
  if (dayKey(at, zone) === dayKey(now, zone)) {
    return messages.time.today(time);
  }
  if (dayKey(at, zone) === dayKey(now - 86_400_000, zone)) {
    return messages.time.yesterday(time);
  }
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short' }).format(
    at,
  );
  return `${date} ${time}`;
}

/** The first characters of an id, enough to tell runs apart: `4dd7a436…`. */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
