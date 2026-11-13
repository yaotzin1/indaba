import { emptyRun, type RunState, type StepView } from '@indaba/engine';

/** A step with every field a view needs; a test overrides what it is about. */
export function stepOf(over: Partial<StepView> = {}): StepView {
  return {
    id: 'build',
    status: 'RUNNING',
    attempts: 1,
    history: [],
    reason: undefined,
    startedAt: '2026-11-13T10:00:00.000Z',
    endedAt: undefined,
    runners: [],
    skipped: [],
    toolCalls: {},
    permissions: { allowed: 0, rejected: 0 },
    consensus: undefined,
    output: [],
    partialLine: '',
    outputTruncated: false,
    thoughts: [],
    partialThought: '',
    ...over,
  };
}

/** An agent runner view; `costUsd` is what the runner or the pricing table gave, or undefined for unknown. */
export function agent(costUsd: number | undefined, over: Partial<StepView['runners'][number]> = {}) {
  return {
    spanId: 's',
    name: 'claude-code',
    operation: 'invoke_agent',
    status: 'ok' as const,
    startedAt: '2026-11-13T10:00:00.000Z',
    endedAt: '2026-11-13T10:00:05.000Z',
    exitCode: 0,
    model: undefined,
    costUsd,
    inputTokens: 10,
    outputTokens: 5,
    ...over,
  };
}

export function runOf(steps: readonly StepView[]): RunState {
  return { ...emptyRun(), status: 'running', steps };
}

/** `n` running steps named s0, s1, ... each with a few lines of output. */
export function running(n: number): StepView[] {
  return Array.from({ length: n }, (_, i) =>
    stepOf({
      id: `s${i}`,
      output: [`line a of s${i}`, `line b of s${i}`, `line c of s${i}`, `line d of s${i}`],
    }),
  );
}
