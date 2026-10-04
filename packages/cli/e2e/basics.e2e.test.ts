import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { examplesDir, makeTempDir, repoRoot, requireBuild, runCli, writeFileIn } from './support.js';

requireBuild();

function packageVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(join(repoRoot, 'packages', 'cli', 'package.json'), 'utf8'),
  );
  if (typeof manifest === 'object' && manifest !== null && 'version' in manifest) {
    return String(manifest.version);
  }
  throw new Error('packages/cli/package.json has no version.');
}

describe('the built CLI: arguments', () => {
  it('prints the version of packages/cli/package.json', async () => {
    const cwd = await makeTempDir();
    for (const flag of ['--version', '-V']) {
      const r = await runCli([flag], cwd);
      expect(r).toMatchObject({ code: 0, stdout: `${packageVersion()}\n`, stderr: '' });
    }
  });

  it('lists validate, plan and run in --help', async () => {
    const r = await runCli(['--help'], await makeTempDir());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: indaba <command>');
    for (const command of ['validate', 'plan', 'run']) {
      expect(r.stdout).toMatch(new RegExp(`^ {2}${command} \\[file\\]`, 'm'));
    }
  });

  it('exits 2 with the usage on stderr for an unknown command', async () => {
    const r = await runCli(['frobnicate'], await makeTempDir());
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('Unknown command "frobnicate".');
    expect(r.stderr).toContain('Usage: indaba <command>');
  });

  it('exits 2 when no command is given', async () => {
    const r = await runCli([], await makeTempDir());
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('No command given.');
  });
});

describe('the built CLI: validate and plan', () => {
  it('validates and plans the task pipeline example', async () => {
    const cwd = await makeTempDir();
    const example = join(examplesDir, 'task-pipeline.workflow.ai.yml');

    const validate = await runCli(['validate', example], cwd);
    expect(validate).toMatchObject({
      code: 0,
      stdout: 'indaba-task-pipeline is valid (4 steps, 3 roles).\n',
      stderr: '',
    });

    const plan = await runCli(['plan', example], cwd);
    expect(plan.code).toBe(0);
    expect(plan.stdout.split('\n').filter((line) => line !== '')).toEqual([
      '1. rfc [architect]',
      '2. code [implementer] (after rfc)',
      '3. verify [shell: pnpm test && pnpm typecheck] (after code)',
      '4. debate_review [reviewer] (after verify; consensus with architect)',
    ]);
  });

  it('validates and plans the MCP example, reporting MCP findings', async () => {
    const cwd = await makeTempDir();
    const example = join(examplesDir, 'mcp.workflow.ai.yml');

    const validate = await runCli(['validate', example], cwd);
    expect(validate.code).toBe(0);
    expect(validate.stdout).toContain('mcp-example is valid');

    const plan = await runCli(['plan', example], cwd);
    expect(plan.stdout).toMatch(/^1\. code \[implementer\]/m);
    expect(plan.stdout).toMatch(/MCP (error|warning): step "/);
    expect(plan.code).toBe(plan.stdout.includes('MCP error:') ? 1 : 0);
  });

  it('lists every problem of an invalid workflow and exits 1', async () => {
    const cwd = await makeTempDir();
    const file = await writeFileIn(
      cwd,
      'bad.workflow.ai.yml',
      'version: "9"\nsteps:\n  - id: "a"\n    depends_on: ["ghost"]\n',
    );
    const r = await runCli(['validate', file], cwd);
    expect(r.code).toBe(1);
    expect(r.stdout.startsWith(`${file} is invalid:\n - `)).toBe(true);
    const problems = r.stdout.split('\n').filter((line) => line.startsWith(' - '));
    expect(problems.length).toBeGreaterThan(1);
    expect(problems.join('\n')).toContain('unsupported version "9"');
    expect(problems.join('\n')).toContain('$.name is required');
  });

  it('says which default file was tried when none was given', async () => {
    const cwd = await makeTempDir();
    for (const command of ['validate', 'plan', 'run']) {
      const r = await runCli([command], cwd);
      expect(r.code).toBe(1);
      expect(r.stdout).toContain('cannot read workflow file');
      expect(r.stdout).toContain('no file was given, so .indaba/workflow.ai.yml was tried');
    }
  });
});
