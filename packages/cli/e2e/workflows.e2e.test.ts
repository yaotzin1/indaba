import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDir, requireBuild, runCli, writeFileIn } from './support.js';

requireBuild();

/** Task T-07 of specs/workflow-registry: the built `indaba workflows` in a temporary project. */

const WORKFLOW = `# Builds the site.
version: "1.0"
name: site
steps:
  - id: build
    runner: shell
    commands: ['node -e "process.exit(0)"']
`;

describe('indaba workflows', () => {
  it('lists, annotates, copies and refuses to remove a file a scan would list again', async () => {
    const dir = await makeTempDir();
    const config = await makeTempDir();
    // The per-user list of folders goes to this temporary folder on every system.
    const env = { HOME: config, USERPROFILE: config, XDG_CONFIG_HOME: config, APPDATA: config };
    await writeFileIn(dir, 'site.workflow.ai.yml', WORKFLOW);

    const listed = await runCli(['workflows', 'list', '--json'], dir, env);
    expect(listed.code).toBe(0);
    const entries = (
      JSON.parse(listed.stdout) as { entries: { id: string; name: string; validation: unknown }[] }
    ).entries;
    expect(entries).toEqual([expect.objectContaining({ name: 'site', validation: { state: 'valid' } })]);
    const id = entries[0]?.id.slice(0, 8) ?? '';

    const tagged = await runCli(
      ['workflows', 'annotate', id, '--tag', 'web', '--name', 'Web site'],
      dir,
      env,
    );
    expect(tagged.code).toBe(0);
    expect(tagged.stdout).toContain('Web site');

    await mkdir(join(dir, 'copies'));
    const copied = await runCli(['workflows', 'copy', id, '--to', 'copies'], dir, env);
    expect(copied.code).toBe(0);
    expect(copied.stdout).toContain('Copied to copies/site.workflow.ai.yml');
    expect(await readFile(join(dir, 'copies', 'site.workflow.ai.yml'), 'utf8')).toBe(WORKFLOW);

    const refused = await runCli(['workflows', 'remove', id], dir, env);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('hide it instead');

    const text = await runCli(['workflows', 'list'], dir, env);
    expect(text.stdout).toMatch(/Web site .*\[web\]/);
    expect(text.stdout).toContain('copies/site.workflow.ai.yml');
  });
});
