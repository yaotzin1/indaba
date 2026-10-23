import type {
  EnforcementDescription,
  PermissionLevel,
  Runner,
  StepDefinition,
  WorkflowDefinition,
} from '@indaba/core';
import {
  applyBound,
  describeEnforcement,
  effectiveLevel,
  isConsensusStep,
  isPermissionCapable,
  isShellStep,
  PermissionLevel as Level,
  PERMISSION_ORDER,
  permissionCapabilitiesOf,
  unsupportedBy,
} from '@indaba/core';
import { planForStep } from './chain.js';

/** The part of the runner registry the checks need. The real `RunnerRegistry` satisfies it. */
export interface PermissionRunners {
  has(name: string): boolean;
  get(name: string): Runner;
}

/**
 * One thing `validate`, `plan` and the start of a run say about a step's permissions (specs/agent-permissions, AC-07,
 * AC-08, AC-18, C-10). Structured, with no English: the CLI and the page put it in words.
 */
export type PermissionFinding =
  | {
      readonly severity: 'error';
      readonly code: 'unsupported';
      readonly stepId: string;
      readonly runner: string;
      readonly level: PermissionLevel;
      readonly note: string | undefined;
    }
  | { readonly severity: 'error'; readonly code: 'read_with_mcp'; readonly stepId: string }
  | { readonly severity: 'note'; readonly code: 'edit_with_mcp'; readonly stepId: string }
  | { readonly severity: 'fact'; readonly code: 'default'; readonly stepId: string; readonly runner: string }
  | {
      readonly severity: 'fact';
      readonly code: 'full';
      readonly stepId: string;
      readonly runners: readonly string[];
    }
  | {
      readonly severity: 'fact';
      readonly code: 'enforcement';
      readonly stepId: string;
      readonly description: EnforcementDescription;
    }
  | {
      readonly severity: 'note';
      readonly code: 'denial_unrecognised';
      readonly stepId: string;
      readonly runner: string;
    }
  | { readonly severity: 'note'; readonly code: 'bound_no_effect'; readonly stepId: string };

/** Agent steps only: a shell step and a debate step have no permissions of their own (AC-03, AC-19). */
export function isAgentStep(step: StepDefinition): boolean {
  return !isShellStep(step) && !isConsensusStep(step);
}

function chainOf(
  step: StepDefinition,
  workflow: WorkflowDefinition,
  runners: PermissionRunners,
): readonly { readonly name: string; readonly runner: Runner }[] {
  const out: { name: string; runner: Runner }[] = [];
  for (const name of planForStep(step, workflow).names) {
    if (runners.has(name)) {
      out.push({ name, runner: runners.get(name) });
    }
  }
  return out;
}

function hasMcp(step: StepDefinition, workflow: WorkflowDefinition): boolean {
  if (step.mcp.length > 0) {
    return true;
  }
  const role = step.role === undefined ? undefined : workflow.roles[step.role];
  return role !== undefined && role.mcp.length > 0;
}

/**
 * AC-07, AC-08, AC-18: what the permissions of every agent step mean for the runners of its chain. A runner that is not
 * registered is skipped here (the parser and the run report it). A written level that a runner of the chain cannot
 * honour is an error; everything else is a fact or a note.
 */
export function checkPermissions(
  workflow: WorkflowDefinition,
  runners: PermissionRunners,
): PermissionFinding[] {
  const findings: PermissionFinding[] = [];
  for (const step of workflow.steps) {
    if (!isAgentStep(step)) {
      continue;
    }
    const chain = chainOf(step, workflow, runners);
    const current = effectiveLevel(step.permissions);

    if (current.kind === 'default') {
      for (const { name, runner } of chain) {
        // A runner that cannot act has no default worth stating.
        if (permissionCapabilitiesOf(runner).some((c) => c.note === 'cannot_act')) {
          continue;
        }
        findings.push({ severity: 'fact', code: 'default', stepId: step.id, runner: name });
      }
      continue;
    }

    const level = current.level;
    for (const miss of unsupportedBy(
      level,
      chain.map(({ name, runner }) => ({ name, capabilities: permissionCapabilitiesOf(runner) })),
    )) {
      findings.push({
        severity: 'error',
        code: 'unsupported',
        stepId: step.id,
        runner: miss.runner,
        level,
        note: miss.capability?.note,
      });
    }
    if (level === Level.Full) {
      findings.push({ severity: 'fact', code: 'full', stepId: step.id, runners: chain.map((c) => c.name) });
    }
    if (hasMcp(step, workflow)) {
      findings.push(
        level === Level.Read
          ? { severity: 'error', code: 'read_with_mcp', stepId: step.id }
          : level === Level.Edit
            ? { severity: 'note', code: 'edit_with_mcp', stepId: step.id }
            : { severity: 'fact', code: 'full', stepId: step.id, runners: chain.map((c) => c.name) },
      );
    }
    for (const { name, runner } of chain) {
      const capability = permissionCapabilitiesOf(runner).find((c) => c.level === level);
      if (capability !== undefined && capability.mode !== 'unsupported') {
        findings.push({
          severity: 'fact',
          code: 'enforcement',
          stepId: step.id,
          description: describeEnforcement(name, capability),
        });
      }
      if (isPermissionCapable(runner) && !runner.canRecogniseDenial && level !== Level.Full) {
        findings.push({ severity: 'note', code: 'denial_unrecognised', stepId: step.id, runner: name });
      }
    }
  }
  return dropDuplicateFacts(findings);
}

