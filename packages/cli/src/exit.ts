/**
 * What has to happen before the command may leave early. A second Ctrl+C gives up on the run, but the log records of
 * that run are what a person sends when something went wrong, so they are flushed first, for a bounded time
 * (specs/logging, the second-interrupt gap of the first slice).
 */
export interface ExitHooks {
  /** Adds work to do before an early exit; the function it returns removes it again. */
  add(hook: () => Promise<void>): () => void;
}

/**
 * The longest an early exit waits for its hooks. A starting value, not a measurement (specs/logging, section 8): long
 * enough for a file append and one send to a nearby collector, short enough that a person who pressed Ctrl+C twice is
 * not kept waiting. A third Ctrl+C leaves at once.
 */
export const EARLY_EXIT_FLUSH_MS = 2000;

export class EarlyExit implements ExitHooks {
  private readonly hooks = new Set<() => Promise<void>>();
  private running: Promise<void> | undefined;

  add(hook: () => Promise<void>): () => void {
    this.hooks.add(hook);
    return () => {
      this.hooks.delete(hook);
    };
  }

  /** True once `run` has been called: the next interrupt should not wait again. */
  get started(): boolean {
    return this.running !== undefined;
  }

  /** Runs every hook at once and resolves when all are done or `limitMs` has passed. Never rejects. */
  run(limitMs = EARLY_EXIT_FLUSH_MS): Promise<void> {
    this.running ??= new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, limitMs);
      timer.unref?.();
      void Promise.allSettled([...this.hooks].map((hook) => Promise.resolve().then(hook))).then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    return this.running;
  }
}
