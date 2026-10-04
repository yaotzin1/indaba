import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeGitRepo, requireBuild, startCli, waitFor, writeFileIn } from './support.js';

requireBuild();

const SLEEPER = `version: "1.0"
name: "sleeper"
steps:
  - id: "sleep"
    runner: "shell"
    isolation: "git_worktree"
    commands:
      - 'node -e "setTimeout(() => {}, 30000)"'
`;

describe('cancellation', () => {
  // Skipped on Windows: child.kill('SIGINT') there terminates the process abruptly (no handler runs),
  // so neither the exit code 130 nor the worktree teardown can be observed reliably.
  it.skipIf(process.platform === 'win32')(
    'exits 130 on SIGINT and leaves no worktree behind',
    async () => {
      const dir = await makeGitRepo();
      await writeFileIn(dir, 'sleep.workflow.ai.yml', SLEEPER);
      const cli = startCli(['run', 'sleep.workflow.ai.yml', '--task-id', 'e2e-cancel'], dir);

      await waitFor(() => /sleep +PENDING -> RUNNING/.test(cli.stdout()), 'the step to start');
      const worktrees = join(dir, '.indaba', 'worktrees');
      await waitFor(
        async () => (await readdir(worktrees).catch(() => [])).length > 0,
        'the worktree to be created',
      );

      const started = Date.now();
      cli.child.kill('SIGINT');
      const r = await cli.result;

      expect(r.code).toBe(130);
      expect(Date.now() - started).toBeLessThan(20_000);
      expect(r.stdout).toContain('Task e2e-cancel finished: CANCELLED');
      expect(await readdir(worktrees).catch(() => [])).toEqual([]);
    },
    60_000,
  );
});
