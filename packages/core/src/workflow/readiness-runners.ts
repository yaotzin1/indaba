import { SHELL_RUNNER, type StepDefinition, type WorkflowDefinition } from './model.js';

/**
 * The runners a step may use, in order, each with its preset and the command the author wrote for its agent (only the
 * first runner has either); a shell step has none to check.
 */
export function runnerChainOf(
  step: StepDefinition,
  workflow: WorkflowDefinition,
): readonly (readonly [string, string | undefined, readonly string[] | undefined])[] {
  const role = step.role === undefined ? undefined : workflow.roles[step.role];
  const primary = step.runner ?? role?.runner;
  if (primary === undefined || primary === SHELL_RUNNER) {
    return [];
  }
  const preset = step.agent?.preset ?? role?.agent?.preset;
  const command = step.agent?.command ?? role?.agent?.command;
  const fallbacks = step.fallbackRunners ?? role?.fallbackRunners ?? [];
  return [...new Set([primary, ...fallbacks])].map(
    (name) => [name, name === primary ? preset : undefined, name === primary ? command : undefined] as const,
  );
}
