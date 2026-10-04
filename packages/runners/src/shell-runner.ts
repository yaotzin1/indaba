import type { Runner, RunRequest } from '@indaba/core';
import { NodeProcessSpawner, type ProcessSpawner } from './process.js';
import { executeProcess, type ProcessRunResult } from './process-runner.js';

export interface ShellInvocation {
  readonly command: readonly string[];
  readonly verbatimArguments: boolean;
}

/**
 * How a declared command line reaches the platform shell. The interpreter is started with an
 * argument array; only the declared line itself is parsed by it (`/bin/sh -c` on POSIX, as
 * Process::fromShellCommandline did in the PHP version; `cmd.exe /d /s /c "line"` on Windows,
 * passed verbatim so cmd.exe does the quote handling instead of Node).
 */
export function shellInvocation(line: string, platform: NodeJS.Platform = process.platform): ShellInvocation {
  if (platform === 'win32') {
    return { command: ['cmd.exe', '/d', '/s', '/c', `"${line}"`], verbatimArguments: true };
  }
  return { command: ['/bin/sh', '-c', line], verbatimArguments: false };
}

export interface ShellRunnerOptions {
  readonly spawner?: ProcessSpawner;
}

/**
 * Deterministic execution of verification commands. The "prompt" is the command line. Commands
 * come from the workflow file the operator wrote, never from model output: this is the only
 * runner that hands a string to a shell, so nothing composed from agent output may reach it.
 */
export class ShellRunner implements Runner {
  readonly name = 'shell';
  private readonly spawner: ProcessSpawner;

  constructor(options: ShellRunnerOptions = {}) {
    this.spawner = options.spawner ?? new NodeProcessSpawner();
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
    });
  }
}
