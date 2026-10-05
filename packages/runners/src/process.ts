import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { RunnerUnavailableError } from '@indaba/core';

/** How the child ran: in a pseudo-terminal (stdout and stderr merged) or on plain pipes. */
export type ProcessMode = 'pty' | 'piped';

export interface ProcessSpec {
  /** The program followed by its arguments; handed to the OS as an argument vector, never to a shell. */
  readonly command: readonly string[];
  readonly cwd: string;
  /** Added to the environment of this process. */
  readonly env: Readonly<Record<string, string>>;
  readonly usePty: boolean;
  readonly timeoutSeconds: number;
  /** Windows only: pass the arguments without quoting. Used by ShellRunner for `cmd.exe /s /c`. */
  readonly verbatimArguments?: boolean;
  readonly onData: (stream: 'stdout' | 'stderr', chunk: string) => void;
}

export interface ProcessOutcome {
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly mode: ProcessMode;
}

/** The seam between a runner and the operating system. Tests inject a fake. */
export interface ProcessSpawner {
  /**
   * Resolves when the child (and its tree) is gone. Rejects with RunnerUnavailableError when it cannot start.
   * Timeout and abort kill the whole process tree.
   */
  run(spec: ProcessSpec, signal?: AbortSignal): Promise<ProcessOutcome>;
}

export const TIMEOUT_EXIT_CODE = 124;
export const ABORT_EXIT_CODE = 130;

export interface PtyProcess {
  readonly pid: number;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number }) => void): unknown;
  kill(signal?: string): void;
}

export interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
  ): PtyProcess;
}

function isPtyModule(value: unknown): value is PtyModule {
  return typeof value === 'object' && value !== null && 'spawn' in value && typeof value.spawn === 'function';
}

const PTY_PACKAGE = 'node-pty';

/**
 * Loads the optional `node-pty` lazily. Returns undefined when it is not installed or its native
 * part does not load on this machine; the caller falls back to pipes.
 */
export async function loadNodePty(): Promise<PtyModule | undefined> {
  try {
    const loaded: unknown = await import(PTY_PACKAGE);
    if (isPtyModule(loaded)) {
      return loaded;
    }
    if (typeof loaded === 'object' && loaded !== null && 'default' in loaded && isPtyModule(loaded.default)) {
      return loaded.default;
    }
  } catch {
    // Absent or unloadable: piped stdio takes over.
  }
  return undefined;
}

const KILL_GRACE_MS = 1000;
const CLOSE_WAIT_MS = 3000;

/** The child plus everything it spawned. `force` is a hard kill. */
export function killTree(pid: number | undefined, force: boolean): void {
  if (pid === undefined) {
    return;
  }
  if (process.platform === 'win32') {
    // Argument array, no shell. A failure means the tree is already gone.
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined);
    return;
  }
  try {
    process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    // ESRCH: the group has already exited.
  }
}

type Trip = 'timeout' | 'abort';

/** Calls `onTrip` once, on timeout or abort, whichever comes first. */
function supervise(timeoutSeconds: number, signal: AbortSignal | undefined, onTrip: (trip: Trip) => void) {
  let tripped: Trip | undefined;
  const trip = (reason: Trip): void => {
    if (tripped === undefined) {
      tripped = reason;
      onTrip(reason);
    }
  };
  const timer = setTimeout(() => trip('timeout'), Math.max(0, timeoutSeconds * 1000));
  const onAbort = (): void => trip('abort');
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    reason: (): Trip | undefined => tripped,
    stop: (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function outcome(exitCode: number, trip: Trip | undefined, mode: ProcessMode): ProcessOutcome {
  if (trip === 'timeout') {
    return { exitCode: TIMEOUT_EXIT_CODE, timedOut: true, aborted: false, mode };
  }
  if (trip === 'abort') {
    return { exitCode: ABORT_EXIT_CODE, timedOut: false, aborted: true, mode };
  }
  return { exitCode, timedOut: false, aborted: false, mode };
}

function hostEnvironment(additions: Readonly<Record<string, string>>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...additions })) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'unknown error';
}

function startFailure(file: string, error: unknown): RunnerUnavailableError {
  // Only the program name and the error code: the arguments carry the prompt, the environment secrets.
  return new RunnerUnavailableError(`Cannot start "${file}": ${errorCode(error)}.`, { cause: error });
}

