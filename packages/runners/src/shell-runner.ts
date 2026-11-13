import type { Runner, RunRequest } from '@indaba/core';
import type { EnvironmentPolicy } from './env.js';
import { NodeProcessSpawner, type ProcessSpawner } from './process.js';
import { executeProcess, type ProcessRunResult } from './process-runner.js';

export interface ShellInvocation {
  readonly command: readonly string[];
  readonly verbatimArguments: boolean;
}

/**
 * How a declared command line reaches the platform shell. The interpreter is started with an
 * argument array; only the declared line itself is parsed by it (`/bin/sh -c` on POSIX, as
 * a shell would for a declared command line; `cmd.exe /d /s /c "line"` on Windows,
 * passed verbatim so cmd.exe does the quote handling instead of Node).
 */
export function shellInvocation(line: string, platform: NodeJS.Platform = process.platform): ShellInvocation {
  if (platform === 'win32') {
    return { command: ['cmd.exe', '/d', '/s', '/c', `"${line}"`], verbatimArguments: true };
  }
  return { command: ['/bin/sh', '-c', line], verbatimArguments: false };
}

/**
 * What a verification command may read besides the baseline: the toolchains' own settings. No provider key is on the
 * list (specs/host-process-containment, AC-06, C-03).
 */
const SHELL_TOOLCHAIN_ENV: readonly string[] = [
  'CI',
  'NODE_ENV',
  'NODE_OPTIONS',
  'PNPM_HOME',
  'NPM_CONFIG_*',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'GOPATH',
  'GOROOT',
  'VIRTUAL_ENV',
];

export interface ShellRunnerOptions {
  readonly spawner?: ProcessSpawner;
  /** The environment the command's own is taken from; only an allowlist of it is passed on. Defaults to this process's. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Extra variables to pass on: exact names, or a prefix ending in `*`. */
  readonly passEnv?: readonly string[];
}

/**
 * Deterministic execution of verification commands. The "prompt" is the command line. Commands
 * come from the workflow file the operator wrote, never from model output: this is the only
 * runner that hands a string to a shell, so nothing composed from agent output may reach it.
 */
export class ShellRunner implements Runner {
  readonly name = 'shell';
  readonly description =
    'Runs the step’s command lines in order through the system shell (/bin/sh, or cmd.exe on Windows); the first that exits non-zero fails the step.';
  private readonly spawner: ProcessSpawner;
  private readonly environment: EnvironmentPolicy;

  constructor(options: ShellRunnerOptions = {}) {
    this.spawner = options.spawner ?? new NodeProcessSpawner();
    this.environment = {
      source: options.env ?? process.env,
      prefixes: [],
      passEnv: [...SHELL_TOOLCHAIN_ENV, ...(options.passEnv ?? [])],
    };
  }

  run(request: RunRequest, signal?: AbortSignal): Promise<ProcessRunResult> {
    const invocation = shellInvocation(request.prompt);
    return executeProcess({
      spawner: this.spawner,
      command: invocation.command,
      request,
      usePty: false,
      verbatimArguments: invocation.verbatimArguments,
      signal,
      environment: this.environment,
    });
  }
}
