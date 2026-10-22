import { chmod, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger, type LogRecord } from '@indaba/core';
import { parseWorkflow } from '@indaba/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RunChild, RunStarter } from '../src/run-child.js';
import { contentHash } from '../src/run-control/confirm.js';
import { createRunControl } from '../src/run-control/index.js';
import { MAX_WORKFLOW_BYTES, workflowId } from '../src/run-control/scan.js';
import { createWorkflowStore, SAVE_SUFFIX } from '../src/run-control/source.js';
import { makeTempDir } from './support.js';

/** specs/web-app-editing-core, T-05 and T-06: the workflow store over real files. */

const WORKFLOW = `version: "1.0"
name: demo
steps:
  - id: build
    runner: shell
    commands:
      - node -e "process.exit(0)"
`;
const CHANGED = WORKFLOW.replace('name: demo', 'name: changed');
const PID = 4242;
const FILE = 'demo.workflow.ai.yml';
const ID = workflowId(0, FILE);
const posixWithRights = process.platform !== 'win32' && process.getuid?.() !== 0;

let logged: LogRecord[];

beforeEach(() => {
  logged = [];
});

async function project(text: string | Buffer = WORKFLOW) {
  const root = await makeTempDir();
  await writeFile(join(root, FILE), text);
  const store = createWorkflowStore({
    roots: [root],
    parse: parseWorkflow,
    pid: PID,
    logger: createLogger({
      sinks: [{ write: (record) => logged.push(record) }],
      clock: () => new Date('2026-10-22T12:00:00.000Z'),
      level: 'debug',
    }),
  });
  return { root, store, file: join(root, FILE) };
}

const leftovers = async (root: string) => (await readdir(root)).filter((n) => n.endsWith(SAVE_SUFFIX));

describe('reading (AC-01)', () => {
  it('answers the text, its hash and its problems', async () => {
    const { store } = await project();
    const answer = await store.read(ID);
    expect(answer.text).toBe(WORKFLOW);
    expect(answer.contentHash).toBe(contentHash(Buffer.from(WORKFLOW)));
    expect(answer.problems).toEqual([]);
    expect(answer.workflow).toMatchObject({ id: ID, name: 'demo', path: FILE, valid: true, problems: [] });
  });

  it('gives a YAML syntax problem its line and column, and a structural one none', async () => {
    const { store } = await project('version: "1.0"\nname: x\nsteps:\n  - id: a\n   bad: [\n');
    const { problems, workflow } = await store.read(ID);
    expect(problems[0]).toMatchObject({ line: expect.any(Number), column: expect.any(Number) });
    expect(problems[0]?.message).toMatch(/^invalid YAML/);
    expect(workflow).toMatchObject({ valid: false, name: 'demo' });
    const structural = store.check('version: "1.0"\nname: x\nsteps:\n  - id: a\n');
    expect(structural.problems.length).toBeGreaterThan(0);
    expect(structural.problems.every((p) => p.line === undefined && p.column === undefined)).toBe(true);
  });

  it('refuses an id the scan does not list, a file over the limit, and bytes that are not UTF-8', async () => {
    const { store, file } = await project();
    await expect(store.read('f'.repeat(32))).rejects.toMatchObject({
      name: 'WorkflowStoreError',
      code: 'workflow_not_found',
    });
    await writeFile(file, Buffer.from([0x76, 0xff, 0xfe, 0x0a]));
    await expect(store.read(ID)).rejects.toMatchObject({ code: 'not_text' });
    await writeFile(file, 'x'.repeat(MAX_WORKFLOW_BYTES + 1));
    await expect(store.read(ID)).rejects.toMatchObject({ code: 'too_large' });
  });

  it('keeps a byte-order mark, so a file round-trips byte for byte', async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(WORKFLOW)]);
    const { store, file } = await project(bytes);
    const { text, contentHash: hash } = await store.read(ID);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    await store.save(ID, { text: text.replace('name: demo', 'name: edited'), baseHash: hash });
    expect((await readFile(file)).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });
});

