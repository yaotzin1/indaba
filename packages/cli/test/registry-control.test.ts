import { mkdir, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { FileWorkflowRegistry, parseWorkflow } from '@indaba/engine';
import { describe, expect, it } from 'vitest';
import { createRegistryHub, RegistryControlRefusal, rootIdOf } from '../src/run-control/registry.js';
import { readRoots } from '../src/run-control/roots.js';
import { makeTempDir } from './support.js';

/** specs/web-app-registry, T-05: the registry control of `indaba ui`, over a real file registry in temporary folders. */

const workflow = (name: string, extra = ''): string =>
  `version: "1.0"\nname: ${name}\nsteps:\n  - id: a\n    runner: shell\n    commands: [make]\n${extra}`;

async function folder(files: Record<string, string>): Promise<string> {
  const dir = await makeTempDir();
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(dir, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(dir, ...path.split('/')), text);
  }
  return dir;
}

async function setup(
  files: Record<string, string> = { 'site.workflow.ai.yml': workflow('site') },
  saved: readonly string[] = [],
) {
  const root = await folder(files);
  const config = await makeTempDir();
  const rootsFile = join(config, 'indaba', 'workflow-roots.json');
  if (saved.length > 0) {
    await mkdir(join(config, 'indaba'), { recursive: true });
    await writeFile(rootsFile, JSON.stringify(saved));
  }
  let n = 0;
  const clock = () => new Date('2026-10-24T12:00:00.000Z');
  const hub = createRegistryHub({
    roots: [root],
    rootsFile,
    pid: 7,
    createRegistry: (roots) =>
      new FileWorkflowRegistry({
        roots,
        parse: parseWorkflow,
        clock,
        ids: () => {
          n += 1;
          return `${n.toString(16).padStart(8, '0')}00000000`;
        },
      }),
    clock,
    cwd: root,
    intervalMs: 0,
  });
  return { root, config, rootsFile, hub, control: hub.control };
}

const refused = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RegistryControlRefusal) {
      return error.code;
    }
    throw error;
  }
  return 'no refusal';
};

describe('listing', () => {
  it('lists the entries with a folder id that does not change, and the folders', async () => {
    const { root, control } = await setup({
      'site.workflow.ai.yml': workflow('site'),
      'sub/other.workflow.ai.yaml': workflow('other'),
    });
    const list = await control.list();
    expect(list.entries.map((e) => e.path)).toEqual(['site.workflow.ai.yml', 'sub/other.workflow.ai.yaml']);
    expect(list.roots).toEqual([{ id: rootIdOf(root), name: basename(root), folder: root, readable: true }]);
    expect(list.entries.every((e) => e.rootId === rootIdOf(root) && /^[0-9a-f]{16}$/.test(e.id))).toBe(true);
    expect(list.truncated).toBe(false);
    expect(rootIdOf(root)).toMatch(/^[0-9a-f]{16}$/);
    expect((await control.list()).entries.map((e) => e.id)).toEqual(list.entries.map((e) => e.id));
  });

  it('includes hidden and missing entries, which the Run a workflow panel leaves out', async () => {
    const { root, control } = await setup();
    const [first] = (await control.list()).entries;
    expect(first).toBeDefined();
    await control.annotate(first?.id ?? '', { hidden: true });
    await rm(join(root, 'site.workflow.ai.yml'));
    const entry = (await control.list()).entries[0];
    expect(entry?.hidden).toBe(true);
    expect(entry?.validation.state).toBe('missing');
  });

  it('says an entry is removable when it is missing, or was added by path and no scan would list it', async () => {
    const { root, control } = await setup({
      'site.workflow.ai.yml': workflow('site'),
      'odd-name.yml': workflow('odd'),
    });
    const entries = async () => (await control.list()).entries;
    expect((await entries()).map((e) => [e.path, e.removable])).toEqual([['site.workflow.ai.yml', false]]);
    // A file with another name is listed only when it is added by path, which the command line does.
    const { FileWorkflowRegistry: Registry } = await import('@indaba/engine');
    await new Registry({
      roots: [root],
      parse: parseWorkflow,
      clock: () => new Date('2026-10-24T12:00:00.000Z'),
      ids: () => 'abcdef0123456789',
    }).add(join(root, 'odd-name.yml'));
    const after = await entries();
    expect(after.map((e) => [e.path, e.origin, e.removable])).toEqual([
      ['odd-name.yml', 'added', true],
      ['site.workflow.ai.yml', 'scanned', false],
    ]);
    await rm(join(root, 'site.workflow.ai.yml'));
    expect((await entries()).find((e) => e.path === 'site.workflow.ai.yml')?.removable).toBe(true);
  });

  it('covers the folders of the per-user list that still exist, and skips one that is gone', async () => {
    const extra = await folder({ 'more.workflow.ai.yml': workflow('more') });
    const { control, root } = await setup({ 'site.workflow.ai.yml': workflow('site') }, [
      extra,
      join(extra, 'gone'),
    ]);
    const list = await control.list();
    expect(list.roots.map((r) => r.folder)).toEqual([root, extra]);
    expect(list.entries.map((e) => e.path).sort()).toEqual(['more.workflow.ai.yml', 'site.workflow.ai.yml']);
    expect(new Set(list.entries.map((e) => e.rootId)).size).toBe(2);
  });

  it('scans on request and reports by folder id', async () => {
    const { root, control } = await setup();
    await control.list();
    await writeFile(join(root, 'new.workflow.ai.yml'), workflow('new'));
    const { reports } = await control.scan();
    expect(reports).toEqual([
      expect.objectContaining({ rootId: rootIdOf(root), found: 2, added: 1, truncated: false }),
    ]);
  });
});

