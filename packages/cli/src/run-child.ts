import { spawn } from 'node:child_process';

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

/**
 * Starts `indaba <args>` as `node <script> <args>`, with an argument array and no shell. The caller names the
 * executable and the script, so this module reads nothing from its surroundings.
 */
export function createRunStarter(execPath: string, script: string): RunStarter {
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
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (text: string) => {
      captured = (captured + text).slice(-MAX_STDERR);
    });

    const exited = new Promise<number>((resolveExit) => {
      child.once('error', (error) => {
        captured = `${captured}${error.message}\n`.slice(-MAX_STDERR);
        resolveExit(1);
      });
      child.once('close', (code) => resolveExit(code ?? 1));
    });

    return {
      exited,
      stderr: () => captured,
      cancel: () => {
        if (child.connected) {
          child.send(CANCEL_MESSAGE, () => undefined);
        }
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
