import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeGitRepo, readTraceRecords, requireBuild, runCli, writeFileIn } from './support.js';

requireBuild();

// Quoting that cmd.exe and /bin/sh read the same way: one executable, one double-quoted argument.
const PASSING = `version: "1.0"
name: "shell-only"
steps:
  - id: "first"
    runner: "shell"
    commands:
      - 'node -e "console.log(11)"'
  - id: "second"
    depends_on: ["first"]
    runner: "shell"
    isolation: "git_worktree"
    commands:
      - 'node -e "console.log(22)"'
      - 'node -e "console.log(33)"'
`;

const FAILING = `version: "1.0"
name: "always-fails"
steps:
  - id: "flaky"
    runner: "shell"
    commands:
      - 'node -e "process.exit(3)"'
    on_failure:
      action: "retry_step"
      target: "flaky"
      max_retries: 2
`;

const NO_RETRY = `version: "1.0"
name: "plain"
steps:
  - id: "boom"
    runner: "shell"
    commands:
      - 'node -e "process.exit(4)"'
`;

function attemptOf(record: Record<string, unknown>): unknown {
  const attributes = record.attributes;
  if (typeof attributes === 'object' && attributes !== null && 'indaba.step.attempt' in attributes) {
    return attributes['indaba.step.attempt'];
  }
  return undefined;
}

describe('run with shell steps in a git repository', () => {
  it('completes, prints each step transition and writes a trace', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'flow.workflow.ai.yml', PASSING);

    const r = await runCli(['run', 'flow.workflow.ai.yml', '--task-id', 'e2e-pass', '-vv'], dir);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Running shell-only');
    expect(r.stdout).toMatch(/first +PENDING -> RUNNING/);
    expect(r.stdout).toMatch(/first +VALIDATING -> COMPLETED/);
    expect(r.stdout).toMatch(/second +VALIDATING -> COMPLETED/);
    expect(r.stdout).toMatch(/Task e2e-pass finished: COMPLETED \(trace [0-9a-f]{32}\)\r?\n$/);
    for (const output of ['11', '22', '33']) {
      expect(r.stdout).toMatch(new RegExp(`^${output}\\s*$`, 'm'));
    }

    const traceId = /trace ([0-9a-f]{32})/.exec(r.stdout)?.[1];
    const files = (await readdir(join(dir, '.indaba', 'traces'))).sort();
    expect(files).toEqual([`${traceId}.events.jsonl`, `${traceId}.jsonl`]);

    const records = await readTraceRecords(dir);
    expect(records.length).toBeGreaterThanOrEqual(5);
    const names = records.map((record) => record.name);
    expect(names).toContain('step first');
    expect(names).toContain('step second');
    expect(names.filter((name) => name === 'execute_tool shell')).toHaveLength(3);

    for (const record of records) {
      expect(Object.keys(record)).toEqual(
        expect.arrayContaining([
          'trace_id',
          'span_id',
          'parent_span_id',
          'name',
          'start',
          'end',
          'status',
          'attributes',
        ]),
      );
    }
    const toolSpan = records.find((record) => record.name === 'execute_tool shell');
    expect(toolSpan?.attributes).toMatchObject({
      'gen_ai.operation.name': 'execute_tool',
      'indaba.runner': 'shell',
      'indaba.exit_code': 0,
    });
    const stepSpan = records.find((record) => record.name === 'step first');
    expect(stepSpan?.attributes).toMatchObject({ 'indaba.step.id': 'first', 'indaba.step.attempt': 1 });

    // The worktree of the isolated step is gone once the run ends.
    const worktrees = await readdir(join(dir, '.indaba', 'worktrees')).catch(() => []);
    expect(worktrees).toEqual([]);
  });

  it('stops retrying after max_retries and ends non-zero', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'fail.workflow.ai.yml', FAILING);

    const r = await runCli(['run', 'fail.workflow.ai.yml', '--task-id', 'e2e-fail'], dir);

    expect(r.code).toBe(2);
    expect(r.stdout).toContain('Task e2e-fail finished: ESCALATED');
    expect(r.stdout).toContain('exited with code 3');
    expect(r.stdout.match(/flaky +RUNNING -> FAILED/g)).toHaveLength(3);
    expect(r.stdout.match(/flaky +FAILED -> PENDING \(retry of flaky\)/g)).toHaveLength(2);
    expect(r.stdout).toMatch(/flaky +FAILED -> ESCALATED/);

    const attempts = (await readTraceRecords(dir))
      .filter((record) => record.name === 'step flaky')
      .map(attemptOf);
    expect(attempts.sort()).toEqual([1, 2, 3]);
  });

  it('fails without retries when on_failure is absent', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'plain.workflow.ai.yml', NO_RETRY);
    const r = await runCli(['run', 'plain.workflow.ai.yml'], dir);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('finished: FAILED');
    expect(r.stdout).toContain('exited with code 4');
  });
});
