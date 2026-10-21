import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { MAX_REPORT_LOG_LINES, REPORT_USAGE } from '../src/report.js';
import {
  captureIo,
  FIXTURE_WORKFLOW,
  fakePluginSource,
  makeTempDir,
  writePlugin,
  writeWorkflow,
} from './support.js';

const NOW = '2026-10-21T08:00:00.000Z';

async function command(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = {},
  pid = 4242,
) {
  const captured = captureIo(cwd, env);
  const code = await main(args, { ...captured.io, clock: () => new Date(NOW), pid });
  return { code, out: captured.stdout(), err: captured.stderr() };
}

async function runOnce(dir: string, env: Record<string, string> = {}): Promise<string> {
  const plugin = await writePlugin(
    dir,
    'p.mjs',
    fakePluginSource(join(dir, 'plugin.log')).replace(
      'register(host) {',
      "register(host) {\n    host.logger.info('plugin.demo', 'a plugin line', { value: 'secret-value-123' });",
    ),
  );
  await mkdir(join(dir, '.indaba'), { recursive: true });
  const workflow = await writeWorkflow(dir, join('.indaba', 'workflow.ai.yml'), FIXTURE_WORKFLOW);
  const r = await command(['run', workflow, '--plugin', plugin, '--task-id', 'reported'], dir, env);
  expect(r.code).toBe(0);
  const traceId = r.out.match(/trace ([0-9a-f]{32})/)?.[1];
  if (traceId === undefined) {
    throw new Error(`no trace id in: ${r.out}`);
  }
  return traceId;
}

describe('indaba report', () => {
  it('gathers the log, trace, events, workflow and environment of the latest run, redacted', async () => {
    const dir = await makeTempDir();
    const env = { DEMO_TOKEN: 'secret-value-123' };
    await writeFile(join(dir, 'indaba.config'), 'logging:\n  level: debug\n');
    const traceId = await runOnce(dir, env);
    // Another process's lines in the same file are not part of the report.
    await command(['validate', join(dir, '.indaba', 'workflow.ai.yml')], dir, {}, 999);

    const r = await command(['report'], dir, env, 5555);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Report of run ${traceId} written to `);
    expect(r.out).toContain('Nothing was sent anywhere.');

    const [folder] = await readdir(join(dir, '.indaba', 'reports'));
    expect(folder).toBe(`report-${traceId.slice(0, 12)}-20261021T080000Z`);
    const base = join(dir, '.indaba', 'reports', folder ?? '');
    expect((await readdir(base)).sort()).toEqual([
      'README.txt',
      'environment.json',
      'events.jsonl',
      'indaba.config',
      'log.jsonl',
      'trace.jsonl',
      'workflow.ai.yml',
    ]);
    const log = (await readFile(join(base, 'log.jsonl'), 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as { message: string; pid: number });
    expect(new Set(log.map((l) => l.pid))).toEqual(new Set([4242]));
    expect(log[0]?.message).toBe('process.start');
    expect(log.map((l) => l.message)).toContain('a plugin line');
    for (const name of await readdir(base)) {
      expect(await readFile(join(base, name), 'utf8')).not.toContain('secret-value-123');
    }
    const environment = JSON.parse(await readFile(join(base, 'environment.json'), 'utf8'));
    expect(environment).toMatchObject({
      runId: traceId,
      platform: process.platform,
      nodeVersion: process.version,
    });
    expect(environment.processes[0]).toMatchObject({ command: 'run' });
    expect(await readFile(join(base, 'README.txt'), 'utf8')).toContain('read the files before sending them');
  });

  it('names a run by a start of its id, and writes where --out says', async () => {
    const dir = await makeTempDir();
    const traceId = await runOnce(dir);
    const r = await command(['report', traceId.slice(0, 6), '--out', 'here'], dir);
    expect(r.code).toBe(0);
    expect(await readdir(join(dir, 'here'))).toHaveLength(1);
  });

  it('says what it could not include', async () => {
    const dir = await makeTempDir();
    const traceId = await runOnce(dir);
    await writeFile(join(dir, '.indaba', 'workflow.ai.yml'), '');
    const other = await makeTempDir();
    const r = await command(['report', traceId, '-w', dir, '--log-dir', join(other, 'none')], other);
    expect(r.code).toBe(0);
    expect(r.out).toContain('not included: log.jsonl (no log line names this run)');
  });

  it('refuses a relative --out that leaves the project, an unknown run and no runs at all', async () => {
    const dir = await makeTempDir();
    expect((await command(['report'], dir)).out).toBe('There are no runs to report on.\n');
    const traceId = await runOnce(dir);
    expect((await command(['report', traceId, '--out', '../x'], dir)).out).toContain(
      'must stay inside the project',
    );
    expect((await command(['report', 'ffff'], dir)).out).toBe('No run starts with "ffff".\n');
    expect((await command(['report', 'NOT-HEX'], dir)).code).toBe(1);
    expect((await command(['report', traceId, '--workflow', 'missing.yml'], dir)).out).toContain(
      '--workflow',
    );
  });

  it('prints its usage, and a usage error for an unknown option', async () => {
    const dir = await makeTempDir();
    expect((await command(['report', '--help'], dir)).out).toBe(REPORT_USAGE);
    const bad = await command(['report', '--nope'], dir);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain(REPORT_USAGE);
    expect((await command(['report', 'a', 'b'], dir)).err).toContain('Too many arguments');
    expect(MAX_REPORT_LOG_LINES).toBeGreaterThan(0);
  });
});
