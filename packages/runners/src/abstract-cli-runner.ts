import { rm } from 'node:fs/promises';
import type {
  PermissionCapability,
  PermissionCapable,
  PermissionLevel,
  Runner,
  RunRequest,
} from '@indaba/core';
import type { EnvironmentPolicy } from './env.js';
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
  /** The environment the agent's own is taken from; only an allowlist of it is passed on. Defaults to this process's. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Extra variables to pass on: exact names, or a prefix ending in `*`. */
  readonly passEnv?: readonly string[];
}

/**
 * Runs an agent CLI. When `node-pty` loads, a pseudo-terminal is allocated so the tool sees a TTY
 * and streams ANSI output (stdout and stderr then arrive merged); otherwise plain pipes. The
 * argument vector goes to the process directly, never through a shell. The result is a
 * ProcessRunResult whose `mode` says which of the two ran.
 */
export abstract class AbstractCliRunner implements Runner, PermissionCapable {
  abstract readonly name: string;
  protected readonly usePty: boolean;
  protected readonly spawner: ProcessSpawner;
  private readonly hostEnv: Readonly<Record<string, string | undefined>>;
  private readonly passEnv: readonly string[];

  protected constructor(options: CliRunnerOptions = {}) {
    this.hostEnv = options.env ?? process.env;
    this.passEnv = options.passEnv ?? [];
    this.usePty = options.usePty ?? true;
    this.spawner = options.spawner ?? new NodeProcessSpawner();
  }

  /** The prefixes of the provider credentials this CLI is meant to hold, besides the baseline. A subclass declares its own. */
  protected envPrefixes(): readonly string[] {
    return [];
  }

  /** The allowlist of the host environment this runner's child receives (specs/host-process-containment, AC-04). */
  protected environmentPolicy(): EnvironmentPolicy {
    return { source: this.hostEnv, prefixes: this.envPrefixes(), passEnv: this.passEnv };
  }

  protected abstract command(request: RunRequest): readonly string[];

  /** What each level means for this runner (specs/agent-permissions, C-03). A subclass that declares nothing supports no level. */
  permissionCapabilities(): readonly PermissionCapability[] {
    return [];
  }

  /** Whether the output says a permission was refused in headless mode (AC-11). The default cannot tell. */
  permissionDenied(_output: string): boolean {
    return false;
  }

  get canRecogniseDenial(): boolean {
    return false;
  }

  /** The command-line arguments that make a written level true for this runner; empty when it needs none. */
  protected levelArguments(_level: PermissionLevel): readonly string[] {
    return [];
  }

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
        environment: this.environmentPolicy(),
      });
    } finally {
      await prepared.cleanup();
    }
  }

  static stripAnsi(text: string): string {
    return stripAnsi(text);
  }
}
