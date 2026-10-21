import { describe, expect, it } from 'vitest';
import { makeGitRepo, requireBuild, runCli, startCli, waitFor, writeFileIn } from './support.js';

requireBuild();

/**
 * Task T-15 of specs/web-app: the built `indaba ui`, as a person starts it, over the trace of a run that the built
 * `indaba run` wrote. The address it prints carries the token; the API answers with it and refuses without it.
 */

const WORKFLOW = `version: "1.0"
name: "ui-e2e"
steps:
  - id: "hello"
    runner: "shell"
    commands:
      - 'node -e "console.log(4242)"'
  - id: "after"
    depends_on: ["hello"]
    runner: "shell"
    commands:
      - 'node -e "console.log(4343)"'
`;

const ADDRESS = /(http:\/\/127\.0\.0\.1:(\d+))\/#token=([A-Za-z0-9_-]+)/;

describe('indaba ui', () => {
  it('serves the runs of the folder with the printed token, and refuses without it', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'ui.workflow.ai.yml', WORKFLOW);
    const ran = await runCli(['run', 'ui.workflow.ai.yml'], dir);
    expect(ran.code).toBe(0);

    const ui = startCli(['ui', '--no-open'], dir);
    try {
      await waitFor(() => ADDRESS.test(ui.stdout()), 'the address to be printed');
      const [, origin, , token] = ui.stdout().match(ADDRESS) ?? [];
      const auth = { Authorization: `Bearer ${token}` };

      const list = await fetch(`${origin}/api/v1/runs`, { headers: auth });
      expect(list.status).toBe(200);
      const { runs } = (await list.json()) as {
        runs: { runId: string; status: string; workflow: string; cost: unknown }[];
      };
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        status: 'completed',
        workflow: 'ui-e2e',
        cost: { usd: 0, unknown: 0, calls: 0 },
      });

      const one = await fetch(`${origin}/api/v1/runs/${runs[0]?.runId}`, { headers: auth });
      expect(one.status).toBe(200);
      const { run } = (await one.json()) as {
        run: {
          status: string;
          steps: { id: string; status: string; output: string[] }[];
          structure: unknown;
        };
      };
      expect(run.status).toBe('completed');
      expect(run.steps.map((s) => [s.id, s.status])).toEqual([
        ['hello', 'COMPLETED'],
        ['after', 'COMPLETED'],
      ]);
      expect(run.steps[0]?.output.join('\n')).toContain('4242');
      expect(run.structure).toEqual([
        { id: 'hello', dependsOn: [] },
        { id: 'after', dependsOn: ['hello'] },
      ]);

      for (const path of ['/api/v1/runs', `/api/v1/runs/${runs[0]?.runId}`, '/api/v1/contract']) {
        const refused = await fetch(`${origin}${path}`);
        expect(refused.status, path).toBe(401);
        const body = await refused.text();
        expect(body).not.toContain('4242');
        expect(body).not.toContain(String(token));
        expect((await fetch(`${origin}${path}`, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(
          401,
        );
      }

      // The page itself is served without the token, as a browser's first navigation needs.
      const page = await fetch(`${origin}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<div id="root"');
      expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    } finally {
      ui.child.kill('SIGINT');
      const ended = await ui.result;
      // On Windows a signal ends the process at once, so its exit code says nothing; elsewhere it stops cleanly.
      if (process.platform !== 'win32') {
        expect(ended.code).toBe(130);
        expect(ended.stdout).toContain('Stopped.');
      }
    }
  });
});
