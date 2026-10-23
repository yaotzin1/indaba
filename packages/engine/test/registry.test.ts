import { chmod, mkdir, readdir, readFile, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RegistryError, type WorkflowDefinition, WorkflowValidationError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  FileWorkflowRegistry,
  parseWorkflow,
  REGISTRY_INDEX,
  type RunRecord,
  serializeRecord,
  type UnknownRecord,
} from '../src/index.js';
import { fileStem, placesToReview } from '../src/registry/file-registry.js';
import { isSafeRelative, readIndex, storedEntryOf, writeIndex } from '../src/registry/index-file.js';
import { makeTempDir } from './support.js';

/** specs/workflow-registry, T-03 to T-05: the file store on temporary folders. */

const workflow = (name: string, extra = ''): string =>
  `# ${name}\nversion: "1.0"\nname: ${name}\nsteps:\n  - id: a\n    runner: shell\n    commands: [make]\n${extra}`;

const AT = new Date('2026-10-23T12:00:00.000Z');

/** A registry over `roots` whose parser counts its calls, with ids 0000000000000001, ...2, ... */
function registry(roots: string[], parse: (s: string) => WorkflowDefinition = parseWorkflow) {
  let n = 0;
  const parsed = { count: 0 };
  const store = new FileWorkflowRegistry({
    roots,
    parse: (source) => {
      parsed.count += 1;
      return parse(source);
    },
    clock: () => AT,
    ids: () => {
      n += 1;
      return n.toString(16).padStart(16, '0');
    },
  });
  return { store, parsed };
}

async function project(files: Record<string, string>): Promise<string> {
  const root = await makeTempDir();
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...path.split('/')), text);
  }
  return root;
}

type Writable = Exclude<RunRecord, UnknownRecord>;

/** A finished run of `name` in the root's traces. */
async function run(root: string, trace: string, name: string, at: string): Promise<void> {
  const dir = join(root, '.indaba', 'traces');
  await mkdir(dir, { recursive: true });
  const span = '2'.repeat(16);
  const records: Writable[] = [
    {
      type: 'span_started',
      at,
      traceId: trace,
      spanId: span,
      parentSpanId: undefined,
      name: `indaba.task ${name}`,
      attributes: {},
    },
    {
      type: 'span_ended',
      at,
      traceId: trace,
      spanId: span,
      status: 'ok',
      statusMessage: undefined,
      attributes: { 'indaba.workflow.status': 'completed' },
      events: [],
    },
  ];
  await writeFile(join(dir, `${trace}.events.jsonl`), records.map((r) => `${serializeRecord(r)}\n`).join(''));
}

