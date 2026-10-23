import { describe, expect, it } from 'vitest';
import { makeGitRepo, makeTempDir, requireBuild, runCli, startCli, waitFor, writeFileIn } from './support.js';

requireBuild();

/**
 * Task T-15 of specs/workflow-registry (slice 2): the built `indaba ui` lists the registry, by its ids, with what
 * `indaba workflows annotate` set, and opens and starts a workflow by that id.
 */

const ADDRESS = /(http:\/\/127\.0\.0\.1:(\d+))\/#token=([A-Za-z0-9_-]+)/;
const WORKFLOW = `version: "1.0"
name: "site"
steps:
  - id: "hello"
    runner: "shell"
    commands:
      - 'node -e "process.exit(0)"'
`;

type Body = Record<string, unknown>;

describe('indaba ui on the workflow registry', () => {
  it('lists by registry id with the person’s name and tags, and opens and starts by that id', async () => {
    const dir = await makeGitRepo();
    const config = await makeTempDir();
    const env = { HOME: config, USERPROFILE: config, XDG_CONFIG_HOME: config, APPDATA: config };
    await writeFileIn(dir, 'site.workflow.ai.yml', WORKFLOW);
    const listed = await runCli(['workflows', 'list', '--json'], dir, env);
    const id = String((JSON.parse(listed.stdout) as { entries: { id: string }[] }).entries[0]?.id);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(
      (await runCli(['workflows', 'annotate', id, '--name', 'Web site', '--tag', 'web'], dir, env)).code,
    ).toBe(0);

    const ui = startCli(['ui', '--no-open'], dir, env);
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
      const workflows = (await call('/api/v1/workflows')).body.workflows as Body[];
      expect(workflows).toEqual([
        expect.objectContaining({ id, name: 'Web site', tags: ['web'], hidden: false, valid: true }),
      ]);
      const source = await call(`/api/v1/workflows/${id}/source`);
      expect(source.status).toBe(200);
      expect(source.body.text).toBe(WORKFLOW);
      const start = await call('/api/v1/runs', 'POST', { workflowId: id });
      expect(start.status).toBe(409);
      expect(start.body.code).toBe('confirmation_required');
    } finally {
      ui.child.kill('SIGINT');
    }
    await ui.result;
  });
});
