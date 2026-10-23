import { RunResult, StepStatus } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { parseWorkflow, WorkflowStatus } from '../src/index.js';
import { FakeRunner, harness, makeGitRepo } from './support.js';

/**
 * `x` does not depend on `a` or `b`, but it sits between them in the order. When `b` fails and `retry_step`
 * moves the loop back to `a`, the loop passes `x` again; `x` is COMPLETED and was not reset, so it must be
 * skipped, not run a second time (a COMPLETED step may only move to PENDING).
 */
const WORKFLOW = `
version: "1.0"
name: independent-branch
roles:
  worker: {runner: work}
steps:
  - {id: a, role: worker, goal: first}
  - {id: x, role: worker, goal: independent}
  - id: b
    depends_on: [a]
    runner: shell
    commands: ["check"]
    on_failure: {action: retry_step, target: a, max_retries: 1}
`;

const ok = (output = 'ok'): RunResult => new RunResult({ exitCode: 0, output });

describe('retry_step with a step that is independent of the target', () => {
  it('does not run a completed, unreset step again', async () => {
    const repo = await makeGitRepo();
    const worker = new FakeRunner('work', () => ok());
    const shell = new FakeRunner('shell', (_request, call) =>
      call === 1 ? new RunResult({ exitCode: 1, output: '', errorOutput: 'not yet' }) : ok(),
    );
    const { engine } = harness(repo, [worker, shell]);

    const result = await engine.run(parseWorkflow(WORKFLOW), { taskId: 'T-indep' });

    expect(result.status, result.failureReason).toBe(WorkflowStatus.Completed);
    for (const id of ['a', 'x', 'b']) {
      expect(result.steps[id]).toBe(StepStatus.Completed);
    }
    // a ran twice (the retry), x once (it was never reset)
    expect(worker.requests.filter((r) => r.prompt.includes('first'))).toHaveLength(2);
    expect(worker.requests.filter((r) => r.prompt.includes('independent'))).toHaveLength(1);
  });
});
