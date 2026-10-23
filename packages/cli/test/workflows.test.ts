import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger, type LogRecord, RegistryError, type WorkflowRegistry } from '@indaba/core';
import { FileWorkflowRegistry, parseWorkflow } from '@indaba/engine';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import {
  parseWorkflows,
  readRoots,
  shortIds,
  type WorkflowsOptions,
  WorkflowsUsageError,
  workflowsCommand,
  writeRoots,
} from '../src/workflows.js';
import { captureIo, makeTempDir, writePlugin } from './support.js';

/** specs/workflow-registry, T-06: `indaba workflows`. */

const workflow = (name: string, extra = ''): string =>
  `version: "1.0"\nname: ${name}\nsteps:\n  - id: a\n    runner: shell\n    commands: [make]\n${extra}`;

async function setup(files: Record<string, string> = { 'site.workflow.ai.yml': workflow('site') }) {
  const cwd = await makeTempDir();
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(cwd, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(cwd, ...path.split('/')), text);
  }
  const config = await makeTempDir();
  const rootsFile = join(config, 'indaba', 'workflow-roots.json');
  const logged: LogRecord[] = [];
  let n = 0;
  const made: (readonly string[])[] = [];
  const deps = {
    cwd,
    rootsFile,
    pid: 7,
    logger: createLogger({ sinks: [{ write: (r: LogRecord) => logged.push(r) }], clock: () => new Date(0) }),
    registry: async (roots: readonly string[]): Promise<WorkflowRegistry> => {
      made.push(roots);
      return new FileWorkflowRegistry({
        roots,
        parse: parseWorkflow,
        clock: () => new Date('2026-10-23T12:00:00.000Z'),
        ids: () => {
          n += 1;
          return `${n.toString(16).padStart(8, '0')}00000000`;
        },
      });
    },
  };
  return { cwd, rootsFile, deps, logged, made };
}

async function runIt(deps: Awaited<ReturnType<typeof setup>>['deps'], args: string[]) {
  const captured = captureIo(deps.cwd);
  const code = await workflowsCommand(parseWorkflows(args), captured.io, deps);
  return { code, out: captured.stdout(), err: captured.stderr() };
}

describe('parsing (AC-09)', () => {
  it('reads each subcommand and its options', () => {
    expect(parseWorkflows(['list', '--all', '--json'])).toMatchObject({
      subcommand: 'list',
      all: true,
      json: true,
    });
    expect(
      parseWorkflows([
        'annotate',
        'ab',
        '--name',
        'N',
        '--tag',
        'a',
        '--tag',
        'b',
        '--hide',
        '--plugin',
        'p',
      ]),
    ).toMatchObject({
      subcommand: 'annotate',
      target: 'ab',
      name: 'N',
      tags: ['a', 'b'],
      hide: true,
      plugins: ['p'],
    });
    expect(parseWorkflows(['copy', 'ab', '--to', 'x', '--name', 'y'])).toMatchObject({ to: 'x', name: 'y' });
    expect(parseWorkflows(['--help'])).toMatchObject({ help: true });
    expect(parseWorkflows(['copy', '--help'])).toMatchObject({ help: true, subcommand: 'copy' });
  });

  it.each([
    [[], 'Name what to do'],
    [['delete', 'x'], 'Unknown subcommand: delete.'],
    [['list', 'x'], 'Unexpected argument: x.'],
    [['remove'], 'Name the entry by its id.'],
    [['add'], 'Name a folder or a file to add.'],
    [['remove', 'a', 'b'], 'Unexpected argument: b.'],
    [['copy', 'a'], '--to <folder>'],
    [['annotate', 'a'], 'Say what to change'],
    [['annotate', 'a', '--hide', '--show'], 'cannot be given together'],
    [['list', '--bogus'], 'bogus'],
  ])('refuses %j', (args, message) => {
    expect(() => parseWorkflows(args)).toThrow(WorkflowsUsageError);
    expect(() => parseWorkflows(args)).toThrow(message);
  });
});

