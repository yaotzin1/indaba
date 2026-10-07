import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TraceReader } from '@indaba/engine';
import { describe, expect, it } from 'vitest';
import { createRunStarter } from '../src/run-child.js';
import { binPath, childEnv, makeGitRepo, requireBuild, waitFor, writeFileIn } from './support.js';

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

const QUICK = `version: "1.0"
name: "quick"
steps:
  - id: "hello"
    runner: "shell"
    commands:
      - 'node -e "console.log(11)"'
`;

describe('a run started the way run --tui starts it', () => {
  // Unlike a signal, the message works on Windows too: the child stops as on Ctrl+C and tears its worktree down.
  it('stops gracefully when asked through the channel, and the process ends', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'sleep.workflow.ai.yml', SLEEPER);
    const child = createRunStarter(process.execPath, binPath)(['run', 'sleep.workflow.ai.yml'], {
      cwd: dir,
      environment: childEnv(),
    });

    const traces = join(dir, '.indaba', 'traces');
    const worktrees = join(dir, '.indaba', 'worktrees');
    await waitFor(async () => (await readdir(worktrees).catch(() => [])).length > 0, 'the worktree');
    const [run] = await new TraceReader(traces).listRuns();
    expect(run?.status).toBe('running');

    child.cancel();
    expect(await child.exited).toBe(130);
    expect(await readdir(worktrees).catch(() => [])).toEqual([]);
    const events = await readFile(join(traces, `${run?.runId ?? ''}.events.jsonl`), 'utf8');
    expect(events).toContain('CANCELLED');
  });

  it('ends by itself when the run finishes, with the channel closed and its files complete', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'quick.workflow.ai.yml', QUICK);
    const child = createRunStarter(process.execPath, binPath)(['run', 'quick.workflow.ai.yml'], {
      cwd: dir,
      environment: childEnv(),
    });
    expect(await child.exited).toBe(0);
    const [run] = await new TraceReader(join(dir, '.indaba', 'traces')).listRuns();
    expect(run?.status).toBe('completed');
  });

  it('reports a workflow that does not exist as a failure with its reason', async () => {
    const dir = await makeGitRepo();
    const child = createRunStarter(process.execPath, binPath)(['run', 'missing.yml'], {
      cwd: dir,
      environment: childEnv(),
    });
    expect(await child.exited).toBe(1);
  });
});
