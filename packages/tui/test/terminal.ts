import { EventEmitter } from 'node:events';

/** A terminal Ink can draw on: it records what is written, and can be sent keys. */
export class FakeStdout extends EventEmitter {
  readonly frames: string[] = [];
  columns: number;
  rows: number;
  readonly isTTY = true;

  constructor(columns = 100, rows = 24) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  /** Like a real stream, calls back once the chunk is written: Ink waits for it before it reports it has exited. */
  write(chunk: string, callback?: () => void): boolean {
    this.frames.push(String(chunk));
    if (callback !== undefined) {
      queueMicrotask(callback);
    }
    return true;
  }

  get text(): string {
    return this.frames.join('');
  }

  resize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.emit('resize');
  }
}

export class FakeStdin extends EventEmitter {
  readonly isTTY = true;
  rawMode = false;
  readonly rawHistory: boolean[] = [];
  private buffer: string[] = [];

  setRawMode(value: boolean): this {
    this.rawMode = value;
    this.rawHistory.push(value);
    return this;
  }
  setEncoding(): this {
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
  read(): string | null {
    return this.buffer.shift() ?? null;
  }

  /** Types characters as the terminal would deliver them. */
  type(data: string): void {
    // a key typed before the screen has started listening would be lost, as it would on a real terminal that is not
    // yet in raw mode: wait for the listener, as a person would wait for the screen to appear
    if (this.listenerCount('readable') === 0) {
      setTimeout(() => this.type(data), 5);
      return;
    }
    this.buffer.push(data);
    this.emit('readable');
  }
}

export const KEY = {
  up: '\u001b[A',
  down: '\u001b[B',
  pageUp: '\u001b[5~',
  pageDown: '\u001b[6~',
  tab: '\t',
  escape: '\u001b',
  ctrlC: '\u0003',
} as const;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the screen');
    }
    await sleep(10);
  }
}

/** The terminal's final picture is the last frame; Ink rewrites the whole thing on every change. */
export const lastFrame = (out: FakeStdout): string => out.frames[out.frames.length - 1] ?? '';