function dropDuplicateFacts(findings: PermissionFinding[]): PermissionFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = JSON.stringify(finding);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** AC-05: the agent steps whose effective level is `full`, with the runners of their chain, in workflow order. */
export function fullAccessSteps(
  workflow: WorkflowDefinition,
  runners: PermissionRunners,
): readonly { readonly stepId: string; readonly runners: readonly string[] }[] {
  return workflow.steps
    .filter((step) => isAgentStep(step) && step.permissions?.level === Level.Full)
    .map((step) => ({
      stepId: step.id,
      runners: chainOf(step, workflow, runners).map((c) => c.name),
    }));
}

/** AC-12: one `--permissions [<step>=]<level>` value. */
export interface RunBound {
  readonly step?: string;
  readonly level: PermissionLevel;
}

/** Parses `read`, `edit`, `full`, or `<step>=<level>`; the error names what was wrong. */
export function parseRunBound(text: string): RunBound | { readonly error: string } {
  const at = text.indexOf('=');
  const levelName = at < 0 ? text : text.slice(at + 1);
  const level = PERMISSION_ORDER.find((candidate) => candidate === levelName);
  if (level === undefined) {
    return { error: `--permissions "${text}": the level must be read, edit or full` };
  }
  if (at < 0) {
    return { level };
  }
  const step = text.slice(0, at);
  return step === '' ? { error: `--permissions "${text}": the step name is empty` } : { step, level };
}

export interface BoundedWorkflow {
  readonly workflow: WorkflowDefinition;
  /** Usage errors (AC-12); the run must not start when this is not empty. */
  readonly errors: readonly string[];
  readonly findings: readonly PermissionFinding[];
}

/**
 * AC-12: lower the permissions of this run. A bound never raises a level and never writes the file; it returns a new
 * workflow whose steps carry the lowered block, so every reader (the guards, the runner request, the confirmation) sees
 * the effective block. A named step wins over a bound with no step.
 */
export function applyRunBounds(
  workflow: WorkflowDefinition,
  bounds: readonly RunBound[],
  runners: PermissionRunners,
): BoundedWorkflow {
  if (bounds.length === 0) {
    return { workflow, errors: [], findings: [] };
  }
  const errors: string[] = [];
  const findings: PermissionFinding[] = [];
  const everywhere = bounds
    .filter((b) => b.step === undefined)
    .reduce<PermissionLevel | undefined>(
      (lowest, b) =>
        lowest === undefined || PERMISSION_ORDER.indexOf(b.level) < PERMISSION_ORDER.indexOf(lowest)
          ? b.level
          : lowest,
      undefined,
    );
  for (const named of bounds.filter((b) => b.step !== undefined)) {
    const target = workflow.steps.find((s) => s.id === named.step);
    if (target === undefined) {
      errors.push(`--permissions: the workflow has no step "${named.step}"`);
    } else if (!isAgentStep(target)) {
      errors.push(
        `--permissions: step "${named.step}" is not an agent step, so it has no permissions to bound`,
      );
    }
  }

  const steps = workflow.steps.map((step) => {
    if (!isAgentStep(step)) {
      return step;
    }
    const own = bounds.filter((b) => b.step === step.id).map((b) => b.level);
    const all = [...own, ...(everywhere === undefined ? [] : [everywhere])];
    let result = step;
    for (const bound of all) {
      const bounded = applyBound(result.permissions, bound);
      if (!bounded.changed) {
        if (effectiveLevel(result.permissions).kind === 'default') {
          findings.push({ severity: 'note', code: 'bound_no_effect', stepId: step.id });
        }
        continue;
      }
      result = bounded.permissions === undefined ? result : { ...result, permissions: bounded.permissions };
    }
    if (result !== step && result.permissions?.level !== undefined) {
      const chain = chainOf(result, workflow, runners);
      for (const miss of unsupportedBy(
        result.permissions.level,
        chain.map(({ name, runner }) => ({ name, capabilities: permissionCapabilitiesOf(runner) })),
      )) {
        errors.push(
          `--permissions: runner "${miss.runner}" of step "${step.id}" cannot hold the level "${result.permissions.level}"`,
        );
      }
    }
    return result;
  });
  return { workflow: { ...workflow, steps }, errors, findings: dropDuplicateFacts(findings) };
}
