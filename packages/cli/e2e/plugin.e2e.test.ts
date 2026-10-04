import { describe, expect, it } from 'vitest';
import { makeGitRepo, pluginSource, requireBuild, runCli, writeFileIn } from './support.js';

requireBuild();

const WORKFLOW = `version: "1.0"
name: "plugin-flow"
roles:
  worker:
    runner: "canned"
steps:
  - id: "work"
    role: "worker"
    goal: "do the thing"
    guards:
      - type: "marker_ok"
`;

const PLUGIN = pluginSource(`
export default {
  name: 'e2e-plugin',
  register(host) {
    host.registerRunner({
      name: 'canned',
      async run(request) {
        process.stderr.write('[plugin] runner saw goal: ' + request.prompt.includes('do the thing') + '\\n');
        return new RunResult({ exitCode: 0, output: 'canned answer' });
      },
    });
    host.registerGuard({
      type: 'marker_ok',
      async check() {
        process.stderr.write('[plugin] guard marker_ok ran\\n');
        return GuardResult.pass();
      },
    });
    host.addListener(StepStatusChanged, (event) => {
      process.stderr.write('[plugin] ' + event.stepId + ' -> ' + event.to + '\\n');
    });
  },
};
`);

const FAILING_GUARD_PLUGIN = pluginSource(`
export default {
  name: 'strict',
  register(host) {
    host.registerRunner({ name: 'canned', async run() { return new RunResult({ exitCode: 0, output: 'x' }); } });
    host.registerGuard({ type: 'marker_ok', async check() { return GuardResult.fail('marker is missing'); } });
  },
};
`);

const THROWING_LISTENER_PLUGIN = pluginSource(`
export default {
  name: 'noisy',
  register(host) {
    host.registerRunner({ name: 'canned', async run() { return new RunResult({ exitCode: 0, output: 'x' }); } });
    host.registerGuard({ type: 'marker_ok', async check() { return GuardResult.pass(); } });
    host.addListener(StepStatusChanged, () => { throw new Error('listener exploded'); });
  },
};
`);

describe('run with --plugin', () => {
  it('needs the plugin for the custom guard type to be valid', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'flow.workflow.ai.yml', WORKFLOW);
    const r = await runCli(['validate', 'flow.workflow.ai.yml'], dir);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('"marker_ok" is not a known guard');
  });

  it('validates, plans and runs with a plugin runner, guard type and listener', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'flow.workflow.ai.yml', WORKFLOW);
    await writeFileIn(dir, 'plugin.mjs', PLUGIN);

    const validate = await runCli(['validate', 'flow.workflow.ai.yml', '--plugin', './plugin.mjs'], dir);
    expect(validate).toMatchObject({ code: 0, stdout: 'plugin-flow is valid (1 steps, 1 roles).\n' });

    const plan = await runCli(['plan', 'flow.workflow.ai.yml', '--plugin', './plugin.mjs'], dir);
    expect(plan).toMatchObject({ code: 0, stdout: '1. work [worker]\n' });

    const run = await runCli(
      ['run', 'flow.workflow.ai.yml', '--plugin', './plugin.mjs', '--task-id', 'e2e-plugin'],
      dir,
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('Task e2e-plugin finished: COMPLETED');
    expect(run.stderr).toContain('[plugin] runner saw goal: true');
    expect(run.stderr).toContain('[plugin] guard marker_ok ran');
    expect(run.stderr).toContain('[plugin] work -> RUNNING');
    expect(run.stderr).toContain('[plugin] work -> COMPLETED');
  });

  it('fails the step when a plugin guard fails', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'flow.workflow.ai.yml', WORKFLOW);
    await writeFileIn(dir, 'plugin.mjs', FAILING_GUARD_PLUGIN);
    const r = await runCli(['run', 'flow.workflow.ai.yml', '--plugin', './plugin.mjs'], dir);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('finished: FAILED');
    expect(r.stdout).toContain('marker is missing');
  });

  it('survives a throwing listener and reports it on stderr', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'flow.workflow.ai.yml', WORKFLOW);
    await writeFileIn(dir, 'plugin.mjs', THROWING_LISTENER_PLUGIN);
    const r = await runCli(['run', 'flow.workflow.ai.yml', '--plugin', './plugin.mjs'], dir);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('Listener failed: listener exploded');
  });

  it('names the plugin and exits non-zero when register throws', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'flow.workflow.ai.yml', WORKFLOW);
    await writeFileIn(
      dir,
      'broken.mjs',
      "export default { name: 'broken-plugin', register() { throw new Error('no way'); } };\n",
    );
    for (const command of ['validate', 'plan', 'run']) {
      const r = await runCli([command, 'flow.workflow.ai.yml', '--plugin', './broken.mjs'], dir);
      expect(r.code).toBe(1);
      const text = r.stdout + r.stderr;
      expect(text).toContain('broken-plugin');
      expect(text).toContain('failed to register');
      expect(text).toContain('no way');
    }
  });

  it('rejects a module that is not a plugin and a missing file', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'flow.workflow.ai.yml', WORKFLOW);
    await writeFileIn(dir, 'notaplugin.mjs', 'export default { hello: 1 };\n');

    const wrong = await runCli(['validate', 'flow.workflow.ai.yml', '--plugin', './notaplugin.mjs'], dir);
    expect(wrong.code).toBe(1);
    expect(wrong.stdout + wrong.stderr).toContain('must default-export');

    const missing = await runCli(['validate', 'flow.workflow.ai.yml', '--plugin', './absent.mjs'], dir);
    expect(missing.code).toBe(1);
    expect(missing.stdout + missing.stderr).toContain('Cannot load plugin "./absent.mjs"');
  });
});
