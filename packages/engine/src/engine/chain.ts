import type { AgentSpec, GuardDefinition, StepDefinition, WorkflowDefinition } from '@indaba/core';
import { GuardType, IndabaError, roleOf, runnerChain } from '@indaba/core';

/** Which runners a speaker may use, in order, and what goes with them. */
export interface RunnerPlan {
  readonly names: readonly string[];
  readonly model: string | undefined;
  readonly agent: AgentSpec | undefined;
}

/** A role's own chain: used by every participant of a consensus. */
export function planForRole(workflow: WorkflowDefinition, roleName: string): RunnerPlan {
  const role = roleOf(workflow, roleName);
  return { names: runnerChain(role), model: role.model, agent: role.agent };
}

/**
 * The chain for a step's single speaker. A runner written on the step wins over the role's (the
 * role still supplies the model and, unless the step has its own, the agent).
 */
export function planForStep(step: StepDefinition, workflow: WorkflowDefinition): RunnerPlan {
  const role = step.role === undefined ? undefined : roleOf(workflow, step.role);
  if (step.runner !== undefined) {
    return {
      names: runnerChain({
        runner: step.runner,
        ...(step.fallbackRunners !== undefined ? { fallbackRunners: step.fallbackRunners } : {}),
      }),
      model: role?.model,
      agent: step.agent ?? role?.agent,
    };
  }
  if (role === undefined) {
    throw new IndabaError('Step has neither role nor runner.');
  }
  return { names: runnerChain(role), model: role.model, agent: step.agent ?? role.agent };
}

/**
 * The guards that will run: the declared ones, plus a scope guard implied by a `permissions` block
 * (an empty `fs.write` list means the step may change nothing).
 */
export function effectiveGuards(step: StepDefinition): readonly GuardDefinition[] {
  const implied: GuardDefinition[] =
    step.permissions === undefined || step.guards.some((g) => g.type === GuardType.DiffWithinScope)
      ? []
      : [{ type: GuardType.DiffWithinScope, paths: step.permissions.fsWrite }];
  return [...step.guards, ...implied];
}
