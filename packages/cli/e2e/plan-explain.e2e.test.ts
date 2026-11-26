import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { examplesDir, makeTempDir, requireBuild, runCli, writeFileIn } from './support.js';

requireBuild();

// specs/plan-explain, T-16: the built CLI, as a person or a CI job runs it.

const SHORT = `version: "1.0"
name: short
roles:
  writer: { runner: claude-code }
steps:
  - id: write
    role: writer
    goal: do it
  - id: test
    runner: shell
    commands: ["pnpm test"]
    depends_on: [write]
`;

describe('the built CLI: plan --explain and --json', () => {
  it('prints the explanation of the task pipeline example under each step and exits as plan does', async () => {
    const cwd = await makeTempDir();
    const example = join(examplesDir, 'task-pipeline.workflow.ai.yml');
    const plain = await runCli(['plan', example], cwd);
    const explained = await runCli(['plan', example, '--explain'], cwd);
    expect(explained.code).toBe(plain.code);
    expect(explained.stderr).toBe('');
    expect(explained.stdout).toContain('1. rfc [architect]\n   runner: ');
    expect(explained.stdout).toMatch(/ {3}timeout_seconds: 900s {2}<- fallback, engine\n/);
  });

  it('prints JSON and only JSON on stdout, the same bytes twice', async () => {
    const cwd = await makeTempDir();
    const file = await writeFileIn(cwd, 'short.yml', SHORT);
    const a = await runCli(['plan', file, '--json'], cwd);
    const b = await runCli(['plan', file, '--json'], cwd);
    expect(a.code).toBe(0);
    expect(a.stderr).toBe('');
    expect(a.stdout).toBe(b.stdout);
    const parsed = JSON.parse(a.stdout);
    expect(parsed).toMatchObject({ schema: 'indaba.plan-explain', version: 1, workflow: 'short' });
    expect(parsed.steps.map((s: { id: string }) => s.id)).toEqual(['write', 'test']);
    expect(a.stdout).not.toContain(cwd);
  });

  it('keeps stdout empty for an invalid file and says what is wrong on stderr', async () => {
    const cwd = await makeTempDir();
    const file = await writeFileIn(cwd, 'bad.yml', 'version: "1.0"\nname: bad\nsteps: []\n');
    const r = await runCli(['plan', file, '--json'], cwd);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toBe('');
  });

  it('is refused by validate and run as an option they do not have', async () => {
    const cwd = await makeTempDir();
    const file = await writeFileIn(cwd, 'short.yml', SHORT);
    const r = await runCli(['validate', file, '--json'], cwd);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Unknown option \'--json\' for "validate".');
  });
});