describe('a scan (AC-04 to AC-07)', () => {
  it('lists what the page lists, reads each file once, and keeps a stable id', async () => {
    const root = await project({
      'site.workflow.ai.yml': workflow('site'),
      'deep/a/b/c/review.workflow.ai.yaml': workflow('review'),
      'deep/a/b/c/d/too-deep.workflow.ai.yml': workflow('deep'),
      'node_modules/x.workflow.ai.yml': workflow('dep'),
      '.indaba/workflow.ai.yml': workflow('default'),
      '.indaba/run-inputs/copy.workflow.ai.yml': workflow('copy'),
      'notes.yml': 'a: 1\n',
    });
    const { store, parsed } = registry([root]);
    const [report] = await store.scan();
    expect(report).toEqual({
      root,
      found: 3,
      added: 3,
      changed: 0,
      moved: 0,
      missing: 0,
      invalid: 0,
      truncated: false,
      recovered: false,
    });
    const entries = await store.list();
    expect(entries.map((e) => [e.path, e.name, e.project, e.origin, e.validation.state])).toEqual([
      ['.indaba/workflow.ai.yml', 'default', expect.any(String), 'scanned', 'valid'],
      ['deep/a/b/c/review.workflow.ai.yaml', 'review', expect.any(String), 'scanned', 'valid'],
      ['site.workflow.ai.yml', 'site', expect.any(String), 'scanned', 'valid'],
    ]);
    expect(entries[2]).toMatchObject({
      id: '0000000000000002',
      root,
      tags: [],
      hidden: false,
      readAt: AT.toISOString(),
    });
    expect(entries[2]?.hash).toMatch(/^[0-9a-f]{64}$/);
    // AC-06: unchanged files are not read again.
    parsed.count = 0;
    const [again] = await store.scan();
    expect(parsed.count).toBe(0);
    expect(again).toMatchObject({ found: 3, added: 0, changed: 0 });
    expect((await store.list()).map((e) => e.id)).toEqual(entries.map((e) => e.id));
    // The registry stays on the machine (C-02).
    expect(await readFile(join(root, '.indaba', 'registry', '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('reads a changed file again, keeps an invalid one with its first problem, and one over 1 MiB unread', async () => {
    const root = await project({ 'site.workflow.ai.yml': workflow('site') });
    const { store } = registry([root]);
    await store.scan();
    await writeFile(join(root, 'site.workflow.ai.yml'), 'version: "1.0"\nname: site\nsteps: []\n');
    await writeFile(join(root, 'big.workflow.ai.yml'), `# ${'x'.repeat(1024 * 1024)}\n`);
    const [report] = await store.scan();
    expect(report).toMatchObject({ changed: 1, added: 1, invalid: 2 });
    const [big, site] = await store.list();
    expect(site?.validation).toEqual({ state: 'invalid', message: expect.stringMatching(/steps/) });
    expect(big).toMatchObject({
      hash: '',
      name: 'big',
      validation: { state: 'invalid', message: expect.stringMatching(/1 MiB/) },
    });
  });

  it('keeps an entry, its id and its annotations across a rename, and marks a deleted file missing without dropping it', async () => {
    const root = await project({
      'site.workflow.ai.yml': workflow('site'),
      'other.workflow.ai.yml': workflow('other'),
    });
    const { store } = registry([root]);
    await store.scan();
    const site = (await store.list()).find((e) => e.path === 'site.workflow.ai.yml');
    await store.annotate(site?.id ?? '', { tags: ['web'] });
    await mkdir(join(root, 'flows'));
    await rename(join(root, 'site.workflow.ai.yml'), join(root, 'flows', 'site.workflow.ai.yml'));
    await rm(join(root, 'other.workflow.ai.yml'));
    const [report] = await store.scan();
    expect(report).toMatchObject({ moved: 1, added: 0, missing: 1 });
    const entries = await store.list();
    expect(entries.find((e) => e.id === site?.id)).toMatchObject({
      path: 'flows/site.workflow.ai.yml',
      tags: ['web'],
    });
    expect(entries.find((e) => e.path === 'other.workflow.ai.yml')?.validation).toEqual({
      state: 'missing',
      reason: 'the file is gone',
    });
    // Still missing on the next scan, until the person removes it.
    await store.scan();
    expect((await store.list()).length).toBe(2);
    // It comes back when the file does.
    await writeFile(join(root, 'other.workflow.ai.yml'), workflow('other'));
    expect((await store.scan())[0]).toMatchObject({ changed: 1, missing: 0 });
  });

  it('follows no link, to a folder or a file', async () => {
    const outside = await project({ 'secret.workflow.ai.yml': workflow('secret') });
    const root = await project({});
    try {
      await symlink(outside, join(root, 'linked'), 'junction');
      await symlink(join(outside, 'secret.workflow.ai.yml'), join(root, 'file.workflow.ai.yml'));
    } catch {
      return; // A system that cannot make links here has nothing to follow.
    }
    const { store } = registry([root]);
    expect((await store.scan())[0]?.found).toBe(0);
    await expect(store.add(join(root, 'linked', 'secret.workflow.ai.yml'))).rejects.toMatchObject({
      code: 'outside_roots',
    });
  });

  it('sets aside an index it cannot read, and starts again', async () => {
    const root = await project({ 'site.workflow.ai.yml': workflow('site') });
    await mkdir(join(root, '.indaba', 'registry'), { recursive: true });
    await writeFile(join(root, ...REGISTRY_INDEX.split('/')), '{"registry": 1, "entr');
    const { store } = registry([root]);
    expect(await store.list()).toEqual([]);
    const [report] = await store.scan();
    expect(report).toMatchObject({ recovered: true, added: 1 });
    expect(await readFile(join(root, '.indaba', 'registry', 'index.json.bak'), 'utf8')).toBe(
      '{"registry": 1, "entr',
    );
    expect((await store.scan())[0]?.recovered).toBe(false);
  });

  it('reports a root that is not a folder with nothing found, and writes nothing there', async () => {
    const root = await project({});
    const gone = join(root, 'gone');
    const { store } = registry([gone]);
    expect(await store.scan()).toEqual([
      {
        root: gone,
        found: 0,
        added: 0,
        changed: 0,
        moved: 0,
        missing: 0,
        invalid: 0,
        truncated: false,
        recovered: false,
      },
    ]);
    expect(await store.list()).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  });

  it('writes nothing when the scan is aborted', async () => {
    const root = await project({ 'site.workflow.ai.yml': workflow('site') });
    const { store } = registry([root]);
    const controller = new AbortController();
    controller.abort(new Error('stopped'));
    await expect(store.scan({ signal: controller.signal })).rejects.toThrow('stopped');
    expect(await readdir(root)).toEqual(['site.workflow.ai.yml']);
  });

  it('keeps an entry a limit kept the walk from, and records a parse failure that is not a validation', async () => {
    const root = await project({ 'site.workflow.ai.yml': workflow('site') });
    let fail = false;
    const { store } = registry([root], (source) => {
      if (fail) throw new TypeError('the parser broke\nsecond line');
      return parseWorkflow(source);
    });
    await store.scan();
    fail = true;
    await writeFile(join(root, 'site.workflow.ai.yml'), workflow('site', '# changed\n'));
    await store.scan();
    expect((await store.list())[0]?.validation).toEqual({ state: 'invalid', message: 'the parser broke' });
    const thrown = registry([root], () => {
      throw 'a string';
    });
    await writeFile(join(root, 'site.workflow.ai.yml'), workflow('site', '# again\n'));
    await thrown.store.scan();
    expect((await thrown.store.list())[0]?.validation).toEqual({ state: 'invalid', message: 'a string' });
    expect(new WorkflowValidationError(['x']).problems).toEqual(['x']);
  });
});

describe('the last run (AC-12)', () => {
  it('is the newest run with the workflow’s name, and none when two entries share the name', async () => {
    const root = await project({
      'site.workflow.ai.yml': workflow('site'),
      'a/twin.workflow.ai.yml': workflow('twin'),
      'b/twin.workflow.ai.yml': workflow('twin'),
    });
    await run(root, 'a'.repeat(32), 'site', '2026-10-20T10:00:00.000Z');
    await run(root, 'b'.repeat(32), 'site', '2026-10-21T10:00:00.000Z');
    await run(root, 'c'.repeat(32), 'twin', '2026-10-21T10:00:00.000Z');
    const { store } = registry([root]);
    await store.scan();
    const entries = await store.list();
    const site = entries.find((e) => e.name === 'site');
    expect(site?.lastRun).toMatchObject({ runId: 'b'.repeat(32), workflow: 'site' });
    expect(entries.filter((e) => e.name === 'twin').map((e) => e.lastRun)).toEqual([undefined, undefined]);
  });
});

describe('annotate, get, remove, add and copy (AC-09 to AC-11)', () => {
  async function scanned(files: Record<string, string>) {
    const root = await project(files);
    const { store } = registry([root]);
    await store.scan();
    return { root, store };
  }

  it('annotates by id or prefix, clears with null, hides, and cleans tags', async () => {
    const { store } = await scanned({ 'site.workflow.ai.yml': workflow('site') });
    const [entry] = await store.list();
    const id = entry?.id ?? '';
    const named = await store.annotate(id.slice(0, 15), {
      name: 'Web site\nsecond line',
      project: 'shop',
      tags: [' web ', '', 'web', 'release'],
    });
    expect(named).toMatchObject({ name: 'Web site', project: 'shop', tags: ['web', 'release'] });
    await store.annotate(id, { hidden: true });
    expect(await store.list()).toEqual([]);
    expect((await store.list({ includeHidden: true }))[0]?.hidden).toBe(true);
    const cleared = await store.annotate(id, { name: null, project: null, hidden: false, tags: [] });
    expect(cleared).toMatchObject({ name: 'site', tags: [], hidden: false });
    expect(cleared.project).not.toBe('shop');
    expect(await store.get(id.toUpperCase())).toMatchObject({ id });
    expect(await store.get('ffff')).toBeUndefined();
    expect(await store.get('')).toBeUndefined();
    await expect(store.annotate('ffff', {})).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses a prefix that names several entries, with their ids', async () => {
    const { store } = await scanned({
      'a.workflow.ai.yml': workflow('a'),
      'b.workflow.ai.yml': workflow('b'),
    });
    const error = await store.get('000000000000000').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RegistryError);
    expect(error).toMatchObject({ code: 'ambiguous', candidates: ['0000000000000001', '0000000000000002'] });
  });

  it('removes a missing entry or one added by path, and refuses one a scan would list again', async () => {
    const { root, store } = await scanned({
      'site.workflow.ai.yml': workflow('site'),
      'review.yml': workflow('review'),
    });
    const [site] = await store.list();
    await expect(store.remove(site?.id ?? '')).rejects.toMatchObject({ code: 'would_return' });
    const added = await store.add(join(root, 'review.yml'));
    expect(added).toMatchObject({ path: 'review.yml', origin: 'added', name: 'review' });
    expect(await store.add(join(root, 'review.yml'))).toMatchObject({ id: added.id });
    // A file added by path stays listed across scans.
    await store.scan();
    expect((await store.list()).map((e) => e.path)).toEqual(['review.yml', 'site.workflow.ai.yml']);
    await store.remove(added.id);
    await rm(join(root, 'site.workflow.ai.yml'));
    await store.scan();
    await store.remove(site?.id ?? '');
    expect(await store.list()).toEqual([]);
    expect(await readFile(join(root, 'review.yml'), 'utf8')).toBe(workflow('review'));
    await expect(store.remove('ffff')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('adds only a regular file inside a root', async () => {
    const { root, store } = await scanned({});
    const elsewhere = await project({ 'x.yml': workflow('x') });
    await expect(store.add(join(elsewhere, 'x.yml'))).rejects.toMatchObject({ code: 'outside_roots' });
    await expect(store.add(join(root, 'nothing.yml'))).rejects.toMatchObject({ code: 'outside_roots' });
    await mkdir(join(root, 'folder'));
    await expect(store.add(join(root, 'folder'))).rejects.toMatchObject({ code: 'not_a_workflow' });
    await writeFile(join(root, 'site.workflow.ai.yml'), workflow('site'));
    expect(await store.add(join(root, 'site.workflow.ai.yml'))).toMatchObject({ origin: 'scanned' });
  });

  it('copies the bytes as they are, never over a file, and lists what to review', async () => {
    const text = workflow(
      'site',
      '    outputs: [dist/index.html]\n    permissions:\n      fs:\n        write: ["dist/**"]\n',
    );
    const { root, store } = await scanned({ 'site.workflow.ai.yml': text });
    const [source] = await store.list();
    await mkdir(join(root, 'workflows'));
    const copy = await store.copy(source?.id ?? '', { folder: join(root, 'workflows') });
    expect(copy.entry).toMatchObject({
      path: 'workflows/site.workflow.ai.yml',
      origin: 'copied',
      copiedFrom: source?.id,
    });
    expect(await readFile(join(root, 'workflows', 'site.workflow.ai.yml'), 'utf8')).toBe(text);
    expect(copy.toReview).toEqual([
      'name: site',
      'steps[0].outputs[0]: dist/index.html',
      'steps[0].permissions.fs.write[0]: dist/**',
      'steps[0].commands[0]: make',
    ]);
    await expect(store.copy(source?.id ?? '', { folder: join(root, 'workflows') })).rejects.toMatchObject({
      code: 'exists',
    });
    const named = await store.copy(source?.id ?? '', { folder: root, name: 'site-2' });
    expect(named.entry.path).toBe('site-2.workflow.ai.yml');
    for (const name of ['../x', 'a/b', '.hidden', '']) {
      await expect(store.copy(source?.id ?? '', { folder: root, name })).rejects.toMatchObject({
        code: 'not_a_workflow',
      });
    }
    const elsewhere = await makeTempDir();
    await expect(store.copy(source?.id ?? '', { folder: elsewhere })).rejects.toMatchObject({
      code: 'outside_roots',
    });
    await expect(store.copy(source?.id ?? '', { folder: join(root, 'none') })).rejects.toMatchObject({
      code: 'outside_roots',
    });
    await mkdir(join(root, '.indaba', 'x'), { recursive: true });
    await expect(store.copy(source?.id ?? '', { folder: join(root, '.indaba', 'x') })).rejects.toMatchObject({
      code: 'outside_roots',
    });
    await rm(join(root, 'site.workflow.ai.yml'));
    await expect(store.copy(source?.id ?? '', { folder: root, name: 'site-3' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('the index file (AC-03)', () => {
  const good = {
    id: 'a'.repeat(16),
    path: 'site.workflow.ai.yml',
    origin: 'scanned',
    hash: '',
    size: 1,
    mtimeMs: 1,
    readAt: AT.toISOString(),
    workflowName: null,
    validation: { state: 'valid' },
    name: null,
    project: null,
    tags: [],
    hidden: false,
  };

  it('keeps an entry only when every field has its type, and drops a second of one id or path', async () => {
    expect(storedEntryOf(good)).toEqual(good);
    expect(storedEntryOf({ ...good, copiedFrom: 'b'.repeat(16), origin: 'copied' })).toMatchObject({
      copiedFrom: 'b'.repeat(16),
    });
    for (const bad of [
      { ...good, id: 'x' },
      { ...good, path: '../x' },
      { ...good, origin: 'magic' },
      { ...good, copiedFrom: 'x' },
      { ...good, hash: 'x' },
      { ...good, tags: [1] },
      { ...good, validation: { state: 'invalid' } },
      { ...good, validation: { state: 'missing' } },
      { ...good, validation: 'valid' },
      { ...good, hidden: 'no' },
      'entry',
    ]) {
      expect(storedEntryOf(bad), JSON.stringify(bad)).toBeUndefined();
    }
    const root = await makeTempDir();
    await writeIndex(root, []);
    await writeFile(
      join(root, ...REGISTRY_INDEX.split('/')),
      JSON.stringify({
        registry: 1,
        entries: [
          good,
          good,
          { ...good, id: 'b'.repeat(16) },
          { ...good, validation: { state: 'missing', reason: 'gone' }, id: 'c'.repeat(16), path: 'x.yml' },
        ],
      }),
    );
    expect((await readIndex(root, false)).entries.map((e) => e.id)).toEqual(['a'.repeat(16), 'c'.repeat(16)]);
    await writeFile(join(root, ...REGISTRY_INDEX.split('/')), JSON.stringify({ registry: 2, entries: [] }));
    expect(await readIndex(root, false)).toEqual({ entries: [], recovered: true });
  });

  it('accepts only a relative path with / separators that stays inside', () => {
    expect(isSafeRelative('a/b.yml')).toBe(true);
    for (const bad of ['', '/a', 'C:/a', 'a\\b', 'a//b', './a', 'a/../b']) {
      expect(isSafeRelative(bad), bad).toBe(false);
    }
  });

  it('refuses to write through a link or a file where its folder should be', async () => {
    const root = await makeTempDir();
    await writeFile(join(root, '.indaba'), 'a file');
    await expect(writeIndex(root, [])).rejects.toMatchObject({ code: 'store_failed' });
    await expect(readIndex(root, true)).rejects.toMatchObject({ code: 'store_failed' });
    const other = await makeTempDir();
    const linked = await makeTempDir();
    try {
      await symlink(other, join(linked, '.indaba'), 'junction');
    } catch {
      return;
    }
    await expect(writeIndex(linked, [])).rejects.toMatchObject({ code: 'store_failed' });
    expect(await readdir(other)).toEqual([]);
  });

  it('says the index could not be written when its folder cannot be', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) {
      return; // Permissions do not stop root, and Windows has none of these bits.
    }
    const root = await makeTempDir();
    await mkdir(join(root, '.indaba', 'registry'), { recursive: true });
    await chmod(join(root, '.indaba', 'registry'), 0o500);
    try {
      await expect(writeIndex(root, [])).rejects.toMatchObject({ code: 'store_failed' });
    } finally {
      await chmod(join(root, '.indaba', 'registry'), 0o700);
    }
  });
});

describe('helpers', () => {
  it('names a file without its suffix, and finds no places in a text that is not a workflow', () => {
    expect(fileStem('a/site.workflow.ai.yml')).toBe('site');
    expect(fileStem('review.yml')).toBe('review');
    expect(fileStem('.yml')).toBe('.yml');
    expect(placesToReview('a: [')).toEqual([]);
    expect(
      placesToReview(
        'name: x\nartifacts:\n  spec: specs/a.md\nsteps:\n  - id: a\n    input_artifacts: [a.md]\n    guards:\n      - type: g\n        paths: [src]\n    permissions:\n      fs:\n        read: [docs]\n  - plain\n',
      ),
    ).toEqual([
      'name: x',
      'artifacts.spec: specs/a.md',
      'steps[0].input_artifacts[0]: a.md',
      'steps[0].permissions.fs.read[0]: docs',
      'steps[0].guards[0].paths[0]: src',
    ]);
  });

  it('keeps a file’s time when nothing else changed', async () => {
    const root = await project({ 'site.workflow.ai.yml': workflow('site') });
    const { store, parsed } = registry([root]);
    await store.scan();
    // Same size, new time: read again, the same hash, so not counted as changed.
    await utimes(join(root, 'site.workflow.ai.yml'), new Date(0), new Date(0));
    parsed.count = 0;
    expect((await store.scan())[0]).toMatchObject({ changed: 0 });
    expect(parsed.count).toBe(1);
  });
});
