import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import {
  captureIo,
  FIXTURE_WORKFLOW,
  fakePluginSource,
  makeTempDir,
  parseLog,
  writePlugin,
  writeWorkflow,
} from './support.js';

/** AC-11: a runner, a guard type and a listener come from a plugin; core, engine and runners are untouched. */
describe('extension without touching core (AC-11)', () => {
  it('validates, plans and runs a workflow that uses a plugin runner, guard type and listener', async () => {
    const dir = await makeTempDir();
    const log = join(dir, 'plugin.log');
    const plugin = await writePlugin(dir, 'fake-plugin.mjs', fakePluginSource(log));
    const workflow = await writeWorkflow(dir, 'flow.workflow.ai.yml', FIXTURE_WORKFLOW);

    // Without the plugin the custom guard type is not a valid workflow value.
    const bare = captureIo(dir);
    expect(await main(['validate', workflow], bare.io)).toBe(1);
    expect(bare.stdout()).toContain('"always_ok" is not a known guard');

    const validate = captureIo(dir);
    expect(await main(['validate', workflow, '--plugin', plugin], validate.io)).toBe(0);
    expect(validate.stdout()).toBe('ext-flow is valid (1 steps, 1 roles).\n');

    const plan = captureIo(dir);
    expect(await main(['plan', workflow, '--plugin', plugin], plan.io)).toBe(0);
    expect(plan.stdout()).toBe('1. work [worker]\n');

    const run = captureIo(dir);
    expect(await main(['run', workflow, '--plugin', plugin, '--task-id', 'ac11'], run.io)).toBe(0);
    expect(run.stdout()).toContain('Running ext-flow');
    expect(run.stdout()).toContain('Task ac11 finished: COMPLETED');

    const lines = parseLog(await readFile(log, 'utf8'));
    expect(lines).toContain('runner:true');
    expect(lines).toContain('guard:always_ok');
    expect(lines).toContain('event:work:RUNNING');
    expect(lines).toContain('event:work:COMPLETED');

    const traces = await readdir(join(dir, '.indaba', 'traces'));
    expect(traces).toHaveLength(1);
  });

  it('accepts several plugins, a relative path and a failing runner', async () => {
    const dir = await makeTempDir();
    const log = join(dir, 'plugin.log');
    await writePlugin(dir, 'failing.mjs', fakePluginSource(log, 3));
    await writePlugin(dir, 'second.mjs', "export default { name: 'second', register() {} };\n");
    await writeWorkflow(dir, 'flow.yml', FIXTURE_WORKFLOW);

    const run = captureIo(dir);
    expect(
      await main(['run', 'flow.yml', '--plugin', './failing.mjs', '--plugin', './second.mjs'], run.io),
    ).toBe(1);
    expect(run.stdout()).toContain('FAILED');
  });
});
