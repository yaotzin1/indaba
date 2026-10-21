import type { RunState } from '@indaba/core';
import { emptyRun } from '@indaba/engine';
import { describe, expect, it } from 'vitest';
import { snapshotOf, stepOf, summaryOf } from '../src/runs.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const dirty = (text: string): string => `${ESC}[1m${text}${ESC}]0;x${BEL}`;

function run(): RunState {
  const base = emptyRun();
  return {
    ...base,
    workflow: dirty('flow'),
    taskId: dirty('task'),
    owners: { a: { kind: 'root', stepId: undefined } },
    notes: [dirty('note')],
    steps: [
      {
        id: 'agent',
        status: dirty('FAILED'),
        attempts: 1,
        history: [
          { attempt: 1, startedAt: 'x', endedAt: undefined, outcome: dirty('FAILED'), reason: dirty('r') },
        ],
        reason: dirty('why'),
        startedAt: undefined,
        endedAt: undefined,
        runners: [
          {
            spanId: 's',
            name: dirty('claude'),
            operation: dirty('invoke_agent'),
            status: 'ok',
            startedAt: 'x',
            endedAt: 'y',
            exitCode: 0,
            model: dirty('some/model'),
            costUsd: 0.5,
            inputTokens: 1,
            outputTokens: 2,
          },
        ],
        skipped: [{ runner: dirty('codex'), reason: dirty('absent') }],
        toolCalls: { [dirty('edit')]: 2, edit: 1 },
        permissions: { allowed: 0, rejected: 0 },
        consensus: { outcome: dirty('agreed'), rounds: 2 },
        output: [dirty('line')],
        partialLine: dirty('part'),
        outputTruncated: false,
      },
    ],
  };
}

describe('what the page receives of a run', () => {
  it('has every text cleaned, names and ids as well as output, and no bookkeeping', () => {
    const snapshot = snapshotOf(run());
    expect(JSON.stringify(snapshot)).not.toMatch(new RegExp(`[${ESC}${BEL}]`));
    expect(snapshot).not.toHaveProperty('owners');
    expect(snapshot.workflow).toBe('flow');
    expect(snapshot.taskId).toBe('task');
    const [step] = snapshot.steps;
    expect(step?.status).toBe('FAILED');
    expect(step?.runners[0]).toMatchObject({
      name: 'claude',
      operation: 'invoke_agent',
      model: 'some/model',
      costUsd: 0.5,
    });
    expect(step?.history[0]?.outcome).toBe('FAILED');
    expect(step?.consensus).toEqual({ outcome: 'agreed', rounds: 2 });
    // Two kinds that are the same once cleaned are counted together.
    expect(step?.toolCalls).toEqual({ edit: 3 });
  });

  it('keeps what is absent absent', () => {
    const base = emptyRun();
    const snapshot = snapshotOf(base);
    expect(snapshot.workflow).toBeUndefined();
    expect(snapshot.taskId).toBeUndefined();
    const withStep = snapshotOf({
      ...run(),
      steps: [{ ...(run().steps[0] as RunState['steps'][number]), consensus: undefined }],
    });
    expect(withStep.steps[0]?.consensus).toBeUndefined();
    expect(withStep.steps[0]?.runners[0]?.model).toBe('some/model');
  });

  it('a summary has its workflow cleaned and its cost untouched', () => {
    const cost = { usd: 1, unknown: 0, calls: 1 };
    expect(
      summaryOf({ runId: 'a', startedAt: undefined, status: 'running', workflow: dirty('w'), cost }),
    ).toEqual({
      runId: 'a',
      startedAt: undefined,
      status: 'running',
      workflow: 'w',
      cost,
    });
    expect(
      summaryOf({ runId: 'a', startedAt: undefined, status: 'running', workflow: undefined, cost }).workflow,
    ).toBeUndefined();
  });

  it('a step is looked up only by an id a workflow could name', () => {
    const snapshot = snapshotOf(run());
    expect(stepOf(snapshot, 'agent')?.id).toBe('agent');
    expect(stepOf(snapshot, ['.', '.'].join(''))).toBeUndefined();
    expect(stepOf(snapshot, 'a/b')).toBeUndefined();
    expect(stepOf(snapshot, 'nobody')).toBeUndefined();
  });
});
