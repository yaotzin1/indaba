import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeGitRepo, readAllTraceText, requireBuild, runCli, writeFileIn } from './support.js';

requireBuild();

/** specs/workflow-inputs, T-26: the built CLI, a workflow that asks for folders, and every way it can be started. */

const REVIEW = `version: "1.0"
name: "review-specs"
inputs:
  specs:
    type: path
    list: true
    kind: directory
    max_items: 10
    description: "The specification folders to review, for example specs/billing"
steps:
  - id: "review"
    runner: "shell"
    commands:
      - 'node -e "console.log(7)"'
    goal: "Review the specifications in \${{ inputs.specs }}."
`;

async function setup(): Promise<string> {
  const dir = await makeGitRepo();
  await writeFileIn(dir, 'review.workflow.ai.yml', REVIEW);
  await mkdir(join(dir, 'specs', 'billing'), { recursive: true });
  await mkdir(join(dir, 'specs', 'refunds'), { recursive: true });
  return dir;
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

describe('the built CLI: workflow inputs', () => {
  it('validates and plans without any value, and says what is still missing', async () => {
    const dir = await setup();
    const validate = await runCli(['validate', 'review.workflow.ai.yml'], dir);
    expect(validate.code).toBe(0);
    expect(validate.stdout).toContain('review-specs is valid (1 steps, 0 roles).');
    const plan = await runCli(['plan', 'review.workflow.ai.yml'], dir);
    expect(plan.code).toBe(0);
    expect(plan.stdout).toContain('Inputs:\n  specs (path list): missing (add --input specs=<value>)');
  });

  it('runs with two folders, and the trace holds the digest of the inputs', async () => {
    const dir = await setup();
    const r = await runCli(
      ['run', 'review.workflow.ai.yml', '--input', 'specs=specs/billing', '--input', 'specs=specs/refunds'],
      dir,
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('finished: COMPLETED');
    const trace = await readAllTraceText(dir);
    expect(trace).toContain('indaba.inputs.digest');
    expect(trace).toContain('inputs_resolved');
  });

  it('exits 2 and creates nothing when a folder is missing, outside, or nothing was given and nothing can ask', async () => {
    const dir = await setup();
    const missing = await runCli(['run', 'review.workflow.ai.yml', '--input', 'specs=specs/billng'], dir);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain(
      '"specs/billng" does not exist. Check the spelling, or choose another folder.',
    );
    const outside = await runCli(['run', 'review.workflow.ai.yml', '--input', 'specs=../secrets'], dir);
    expect(outside.code).toBe(2);
    expect(outside.stderr).toContain(
      '"../secrets" is outside the folder the workflow runs in. Choose a folder inside it.',
    );
    const nothing = await runCli(['run', 'review.workflow.ai.yml'], dir);
    expect(nothing.code).toBe(2);
    expect(nothing.stderr).toContain('The workflow needs a value for "specs"');
    expect(nothing.stderr).toContain('Add --input specs=<folder> (repeat it for more than one)');
    expect(await exists(join(dir, '.indaba', 'traces'))).toBe(false);
    expect(await exists(join(dir, '.indaba', 'worktrees'))).toBe(false);
  });

  it('a workflow without inputs is not changed by the new options being there', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(
      dir,
      'plain.workflow.ai.yml',
      'version: "1.0"\nname: "plain"\nsteps:\n  - id: "a"\n    runner: "shell"\n    commands:\n      - \'node -e "console.log(1)"\'\n',
    );
    const r = await runCli(['run', 'plain.workflow.ai.yml'], dir);
    expect(r.code).toBe(0);
    const given = await runCli(['run', 'plain.workflow.ai.yml', '--input', 'x=1'], dir);
    expect(given.code).toBe(2);
    expect(given.stderr).toContain('This workflow has no input called "x". It takes no inputs.');
  });
});
