/** How a step ended: its value, or the error it threw. A rejection never escapes the pool as an unhandled rejection. */
export type PoolResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

export interface Settled<T> {
  readonly id: string;
  readonly result: PoolResult<T>;
}

interface Entry<T> {
  readonly controller: AbortController;
  readonly promise: Promise<Settled<T>>;
  readonly detach: () => void;
}

/**
 * The steps of a run that are running now (specs/parallel-steps, T-05). Each step gets an abort controller of its own,
 * chained to the run's signal, so a retry can abort one step and a cancel aborts them all. `next` waits for the first
 * step to settle and removes it; the order of settlement is the only non-deterministic input the engine has, and every
 * decision taken on it depends on the states, never on time.
 */
export class StepPool<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(private readonly parent?: AbortSignal) {}

  get size(): number {
    return this.entries.size;
  }

  /** The ids of the running steps, in the order they started. */
  ids(): readonly string[] {
    return [...this.entries.keys()];
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  start(id: string, run: (signal: AbortSignal) => Promise<T>): void {
    if (this.entries.has(id)) {
      throw new Error(`Step "${id}" is already running.`);
    }
    const controller = new AbortController();
    const parent = this.parent;
    const onAbort = (): void => controller.abort();
    if (parent?.aborted === true) {
      controller.abort();
    } else {
      parent?.addEventListener('abort', onAbort, { once: true });
    }
    const detach = (): void => parent?.removeEventListener('abort', onAbort);
    const promise = new Promise<T>((resolve) => resolve(run(controller.signal))).then(
      (value): Settled<T> => ({ id, result: { ok: true, value } }),
      (error: unknown): Settled<T> => ({ id, result: { ok: false, error } }),
    );
    this.entries.set(id, { controller, promise, detach });
  }

  /** Waits for the first running step to settle, removes it from the pool and reports it. */
  async next(): Promise<Settled<T>> {
    if (this.entries.size === 0) {
      throw new Error('Nothing is running in the pool.');
    }
    const settled = await Promise.race([...this.entries.values()].map((entry) => entry.promise));
    this.entries.get(settled.id)?.detach();
    this.entries.delete(settled.id);
    return settled;
  }

  abort(id: string): void {
    this.entries.get(id)?.controller.abort();
  }

  abortAll(): void {
    for (const entry of this.entries.values()) {
      entry.controller.abort();
    }
  }
}
