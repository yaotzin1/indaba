import type { TokenUsage } from '../observability/index.js';
import type { AgentSpec, McpServerDefinition, StepPermissions } from '../workflow/model.js';

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
  /** What the step may touch. Runners that cannot enforce it ignore it; the scope guard still applies. */
  readonly permissions?: StepPermissions;
  /** Which agent an agent-protocol runner should start; other runners ignore it. */
  readonly agent?: AgentSpec;
}

export const DEFAULT_TIMEOUT_SECONDS = 900;

export interface RunResultInit {
  readonly exitCode: number;
  readonly output: string;
  readonly errorOutput?: string;
  readonly usage?: TokenUsage;
  readonly durationMs?: number;
  readonly model?: string;
  /** USD cost the provider or agent itself reported. Never computed from anything else. */
  readonly reportedCostUsd?: number;
}

export class RunResult {
  readonly exitCode: number;
  readonly output: string;
  readonly errorOutput: string;
  readonly usage?: TokenUsage;
  readonly durationMs: number;
  readonly model?: string;
  readonly reportedCostUsd?: number;

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
    if (init.reportedCostUsd !== undefined) {
      this.reportedCostUsd = init.reportedCostUsd;
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

export interface SkippedRunner {
  readonly runner: string;
  readonly reason: string;
}

export interface RunnerChainOwner {
  readonly runner: string;
  readonly fallbackRunners?: readonly string[];
}

/** The runners to try, in order: the primary, then each fallback. A runner is listed once. */
export function runnerChain(owner: RunnerChainOwner): readonly string[] {
  return [...new Set([owner.runner, ...(owner.fallbackRunners ?? [])])];
}