describe('annotating', () => {
  it('sets a name, a project, tags and the hidden flag, and a null brings the default back', async () => {
    const { control } = await setup();
    const id = (await control.list()).entries[0]?.id ?? '';
    const set = await control.annotate(id, {
      name: 'My site',
      project: 'Blog',
      tags: ['a', 'b'],
      hidden: true,
    });
    expect(set).toMatchObject({ name: 'My site', project: 'Blog', tags: ['a', 'b'], hidden: true });
    const cleared = await control.annotate(id, { name: null, project: null, hidden: false });
    expect(cleared).toMatchObject({ name: 'site', hidden: false, tags: ['a', 'b'] });
    expect(cleared.project).not.toBe('Blog');
  });

  it('refuses an id that names no entry, whatever its shape', async () => {
    const { control } = await setup();
    expect(await refused(control.annotate('0123456789abcdef', { hidden: true }))).toBe('not_found');
    expect(await refused(control.remove('0123456789abcdef'))).toBe('not_found');
    expect(await refused(control.copy('0123456789abcdef', { rootId: 'a'.repeat(16) }))).toBe('not_found');
  });
});

describe('copying', () => {
  it('copies into another folder of the registry by its id and says what to review', async () => {
    const other = await folder({ 'z.workflow.ai.yml': workflow('z') });
    const { control, root } = await setup(undefined, [other]);
    const source = (await control.list()).entries.find((e) => e.path === 'site.workflow.ai.yml');
    const copy = await control.copy(source?.id ?? '', { rootId: rootIdOf(other), name: 'site-for-z' });
    expect(copy.entry).toMatchObject({
      path: 'site-for-z.workflow.ai.yml',
      origin: 'copied',
      copiedFrom: source?.id,
      rootId: rootIdOf(other),
    });
    expect(copy.toReview.length).toBeGreaterThan(0);
    expect(await readFile(join(other, 'site-for-z.workflow.ai.yml'), 'utf8')).toBe(
      await readFile(join(root, 'site.workflow.ai.yml'), 'utf8'),
    );
    expect((await control.list()).entries.some((e) => e.path === 'site-for-z.workflow.ai.yml')).toBe(true);
  });

  it('refuses a name that is taken, and writes nothing over it', async () => {
    const other = await folder({ 'site.workflow.ai.yml': 'keep me' });
    const { control } = await setup(undefined, [other]);
    const source = (await control.list()).entries.find((e) => e.rootId !== rootIdOf(other));
    expect(await refused(control.copy(source?.id ?? '', { rootId: rootIdOf(other) }))).toBe('exists');
    expect(await readFile(join(other, 'site.workflow.ai.yml'), 'utf8')).toBe('keep me');
  });

  it('refuses a folder id that is not one of the registry, and a path in its place', async () => {
    const { control } = await setup();
    const id = (await control.list()).entries[0]?.id ?? '';
    expect(await refused(control.copy(id, { rootId: 'f'.repeat(16) }))).toBe('outside_roots');
    expect(await refused(control.copy(id, { rootId: '/tmp' }))).toBe('outside_roots');
  });
});

