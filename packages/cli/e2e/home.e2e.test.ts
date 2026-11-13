import { describe, expect, it } from 'vitest';
import { makeTempDir, requireBuild, runCli } from './support.js';

requireBuild();

// The child has pipes for standard input and output, so it has no terminal: bare `indaba` must be what it always was.
describe('the built CLI: bare indaba without a terminal (specs/tui-home, AC-02)', () => {
  it('writes the usage to stderr and exits 2, and nothing to stdout', async () => {
    const r = await runCli([], await makeTempDir());
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('No command given.');
    expect(r.stderr).toContain('Usage: indaba <command>');
  });

  it('is the same with INDABA_NO_TUI=1, and with the other values of it', async () => {
    const cwd = await makeTempDir();
    const plain = await runCli([], cwd);
    for (const value of ['1', '0', 'true']) {
      const r = await runCli([], cwd, { INDABA_NO_TUI: value });
      expect(r).toMatchObject({ code: 2, stdout: '', stderr: plain.stderr });
    }
  });

  it('still prints the usage of --help to stdout and exits 0', async () => {
    const r = await runCli(['--help'], await makeTempDir());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: indaba <command>');
  });
});