describe('the subcommands (AC-09 to AC-12)', () => {
  it('lists after a scan, with short ids, states and reasons, and as JSON', async () => {
    const { deps } = await setup({
      'site.workflow.ai.yml': workflow('site'),
      'bad.workflow.ai.yml': 'version: "1.0"\nname: bad\nsteps: []\n',
    });
    const listed = await runIt(deps, ['list']);
    expect(listed.code).toBe(0);
    const lines = listed.out.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^00000001 +invalid +bad +\(.+: bad\.workflow\.ai\.yml\) +no run yet$/);
    expect(lines[1]?.trim()).toBe('steps must contain at least one step');
    expect(lines[2]).toMatch(/^00000002 +valid +site /);
    const json = JSON.parse((await runIt(deps, ['list', '--json'])).out) as {
      registry: number;
      entries: unknown[];
    };
    expect(json.registry).toBe(1);
    expect(json.entries).toHaveLength(2);
  });

  it('says how to find workflows when there are none, and reports a scan', async () => {
    const { deps, cwd } = await setup({});
    expect((await runIt(deps, ['list'])).out).toMatch(/^No workflow found\./);
    await writeFile(join(cwd, 'a.workflow.ai.yml'), workflow('a'));
    const scanned = await runIt(deps, ['scan']);
    expect(scanned.out).toBe(`${cwd}\n  found 1, new 1, changed 0, moved 0, missing 0, invalid 0\n`);
    const json = JSON.parse((await runIt(deps, ['scan', '--json'])).out) as { reports: { root: string }[] };
    expect(json.reports.map((r) => r.root)).toEqual([cwd]);
  });

  it('adds a folder to the per-user list once and scans it, and lists a file by path', async () => {
    const { deps, rootsFile } = await setup();
    const other = await makeTempDir();
    await writeFile(join(other, 'x.workflow.ai.yml'), workflow('x'));
    const added = await runIt(deps, ['add', other]);
    expect(added.out).toBe(`Added ${other}: 1 workflow files.\n`);
    expect(await readRoots(rootsFile)).toEqual([other]);
    await runIt(deps, ['add', other]);
    expect(await readRoots(rootsFile)).toEqual([other]);
    // The current folder is a root already; adding it writes nothing.
    await runIt(deps, ['add', '.']);
    expect(await readRoots(rootsFile)).toEqual([other]);
    const listed = await runIt(deps, ['list']);
    expect(listed.out).toContain('x.workflow.ai.yml');
    await writeFile(join(deps.cwd, 'review.yml'), workflow('review'));
    expect((await runIt(deps, ['add', 'review.yml'])).out).toMatch(/valid +review/);
  });

  it('skips a saved folder that is gone, and says so', async () => {
    const { deps, rootsFile } = await setup();
    await writeRoots(rootsFile, [join(deps.cwd, 'gone'), deps.cwd], 1);
    const listed = await runIt(deps, ['list']);
    expect(listed.err).toBe(`Skipped a folder that is not there any more: ${join(deps.cwd, 'gone')}\n`);
    expect(listed.code).toBe(0);
  });

  it('annotates, clears, hides and shows', async () => {
    const { deps } = await setup();
    await runIt(deps, ['list']);
    const named = await runIt(deps, [
      'annotate',
      '00000001',
      '--name',
      'Web',
      '--project',
      'shop',
      '--tag',
      'x',
    ]);
    expect(named.out).toMatch(/Web +\(shop: site\.workflow\.ai\.yml\).*\[x\]/);
    expect((await runIt(deps, ['annotate', '0000', '--hide'])).out).toContain('(hidden)');
    expect((await runIt(deps, ['list'])).out).toMatch(/^No workflow found/);
    expect((await runIt(deps, ['list', '--all'])).out).toContain('(hidden)');
    const cleared = await runIt(deps, [
      'annotate',
      '0000',
      '--show',
      '--clear-name',
      '--clear-project',
      '--no-tags',
    ]);
    expect(cleared.out).toMatch(/valid +site +\(/);
    expect(cleared.out).not.toContain('[');
  });

  it('refuses with the registry’s words and exit 1, listing the ids an ambiguous one names', async () => {
    const { deps, logged } = await setup({
      'a.workflow.ai.yml': workflow('a'),
      'b.workflow.ai.yml': workflow('b'),
    });
    await runIt(deps, ['list']);
    const ambiguous = await runIt(deps, ['remove', '0000']);
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.err).toBe('2 entries begin with "0000": 0000000100000000, 0000000200000000\n');
    const back = await runIt(deps, ['remove', '00000001']);
    expect(back.err).toMatch(/^the next scan would list this file again/);
    expect(logged.map((r) => r.fields)).toContainEqual({ subcommand: 'remove', outcome: 'would_return' });
  });

  it('removes an entry and leaves the file, and copies with what to review', async () => {
    const { deps, cwd } = await setup({
      'site.workflow.ai.yml': workflow('site'),
      'review.yml': workflow('review'),
    });
    await runIt(deps, ['list']);
    await runIt(deps, ['add', 'review.yml']);
    const removed = await runIt(deps, ['remove', '00000002']);
    expect(removed.out).toBe('Removed review.yml from the list. The file, if it is there, is untouched.\n');
    expect(await readFile(join(cwd, 'review.yml'), 'utf8')).toBe(workflow('review'));
    await mkdir(join(cwd, 'copies'));
    const copied = await runIt(deps, ['copy', '00000001', '--to', 'copies', '--name', 'site-2']);
    expect(copied.out).toBe(
      'Copied to copies/site-2.workflow.ai.yml (0000000300000000).\nBefore running it, look at what may differ in this project:\n  name: site\n  steps[0].commands[0]: make\n',
    );
    const again = await runIt(deps, ['copy', '00000001', '--to', 'copies', '--name', 'site-2']);
    expect(again).toMatchObject({
      code: 1,
      err: 'copies/site-2.workflow.ai.yml exists; it is not overwritten\n',
    });
  });

  it('copies without a review list when there is nothing to name', async () => {
    const { deps, cwd } = await setup({ 'x.workflow.ai.yml': 'version: "1.0"\nsteps: []\n' });
    await runIt(deps, ['list']);
    await mkdir(join(cwd, 'c'));
    expect((await runIt(deps, ['copy', '00000001', '--to', 'c'])).out).toBe(
      'Copied to c/x.workflow.ai.yml (0000000200000000).\n',
    );
  });

  it('lets an error that is not a refusal through, as a failure of the store', async () => {
    const { deps } = await setup();
    const failing = {
      ...deps,
      registry: async (): Promise<WorkflowRegistry> => {
        throw new TypeError('the store is down');
      },
    };
    await expect(runIt(failing, ['scan'])).rejects.toThrow('the store is down');
    // A refusal from a plugin's own copy of the core package is still a refusal.
    const foreign = Object.assign(new Error('no such entry'), { name: 'RegistryError', code: 'not_found' });
    const plugin = {
      ...deps,
      registry: async (): Promise<WorkflowRegistry> => {
        throw foreign;
      },
    };
    expect(await runIt(plugin, ['scan'])).toMatchObject({ code: 1, err: 'no such entry\n' });
    expect(new RegistryError('exists', 'x').name).toBe('RegistryError');
  });
});

