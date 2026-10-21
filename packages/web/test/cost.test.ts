import { describe, expect, it } from 'vitest';
import { costRows, costTip, stepCost } from '../src/cost.js';
import { buildGraph } from '../src/graph-model.js';
import { liveRun, runner, step } from './fixtures.js';

describe('the cost of a step', () => {
  it('counts finished model calls, priced or not, and leaves out shell commands and calls still running', () => {
    const s = step('mixed', {
      runners: [
        runner({ spanId: 'a', costUsd: 0.1 }),
        runner({ spanId: 'b', costUsd: undefined }),
        runner({ spanId: 'c', costUsd: 0.05 }),
        runner({ spanId: 'd', operation: 'execute_tool', costUsd: 9 }),
        runner({ spanId: 'e', endedAt: undefined, costUsd: 4 }),
      ],
    });
    const cost = stepCost(s);
    expect(cost.calls).toBe(3);
    expect(cost.unknown).toBe(1);
    expect(cost.usd).toBeCloseTo(0.15);
  });

  it('is nothing for a step that ran no model', () => {
    expect(stepCost(step('lint'))).toEqual({ usd: 0, unknown: 0, calls: 0 });
  });
});

describe('the cost table of a run', () => {
  it('has a row for each step that called a model, in graph order, adding up to the run total', () => {
    const run = liveRun();
    const rows = costRows(buildGraph(run).nodes);
    expect(rows.map((row) => row.id)).toEqual(['rfc', 'code']);
    const total = rows.reduce(
      (sum, row) => ({
        usd: sum.usd + row.cost.usd,
        unknown: sum.unknown + row.cost.unknown,
        calls: sum.calls + row.cost.calls,
      }),
      { usd: 0, unknown: 0, calls: 0 },
    );
    expect(total).toEqual(run.cost);
    expect(rows[0]).toMatchObject({ inputTokens: 8100, outputTokens: 2400, running: 0 });
    expect(rows[1]).toMatchObject({ inputTokens: undefined, outputTokens: undefined });
  });

  it('counts a call still running apart, and adds only the tokens that were reported', () => {
    const run = liveRun({
      steps: [
        step('debate', {
          status: 'RUNNING',
          runners: [
            runner({ spanId: 'a', inputTokens: 100, outputTokens: undefined, costUsd: 0.01 }),
            runner({ spanId: 'b', inputTokens: 50, outputTokens: 7, costUsd: 0.02 }),
            runner({ spanId: 'c', endedAt: undefined, inputTokens: 999 }),
          ],
        }),
      ],
      structure: undefined,
    });
    const [row] = costRows(buildGraph(run).nodes);
    expect(row).toMatchObject({ id: 'debate', running: 1, inputTokens: 150, outputTokens: 7 });
    expect(row?.cost.calls).toBe(2);
  });

  it('skips steps that have not run', () => {
    expect(costRows(buildGraph(liveRun({ steps: [] })).nodes)).toEqual([]);
  });
});

describe('what a cost is made of', () => {
  it('names the calls and those with no price', () => {
    expect(costTip({ usd: 0, unknown: 0, calls: 0 })).toBe('No model calls');
    expect(costTip({ usd: 1, unknown: 0, calls: 1 })).toBe('1 model call, each with a price');
    expect(costTip({ usd: 1, unknown: 2, calls: 5 })).toBe('5 model calls, 2 with no price');
    expect(costTip({ usd: 0, unknown: 1, calls: 1 })).toBe('1 model call, 1 with no price');
  });
});
