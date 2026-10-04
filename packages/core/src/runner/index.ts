import type { TokenUsage } from '../observability/index.js';
import type { McpServerDefinition } from '../workflow/model.js';

export interface RunRequest {
  readonly prompt: string;
  readonly workdir: string;
  readonly model?: string;
  /** Defaults to 900 when absent; runners apply it. */
  readonly timeoutSeconds?: number;
  readonly env?: Readonly<Record<string, string>>;
  /** Receives output as it streams. */
  readonly onOutput?: (chunk: string) => void;
  /** Servers the runner is asked to make available; only honoured by runners whose capability is Injected. */
  readonly mcpServers?: readonly McpServerDefinition[];
}

export const DEFAULT_TIMEOUT_SECONDS = 900;

export interface RunResultInit {
  readonly exitCode: number;
  readonly output: string;
  readonly errorOutput?: string;
  readonly usage?: TokenUsage;
  readonly durationMs?: number;
  readonly model?: string;
}

export class RunResult {
  readonly exitCode: number;
  readonly output: string;
  readonly errorOutput: string;
  readonly usage?: TokenUsage;
  readonly durationMs: number;
  readonly model?: string;

  constructor(init: RunResultInit) {
    this.exitCode = init.exitCode;
    this.output = init.output;
    this.errorOutput = init.errorOutput ?? '';
    this.durationMs = init.durationMs ?? 0;
    if (init.usage !== undefined) {
      this.usage = init.usage;
    }
    if (init.model !== undefined) {
      this.model = init.model;
    }
  }

  succeeded(): boolean {
    return this.exitCode === 0;
  }

  /** Stderr when present, otherwise stdout: the part worth showing after a failure. */
  failureText(): string {
    return (this.errorOutput.trim() !== '' ? this.errorOutput : this.output).trim();
  }
}

export interface Runner {
  /** The name workflows use to select this runner, e.g. "claude-code". */
  readonly name: string;
  run(request: RunRequest, signal?: AbortSignal): Promise<RunResult>;
}
