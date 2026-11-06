import type { Runner, WorkflowDefinition } from '@indaba/core';
import { isConsensusStep, isShellStep, isStallCapable } from '@indaba/core';
import { planForStep } from './chain.js';

/** The part of the runner registry the check needs. The real `RunnerRegistry` satisfies it. */
export interface StallRunners {
  has(name: string): boolean;
  get(name: string): Runner;
}

/**
 * A runner of a step's chain that cannot report activity, in a step that sets `stall` (specs/step-stalls, AC-12, AC-21).
 * Structured, with no English; `describeStallFinding` is the one sentence every consumer uses.
 */
export interface StallFinding {
  readonly stepId: string;
  readonly runner: string;
}

/**
 * Every runner of every stall step that would be asked for something it cannot do. A runner the registry does not know is
 * left to the checks that already report it; a runner written before the capability existed is refused here, by name.
 */
export function checkStalls(workflow: WorkflowDefinition, runners: StallRunners): StallFinding[] {
  const findings: StallFinding[] = [];
  for (const step of workflow.steps) {
    if (step.stall === undefined || isShellStep(step) || isConsensusStep(step)) {
      continue;
    }
    for (const name of planForStep(step, workflow).names) {
      if (runners.has(name) && !isStallCapable(runners.get(name))) {
        findings.push({ stepId: step.id, runner: name });
      }
    }
  }
  return findings;
}

/** The contract's message (api-surface.md). Names only: never a path, a prompt or anything from the file's text. */
export function describeStallFinding(finding: StallFinding): string {
  return `step "${finding.stepId}": runner "${finding.runner}" cannot report activity, so stall cannot be used with it`;
}
