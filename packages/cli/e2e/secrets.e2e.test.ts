import { describe, expect, it } from 'vitest';
import { makeGitRepo, pluginSource, readAllTraceText, requireBuild, runCli, writeFileIn } from './support.js';

requireBuild();

// Built from pieces so the repository's security audit does not mistake the test file for a leak.
const FAKE_KEY = ['sk', 'or', 'v1', 'e2e', 'canary', '0123456789'].join('-');

const LEAKY_PLUGIN = pluginSource(`
export default {
  name: 'leaky',
  register() {
    throw new Error('rejected key ' + process.env.OPENROUTER_API_KEY);
  },
};
`);

const FAILING = `version: "1.0"
name: "secret-run"
steps:
  - id: "boom"
    runner: "shell"
    commands:
      - 'node -e "process.exit(5)"'
`;

describe('secrets', () => {
  it('never prints the API key when a plugin error carries it', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'flow.workflow.ai.yml', FAILING);
    await writeFileIn(dir, 'leaky.mjs', LEAKY_PLUGIN);

    const r = await runCli(['run', 'flow.workflow.ai.yml', '--plugin', './leaky.mjs'], dir, {
      OPENROUTER_API_KEY: FAKE_KEY,
    });

    expect(r.code).toBe(1);
    expect(r.stdout + r.stderr).toContain('leaky');
    expect(r.stdout + r.stderr).toContain('[redacted]');
    expect(r.stdout).not.toContain(FAKE_KEY);
    expect(r.stderr).not.toContain(FAKE_KEY);
  });

  it('keeps the key out of stdout, stderr and the trace when a run fails', async () => {
    const dir = await makeGitRepo();
    await writeFileIn(dir, 'flow.workflow.ai.yml', FAILING);

    const r = await runCli(['run', 'flow.workflow.ai.yml', '-vv'], dir, { OPENROUTER_API_KEY: FAKE_KEY });

    expect(r.code).toBe(1);
    expect(r.stdout).toContain('finished: FAILED');
    expect(r.stdout).not.toContain(FAKE_KEY);
    expect(r.stderr).not.toContain(FAKE_KEY);
    expect(await readAllTraceText(dir)).not.toContain(FAKE_KEY);
  });

  it('keeps the key out of the output of commands that cannot read their file', async () => {
    const dir = await makeGitRepo();
    for (const args of [['validate', 'absent.yml'], ['plan', 'absent.yml'], ['run', 'absent.yml'], ['run']]) {
      const r = await runCli(args, dir, { OPENROUTER_API_KEY: FAKE_KEY });
      expect(r.code).toBe(1);
      expect(r.stdout + r.stderr).not.toContain(FAKE_KEY);
    }
  });
});
