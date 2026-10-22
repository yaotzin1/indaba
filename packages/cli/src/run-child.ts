import { type SpawnOptions, spawn } from 'node:child_process';

/** A run started as a program of its own, so that closing a terminal view never decides whether the run lives. */
export interface RunChild {
  /** The exit status; 1 when the program could not be started or was killed by a signal. */
  readonly exited: Promise<number>;
  /** What the child wrote to its error stream, bounded: the reason a run that never started gives. */
  stderr(): string;
  /** Asks the run to stop as Ctrl+C does, so its worktree is torn down. Works the same on every OS. */
  cancel(): void;
  /** Lets the run carry on without us: closes the channel and stops waiting for the child. */
  release(): void;
  /**
   * Ends the child and everything it started, at once: the last resort after {@link cancel} and a grace period. A no-op
   * once the child has exited (its own `close` or `error`), so a pid the system has handed to another program is never
   * signalled.
   */
  kill(): void;
}

export interface StartOptions {
  readonly cwd: string;
  /** The variables the child starts with. */
  readonly environment: Readonly<Record<string, string | undefined>>;
}

export type RunStarter = (args: readonly string[], options: StartOptions) => RunChild;

/** The message `bin.ts` of the child listens for. A signal cannot be used: Windows has no gentle one. */
export const CANCEL_MESSAGE = 'indaba:cancel';

const MAX_STDERR = 8192;

/** Ends a program and its descendants by pid. */
export type TreeKiller = (pid: number) => void;

export interface TreeKillerDeps {
  readonly spawn: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => { on(event: 'error', listener: (error: Error) => void): unknown };
  readonly kill: (pid: number, signal: NodeJS.Signals) => void;
}

/**
 * How to end a tree of programs on this platform. The child is detached, so it leads a group of its own (POSIX) or a tree
 * `taskkill` can follow (Windows); a plain kill of the child would leave its own children running. On Windows,
 * `taskkill /PID <pid> /T /F` as an argument array, no shell, no window; elsewhere `SIGKILL` to the group (`-pid`).
 * Both were checked against `scripts/security-audit.mjs` before this was written (specs/web-app-actions, T-10).
 */
export function treeKiller(platform: NodeJS.Platform, deps: TreeKillerDeps): TreeKiller {
  if (platform === 'win32') {
    return (pid) => {
      const killer = deps.spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      // A tree that is already gone is not an error worth more than ignoring; there is nothing left to end.
      killer.on('error', () => undefined);
    };
  }
  return (pid) => {
    try {
      deps.kill(-pid, 'SIGKILL');
    } catch {
      // The group has already gone (ESRCH): nothing to end.
    }
  };
}

/**
 * Starts `indaba <args>` as `node <script> <args>`, with an argument array and no shell. The caller names the
 * executable and the script, so this module reads nothing from its surroundings.
 */
export function createRunStarter(
  execPath: string,
  script: string,
  /** How to end the child's tree; the binary passes {@link treeKiller} for its platform. */
  killTree: TreeKiller,
): RunStarter {
  return (args, options) => {
    const child = spawn(execPath, [script, ...args], {
      cwd: options.cwd,
      env: { ...options.environment },
      // The output goes to the files the run writes; only the error stream is kept, and the channel carries "cancel".
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      // Its own group: a Ctrl+C meant for the screen must not also stop a run the person detached from.
      detached: true,
      windowsHide: true,
    });

    let captured = '';
    // Set by the child's own `close` or `error`, never by a guess: after it, `kill()` signals nothing.
    let gone = false;
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (text: string) => {
      captured = (captured + text).slice(-MAX_STDERR);
    });

    const exited = new Promise<number>((resolveExit) => {
      child.once('error', (error) => {
        gone = true;
        captured = `${captured}${error.message}\n`.slice(-MAX_STDERR);
        resolveExit(1);
      });
      child.once('close', (code) => {
        gone = true;
        resolveExit(code ?? 1);
      });
    });

    return {
      exited,
      stderr: () => captured,
      cancel: () => {
        if (child.connected) {
          child.send(CANCEL_MESSAGE, () => undefined);
        }
      },
      kill: () => {
        if (gone || child.pid === undefined) {
          return;
        }
        killTree(child.pid);
      },
      release: () => {
        if (child.connected) {
          child.disconnect();
        }
        child.stderr?.destroy();
        child.unref();
      },
    };
  };
}