describe('helpers', () => {
  it('shortens ids to eight characters, more when two would share them', () => {
    const ids = ['abcdef0123456789', 'abcdef0199999999', '1234567890abcdef'];
    expect([...shortIds(ids).values()]).toEqual(['abcdef012', 'abcdef019', '12345678']);
  });

  it('reads a roots file that is not a list of strings as empty', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'r.json'), '{"a": 1}');
    expect(await readRoots(join(dir, 'r.json'))).toEqual([]);
    await writeFile(join(dir, 'r.json'), '["a", 3]');
    expect(await readRoots(join(dir, 'r.json'))).toEqual(['a']);
    expect(await readRoots(join(dir, 'none.json'))).toEqual([]);
    await expect(writeRoots(join(dir, 'r.json', 'x.json'), [], 1)).rejects.toThrow();
  });
});

describe('indaba workflows through main (wiring only; nothing written outside the temporary folder)', () => {
  const options = (o: Partial<WorkflowsOptions>) => o;

  it('prints its help, a usage error, and is in the usage', async () => {
    const dir = await makeTempDir();
    const help = captureIo(dir);
    expect(await main(['workflows', '--help'], help.io)).toBe(0);
    expect(help.stdout()).toContain('Usage: indaba workflows');
    const bad = captureIo(dir);
    expect(await main(['workflows', 'delete'], bad.io)).toBe(2);
    expect(bad.stderr()).toContain('Unknown subcommand: delete.');
    const usage = captureIo(dir);
    await main(['--help'], usage.io);
    expect(usage.stdout()).toContain('workflows         List, scan, annotate and copy');
    expect(options({ json: true })).toEqual({ json: true });
  });

  it('scans the current folder with the built-in store', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'site.workflow.ai.yml'), workflow('site'));
    const captured = captureIo(dir, { XDG_CONFIG_HOME: join(dir, '.config'), APPDATA: join(dir, '.config') });
    expect(await main(['workflows', 'scan', '--json'], captured.io)).toBe(0);
    const reports = (JSON.parse(captured.stdout()) as { reports: { root: string; found: number }[] }).reports;
    expect(reports.find((r) => r.root === dir)).toMatchObject({ found: 1 });
    expect(await readFile(join(dir, '.indaba', 'registry', '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('uses a registry a plugin registers, and fails with its words when it throws', async () => {
    const dir = await makeTempDir();
    const plugin = await writePlugin(
      dir,
      'store.mjs',
      `export default {
  name: 'store',
  register(host) {
    host.registerRegistry({
      roots: () => [],
      list: async () => [],
      get: async () => undefined,
      scan: async () => { throw new Error('the shared store is down'); },
      add: async () => { throw new Error('no'); },
      annotate: async () => { throw new Error('no'); },
      remove: async () => {},
      copy: async () => { throw new Error('no'); },
    });
  },
};
`,
    );
    const captured = captureIo(dir, { XDG_CONFIG_HOME: join(dir, '.config'), APPDATA: join(dir, '.config') });
    expect(await main(['workflows', 'scan', '--plugin', plugin], captured.io)).toBe(1);
    expect(captured.stderr()).toContain('the shared store is down');
    // No fallback to the file store: nothing was written.
    await expect(readFile(join(dir, '.indaba', 'registry', 'index.json'), 'utf8')).rejects.toThrow();
  });
});