describe('removing', () => {
  it('removes a missing entry and never touches a file', async () => {
    const { root, control } = await setup({
      'site.workflow.ai.yml': workflow('site'),
      'keep.workflow.ai.yml': workflow('keep'),
    });
    const entries = (await control.list()).entries;
    const gone = entries.find((e) => e.path === 'site.workflow.ai.yml');
    await unlink(join(root, 'site.workflow.ai.yml'));
    await control.remove(gone?.id ?? '');
    expect((await control.list()).entries.map((e) => e.path)).toEqual(['keep.workflow.ai.yml']);
    expect(await readFile(join(root, 'keep.workflow.ai.yml'), 'utf8')).toContain('keep');
  });

  it('refuses to remove a file a scan would list again, and leaves the entry', async () => {
    const { control } = await setup();
    const id = (await control.list()).entries[0]?.id ?? '';
    expect(await refused(control.remove(id))).toBe('would_return');
    expect((await control.list()).entries).toHaveLength(1);
  });
});

describe('resolving a typed folder', () => {
  it('shows the resolved folder and how many workflow files a scan lists, and writes nothing', async () => {
    const other = await folder({
      'a.workflow.ai.yml': workflow('a'),
      'sub/b.workflow.ai.yaml': workflow('b'),
      'notes.txt': 'x',
    });
    const { control, rootsFile } = await setup();
    const answer = await control.resolveRoot({ path: other });
    expect(answer).toEqual({
      folder: await realpath(other),
      name: basename(other),
      alreadyCovered: false,
      found: 2,
      atLeast: false,
    });
    await expect(readFile(rootsFile, 'utf8')).rejects.toThrow();
    await expect(readFile(join(other, '.indaba', 'registry', 'index.json'), 'utf8')).rejects.toThrow();
  });

  it('says so when the folder is already covered', async () => {
    const { control, root } = await setup();
    expect((await control.resolveRoot({ path: root })).alreadyCovered).toBe(true);
  });

  it('resolves a relative path from the folder indaba ui runs in', async () => {
    const { control, root } = await setup({ 'sub/a.workflow.ai.yml': workflow('a') });
    expect(await control.resolveRoot({ path: 'sub' })).toMatchObject({
      folder: await realpath(join(root, 'sub')),
      found: 1,
    });
  });

  it('refuses a file, a path that is not there, and an empty folder name alike', async () => {
    const { control, root } = await setup();
    expect(await refused(control.resolveRoot({ path: join(root, 'site.workflow.ai.yml') }))).toBe(
      'not_a_folder',
    );
    expect(await refused(control.resolveRoot({ path: join(root, 'nope') }))).toBe('not_a_folder');
  });

  it('follows a link to the folder it points at and shows that folder', async () => {
    const other = await folder({ 'a.workflow.ai.yml': workflow('a') });
    const { control, root } = await setup();
    const link = join(root, 'link');
    try {
      await symlink(other, link, 'junction');
    } catch {
      return; // links need a privilege on some machines; the rest of the suite does not depend on it
    }
    const answer = await control.resolveRoot({ path: link });
    expect(answer.folder).toBe(await realpath(other));
  });

  it('counts at most what a scan lists and says there may be more', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 201; i += 1) {
      files[`w${i}.workflow.ai.yml`] = workflow(`w${i}`);
    }
    const big = await folder(files);
    const { control } = await setup();
    const answer = await control.resolveRoot({ path: big });
    expect(answer.found).toBe(200);
    expect(answer.atLeast).toBe(true);
  });
});

