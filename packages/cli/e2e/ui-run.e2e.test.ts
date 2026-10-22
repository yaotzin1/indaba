import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeGitRepo, makeTempDir, requireBuild, startCli, waitFor, writeFileIn } from './support.js';

requireBuild();

/**
 * Task T-14 of specs/web-app-actions: the built `indaba ui` starts and stops runs of a project, each an `indaba run` of
 * its own. Shell steps only, so no agent and no key: one that ends, one that sleeps until stopped, and a debate whose
 * arbiter is a person, which escalates because the run has no terminal (AC-12).
 */

const ADDRESS = /(http:\/\/127\.0\.0\.1:(\d+))\/#token=([A-Za-z0-9_-]+)/;

const QUICK = `version: "1.0"
name: "quick"
steps:
  - id: "hello"
    runner: "shell"
    commands:
      - 'node -e "console.log(4242)"'
`;

/** A step in a worktree that writes its own pid where the test can read it, then sleeps until it is stopped. */
const long = (pidFile: string): string => `version: "1.0"
name: "long"
steps:
  - id: "sleep"
    runner: "shell"
    isolation: "git_worktree"
    commands:
      - 'node -e "require(''fs'').writeFileSync(process.argv[1], String(process.pid)); setTimeout(function () {}, 120000)" ${pidFile}'
`;

const HUMAN = `version: "1.0"
name: "needs-a-person"
roles:
  a:
    runner: shell
  b:
    runner: shell
steps:
  - id: "argue"
    role: a
    goal: decide
    consensus_with: [b]
    arbiter: human
`;

