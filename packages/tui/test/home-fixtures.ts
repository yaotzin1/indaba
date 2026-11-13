import type { RunSummary } from '@indaba/engine';

export function makeRun(over: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: 'aa11',
    startedAt: '2026-11-13T10:20:30.000Z',
    status: 'completed',
    workflow: 'review',
    cost: { usd: 0.456, unknown: 0, calls: 3 },
    ...over,
  };
}

export const runs = (n: number): RunSummary[] =>
  Array.from({ length: n }, (_, i) => makeRun({ runId: `a${i}`, workflow: `wf-${i}` }));
