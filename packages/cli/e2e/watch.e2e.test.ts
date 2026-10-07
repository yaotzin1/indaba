import { describe, expect, it } from 'vitest';
import { makeGitRepo, requireBuild, runCli, startCli, waitFor, writeFileIn } from './support.js';

requireBuild();

const PASSING = `version: "1.0"
name: "watched"
steps:
  - id: "say"
    runner: "shell"
    commands:
      - 'node -e "console.log(41)"'
`;

const FAILING = `version: "1.0"
name: "watched-failing"
steps:
  - id: "boom"
    runner: "shell"
    commands:
      - 'node -e "process.exit(5)"'
`;

const SLOW = `version: "1.0"
name: "watched-slow"
steps:
  - id: "wait"
    runner: "shell"
    commands:
      - 'node -e "setTimeout(() => console.log(7), 2500)"'
`;

describe('watch, with the built command line', () => {
  it('shows a finished run and exits the way the run did', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'flow.yml', PASSING);
    expect((await runCli(['run', 'flow.yml'], dir)).code).toBe(0);

    const watched = await runCli(['watch', 'latest', '--output'], dir);
    expect(watched.code).toBe(0);
    expect(watched.stdout).toContain('indaba watched |');
    expect(watched.stdout).toContain('say  completed');
    expect(watched.stdout).toContain('| 41');
  });

  it('exits 1 for a run that failed', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'flow.yml', FAILING);
    expect((await runCli(['run', 'flow.yml'], dir)).code).toBe(1);

    const watched = await runCli(['watch', 'latest'], dir);
    expect(watched.code).toBe(1);
    expect(watched.stdout).toContain('boom  failed');
  });

  it('lists the runs, and a run is found by the start of its id', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'flow.yml', PASSING);
    const ran = await runCli(['run', 'flow.yml'], dir);
    const traceId = /trace ([0-9a-f]{32})/.exec(ran.stdout)?.[1] ?? '';

    const listed = await runCli(['watch'], dir);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain(traceId);
    expect(listed.stdout).toContain('completed');
    expect((await runCli(['watch', traceId.slice(0, 8)], dir)).code).toBe(0);
  });

  it('follows a run that is still going and prints what happens as it happens', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'flow.yml', SLOW);
    const running = startCli(['run', 'flow.yml'], dir);
    await waitFor(
      async () => (await runCli(['watch'], dir)).stdout.includes('running'),
      'the run to appear',
      15_000,
    );

    const watched = await runCli(['watch', 'latest', '--output'], dir);
    expect(watched.code).toBe(0);
    expect(watched.stdout).toContain('wait: PENDING -> RUNNING');
    expect(watched.stdout).toContain('run completed');
    expect(watched.stdout).toContain('| 7');
    expect((await running.result).code).toBe(0);
  });

  it('says so when there is nothing to watch', async () => {
    const dir = await makeGitRepo();
    const r = await runCli(['watch'], dir);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('No runs found');
  });
});
