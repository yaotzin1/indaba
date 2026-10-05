import { type ChildProcess, spawn } from 'node:child_process';
import { RunnerError, RunnerUnavailableError } from '@indaba/core';
import { killTree } from './process.js';

export interface StreamingProcessSpec {
  /** The program followed by its arguments; handed to the OS as an argument vector, never to a shell. */
  readonly command: readonly string[];
  readonly cwd: string;
  /** The complete environment of the child. It is not merged with the parent's. */
  readonly env: Readonly<Record<string, string>>;
}

/** A child process spoken to line by line: the transport under a protocol such as ACP. */
export interface ProcessSession {
  /** Writes one line (a newline is appended). Rejects once the child is gone. */
  write(line: string): Promise<void>;
  /** The child's stdout, one line at a time, without the newline. Throws if one line is over the limit. */
  readonly lines: AsyncIterable<string>;
  /** What the child wrote to stderr, last part only. For failure messages, after the run. */
  stderrTail(): string;
  /** The exit code, once the child is gone. */
  readonly exited: Promise<number>;
  /** Closes stdin, gives the child a moment to leave, then ends the whole process tree. */
  kill(): Promise<void>;
}

/** The seam between a protocol runner and the operating system. Tests inject a fake. */
export interface StreamingProcessSpawner {
  /** Resolves once the child is running. Rejects with RunnerUnavailableError when it cannot start. */
  start(spec: StreamingProcessSpec, signal?: AbortSignal): Promise<ProcessSession>;
}

const MAX_LINE_BYTES = 8 * 1024 * 1024;
const STDERR_TAIL_BYTES = 4096;
const EXIT_GRACE_MS = 1500;
const FORCE_WAIT_MS = 3000;

/** Pipes on both directions, no PTY: an agent protocol is not a terminal. */
export class NodeStreamingProcessSpawner implements StreamingProcessSpawner {
  async start(spec: StreamingProcessSpec, signal?: AbortSignal): Promise<ProcessSession> {
    const [file, ...args] = spec.command;
    if (file === undefined) {
      throw new RunnerUnavailableError('Cannot start an empty command.');
    }
    if (signal?.aborted === true) {
      throw new RunnerUnavailableError('Aborted before the agent started.');
    }

    let child: ChildProcess;
    try {
      child = spawn(file, args, {
        cwd: spec.cwd,
        env: { ...spec.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        // Own process group on POSIX so the whole tree can be signalled.
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (error) {
      throw startFailure(file, error);
    }

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', (error) => reject(startFailure(file, error)));
    });
    return new NodeSession(child);
  }
}

function startFailure(file: string, error: unknown): RunnerUnavailableError {
  // Only the program name and the error code: the arguments can carry paths, the environment secrets.
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'unknown error';
  return new RunnerUnavailableError(`Cannot start "${file}": ${code}.`);
}

class NodeSession implements ProcessSession {
  readonly exited: Promise<number>;
  readonly lines: AsyncIterable<string>;
  private tail = '';
  private gone = false;

  constructor(private readonly child: ChildProcess) {
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.tail = (this.tail + chunk).slice(-STDERR_TAIL_BYTES);
    });
    // A write to a closed pipe is reported by write(), not as an uncaught error.
    child.stdin?.on('error', () => undefined);
    this.exited = new Promise((resolve) => {
      child.once('close', (code) => {
        this.gone = true;
        resolve(code ?? 1);
      });
      child.once('error', () => {
        this.gone = true;
        resolve(1);
      });
    });
    this.lines = readLines(child);
  }

  stderrTail(): string {
    return this.tail;
  }

  write(line: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stdin = this.child.stdin;
      if (stdin === null || stdin.destroyed || this.gone) {
        reject(new RunnerError('The agent process is not running.'));
        return;
      }
      stdin.write(`${line}\n`, (error) =>
        error === null || error === undefined ? resolve() : reject(error),
      );
    });
  }

  async kill(): Promise<void> {
    if (this.gone) {
      return;
    }
    this.child.stdin?.end();
    const left = await Promise.race([this.exited.then(() => true), delay(EXIT_GRACE_MS).then(() => false)]);
    if (left) {
      return;
    }
    killTree(this.child.pid, false);
    const terminated = await Promise.race([
      this.exited.then(() => true),
      delay(EXIT_GRACE_MS).then(() => false),
    ]);
    if (!terminated) {
      killTree(this.child.pid, true);
      await Promise.race([this.exited, delay(FORCE_WAIT_MS)]);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

async function* readLines(child: ChildProcess): AsyncGenerator<string> {
  const stdout = child.stdout;
  if (stdout === null) {
    return;
  }
  stdout.setEncoding('utf8');
  let buffer = '';
  for await (const chunk of stdout as AsyncIterable<string>) {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line.length > MAX_LINE_BYTES) {
        throw new RunnerError('The agent sent a line longer than the limit.');
      }
      yield line;
      newline = buffer.indexOf('\n');
    }
    if (buffer.length > MAX_LINE_BYTES) {
      throw new RunnerError('The agent sent a line longer than the limit.');
    }
  }
  if (buffer !== '') {
    yield buffer;
  }
}