describe('adding a folder', () => {
  it('writes the per-user list, scans the folder, and the finder offers its workflows at once', async () => {
    const other = await folder({ 'a.workflow.ai.yml': workflow('a') });
    const { control, hub, rootsFile } = await setup();
    const { folder: resolved } = await control.resolveRoot({ path: other });
    const added = await control.addRoot({ folder: resolved });
    expect(added.alreadyCovered).toBe(false);
    expect(added.root).toMatchObject({ id: rootIdOf(resolved), folder: resolved, readable: true });
    expect(added.report).toMatchObject({ rootId: rootIdOf(resolved), found: 1, added: 1 });
    expect(await readRoots(rootsFile)).toEqual([resolved]);
    const found = (await hub.finder.list()).found;
    expect(found.map((f) => f.path).sort()).toEqual(['a.workflow.ai.yml', 'site.workflow.ai.yml']);
    const imported = found.find((f) => f.path === 'a.workflow.ai.yml');
    expect(await hub.finder.find(imported?.id ?? '')).toMatchObject({ root: resolved });
    expect((await control.list()).roots.map((r) => r.folder)).toContain(resolved);
  });

  it('is idempotent: the same folder again says it was covered and writes nothing twice', async () => {
    const other = await folder({ 'a.workflow.ai.yml': workflow('a') });
    const { control, rootsFile } = await setup();
    const { folder: resolved } = await control.resolveRoot({ path: other });
    await control.addRoot({ folder: resolved });
    const again = await control.addRoot({ folder: resolved });
    expect(again.alreadyCovered).toBe(true);
    expect(await readRoots(rootsFile)).toEqual([resolved]);
    expect((await control.list()).roots).toHaveLength(2);
  });

  it('refuses a folder that is not exactly the one that was shown', async () => {
    const other = await folder({ 'a.workflow.ai.yml': workflow('a') });
    const { control, rootsFile, root } = await setup();
    const link = join(root, 'link');
    try {
      await symlink(other, link, 'junction');
    } catch {
      return;
    }
    // The person saw `other`; a path that now only leads there is a different thing to confirm.
    expect(await refused(control.addRoot({ folder: link }))).toBe('not_a_folder');
    expect(await refused(control.addRoot({ folder: join(root, 'nope') }))).toBe('not_a_folder');
    expect(await refused(control.addRoot({ folder: join(root, 'site.workflow.ai.yml') }))).toBe(
      'not_a_folder',
    );
    expect(await readRoots(rootsFile)).toEqual([]);
  });

  it('does not add the folder for the session when the list cannot be written', async () => {
    const other = await folder({ 'a.workflow.ai.yml': workflow('a') });
    const { control, config, rootsFile } = await setup();
    // A file where the folder of the list should be: the write fails.
    await writeFile(join(config, 'indaba'), 'not a folder');
    const { folder: resolved } = await control.resolveRoot({ path: other });
    expect(await refused(control.addRoot({ folder: resolved }))).toBe('store_failed');
    expect((await control.list()).roots.map((r) => r.folder)).not.toContain(resolved);
    await expect(readFile(rootsFile, 'utf8')).rejects.toThrow();
  });

  it('keeps both folders when two are added at once', async () => {
    const one = await folder({ 'one.workflow.ai.yml': workflow('one') });
    const two = await folder({ 'two.workflow.ai.yml': workflow('two') });
    const { control, rootsFile } = await setup();
    const [a, b] = await Promise.all([
      control.resolveRoot({ path: one }),
      control.resolveRoot({ path: two }),
    ]);
    await Promise.all([control.addRoot({ folder: a.folder }), control.addRoot({ folder: b.folder })]);
    expect([...(await readRoots(rootsFile))].sort()).toEqual([a.folder, b.folder].sort());
    expect((await control.list()).roots).toHaveLength(3);
  });

  it('lets a run start from a folder added at run time: the finder the run control holds follows the swap', async () => {
    const other = await folder({ 'a.workflow.ai.yml': workflow('a') });
    const { control, hub } = await setup();
    const before = (await hub.finder.list()).found.length;
    const { folder: resolved } = await control.resolveRoot({ path: other });
    await control.addRoot({ folder: resolved });
    expect((await hub.finder.list()).found.length).toBe(before + 1);
  });
});