describe('checking (AC-02)', () => {
  it('reads no file and writes nothing', async () => {
    const { store, root } = await project();
    expect(store.check(WORKFLOW)).toEqual({ problems: [] });
    expect(store.check('[').problems[0]?.message).toMatch(/invalid YAML/);
    expect(await readdir(root)).toEqual([FILE]);
  });
});

describe('saving (AC-03 to AC-06)', () => {
  it('replaces the file, answers the new hash and its problems, and leaves no temporary file', async () => {
    const { store, root, file } = await project();
    const { contentHash: base } = await store.read(ID);
    const saved = await store.save(ID, { text: CHANGED, baseHash: base });
    expect(saved).toEqual({ contentHash: contentHash(Buffer.from(CHANGED)), problems: [] });
    expect(await readFile(file, 'utf8')).toBe(CHANGED);
    expect(await leftovers(root)).toEqual([]);
    expect(logged.find((r) => r.message === 'workflow saved')?.fields).toEqual({
      workflow: FILE,
      contentHash: saved.contentHash,
      problems: 0,
    });
    expect(JSON.stringify(logged)).not.toContain('name: changed');
  });

  it('saves a draft that has problems, and says what they are (C-01)', async () => {
    const { store, file } = await project();
    const { contentHash: base } = await store.read(ID);
    const saved = await store.save(ID, { text: 'steps: [', baseHash: base });
    expect(saved.problems[0]?.message).toMatch(/invalid YAML/);
    expect(await readFile(file, 'utf8')).toBe('steps: [');
  });

  it('never overwrites a file changed on disk since it was read, and hands back that version (AC-04)', async () => {
    const { store, file } = await project();
    const { contentHash: base } = await store.read(ID);
    await writeFile(file, CHANGED);
    await expect(store.save(ID, { text: 'mine', baseHash: base })).rejects.toMatchObject({
      code: 'changed_on_disk',
      detail: { current: { text: CHANGED, contentHash: contentHash(Buffer.from(CHANGED)) } },
    });
    expect(await readFile(file, 'utf8')).toBe(CHANGED);
    // Keeping one's own version is a save against the disk's hash.
    await store.save(ID, { text: 'mine', baseHash: contentHash(Buffer.from(CHANGED)) });
    expect(await readFile(file, 'utf8')).toBe('mine');
  });

  it('writes nothing for the same bytes', async () => {
    const { store, root } = await project();
    const { contentHash: base } = await store.read(ID);
    expect(await store.save(ID, { text: WORKFLOW, baseHash: base })).toEqual({
      contentHash: base,
      problems: [],
    });
    expect(logged.some((r) => r.message === 'workflow saved')).toBe(false);
    expect(await leftovers(root)).toEqual([]);
  });

  it('refuses a text over the limit, and an id the scan does not list', async () => {
    const { store } = await project();
    const { contentHash: base } = await store.read(ID);
    await expect(
      store.save(ID, { text: 'x'.repeat(MAX_WORKFLOW_BYTES + 1), baseHash: base }),
    ).rejects.toMatchObject({
      code: 'too_large',
    });
    await expect(store.save('f'.repeat(32), { text: 'x', baseHash: base })).rejects.toMatchObject({
      code: 'workflow_not_found',
    });
  });

  it('follows no link planted at the temporary name, and leaves both files as they were (AC-05)', async () => {
    const { store, file } = await project();
    const outside = join(await makeTempDir(), 'outside.txt');
    await writeFile(outside, 'untouched');
    const { contentHash: base } = await store.read(ID);
    await symlink(outside, `${file}.${PID}.1${SAVE_SUFFIX}`);
    await expect(store.save(ID, { text: CHANGED, baseHash: base })).rejects.toMatchObject({
      code: 'not_saved',
    });
    expect(await readFile(outside, 'utf8')).toBe('untouched');
    expect(await readFile(file, 'utf8')).toBe(WORKFLOW);
  });

  it('writes nothing through a target that became a link after it was read', async () => {
    const { store, file } = await project();
    const outside = join(await makeTempDir(), 'outside.workflow.ai.yml');
    await writeFile(outside, WORKFLOW);
    const { contentHash: base } = await store.read(ID);
    await rm(file);
    await symlink(outside, file);
    await expect(store.save(ID, { text: CHANGED, baseHash: base })).rejects.toMatchObject({
      code: 'workflow_not_found',
    });
    expect(await readFile(outside, 'utf8')).toBe(WORKFLOW);
  });

  it.skipIf(!posixWithRights)('keeps the file as it was when its folder cannot be written', async () => {
    const { store, root, file } = await project();
    const { contentHash: base } = await store.read(ID);
    await chmod(root, 0o500);
    try {
      await expect(store.save(ID, { text: CHANGED, baseHash: base })).rejects.toMatchObject({
        code: 'not_saved',
      });
    } finally {
      await chmod(root, 0o700);
    }
    expect(await readFile(file, 'utf8')).toBe(WORKFLOW);
    expect(await leftovers(root)).toEqual([]);
    expect(logged.find((r) => r.message === 'a workflow could not be saved')?.fields?.workflow).toBe(FILE);
  });

  it.skipIf(process.platform === 'win32')('keeps the file’s permission bits', async () => {
    const { store, file } = await project();
    await chmod(file, 0o640);
    const { contentHash: base } = await store.read(ID);
    await store.save(ID, { text: CHANGED, baseHash: base });
    expect((await stat(file)).mode & 0o777).toBe(0o640);
  });

  it('saves the default workflow under .indaba/ too, the one file the scan lists there', async () => {
    const root = await makeTempDir();
    await mkdir(join(root, '.indaba'), { recursive: true });
    await writeFile(join(root, '.indaba', 'workflow.ai.yml'), WORKFLOW);
    const store = createWorkflowStore({ roots: [root], parse: parseWorkflow, pid: PID });
    const id = workflowId(0, '.indaba/workflow.ai.yml');
    const { contentHash: base } = await store.read(id);
    await store.save(id, { text: CHANGED, baseHash: base });
    expect(await readFile(join(root, '.indaba', 'workflow.ai.yml'), 'utf8')).toBe(CHANGED);
  });
});

