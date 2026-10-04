import type { McpServerDefinition, Runner, StepDefinition, WorkflowDefinition } from '@indaba/core';
import { isConsensusStep, McpPolicy, RunnerError } from '@indaba/core';

/** How a runner offers MCP. Mirrors the runners package's `McpCapability` values; matched by value. */
export const McpSupport = {
  Injected: 'injected',
  AgentManaged: 'agent_managed',
  None: 'none',
} as const;
export type McpSupport = (typeof McpSupport)[keyof typeof McpSupport];

/** Anything that resolves a runner by the name a workflow uses; `RunnerRegistry` satisfies it. */
export interface RunnerLookup {
  get(name: string): Runner;
}

/**
 * One preflight finding about an MCP server a step wants. Carries names only: server definitions
 * can hold secrets and never appear in messages.
 */
export class McpIssue {
  constructor(
    readonly stepId: string,
    readonly runner: string,
    readonly server: string,
    readonly isError: boolean,
    readonly message: string,
  ) {}

  describe(): string {
    return `step "${this.stepId}" (runner ${this.runner}), server "${this.server}": ${this.message}`;
  }
}

/** What one runner can do about the MCP servers one step wants. */
export class McpResolution {
  constructor(
    /** passed to the runner */
    readonly injected: readonly McpServerDefinition[] = [],
    /** names the agent is trusted to have configured itself */
    readonly assumed: readonly string[] = [],
    /** names dropped under the optional policy */
    readonly skipped: readonly string[] = [],
    /** names that cannot be provided under the required policy */
    readonly missing: readonly string[] = [],
  ) {}
}

export type Speaker = readonly [roleName: string | undefined, runnerName: string];

/**
 * Decides, per step and per runner, how each wanted MCP server is provided, and checks the whole
 * workflow before anything runs.
 */
export class McpPlanner {
  constructor(private readonly runners: RunnerLookup) {}

  /** A runner that does not declare `mcpCapability()` has no MCP. */
  static capabilityOf(runner: Runner): McpSupport {
    const declared: unknown = (runner as { mcpCapability?: unknown }).mcpCapability;
    if (typeof declared !== 'function') {
      return McpSupport.None;
    }
    const value: unknown = declared.call(runner);
    return value === McpSupport.Injected || value === McpSupport.AgentManaged ? value : McpSupport.None;
  }

  /** @param roleName the role speaking in this step (a consensus has several), if any */
  resolve(
    workflow: WorkflowDefinition,
    step: StepDefinition,
    roleName: string | undefined,
    runner: Runner,
  ): McpResolution {
    let names: string[] = [...step.mcp];
    if (roleName !== undefined && Object.hasOwn(workflow.roles, roleName)) {
      names = [...(workflow.roles[roleName]?.mcp ?? []), ...names];
    }
    names = [...new Set(names)];
    if (names.length === 0) {
      return new McpResolution();
    }

    const policy = step.mcpPolicy ?? workflow.defaultMcpPolicy;
    const capability = McpPlanner.capabilityOf(runner);

    const injected: McpServerDefinition[] = [];
    const assumed: string[] = [];
    const skipped: string[] = [];
    const missing: string[] = [];
    for (const name of names) {
      const definition = Object.hasOwn(workflow.mcpServers, name) ? workflow.mcpServers[name] : undefined;
      if (definition === undefined) {
        missing.push(name); // unreachable after validation; fail closed regardless
      } else if (capability === McpSupport.Injected) {
        injected.push(definition);
      } else if (capability === McpSupport.AgentManaged) {
        assumed.push(name);
      } else if (policy === McpPolicy.Optional) {
        skipped.push(name);
      } else {
        missing.push(name);
      }
    }
    return new McpResolution(injected, assumed, skipped, missing);
  }

  /** Errors are what blocks a run; warnings are informational. */
  preflight(workflow: WorkflowDefinition): McpIssue[] {
    const issues: McpIssue[] = [];

    for (const step of workflow.steps) {
      for (const [roleName, runnerName] of this.speakers(workflow, step)) {
        let runner: Runner;
        try {
          runner = this.runners.get(runnerName);
        } catch (error) {
          if (error instanceof RunnerError) {
            continue; // an unknown runner is reported when the step runs
          }
          throw error;
        }

        const resolution = this.resolve(workflow, step, roleName, runner);
        for (const name of resolution.missing) {
          issues.push(
            new McpIssue(step.id, runnerName, name, true, 'the runner has no MCP support (policy: required)'),
          );
        }
        for (const name of resolution.skipped) {
          issues.push(
            new McpIssue(
              step.id,
              runnerName,
              name,
              false,
              'the runner has no MCP support; the step will run without it (policy: optional)',
            ),
          );
        }
        for (const name of resolution.assumed) {
          issues.push(
            new McpIssue(
              step.id,
              runnerName,
              name,
              false,
              'managed by the agent itself; Indaba cannot verify it is configured',
            ),
          );
        }
      }
    }
    return issues;
  }

  /** Who runs a step: one speaker, or every participant of a consensus. */
  speakers(workflow: WorkflowDefinition, step: StepDefinition): Speaker[] {
    const roles = isConsensusStep(step)
      ? [...new Set([...(step.role === undefined ? [] : [step.role]), ...step.consensusWith])]
      : step.role === undefined
        ? []
        : [step.role];

    if (roles.length === 0) {
      return [[undefined, step.runner ?? '']];
    }

    const speakers: Speaker[] = [];
    for (const role of roles) {
      const definition = Object.hasOwn(workflow.roles, role) ? workflow.roles[role] : undefined;
      if (definition !== undefined) {
        speakers.push([role, definition.runner]);
      }
    }
    return speakers;
  }
}
