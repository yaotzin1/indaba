import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer } from '@indaba/server';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { captureIo, FIXTURE_WORKFLOW, makeTempDir, writePlugin, writeWorkflow } from './support.js';

/**
 * T-12 of specs/web-app: a secret in the environment of a recorded step reaches no trace file, no response of the
 * server and no stream. The run goes through the real command line, so the redaction is the one `indaba run` applies,
 * and the server reads what it wrote. The secret is built from fragments.
 */
describe('a secret in the environment of a recorded step', () => {
  it('is in no trace file and in nothing the server of indaba ui sends', async () => {
    const secret = ['sk', 'live', 'q'.repeat(24)].join('-');
    const dir = await makeTempDir();
    const plugin = await writePlugin(
      dir,
      'p.mjs',
      `import { RunResult } from '@indaba/core';
export default {
  name: 'p',
  register(host) {
    host.registerRunner({
      name: 'fake',
      async run(request) {
        request.onOutput?.('using ${secret} now\\n');
        request.onOutput?.('half of it: ${secret.slice(0, 12)}\\n');
        return new RunResult({ exitCode: 1, output: 'out ${secret}', errorOutput: 'failed with ${secret}' });
      },
    });
    host.registerGuard({ type: 'always_ok', async check() { return { passed: true }; } });
  },
};
`,
    );
    const file = await writeWorkflow(dir, 'f.yml', FIXTURE_WORKFLOW);
    const captured = captureIo(dir, { MY_API_TOKEN: secret });
    await main(['run', file, '--plugin', plugin], captured.io);
    expect(captured.stdout() + captured.stderr()).not.toContain(secret);

    const traces = join(dir, '.indaba', 'traces');
    const names = await readdir(traces);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(await readFile(join(traces, name), 'utf8')).not.toContain(secret);
    }

    const site = join(dir, 'site');
    await mkdir(site);
    const token = ['page', 'z'.repeat(24)].join('_');
    const server = await startServer({ roots: [dir], staticDir: site, token, pollMs: 10, coalesceMs: 5 });
    try {
      const get = async (path: string): Promise<string> => {
        const controller = new AbortController();
        const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (response.headers.get('content-type')?.includes('event-stream') !== true) {
          return response.text();
        }
        // A stream: read until the run's snapshot has arrived, then stop.
        const reader = response.body?.getReader();
        let text = '';
        const decoder = new TextDecoder();
        while (reader !== undefined && !/\ndata: .*\n\n/.test(text)) {
          const { value, done } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }
        controller.abort();
        return text;
      };
      const list = JSON.parse(await get('/api/v1/runs')) as { runs: { runId: string }[] };
      const runId = list.runs[0]?.runId ?? '';
      expect(runId).not.toBe('');
      const answers = [
        JSON.stringify(list),
        await get(`/api/v1/runs/${runId}`),
        await get(`/api/v1/runs/${runId}/steps/work/log`),
        await get(`/api/v1/runs/${runId}/events`),
      ];
      expect(answers[1]).toContain('[redacted]');
      for (const answer of answers) {
        expect(answer).not.toContain(secret);
      }
    } finally {
      await server.close();
    }
  });
});
