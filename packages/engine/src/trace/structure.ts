import type { StepDefinition, StepFailureRoute, StepStructure } from '@indaba/core';

/**
 * The structure of a run: every step, what it waits for and where a failure leads, recorded on the run's root span
 * when the run starts. A step's own span exists only once the step runs, so the root is the one place that can
 * describe the steps that have not run yet.
 *
 * A span attribute holds a string, a number or a boolean, so the list is one JSON string. The writer and the reader
 * live here together, so the two cannot drift apart.
 */
export const WORKFLOW_STRUCTURE_ATTRIBUTE = 'indaba.workflow.structure';

/** The most steps a recorded structure may describe; a record with more is not read. */
export const MAX_STRUCTURE_STEPS = 500;

/** The attribute's value for these steps, in the order the engine runs them. */
export function describeStructure(steps: readonly StepDefinition[]): string {
  return JSON.stringify(
    steps.map((step) => ({
      id: step.id,
      dependsOn: [...step.dependsOn],
      ...(step.onFailure === undefined
        ? {}
        : {
            onFailure: {
              action: step.onFailure.action,
              ...(step.onFailure.target === undefined ? {} : { target: step.onFailure.target }),
              maxRetries: step.onFailure.maxRetries,
            },
          }),
    })),
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function routeOf(value: unknown): StepFailureRoute | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || !isText(value.action)) {
    return null;
  }
  const target = value.target;
  const retries = value.maxRetries;
  if (target !== undefined && !isText(target)) {
    return null;
  }
  if (typeof retries !== 'number' || !Number.isInteger(retries) || retries < 0) {
    return null;
  }
  return { action: value.action, target, maxRetries: retries };
}

function stepOf(value: unknown): StepStructure | null {
  if (!isRecord(value) || !isText(value.id) || !Array.isArray(value.dependsOn)) {
    return null;
  }
  const dependsOn: readonly unknown[] = value.dependsOn;
  if (!dependsOn.every(isText)) {
    return null;
  }
  const onFailure = routeOf(value.onFailure);
  if (onFailure === null) {
    return null;
  }
  return { id: value.id, dependsOn: dependsOn.filter(isText), onFailure };
}

/**
 * The structure an attribute value describes, or undefined when it is missing or cannot be trusted. All or nothing:
 * one malformed step, a duplicate id, or an edge to a step the list does not name, and the whole value is ignored,
 * because a graph with a wrong edge is worse than a list with none. Never throws.
 */
export function readStructure(value: unknown): readonly StepStructure[] | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_STRUCTURE_STEPS) {
    return undefined;
  }
  const items: readonly unknown[] = parsed;
  const steps: StepStructure[] = [];
  for (const item of items) {
    const step = stepOf(item);
    if (step === null) {
      return undefined;
    }
    steps.push(step);
  }
  const ids = new Set(steps.map((step) => step.id));
  if (ids.size !== steps.length) {
    return undefined;
  }
  const known = (id: string | undefined): boolean => id === undefined || ids.has(id);
  if (!steps.every((step) => step.dependsOn.every(known) && known(step.onFailure?.target))) {
    return undefined;
  }
  return steps;
}
