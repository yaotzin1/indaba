import type { RunCost, StepView } from '@indaba/core';
import type { GraphNode } from './graph-model.js';
import { messages } from './messages.js';

/**
 * The cost of one step, added up the way the engine's reducer adds up the run's: a finished model call counts, with
 * its price when it had one and as unknown when it had none; a shell command and a call still running do not count.
 * The rows of the cost table therefore add up to the total beside them.
 */
export function stepCost(step: StepView): RunCost {
  let usd = 0;
  let unknown = 0;
  let calls = 0;
  for (const runner of step.runners) {
    if (runner.operation === 'execute_tool' || runner.endedAt === undefined) {
      continue;
    }
    calls += 1;
    if (runner.costUsd === undefined) {
      unknown += 1;
    } else {
      usd += runner.costUsd;
    }
  }
  return { usd, unknown, calls };
}

/** One row of a run's cost table: a step that called a model, or has one running. */
export interface CostRow {
  readonly id: string;
  readonly cost: RunCost;
  /** Calls that have started and not ended; their cost is not known yet. */
  readonly running: number;
  /** The tokens the finished calls reported; undefined when none reported any. */
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
}

function addKnown(total: number | undefined, value: number | undefined): number | undefined {
  return value === undefined ? total : (total ?? 0) + value;
}

/** The steps that called a model, in graph order. A step that ran only shell commands has no row. */
export function costRows(nodes: readonly GraphNode[]): readonly CostRow[] {
  const rows: CostRow[] = [];
  for (const node of nodes) {
    const step = node.step;
    if (step === undefined) {
      continue;
    }
    const agents = step.runners.filter((runner) => runner.operation !== 'execute_tool');
    if (agents.length === 0) {
      continue;
    }
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    for (const runner of agents) {
      if (runner.endedAt !== undefined) {
        inputTokens = addKnown(inputTokens, runner.inputTokens);
        outputTokens = addKnown(outputTokens, runner.outputTokens);
      }
    }
    rows.push({
      id: node.id,
      cost: stepCost(step),
      running: agents.filter((runner) => runner.endedAt === undefined).length,
      inputTokens,
      outputTokens,
    });
  }
  return rows;
}

/** What a cost is made of, for a tooltip: `3 model calls, 1 with no price`, or `No model calls`. */
export function costTip(cost: RunCost): string {
  if (cost.calls === 0) {
    return messages.cost.tipNone;
  }
  return cost.unknown > 0
    ? messages.cost.tipPartial(cost.calls, cost.unknown)
    : messages.cost.tipCalls(cost.calls);
}
