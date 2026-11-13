import type { RunSummaryOfUse, WorkflowSummary } from '@indaba/engine';
import type { RunControlRefusal } from '../src/run-flow.js';

export function workflow(over: Partial<WorkflowSummary> = {}): WorkflowSummary {
  return {
    id: 'w1',
    name: 'review',
    path: 'review.workflow.ai.yml',
    project: 'app',
    valid: true,
    problems: [],
    ...over,
  };
}

export const USE: RunSummaryOfUse = {
  runners: ['shell'],
  commands: ['build: npm test'],
  permissions: ['build: runner default (unrestricted)'],
  needsPerson: [],
  fullAccessSteps: [],
};

/** What createRunControl throws: an Error named RunControlError with a code and a detail. */
export function refusal(
  code: string,
  detail: Record<string, unknown> = {},
  message = code,
): RunControlRefusal {
  const error = new Error(message);
  error.name = 'RunControlError';
  return Object.assign(error, { code, detail });
}
