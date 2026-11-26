/**
 * The resolvers of a step's runner chain and guards live in `@indaba/core`, so the run and `plan --explain` call one
 * function (specs/plan-explain, AC-04). They are re-exported here for the engine's own files and its index.
 */
export type { RunnerPlan } from '@indaba/core';
export { effectiveGuards, planForRole, planForStep } from '@indaba/core';
