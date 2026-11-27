import type { StepDefinition, WorkflowDefinition } from '@indaba/core';
import {
  DagBuilder,
  FailureAction,
  Isolation,
  isConsensusStep,
  isShellStep,
  SHELL_RUNNER,
  WorkflowValidationError,
} from '@indaba/core';

const NAME = /^[A-Za-z0-9_-]+$/;
const HTTP_URL = /^https?:\/\/\S+$/i;

/** Whether a declared role names the shell runner, first or as a fallback. */
export function roleNamesShellRunner(workflow: WorkflowDefinition, name: string): boolean {
  const role = Object.hasOwn(workflow.roles, name) ? workflow.roles[name] : undefined;
  return role !== undefined && [role.runner, ...(role.fallbackRunners ?? [])].includes(SHELL_RUNNER);
}

/** Semantic checks that need the whole document. */
export class WorkflowValidator {
  constructor(private readonly dag: DagBuilder = new DagBuilder()) {}

  /** Things that are legal but probably not what the author meant. They never block a run. */
  warnings(workflow: WorkflowDefinition): string[] {
    const warnings: string[] = [];
    for (const name of workflow.unusedInputs ?? []) {
      warnings.push(`the input "${name}" is declared but no step uses it.`);
    }
    for (const step of workflow.steps) {
      const at = `step "${step.id}"`;
      // At the level `full` no scope guard is added, so the isolation advice does not apply (specs/agent-permissions, AC-04).
      const scoped = step.permissions !== undefined && step.permissions.level !== 'full';
      if (scoped && step.isolation === Isolation.None) {
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
      if (scoped) {
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

  /** The parts of the `board` field that need other steps or the step's kind (specs/run-blackboard, AC-08 and AC-11). */
  private checkBoard(workflow: WorkflowDefinition, step: StepDefinition, errors: string[]): void {
    const board = step.board;
    if (board === undefined) {
      return;
    }
    const at = `steps[${workflow.steps.indexOf(step)}].board`;
    if (isShellStep(step)) {
      errors.push(
        `${at} is not allowed on a shell step: it has no prompt to add notes to and no reply to read posts from`,
      );
      return;
    }
    if (isConsensusStep(step) && board.post.length > 0) {
      errors.push(`${at}.post is not allowed on a debate step: the engine posts a debate's messages`);
    }
    const ids = new Set(workflow.steps.map((s) => s.id));
    const ancestors = this.dag.ancestorsOf(workflow, step.id);
    board.read?.steps?.forEach((id, j) => {
      if (!ids.has(id)) {
        errors.push(`${at}.read.steps[${j}] "${id}" is not a step`);
      } else if (!ancestors.includes(id)) {
        errors.push(`${at}.read.steps[${j}] "${id}" is not an ancestor of this step`);
      }
    });
  }

  /**
   * The shell runner hands what it is given to the system shell, so only a step that says `runner: shell` may reach it,
   * with the commands its author wrote. Any other step sends a prompt, which can quote what a model wrote: neither its
   * own runners nor those of a role it names may include the shell runner.
   */
  private checkShellRunner(workflow: WorkflowDefinition, step: StepDefinition, errors: string[]): void {
    if (isShellStep(step)) {
      return;
    }
    const refuse = (where: string): void => {
      errors.push(
        `step "${step.id}" would send an agent's prompt to the shell runner (${where}): that runner only runs the commands of a step that says runner: shell`,
      );
    };
    if (step.fallbackRunners?.includes(SHELL_RUNNER) === true) {
      refuse('a fallback of the step');
      return;
    }
    const named = [...(step.role === undefined ? [] : [step.role]), ...step.consensusWith];
    const reaching = named.find((name) => roleNamesShellRunner(workflow, name));
    if (reaching !== undefined) {
      refuse(`role "${reaching}"`);
    }
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
      if (step.arbiter !== undefined && !isConsensusStep(step)) {
        errors.push(`${at} has an arbiter but is not a debate (it needs consensus_with or decision_type)`);
      }
      for (const role of step.consensusWith) {
        if (!hasRole(role)) {
          errors.push(`${at} consensus_with unknown role "${role}"`);
        }
      }

      this.checkBoard(workflow, step, errors);
      this.checkShellRunner(workflow, step, errors);

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
