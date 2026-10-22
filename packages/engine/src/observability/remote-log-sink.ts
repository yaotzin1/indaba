import { IndabaError, type LogLevel, type LogRecord, type LogSink } from '@indaba/core';

/** What a remote sink tells the command about its own trouble. The messages are constants; the fields are counts. */
export type RemoteLogTrouble =
  | { readonly kind: 'unreachable'; readonly reason: string }
  | { readonly kind: 'reachable-again' }
  | { readonly kind: 'dropped'; readonly count: number };

export interface RemoteLogSinkOptions {
  readonly level?: LogLevel;
  /** The records held while the collector is slow or down. When full, the oldest `debug` record goes first. */
  readonly queueLength: number;
  /** One attempt that has not finished in this time has failed. */
  readonly timeoutSeconds: number;
  /** Further attempts after the first fails, while the collector is believed to be up. */
  readonly retries: number;
  /**
   * The wait between two attempts of one record. A starting value, not a measurement (specs/logging, section 8); the
   * tests set it to 0.
   */
  readonly retryDelayMs?: number;
  /**
   * Told once per outage (`unreachable`), once when it ends (`reachable-again`) and once per run of dropped records
   * (`dropped`), never once per record (AC-16). It must not throw; a throw is swallowed.
   */
  readonly onTrouble?: (trouble: RemoteLogTrouble) => void;
}

/** The wait between attempts when the options name none. */
export const DEFAULT_RETRY_DELAY_MS = 250;

/** Delivers one record. Resolves when the collector took it, rejects when it did not. */
export type RemoteDelivery = (record: LogRecord, signal: AbortSignal) => Promise<void>;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wait(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms).unref?.());
}

/**
 * A sink that sends to a collector without ever holding up a run (specs/logging, AC-16). `write` only queues; one
 * record at a time is sent in the background, each attempt limited by `timeoutSeconds`, retried `retries` times while
 * the collector is up, and tried once while it is down, so an outage costs one warning and a short queue rather than a
 * stalled command. `flush` waits for the queue for at most one timeout and counts what it leaves behind as dropped.
 */
export class RemoteLogSink implements LogSink {
  readonly level?: LogLevel;
  private readonly queue: LogRecord[] = [];
  private readonly queueLength: number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly onTrouble: ((trouble: RemoteLogTrouble) => void) | undefined;
  private readonly deliver: RemoteDelivery;
  private sending: Promise<void> | undefined;
  private down = false;
  private dropped = 0;
  private closed = false;
  private readonly inFlight = new Set<AbortController>();

  constructor(deliver: RemoteDelivery, options: RemoteLogSinkOptions) {
    for (const [name, value, min] of [
      ['queueLength', options.queueLength, 1],
      ['timeoutSeconds', options.timeoutSeconds, 1],
      ['retries', options.retries, 0],
    ] as const) {
      if (!Number.isInteger(value) || value < min) {
        throw new IndabaError(`${name} must be a whole number of at least ${min}.`);
      }
    }
    this.deliver = deliver;
    this.queueLength = options.queueLength;
    this.timeoutMs = options.timeoutSeconds * 1000;
    this.retries = options.retries;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.onTrouble = options.onTrouble;
    if (options.level !== undefined) {
      this.level = options.level;
    }
  }

  write(record: LogRecord): void {
    if (this.closed) {
      return;
    }
    if (this.queue.length >= this.queueLength) {
      const debug = this.queue.findIndex((queued) => queued.level === 'debug');
      this.queue.splice(debug >= 0 ? debug : 0, 1);
      this.dropped += 1;
    }
    this.queue.push(record);
    this.sending ??= this.drain().finally(() => {
      this.sending = undefined;
    });
  }

  /** Waits for the queue for at most one timeout, then gives up on what is left and closes. Never rejects. */
  async flush(): Promise<void> {
    const sending = this.sending;
    if (sending !== undefined) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        sending,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.timeoutMs);
        }),
      ]);
      clearTimeout(timer);
    }
    this.closed = true;
    this.dropped += this.queue.length;
    this.queue.length = 0;
    for (const controller of this.inFlight) {
      controller.abort();
    }
    this.reportDropped();
    await this.close();
  }

  /** Releases a connection the delivery keeps. The base sink keeps none. */
  protected close(): Promise<void> {
    return Promise.resolve();
  }

  private async drain(): Promise<void> {
    // Start after the caller's own work: `write` hands the record over and returns before anything is sent.
    await Promise.resolve();
    for (let record = this.queue.shift(); record !== undefined; record = this.queue.shift()) {
      await this.send(record);
      if (this.queue.length === 0) {
        this.reportDropped();
      }
    }
  }

  private async send(record: LogRecord): Promise<void> {
    const attempts = this.down ? 1 : this.retries + 1;
    let reason = '';
    for (let attempt = 0; attempt < attempts && !this.closed; attempt += 1) {
      if (attempt > 0) {
        await wait(this.retryDelayMs);
      }
      try {
        await this.attempt(record);
        if (this.down) {
          this.down = false;
          this.tell({ kind: 'reachable-again' });
        }
        return;
      } catch (error) {
        reason = describe(error);
      }
    }
    this.dropped += 1;
    if (!this.down && !this.closed) {
      this.down = true;
      this.tell({ kind: 'unreachable', reason });
    }
  }

  private async attempt(record: LogRecord): Promise<void> {
    const controller = new AbortController();
    this.inFlight.add(controller);
    const timer = setTimeout(
      () => controller.abort(new IndabaError('the collector did not answer in time')),
      this.timeoutMs,
    );
    try {
      await Promise.race([
        this.deliver(record, controller.signal),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.inFlight.delete(controller);
    }
  }

  private reportDropped(): void {
    if (this.dropped > 0) {
      const count = this.dropped;
      this.dropped = 0;
      this.tell({ kind: 'dropped', count });
    }
  }

  private tell(trouble: RemoteLogTrouble): void {
    try {
      this.onTrouble?.(trouble);
    } catch {
      // Whoever was told could not hear it; the run must not hear about it either (AC-11).
    }
  }
}
