import { rm } from 'node:fs/promises';
import type { Runner, RunRequest } from '@indaba/core';
import { NodeProcessSpawner, type ProcessSpawner } from './process.js';
import { executeProcess, type ProcessRunResult, stripAnsi } from './process-runner.js';

/** An agent command line plus the temporary files it needs, which the runner deletes afterwards. */
export class PreparedCommand {
  constructor(
    readonly command: readonly string[],
    readonly temporaryFiles: readonly string[] = [],
    readonly temporaryDirectories: readonly string[] = [],
  ) {}

  async cleanup(): Promise<void> {
    for (const file of this.temporaryFiles) {
      await rm(file, { force: true });
    }
    for (const directory of this.temporaryDirectories) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export interface CliRunnerOptions {
  /** Ask for a pseudo-terminal (default true). Falls back to pipes when `node-pty` is unavailable. */
  readonly usePty?: boolean;
  /** Replaces the real process layer. Unit tests inject a fake. */
  readonly spawner?: ProcessSpawner;
}

/**
 * Runs an agent CLI. When `node-pty` loads, a pseudo-terminal is allocated so the tool sees a TTY
 * and streams ANSI output (stdout and stderr then arrive merged); otherwise plain pipes. The
 * argument vector goes to the process directly, never through a shell. The result is a
 * ProcessRunResult whose `mode` says which of the two ran.
 */
export abstract class AbstractCliRunner implements Runner {
  abstract readonly name: string;
  private readonly usePty: boolean;
  private readonly spawner: ProcessSpawner;

  protected constructor(options: CliRunnerOptions = {}) {
    this.usePty = options.usePty ?? true;
    this.spawner = options.spawner ?? new NodeProcessSpawner();
  }

  protected abstract command(request: RunRequest): readonly string[];

  /**
   * Override when the command needs temporary files (e.g. an MCP configuration). The runner
   * removes them once the process ends, however it ends.
   */
  protected prepare(request: RunRequest): Promise<PreparedCommand> {
    return Promise.resolve(new PreparedCommand(this.command(request)));
  }

  async run(request: RunRequest, signal?: AbortSignal): Promise<ProcessRunResult> {
    const prepared = await this.prepare(request);
    try {
      return await executeProcess({
        spawner: this.spawner,
        command: prepared.command,
        request,
        usePty: this.usePty,
        clean: stripAnsi,
        signal,
      });
    } finally {
      await prepared.cleanup();
    }
  }

  static stripAnsi(text: string): string {
    return stripAnsi(text);
  }
}
