import type { AttemptView, RunnerView, RunSnapshot, StepStructure, StepView } from '@indaba/core';

export const T = (seconds: number): string => new Date(Date.UTC(2026, 9, 20, 12, 0, seconds)).toISOString();

export function step(id: string, patch: Partial<StepView> = {}): StepView {
  return {
    id,
    status: 'PENDING',
    attempts: 0,
    history: [],
    reason: undefined,
    startedAt: undefined,
    endedAt: undefined,
    runners: [],
    skipped: [],
    toolCalls: {},
    permissions: { allowed: 0, rejected: 0 },
    consensus: undefined,
    output: [],
    partialLine: '',
    outputTruncated: false,
    ...patch,
  };
}

export function attempt(
  n: number,
  outcome: string,
  start: number,
  end?: number,
  reason?: string,
): AttemptView {
  return {
    attempt: n,
    startedAt: T(start),
    endedAt: end === undefined ? undefined : T(end),
    outcome,
    reason,
  };
}

export function runner(patch: Partial<RunnerView> = {}): RunnerView {
  return {
    spanId: `span-${Math.abs(patch.name?.length ?? 1)}`,
    name: 'claude-code',
    operation: 'invoke_agent',
    status: 'ok',
    startedAt: T(1),
    endedAt: T(5),
    exitCode: 0,
    model: undefined,
    costUsd: undefined,
    inputTokens: undefined,
    outputTokens: undefined,
    ...patch,
  };
}

export const STRUCTURE: readonly StepStructure[] = [
  { id: 'rfc', dependsOn: [], onFailure: undefined },
  { id: 'code', dependsOn: ['rfc'], onFailure: undefined },
  { id: 'verify', dependsOn: ['code'], onFailure: { action: 'retry_step', target: 'code', maxRetries: 3 } },
  {
    id: 'review',
    dependsOn: ['verify'],
    onFailure: { action: 'escalate', target: undefined, maxRetries: 0 },
  },
];

/** A run in the middle of a retry: rfc and code done, verify on its second try, review waiting. */
export function liveRun(patch: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    traceId: 'a'.repeat(32),
    taskId: 'task-1',
    workflow: 'task-pipeline',
    status: 'running',
    startedAt: T(0),
    endedAt: undefined,
    lastAt: T(30),
    structure: STRUCTURE,
    steps: [
      step('rfc', {
        status: 'COMPLETED',
        attempts: 1,
        history: [attempt(1, 'COMPLETED', 0, 4)],
        startedAt: T(0),
        endedAt: T(4),
        runners: [
          runner({
            spanId: 's1',
            name: 'openrouter',
            model: 'some/model',
            costUsd: 0.21,
            inputTokens: 8100,
            outputTokens: 2400,
          }),
        ],
        output: ['Specification written.'],
      }),
      step('code', {
        status: 'COMPLETED',
        attempts: 2,
        history: [attempt(1, 'COMPLETED', 5, 10), attempt(2, 'COMPLETED', 15, 20)],
        startedAt: T(5),
        endedAt: T(20),
        runners: [runner({ spanId: 's2', name: 'claude-code' })],
        toolCalls: { edit: 5, execute: 3 },
        permissions: { allowed: 8, rejected: 0 },
      }),
      step('verify', {
        status: 'RUNNING',
        attempts: 2,
        history: [attempt(1, 'FAILED', 10, 14, 'pnpm typecheck exited with 2'), attempt(2, 'RUNNING', 21)],
        startedAt: T(10),
        runners: [
          runner({
            spanId: 's3',
            name: 'shell',
            operation: 'execute_tool',
            exitCode: undefined,
            endedAt: undefined,
          }),
        ],
        output: ['> pnpm test'],
        partialLine: ' RUN v4',
      }),
    ],
    cost: { usd: 0.21, unknown: 1, calls: 2 },
    notes: [],
    ...patch,
  };
}
