import type { WorkflowDefinition } from '@indaba/core';
import {
  DagBuilder,
  FailureAction,
  Isolation,
  isConsensusStep,
  isShellStep,
  WorkflowValidationError,
} from '@indaba/core';

const NAME = /^[A-Za-z0-9_-]+$/;
const HTTP_URL = /^https?:\/\/\S+$/i;

/** Semantic checks that need the whole document. */
export class WorkflowValidator {
  constructor(private readonly dag: DagBuilder = new DagBuilder()) {}

  /** Things that are legal but probably not what the author meant. They never block a run. */
  warnings(workflow: WorkflowDefinition): string[] {
    const warnings: string[] = [];
    for (const step of workflow.steps) {
      const at = `step "${step.id}"`;
      if (step.permissions !== undefined && step.isolation === Isolation.None) {
        warnings.push(
          `${at} declares permissions but has no isolation: the scope guard then sees every change in the working tree, not only the step's. Use isolation: git_worktree.`,
        );
      }
      const role = step.role === undefined ? undefined : workflow.roles[step.role];
      if (step.runner !== undefined && role !== undefined) {
        const own = [step.runner, ...(step.fallbackRunners ?? [])].join(', ');
        const theirs = [role.runner, ...(role.fallbackRunners ?? [])].join(', ');
        if (own !== theirs) {
          warnings.push(
            `${at} sets runner (${own}), which takes precedence over role "${role.name}" (${theirs}).`,
          );
        }
      }
      if (step.permissions !== undefined) {
        const names =
          step.runner !== undefined || role === undefined
            ? [step.runner, ...(step.fallbackRunners ?? [])]
            : [role.runner, ...(role.fallbackRunners ?? [])];
        if (!names.includes('acp')) {
          warnings.push(
            `${at} declares permissions but no acp runner is in its chain: only the scope guard enforces them, after the step has run.`,
          );
        }
      }
    }
    return warnings;
  }

  validate(workflow: WorkflowDefinition): string[] {
    const errors: string[] = [];
    const ids = new Set<string>();
    const hasServer = (name: string): boolean => Object.hasOwn(workflow.mcpServers, name);
    const hasRole = (name: string): boolean => Object.hasOwn(workflow.roles, name);

    if (workflow.steps.length === 0) {
      errors.push('steps must contain at least one step');
    }

    for (const step of workflow.steps) {
      if (!NAME.test(step.id)) {
        errors.push(`step id "${step.id}" must match [A-Za-z0-9_-]+`);
      }
      if (ids.has(step.id)) {
        errors.push(`duplicate step id "${step.id}"`);
      }
      ids.add(step.id);
    }

    for (const [name, server] of Object.entries(workflow.mcpServers)) {
      const at = `mcp_servers.${name}`;
      if (!NAME.test(name)) {
        errors.push(`${at} name must match [A-Za-z0-9_-]+`);
      }
      if ((server.command === undefined) === (server.url === undefined)) {
        errors.push(`${at} needs exactly one of "command" or "url"`);
      }
      if (server.url !== undefined && !HTTP_URL.test(server.url)) {
        errors.push(`${at} url must be an http or https URL`);
      }
      if (server.url !== undefined && (server.args.length > 0 || Object.keys(server.env).length > 0)) {
        errors.push(`${at} "args" and "env" only apply to a "command" server`);
      }
    }

    for (const role of Object.values(workflow.roles)) {
      for (const name of role.mcp) {
        if (!hasServer(name)) {
          errors.push(`role "${role.name}" uses unknown MCP server "${name}"`);
        }
      }
    }

    for (const step of workflow.steps) {
      const at = `step "${step.id}"`;

      for (const name of step.mcp) {
        if (!hasServer(name)) {
          errors.push(`${at} uses unknown MCP server "${name}"`);
        }
      }

      for (const dep of step.dependsOn) {
        if (dep === step.id) {
          errors.push(`${at} depends on itself`);
        } else if (!ids.has(dep)) {
          errors.push(`${at} depends on unknown step "${dep}"`);
        }
      }

      if (step.role !== undefined && !hasRole(step.role)) {
        errors.push(`${at} uses unknown role "${step.role}"`);
      }
      if (step.role === undefined && step.runner === undefined) {
        errors.push(`${at} needs a role or a runner`);
      }
      if (isShellStep(step) && step.commands.length === 0) {
        errors.push(`${at} uses the shell runner but declares no commands`);
      }
      if (!isShellStep(step) && step.commands.length > 0) {
        errors.push(`${at} declares commands but is not a shell step`);
      }
      if (isConsensusStep(step) && step.role === undefined) {
        errors.push(`${at} needs a role to take part in a consensus`);
      }
      for (const role of step.consensusWith) {
        if (!hasRole(role)) {
          errors.push(`${at} consensus_with unknown role "${role}"`);
        }
      }

      const onFailure = step.onFailure;
      if (onFailure?.action === FailureAction.RetryStep) {
        if (onFailure.maxRetries < 1) {
          errors.push(`${at} on_failure.max_retries must be at least 1`);
        }
        const target = onFailure.target;
        if (target === undefined || !ids.has(target)) {
          errors.push(`${at} on_failure.target "${target ?? ''}" is not a step`);
        } else if (target !== step.id && !this.dag.ancestorsOf(workflow, step.id).includes(target)) {
          errors.push(`${at} on_failure.target "${target}" must be the step itself or one of its ancestors`);
        }
      }
    }

    if (errors.length === 0) {
      try {
        this.dag.build(workflow);
      } catch (error) {
        if (error instanceof WorkflowValidationError) {
          errors.push(...error.problems);
        } else {
          throw error;
        }
      }
    }

    return errors;
  }
}
