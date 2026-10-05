import type { ProcessSession, StreamingProcessSpawner, StreamingProcessSpec } from '../src/index.js';

type Json = Record<string, unknown>;

/** A queue the connection reads lines from; the fake agent pushes into it. */
export class LineQueue implements AsyncIterable<string> {
  private readonly items: string[] = [];
  private waiting: ((result: IteratorResult<string>) => void) | undefined;
  private closed = false;

  push(line: string): void {
    if (this.closed) {
      return;
    }
    if (this.waiting !== undefined) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve({ value: line, done: false });
    } else {
      this.items.push(line);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiting !== undefined) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) {
          return Promise.resolve({ value: item, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

/** What a script can do to the client. */
export interface Wire {
  /** Sends any JSON-RPC message to the client. */
  send(message: Json): void;
  /** Sends a raw line, valid or not. */
  raw(line: string): void;
  /** A notification: session/update with the given update. */
  update(update: Json): void;
  /** A request from the agent; resolves with the client's answer (or rejects with its error). */
  ask(method: string, params: Json): Promise<unknown>;
  /** The agent's stdout ends, as if it exited. */
  end(): void;
}

export interface ClientMessage {
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: Json;
}

export interface Script {
  /** Called for the `session/prompt` request; must eventually reply with `reply(id, result)`. */
  prompt?: (message: ClientMessage, wire: Wire, reply: (result: unknown) => void) => void | Promise<void>;
  initialize?: (message: ClientMessage, wire: Wire, reply: (result: unknown) => void) => void;
  newSession?: (message: ClientMessage, wire: Wire, reply: (result: unknown) => void) => void;
  /** Any other client message, such as `session/cancel`. */
  other?: (message: ClientMessage, wire: Wire) => void;
}

export class FakeAgent implements StreamingProcessSpawner {
  readonly received: ClientMessage[] = [];
  readonly specs: StreamingProcessSpec[] = [];
  killed = false;
  stderr = '';
  private nextAsk = 1;

  constructor(private readonly script: Script = {}) {}

  async start(spec: StreamingProcessSpec): Promise<ProcessSession> {
    this.specs.push(spec);
    const queue = new LineQueue();
    const answers = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let exit: (code: number) => void = () => undefined;
    const exited = new Promise<number>((resolve) => {
      exit = resolve;
    });

    const wire: Wire = {
      send: (message) => queue.push(JSON.stringify({ jsonrpc: '2.0', ...message })),
      raw: (line) => queue.push(line),
      update: (update) =>
        queue.push(
          JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update } }),
        ),
      ask: (method, params) => {
        const id = `a${this.nextAsk++}`;
        return new Promise((resolve, reject) => {
          answers.set(id, { resolve, reject });
          queue.push(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        });
      },
      end: () => {
        queue.close();
        exit(0);
      },
    };

    const handle = async (message: ClientMessage): Promise<void> => {
      const reply = (result: unknown): void => wire.send({ id: message.id ?? null, result });
      switch (message.method) {
        case 'initialize':
          if (this.script.initialize !== undefined) {
            this.script.initialize(message, wire, reply);
          } else {
            reply({ protocolVersion: 1, agentCapabilities: {} });
          }
          return;
        case 'session/new':
          if (this.script.newSession !== undefined) {
            this.script.newSession(message, wire, reply);
          } else {
            reply({ sessionId: 's1' });
          }
          return;
        case 'session/prompt':
          if (this.script.prompt !== undefined) {
            await this.script.prompt(message, wire, reply);
          } else {
            reply({ stopReason: 'end_turn' });
          }
          return;
        default:
          this.script.other?.(message, wire);
      }
    };

    return {
      lines: queue,
      stderrTail: () => this.stderr,
      exited,
      write: async (line) => {
        const message = JSON.parse(line) as Json;
        if (message.method === undefined && message.id !== undefined) {
          const waiter = answers.get(String(message.id));
          answers.delete(String(message.id));
          if (message.error !== undefined) {
            const error = message.error as { message?: string };
            waiter?.reject(new Error(error.message ?? 'error'));
          } else {
            waiter?.resolve(message.result);
          }
          return;
        }
        const client: ClientMessage = {
          ...(message.id !== undefined ? { id: message.id as number | string } : {}),
          ...(typeof message.method === 'string' ? { method: message.method } : {}),
          ...(typeof message.params === 'object' && message.params !== null
            ? { params: message.params as Json }
            : {}),
        };
        this.received.push(client);
        void handle(client);
      },
      kill: async () => {
        this.killed = true;
        queue.close();
        exit(0);
      },
    };
  }

  methods(): string[] {
    return this.received.map((m) => m.method ?? '');
  }
}

/** A spawner whose agent cannot be started. */
export class UnstartableAgent implements StreamingProcessSpawner {
  constructor(private readonly error: Error) {}

  async start(): Promise<ProcessSession> {
    throw this.error;
  }
}
