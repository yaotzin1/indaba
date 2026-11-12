import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import {
  captureIo,
  FIXTURE_WORKFLOW,
  fakePluginSource,
  makeTempDir,
  writePlugin,
  writeWorkflow,
} from './support.js';

// specs/parallel-steps, slice 1 (T-06): --parallel, INDABA_PARALLEL, indaba.config and what the command says about them.

async function setup(config?: string, workflow: string = FIXTURE_WORKFLOW) {
  const dir = await makeTempDir();
  if (config !== undefined) {
    await writeFile(join(dir, 'indaba.config'), config);
  }
  const file = await writeWorkflow(dir, 'w.yml', workflow);
  const plugin = await writePlugin(dir, 'p.mjs', fakePluginSource(join(dir, 'plugin.log')));
  return { dir, file, plugin };
}

/** The attributes of the root span of the one trace this run wrote. */
async function rootAttributes(dir: string): Promise<Record<string, unknown>> {
  const traces = join(dir, '.indaba', 'traces');
  const files = (await readdir(traces)).filter(
    (name) => name.endsWith('.jsonl') && !name.includes('.events.'),
  );
  for (const name of files) {
    for (const line of (await readFile(join(traces, name), 'utf8')).split('\n')) {
      if (line === '') {
        continue;
      }
      const record = JSON.parse(line) as { name?: string; attributes?: Record<string, unknown> };
      if (record.name?.startsWith('indaba.task') === true) {
        return record.attributes ?? {};
      }
    }
  }
  return {};
}

async function run(args: string[], env: Record<string, string | undefined>, config?: string) {
  const { dir, file, plugin } = await setup(config);
  const captured = captureIo(dir, env);
  const code = await main(['run', file, '--plugin', plugin, ...args], captured.io);
  return { code, out: captured.stdout(), err: captured.stderr(), dir };
}

describe('indaba run and the limit of steps', () => {
  it('records the default when nothing asks for more, and prints no notice', async () => {
    const r = await run([], {});
    expect(r.code).toBe(0);
    const attributes = await rootAttributes(r.dir);
    expect(attributes['indaba.workflow.max_parallel']).toBe(1);
    expect(attributes['indaba.workflow.max_parallel.source']).toBe('default');
    expect(r.out).not.toContain('one at a time');
  });

  it('takes --parallel first, records the flag, and shows what steps at the same time cost', async () => {
    const r = await run(['--parallel', '3'], { INDABA_PARALLEL: '2' });
    expect(r.code).toBe(0);
    const attributes = await rootAttributes(r.dir);
    expect(attributes['indaba.workflow.max_parallel.source']).toBe('flag');
    expect(attributes['indaba.workflow.max_parallel']).toBe(3);
    expect(r.out).toContain('Steps run at the same time. What that costs:');
  });

  it('takes INDABA_PARALLEL when there is no flag', async () => {
    const r = await run([], { INDABA_PARALLEL: '2' });
    expect((await rootAttributes(r.dir))['indaba.workflow.max_parallel.source']).toBe('env');
    expect(r.out).toContain('Steps run at the same time. What that costs:');
  });

  it('ignores a bad INDABA_PARALLEL with a warning and uses the next source', async () => {
    const r = await run([], { INDABA_PARALLEL: 'lots' }, 'parallel:\n  max_steps: 2\n');
    expect(r.code).toBe(0);
    expect(r.err).toContain('INDABA_PARALLEL must be a whole number of at least 1; it is ignored.');
    expect((await rootAttributes(r.dir))['indaba.workflow.max_parallel.source']).toBe('config');
  });

  it('takes parallel.max_steps of indaba.config when nothing else says', async () => {
    const r = await run([], {}, 'parallel:\n  max_steps: 4\n');
    expect((await rootAttributes(r.dir))['indaba.workflow.max_parallel.source']).toBe('config');
    expect(r.out).toContain('Steps run at the same time. What that costs:');
  });

  it.each(['0', '-1', '1.5', 'many'])('refuses --parallel %s as a usage error', async (value) => {
    const r = await run([`--parallel=${value}`], {});
    expect(r.code).toBe(2);
    expect(r.err + r.out).toContain('--parallel must be a whole number of at least 1');
  });

  it('refuses a bad parallel section in indaba.config, naming the key', async () => {
    const r = await run([], {}, 'parallel:\n  max_steps: 0\n');
    expect(r.code).toBe(2);
    expect(r.err + r.out).toContain('parallel.max_steps must be a whole number of at least 1');
  });

  it('does not accept --parallel on other commands', async () => {
    const { dir, file } = await setup();
    const captured = captureIo(dir, {});
    const code = await main(['validate', file, '--parallel', '2'], captured.io);
    expect(code).toBe(2);
    expect(captured.stderr() + captured.stdout()).toContain("Unknown option '--parallel'");
  });
});

describe('indaba plan and the limit', () => {
  async function plan(env: Record<string, string | undefined>, workflow?: string) {
    const { dir, file, plugin } = await setup(undefined, workflow);
    const captured = captureIo(dir, env);
    const code = await main(['plan', file, '--plugin', plugin], captured.io);
    return { code, out: captured.stdout() };
  }

  it('prints no group and no notice at the default', async () => {
    const r = await plan({});
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('Parallel groups');
    expect(r.out).not.toContain('one at a time');
  });

  it('shows the cost and the groups when the variable asks for more', async () => {
    const r = await plan({ INDABA_PARALLEL: '3' });
    expect(r.out).toContain('Steps run at the same time. What that costs:');
    expect(r.out).toContain('Parallel groups (limit 3):');
  });

  it('lets a workflow lower the limit it would say, never raise it', async () => {
    const lowered = await plan(
      { INDABA_PARALLEL: '3' },
      FIXTURE_WORKFLOW.replace('name: "ext-flow"\n', 'name: "ext-flow"\nmax_parallel: 1\n'),
    );
    expect(lowered.out).not.toContain('one at a time');
  });
});
