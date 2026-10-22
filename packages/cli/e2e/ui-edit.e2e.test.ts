import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeGitRepo, makeTempDir, requireBuild, startCli, waitFor, writeFileIn } from './support.js';

requireBuild();

/**
 * Task T-08 of specs/web-app-editing-core: the built `indaba ui` reads a workflow's text, saves a change only against the
 * version it read, and the next Run asks for a confirmation again because the content changed (AC-07).
 */

const ADDRESS = /(http:\/\/127\.0\.0\.1:(\d+))\/#token=([A-Za-z0-9_-]+)/;

const WORKFLOW = `version: "1.0"
name: "editable"
steps:
  - id: "hello"
    runner: "shell"
    commands:
      - 'node -e "console.log(4242)"'
`;

type Body = Record<string, unknown>;

describe('indaba ui: edit a workflow’s source', () => {
  it('reads, saves against the version read, refuses a stale save, and asks again before the next run', async () => {
    const dir = await makeGitRepo();
    const config = await makeTempDir();
    await writeFileIn(dir, 'edit.workflow.ai.yml', WORKFLOW);
    const ui = startCli(['ui', '--no-open'], dir, {
      HOME: config,
      USERPROFILE: config,
      XDG_CONFIG_HOME: config,
      APPDATA: config,
    });
    try {
      await waitFor(() => ADDRESS.test(ui.stdout()), 'the address to be printed');
      const [, origin = '', , token = ''] = ui.stdout().match(ADDRESS) ?? [];
      const call = async (
        path: string,
        method = 'GET',
        body?: unknown,
      ): Promise<{ status: number; body: Body }> => {
        const res = await fetch(`${origin}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(method === 'GET' ? {} : { Origin: origin, 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: res.status, body: (await res.json()) as Body };
      };

      const listed = await call('/api/v1/workflows');
      const id = String((listed.body.workflows as { id: string }[])[0]?.id);

      // Confirm and start once, so the content is confirmed.
      const asked = await call('/api/v1/runs', 'POST', { workflowId: id });
      expect(asked.status).toBe(409);
      const first = await call('/api/v1/runs', 'POST', {
        workflowId: id,
        confirmedHash: asked.body.contentHash,
      });
      expect(first.status).toBe(202);
      const second = await call('/api/v1/runs', 'POST', { workflowId: id });
      expect(second.status).toBe(202);
      // Both end by themselves; wait for that, so no run outlives the test (on Windows a signal ends indaba ui at once).
      for (const start of [first, second]) {
        let runId = '';
        await waitFor(async () => {
          const status = await call(`/api/v1/starts/${String(start.body.startId)}`);
          runId = typeof status.body.runId === 'string' ? status.body.runId : '';
          return runId !== '';
        }, 'the run to open its trace');
        await waitFor(
          async () => (await call(`/api/v1/runs/${runId}`)).body.canStop === false,
          'the run to end',
        );
      }

      const source = await call(`/api/v1/workflows/${id}/source`);
      expect(source.status).toBe(200);
      expect(source.body.text).toBe(WORKFLOW);
      const base = String(source.body.contentHash);

      const checked = await call('/api/v1/workflows/check', 'POST', { text: 'steps: [' });
      expect((checked.body.problems as { line?: number }[])[0]?.line).toEqual(expect.any(Number));

      const edited = WORKFLOW.replace('name: "editable"', 'name: "edited"');
      const saved = await call(`/api/v1/workflows/${id}/source`, 'PUT', { text: edited, baseHash: base });
      expect(saved.status).toBe(200);
      expect(saved.body.problems).toEqual([]);
      expect(await readFile(join(dir, 'edit.workflow.ai.yml'), 'utf8')).toBe(edited);

      // The page's old hash no longer matches the file: nothing is written, and the disk's version comes back.
      const stale = await call(`/api/v1/workflows/${id}/source`, 'PUT', { text: 'lost', baseHash: base });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ code: 'changed_on_disk', current: { text: edited } });
      expect(await readFile(join(dir, 'edit.workflow.ai.yml'), 'utf8')).toBe(edited);

      // AC-07: the saved content is unconfirmed, so the next Run shows what it will use again.
      const again = await call('/api/v1/runs', 'POST', { workflowId: id });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('confirmation_required');
      expect(again.body.contentHash).toBe(saved.body.contentHash);
    } finally {
      ui.child.kill('SIGINT');
    }
    await ui.result;
  });
});