function runPiped(spec: ProcessSpec, signal: AbortSignal | undefined): Promise<ProcessOutcome> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      resolve(outcome(0, 'abort', 'piped'));
      return;
    }
    const [file, ...args] = spec.command;
    if (file === undefined) {
      reject(new RunnerUnavailableError('Cannot start an empty command.'));
      return;
    }

    let child: ChildProcess;
    try {
      child = spawn(file, args, {
        cwd: spec.cwd,
        env: hostEnvironment(spec.env),
        stdio: ['ignore', 'pipe', 'pipe'],
        // Own process group on POSIX so the whole tree can be signalled.
        detached: process.platform !== 'win32',
        windowsHide: true,
        windowsVerbatimArguments: spec.verbatimArguments === true,
      });
    } catch (error) {
      reject(startFailure(file, error));
      return;
    }

    let settled = false;
    const timers: NodeJS.Timeout[] = [];
    const settle = (exitCode: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      watch.stop();
      for (const timer of timers) {
        clearTimeout(timer);
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(outcome(exitCode, watch.reason(), 'piped'));
    };
    const watch = supervise(spec.timeoutSeconds, signal, () => {
      killTree(child.pid, false);
      timers.push(setTimeout(() => killTree(child.pid, true), KILL_GRACE_MS));
      // A grandchild holding the pipes open must not hold the run open.
      timers.push(setTimeout(() => settle(1), CLOSE_WAIT_MS));
    });

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => spec.onData('stdout', chunk));
    child.stderr?.on('data', (chunk: string) => spec.onData('stderr', chunk));
    child.once('error', (error) => {
      if (child.pid === undefined && !settled) {
        settled = true;
        watch.stop();
        reject(startFailure(file, error));
      }
    });
    child.once('close', (code) => settle(code ?? 1));
  });
}

/** Resolves undefined when the pseudo-terminal could not be started, so the caller can use pipes. */
function runPty(
  pty: PtyModule,
  spec: ProcessSpec,
  signal: AbortSignal | undefined,
): Promise<ProcessOutcome | undefined> {
  const [file, ...args] = spec.command;
  if (signal?.aborted === true) {
    return Promise.resolve(outcome(0, 'abort', 'pty'));
  }
  if (file === undefined) {
    return Promise.resolve(undefined);
  }
  let term: PtyProcess;
  try {
    term = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: 200,
      rows: 50,
      cwd: spec.cwd,
      env: hostEnvironment(spec.env),
    });
  } catch {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    const timers: NodeJS.Timeout[] = [];
    let settled = false;
    const settle = (exitCode: number, exited: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      watch.stop();
      for (const timer of timers) {
        clearTimeout(timer);
      }
      if (!exited) {
        try {
          term.kill();
        } catch {
          // Already gone.
        }
      }
      resolve(outcome(exitCode, watch.reason(), 'pty'));
    };
    const watch = supervise(spec.timeoutSeconds, signal, () => {
      killTree(term.pid, false);
      timers.push(setTimeout(() => killTree(term.pid, true), KILL_GRACE_MS));
      timers.push(setTimeout(() => settle(1, false), CLOSE_WAIT_MS));
    });
    term.onData((data) => spec.onData('stdout', data));
    term.onExit((event) => settle(event.exitCode, true));
  });
}

export interface NodeProcessSpawnerOptions {
  /** Replaces the lazy `node-pty` import; tests use it to simulate its absence. */
  readonly loadPty?: () => Promise<PtyModule | undefined>;
}

/** The real thing: a PTY when `node-pty` loads and the request asks for one, pipes otherwise. */
export class NodeProcessSpawner implements ProcessSpawner {
  private readonly loadPty: () => Promise<PtyModule | undefined>;

  constructor(options: NodeProcessSpawnerOptions = {}) {
    this.loadPty = options.loadPty ?? loadNodePty;
  }

  async run(spec: ProcessSpec, signal?: AbortSignal): Promise<ProcessOutcome> {
    if (spec.usePty) {
      const pty = await this.loadPty();
      if (pty !== undefined) {
        const result = await runPty(pty, spec, signal);
        if (result !== undefined) {
          return result;
        }
      }
    }
    return runPiped(spec, signal);
  }
}