/** Whether a process runs; a killed one that nobody reaped yet (a zombie, in a container) does not. */
function running(pid: number): boolean {
  if (process.platform === 'linux') {
    try {
      return readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[2] !== 'Z';
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface Api {
  get(path: string): Promise<{ status: number; body: Record<string, unknown> }>;
  post(path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }>;
}

function api(origin: string, token: string): Api {
  const call = async (path: string, init: RequestInit) => {
    const res = await fetch(`${origin}${path}`, init);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return {
    get: (path) => call(path, { headers: { Authorization: `Bearer ${token}` } }),
    post: (path, body) =>
      call(path, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          // What a browser sends for the page; the server refuses a write without it.
          Origin: origin,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}

/** Confirms if asked, starts, and waits for the trace id (AC-04, AC-08). */
async function runWorkflow(client: Api, workflowId: string): Promise<string> {
  let answer = await client.post('/api/v1/runs', { workflowId });
  if (answer.status === 409) {
    expect(answer.body.code).toBe('confirmation_required');
    answer = await client.post('/api/v1/runs', { workflowId, confirmedHash: answer.body.contentHash });
  }
  expect(answer.status).toBe(202);
  const startId = String(answer.body.startId);
  let runId: string | undefined;
  await waitFor(async () => {
    const status = await client.get(`/api/v1/starts/${startId}`);
    expect(status.body.state).not.toBe('failed');
    runId = typeof status.body.runId === 'string' ? status.body.runId : undefined;
    return runId !== undefined;
  }, `the run of ${startId} to open its trace`);
  return runId ?? '';
}

async function statusOf(client: Api, runId: string): Promise<{ status: string; canStop: boolean }> {
  const { body } = await client.get(`/api/v1/runs/${runId}`);
  const run = body.run as { status: string };
  return { status: run.status, canStop: body.canStop === true };
}

async function worktrees(dir: string): Promise<string[]> {
  try {
    return await readdir(join(dir, '.indaba', 'worktrees'));
  } catch {
    return [];
  }
}

describe('indaba ui: Run and Stop', () => {
  it('lists, starts, stops, escalates, and stops what it started when it closes', async () => {
    const dir = await makeGitRepo();
    const config = await makeTempDir();
    const pids = await makeTempDir();
    const firstPid = join(pids, 'first.pid');
    const secondPid = join(pids, 'second.pid');
    await writeFileIn(dir, 'quick.workflow.ai.yml', QUICK);
    await writeFileIn(dir, 'long.workflow.ai.yml', long(firstPid));
    await writeFileIn(dir, 'human.workflow.ai.yml', HUMAN);

    // The confirmations go to the user's configuration folder; here a temporary one, on every OS.
    const ui = startCli(['ui', '--no-open'], dir, {
      HOME: config,
      USERPROFILE: config,
      XDG_CONFIG_HOME: config,
      APPDATA: config,
    });
    try {
      await waitFor(() => ADDRESS.test(ui.stdout()), 'the address to be printed');
      const [, origin = '', , token = ''] = ui.stdout().match(ADDRESS) ?? [];
      const client = api(origin, token);

      // AC-01: every workflow of the folder, valid, by an opaque id.
      const listed = await client.get('/api/v1/workflows');
      expect(listed.status).toBe(200);
      const workflows = listed.body.workflows as { id: string; path: string; valid: boolean }[];
      expect(workflows.map((w) => [w.path, w.valid]).sort()).toEqual([
        ['human.workflow.ai.yml', true],
        ['long.workflow.ai.yml', true],
        ['quick.workflow.ai.yml', true],
      ]);
      const idOf = (path: string): string => workflows.find((w) => w.path === path)?.id ?? '';

      // AC-03 to AC-05, AC-08: a run that ends by itself; the page opens it by its trace id.
      const quick = await runWorkflow(client, idOf('quick.workflow.ai.yml'));
      await waitFor(
        async () => (await statusOf(client, quick)).status === 'completed',
        'the quick run to complete',
      );
      expect((await statusOf(client, quick)).canStop).toBe(false);
      // Confirmed once: the same content starts without asking again.
      expect((await client.post('/api/v1/runs', { workflowId: idOf('quick.workflow.ai.yml') })).status).toBe(
        202,
      );

      // AC-09, AC-10: stop a long run as Ctrl+C would; its worktree goes.
      const first = await runWorkflow(client, idOf('long.workflow.ai.yml'));
      await waitFor(() => existsSync(firstPid), 'the long step to start');
      expect((await statusOf(client, first)).canStop).toBe(true);
      expect((await worktrees(dir)).length).toBeGreaterThan(0);
      const stopping = await client.post(`/api/v1/runs/${first}/stop`);
      expect(stopping.status).toBe(202);
      expect(stopping.body).toEqual({ state: 'stopping' });
      await waitFor(
        async () => (await statusOf(client, first)).status === 'cancelled',
        'the stopped run to end',
      );
      await waitFor(async () => !(await statusOf(client, first)).canStop, 'the stopped run to exit');
      const ended = await client.post(`/api/v1/runs/${first}/stop`);
      expect(ended.status).toBe(200);
      expect(ended.body).toEqual({ state: 'ended' });
      await waitFor(() => !running(Number(readFileSync(firstPid, 'utf8'))), 'the stopped step to end');

      // AC-12: a step that needs a person ends escalated; the run has no terminal.
      const human = await runWorkflow(client, idOf('human.workflow.ai.yml'));
      await waitFor(
        async () => (await statusOf(client, human)).status === 'escalated',
        'the debate to escalate',
      );

      // A run that indaba ui did not start cannot be stopped from it.
      const cliRun = await startCli(['run', 'quick.workflow.ai.yml'], dir).result;
      const theirs = cliRun.stdout.match(/\(trace ([0-9a-f]+)\)/)?.[1] ?? '';
      expect(theirs).not.toBe('');
      const refused = await client.post(`/api/v1/runs/${theirs}/stop`);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('not_started_here');
      expect((await statusOf(client, theirs)).canStop).toBe(false);

      // AC-11: one more long run, then close indaba ui while it runs.
      await writeFileIn(dir, 'long.workflow.ai.yml', long(secondPid));
      const second = await runWorkflow(client, idOf('long.workflow.ai.yml'));
      await waitFor(() => existsSync(secondPid), 'the second long step to start');
      expect((await statusOf(client, second)).canStop).toBe(true);
      if (process.platform === 'win32') {
        // A signal ends indaba ui at once on Windows, so closing cannot stop this run there (the documented cost of a
        // crash). Stop it from the page instead, or it outlives the test and keeps its folders in use.
        expect((await client.post(`/api/v1/runs/${second}/stop`)).status).toBe(202);
        await waitFor(async () => !(await statusOf(client, second)).canStop, 'the second run to exit');
      }
    } finally {
      ui.child.kill('SIGINT');
    }
    const result = await ui.result;
    // On Windows a signal ends the process at once, so nothing it started is stopped by it; that is the documented
    // cost of a crash, not of closing it. Elsewhere it closes cleanly and stops its runs first.
    if (process.platform === 'win32') {
      return;
    }
    expect(result.code).toBe(130);
    await waitFor(
      () => !running(Number(readFileSync(secondPid, 'utf8'))),
      'the second step to be stopped at exit',
    );
    await waitFor(async () => (await worktrees(dir)).length === 0, 'every worktree to be removed');
    expect(await readdir(join(dir, '.indaba', 'run-inputs'))).toEqual([]);
    const logs = join(dir, '.indaba', 'logs');
    const text = (
      await Promise.all((await readdir(logs)).map((name) => readFileSync(join(logs, name), 'utf8')))
    ).join('');
    expect(text).toContain('runs stopped at exit');
    expect(text).not.toContain(token(ui.stdout()));
  });
});

function token(stdout: string): string {
  return stdout.match(ADDRESS)?.[3] ?? 'no token printed';
}
