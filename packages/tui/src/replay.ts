import type { RunRecord } from '@indaba/engine';

/** The longest wait between two records, however long the gap really was, after scaling by the speed. */
export const MAX_REPLAY_WAIT_MS = 2000;

export interface ReplayOptions {
  /** 1 plays at the speed things happened; 10 is ten times faster. */
  readonly speed: 1 | 10;
  /** Waits between records. Tests inject one; the default is a timer that a signal can cut short. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly signal?: AbortSignal;
}

function timerSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** A finished run's records, one at a time, with the pauses they originally had (scaled, and capped). */
export async function* replay(
  records: readonly RunRecord[],
  options: ReplayOptions,
): AsyncGenerator<RunRecord> {
  const sleep = options.sleep ?? timerSleep;
  let previous: number | undefined;
  for (const record of records) {
    if (options.signal?.aborted === true) {
      return;
    }
    if (record.type !== 'unknown') {
      const at = Date.parse(record.at);
      if (!Number.isNaN(at)) {
        if (previous !== undefined && at > previous) {
          await sleep(Math.min((at - previous) / options.speed, MAX_REPLAY_WAIT_MS), options.signal);
        }
        previous = at;
      }
    }
    yield record;
  }
}
