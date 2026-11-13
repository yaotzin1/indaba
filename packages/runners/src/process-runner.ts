import { DEFAULT_TIMEOUT_SECONDS, type RunRequest, RunResult, type RunResultInit } from '@indaba/core';
import { buildRunnerEnvironment, type EnvironmentPolicy, withConfinedTemp } from './env.js';
import type { ProcessMode, ProcessSpawner } from './process.js';

/**
 * A RunResult that also says how the process ran. The engine records `mode` as a span attribute:
 * 'pty' means stdout and stderr arrived merged, 'piped' means they were captured separately.
 */
export class ProcessRunResult extends RunResult {
  readonly mode: ProcessMode;

  constructor(init: RunResultInit, mode: ProcessMode) {
    super(init);
    this.mode = mode;
  }
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g');

/** Removes CSI and OSC escape sequences and normalises CRLF. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '').replaceAll('\r\n', '\n');
}

export interface ExecuteOptions {
  readonly spawner: ProcessSpawner;
  readonly command: readonly string[];
  readonly request: RunRequest;
  readonly usePty: boolean;
  readonly verbatimArguments?: boolean;
  readonly clean?: (text: string) => string;
  readonly signal?: AbortSignal | undefined;
  /** Which host variables the child receives. Absent: only the baseline. */
  readonly environment?: Partial<EnvironmentPolicy>;
}

/** Runs one process and folds its stream, exit and timing into a result. */
export function executeProcess(options: ExecuteOptions): Promise<ProcessRunResult> {
  // The child's TEMP, TMP and TMPDIR are a directory inside its working directory, removed when the call ends.
  return withConfinedTemp(options.request.workdir, (tempDir) => runProcess(options, tempDir));
}

async function runProcess(options: ExecuteOptions, tempDir: string): Promise<ProcessRunResult> {
  const { request } = options;
  const started = performance.now();
  const timeoutSeconds = request.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  let stdout = '';
  let stderr = '';
  let callbackError: unknown;
  let callbackFailed = false;

  const outcome = await options.spawner.run(
    {
      command: options.command,
      cwd: request.workdir,
      env: buildRunnerEnvironment({
        ...(options.environment ?? {}),
        additions: request.env ?? {},
        tempDir,
      }),
      inheritEnv: false,
      usePty: options.usePty,
      timeoutSeconds,
      ...(request.stallSeconds !== undefined ? { stallSeconds: request.stallSeconds } : {}),
      ...(options.verbatimArguments === true ? { verbatimArguments: true } : {}),
      onData: (stream, chunk) => {
        if (stream === 'stderr') {
          stderr += chunk;
        } else {
          stdout += chunk;
        }
        if (request.onOutput !== undefined && !callbackFailed) {
          try {
            request.onOutput(chunk);
          } catch (error) {
            // A throwing consumer must not take down the child's event loop; surface it afterwards.
            callbackFailed = true;
            callbackError = error;
          }
        }
      },
    },
    options.signal,
  );
  if (callbackFailed) {
    throw callbackError;
  }

  if (outcome.timedOut) {
    stderr += `\nTimed out after ${timeoutSeconds} seconds.`;
  } else if (outcome.stalled === true) {
    // Fixed text and a number from the workflow: never anything the agent printed (specs/step-stalls, AC-19).
    stderr += `\nStalled: no activity for ${request.stallSeconds ?? 0} seconds.`;
  } else if (outcome.aborted) {
    stderr += '\nAborted.';
  }
  const clean = options.clean ?? ((text: string) => text);
  return new ProcessRunResult(
    {
      exitCode: outcome.exitCode,
      output: clean(stdout),
      errorOutput: clean(stderr),
      durationMs: performance.now() - started,
      ...(request.model !== undefined ? { model: request.model } : {}),
      ...(outcome.stalled === true ? { stalled: true as const } : {}),
    },
    outcome.mode,
  );
}