describe('a save invalidates the confirmation (T-06, AC-07)', () => {
  it('asks again before the next run of the saved content', async () => {
    const { root, store } = await project();
    const children: string[][] = [];
    const starter: RunStarter = (args): RunChild => {
      children.push([...args]);
      return {
        exited: new Promise<number>(() => undefined),
        stderr: () => '',
        cancel: () => undefined,
        kill: () => undefined,
        release: () => undefined,
      };
    };
    let n = 0;
    const control = createRunControl({
      roots: [root],
      starter,
      environment: {},
      confirmationFile: join(await makeTempDir(), 'indaba', 'confirmed-workflows.json'),
      pid: PID,
      ids: () => {
        n += 1;
        return n.toString(16).padStart(24, '0');
      },
      parse: parseWorkflow,
    });
    const asked = await control.start({ workflowId: ID }).catch((e: unknown) => e);
    const first = (asked as { detail?: { contentHash?: string } }).detail?.contentHash ?? '';
    await control.start({ workflowId: ID, confirmedHash: first });
    // Confirmed: the same content starts without asking.
    await control.start({ workflowId: ID });
    expect(children).toHaveLength(2);

    await store.save(ID, { text: CHANGED, baseHash: first });
    const again = await control.start({ workflowId: ID }).catch((e: unknown) => e);
    expect(again).toMatchObject({ code: 'confirmation_required', detail: { use: expect.anything() } });
    expect((again as { detail?: { contentHash?: string } }).detail?.contentHash).toBe(
      contentHash(Buffer.from(CHANGED)),
    );
    expect(children).toHaveLength(2);
    await control.stopAll().catch(() => undefined);
  });
});
