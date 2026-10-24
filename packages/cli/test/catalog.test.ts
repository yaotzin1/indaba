import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { captureIo, makeTempDir, writePlugin } from './support.js';

/** specs/workflow-editor, T1 to T4: what this installation offers a workflow, plugins included (AC-11, AC-12). */

async function run(args: string[], cwd: string) {
  const captured = captureIo(cwd);
  const code = await main(args, captured.io);
  return { code, out: captured.stdout(), err: captured.stderr() };
}

const esc = String.fromCharCode(27);

const PLUGIN = `export default {
  name: 'p',
  register(host) {
    host.registerRunner({ name: 'described', description: 'A runner from a plugin.', async run() {} });
    host.registerRunner({ name: 'bare', async run() {} });
    host.registerRunner({ name: 'loud', description: '${esc}[31mred\\nand ${'long '.repeat(60)}', async run() {} });
    host.registerGuard({ type: 'always_ok', description: 'Always passes.', async check() { return { passed: true }; } });
    host.registerAdjudicator('coin', { description: 'Flips a coin.', async rule() { return null; } });
  },
};
`;

interface CatalogJson {
  catalog: number;
  runners: {
    name: string;
    description: string;
    permissions?: Record<string, { mode: string; scope: string; note: string }>;
  }[];
  guards: { name: string; description: string }[];
  arbiters: { name: string; description: string }[];
  voters: unknown[];
  prompts: unknown[];
  values: Record<string, string[]>;
}

describe('indaba catalog', () => {
  it('lists the built-ins, each described, and the values of the format', async () => {
    const dir = await makeTempDir();
    const { code, out } = await run(['catalog', '--json'], dir);
    expect(code).toBe(0);
    const catalog = JSON.parse(out) as CatalogJson;
    expect(catalog.catalog).toBe(1);
    expect(catalog.runners.map((r) => r.name)).toEqual([
      'shell',
      'claude-code',
      'codex',
      'antigravity',
      'cursor',
      'opencode',
      'openrouter',
      'acp',
    ]);
    expect(catalog.runners.every((r) => r.description !== '' && r.description.length <= 200)).toBe(true);
    expect(catalog.guards.map((g) => g.name)).toEqual(['git_diff_empty', 'diff_within_scope']);
    expect(catalog.guards.every((g) => g.description !== '')).toBe(true);
    // A workflow can name `human` even where no terminal is attached, so it is listed.
    expect(catalog.arbiters).toEqual([
      {
        name: 'human',
        description:
          'A person at the terminal accepts or rejects a debate that failed; with no terminal the step escalates.',
      },
    ]);
    expect(catalog.voters).toEqual([]);
    expect(catalog.prompts).toEqual([]);
    expect(catalog.values).toEqual({
      decisionTypes: ['consensus', 'majority'],
      isolation: ['none', 'git_worktree'],
      failureActions: ['retry_step', 'escalate', 'fail'],
      mcpPolicies: ['required', 'optional'],
      promptAdditions: [],
    });
  });

  it('says how the shell runner runs a line, plainly: through the system shell', async () => {
    const { out } = await run(['catalog', '--json'], await makeTempDir());
    const shell = (JSON.parse(out) as CatalogJson).runners.find((r) => r.name === 'shell');
    expect(shell?.description).toContain('through the system shell');
  });

  it('carries, per built-in runner and level, the mode, the scope and a note id, for the page (AC-16)', async () => {
    const { out } = await run(['catalog', '--json'], await makeTempDir());
    const catalog = JSON.parse(out) as CatalogJson;
    for (const runner of catalog.runners) {
      expect(Object.keys(runner.permissions ?? {}).sort()).toEqual(['edit', 'full', 'read']);
    }
    const claude = catalog.runners.find((r) => r.name === 'claude-code');
    expect(claude?.permissions?.read?.mode).toBe('native');
    expect(catalog.runners.find((r) => r.name === 'opencode')?.permissions?.read?.mode).toBe('unsupported');
  });

  it('prints it as text for a person', async () => {
    const { code, out } = await run(['catalog'], await makeTempDir());
    expect(code).toBe(0);
    expect(out).toMatch(/^Runners\n {2}shell {8}Runs the step’s command lines/);
    expect(out).toContain('Guard types\n  git_diff_empty     Passes when nothing');
    expect(out).toContain('Voters\n  (none yet)');
    expect(out).toContain('  isolation          none, git_worktree');
  });

  it('lists what a plugin adds, cleaned and cut, and a runner with no description as such', async () => {
    const dir = await makeTempDir();
    await writePlugin(dir, 'p.mjs', PLUGIN);
    const { code, out } = await run(['catalog', '--json', '--plugin', './p.mjs'], dir);
    expect(code).toBe(0);
    const catalog = JSON.parse(out) as CatalogJson;
    // A plugin runner that does not implement PermissionCapable supports no level (spec C-04).
    const none = { mode: 'unsupported', scope: 'none', note: 'not_offered' };
    const noLevel = { read: none, edit: none, full: none };
    expect(catalog.runners).toContainEqual({
      name: 'described',
      description: 'A runner from a plugin.',
      permissions: noLevel,
    });
    expect(catalog.runners).toContainEqual({ name: 'bare', description: '', permissions: noLevel });
    const loud = catalog.runners.find((r) => r.name === 'loud')?.description ?? '';
    expect(loud).not.toContain(esc);
    expect(loud).not.toContain('\n');
    expect(loud.length).toBeLessThanOrEqual(200);
    expect(loud.endsWith('…')).toBe(true);
    expect(catalog.guards).toContainEqual({ name: 'always_ok', description: 'Always passes.' });
    expect(catalog.arbiters).toContainEqual({ name: 'coin', description: 'Flips a coin.' });
    const text = await run(['catalog', '--plugin', './p.mjs'], dir);
    expect(text.out).toMatch(/\n {2}bare\n/);
  });

  it('exits 1 naming a plugin that fails to load, and 2 for a usage error', async () => {
    const dir = await makeTempDir();
    const missing = await run(['catalog', '--plugin', './nope.mjs'], dir);
    expect(missing.code).toBe(1);
    expect(missing.out + missing.err).toContain('./nope.mjs');
    const extra = await run(['catalog', 'x'], dir);
    expect(extra.code).toBe(2);
    expect(extra.err).toContain('Unexpected argument: x.');
    const unknown = await run(['catalog', '--yaml'], dir);
    expect(unknown.code).toBe(2);
  });

  it('prints its help, and is in the usage', async () => {
    const dir = await makeTempDir();
    const help = await run(['catalog', '--help'], dir);
    expect(help.code).toBe(0);
    expect(help.out).toContain('Usage: indaba catalog [--json] [--plugin <specifier>]...');
    const usage = await run(['--help'], dir);
    expect(usage.out).toContain(
      'catalog           List the runners, guard types and arbiters this installation offers',
    );
  });
});
