import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEngine, loadPlugin, main } from '../src/index.js';
import { captureIo, FIXTURE_WORKFLOW, makeTempDir, writePlugin, writeWorkflow } from './support.js';

describe('plugin loading', () => {
  it('fails clearly when the module does not exist', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'f.yml', FIXTURE_WORKFLOW);
    const out = captureIo(dir);
    expect(await main(['validate', file, '--plugin', './missing.mjs'], out.io)).toBe(1);
    expect(out.stdout()).toContain('Cannot load plugin "./missing.mjs"');
  });

  it('fails clearly for a bare package that is not installed', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'f.yml', FIXTURE_WORKFLOW);
    const out = captureIo(dir);
    expect(await main(['plan', file, '--plugin', 'indaba-no-such-plugin-package'], out.io)).toBe(1);
    expect(out.stdout()).toContain('Cannot load plugin "indaba-no-such-plugin-package"');
  });

  it.each([
    ['no default export', 'export const x = 1;\n'],
    ['a default that is not an object', 'export default 42;\n'],
    ['a missing name', 'export default { register() {} };\n'],
    ['an empty name', "export default { name: '', register() {} };\n"],
    ['a missing register function', "export default { name: 'p' };\n"],
  ])('rejects a module with %s', async (_label, source) => {
    const dir = await makeTempDir();
    await writePlugin(dir, 'bad.mjs', source);
    await expect(loadPlugin('./bad.mjs', dir)).rejects.toThrow(/must default-export/);
  });

  it('names the plugin and exits non-zero when registering throws', async () => {
    const dir = await makeTempDir();
    await writePlugin(
      dir,
      'boom.mjs',
      "export default { name: 'boomer', register() { throw new Error('cannot start'); } };\n",
    );
    const file = await writeWorkflow(dir, 'f.yml', FIXTURE_WORKFLOW);
    for (const command of ['validate', 'plan', 'run']) {
      const out = captureIo(dir);
      expect(await main([command, file, '--plugin', './boom.mjs'], out.io)).toBe(1);
      expect(out.stdout()).toContain('Plugin "boomer" failed to register: cannot start');
    }
  });

  it('supports an async register and loads plugins in order', async () => {
    const dir = await makeTempDir();
    await writePlugin(
      dir,
      'async.mjs',
      "export default { name: 'a', async register(host) { await Promise.resolve(); host.registerRunner({ name: 'late', run: async () => { throw new Error('unused'); } }); } };\n",
    );
    const plugin = await loadPlugin(join(dir, 'async.mjs'), dir);
    const bundle = await createEngine({ projectDir: dir, plugins: [plugin] });
    expect(bundle.runners.has('late')).toBe(true);
    expect(bundle.runners.has('shell')).toBe(true);
  });

  it('never prints an environment secret that appears in a plugin error', async () => {
    const dir = await makeTempDir();
    await writePlugin(
      dir,
      'leak.mjs',
      "export default { name: 'leaky', register() { throw new Error('token ' + 'sk-test-' + '123456789'); } };\n",
    );
    const file = await writeWorkflow(dir, 'f.yml', FIXTURE_WORKFLOW);
    const out = captureIo(dir, { OPENROUTER_API_KEY: ['sk', 'test', '123456789'].join('-') });
    expect(await main(['validate', file, '--plugin', './leak.mjs'], out.io)).toBe(1);
    expect(out.stdout() + out.stderr()).not.toContain('123456789');
    expect(out.stdout()).toContain('[redacted]');
  });
});

describe('createEngine', () => {
  it('uses only the allowed environment keys and reads nothing else', async () => {
    const dir = await makeTempDir();
    const bundle = await createEngine({
      projectDir: dir,
      env: { INDABA_CODEX_CMD: 'mycodex {prompt}', UNRELATED: 'x' },
    });
    expect(bundle.runners.names()).toEqual(
      expect.arrayContaining(['shell', 'claude-code', 'codex', 'antigravity', 'cursor', 'openrouter']),
    );
    expect(bundle.guards.has('git_diff_empty')).toBe(true);
  });

  it('parses with the same guard registry the plugins registered into', async () => {
    const dir = await makeTempDir();
    const bundle = await createEngine({
      projectDir: dir,
      plugins: [
        {
          name: 'guards',
          register: (host) => {
            host.registerGuard({ type: 'always_ok', check: () => Promise.reject(new Error('unused')) });
          },
        },
      ],
    });
    expect(() => bundle.parser.parse(FIXTURE_WORKFLOW.replace('"fake"', '"shell"'))).not.toThrow();
  });
});
