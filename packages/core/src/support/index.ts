export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  /** A fresh lowercase hexadecimal id of exactly `hexLength` characters (32 for a trace, 16 for a span). */
  next(hexLength: number): string;
}

export interface EventDispatcher {
  /** Resolves once every listener has run; a failing listener never fails the dispatch. */
  dispatch<E>(event: E): Promise<void>;
}

type EventClass<E extends object> = abstract new (...args: never[]) => E;

/** In-memory dispatcher. Listeners run in registration order, one at a time. */
export class SimpleEventDispatcher implements EventDispatcher {
  private readonly listeners: {
    readonly type: EventClass<object>;
    readonly run: (event: object) => unknown;
  }[] = [];

  /** @param onListenerError receives what a failing listener threw; by default it is dropped. */
  constructor(private readonly onListenerError: (error: unknown) => void = () => undefined) {}

  addListener<E extends object>(type: EventClass<E>, listener: (event: E) => unknown): void {
    this.listeners.push({ type, run: (event) => listener(event as E) });
  }

  async dispatch<E>(event: E): Promise<void> {
    if (typeof event !== 'object' || event === null) {
      return;
    }
    for (const { type, run } of [...this.listeners]) {
      if (!(event instanceof type)) {
        continue;
      }
      try {
        await run(event);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }
}
