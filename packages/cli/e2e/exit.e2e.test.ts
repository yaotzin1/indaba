import { describe, expect, it } from 'vitest';
import { makeGitRepo, pluginSource, requireBuild, runCli, writeFileIn } from './support.js';

requireBuild();

const WORKFLOW = `version: "1.0"
name: "lingering"
roles:
  worker:
    runner: "lingering"
steps:
  - id: "work"
    role: "worker"
    goal: "finish"
`;

// A runner that finishes but leaves a live handle behind, as a Windows pseudo-terminal does
// (its conhost outlives the child). Without an explicit exit the process would never end.
const LINGERING_PLUGIN = pluginSource(`
export default {
  name: 'lingering',
  register(host) {
    host.registerRunner({
      name: 'lingering',
      async run() {
        setInterval(() => undefined, 1000);
        return new RunResult({ exitCode: 0, output: 'done' });
      },
    });
  },
};
`);

describe('the built CLI: leaving when the work is done', () => {
  it('exits with the run status, and all its output, although a runner left a handle open', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'flow.workflow.ai.yml', WORKFLOW);
    await writeFileIn(dir, 'plugin.mjs', LINGERING_PLUGIN);

    const r = await runCli(
      ['run', 'flow.workflow.ai.yml', '--plugin', './plugin.mjs', '--task-id', 'lingers'],
      dir,
    );

    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Task lingers finished: COMPLETED');
  }, 15_000);
});
