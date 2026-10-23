import { readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkflowValidationError } from '@indaba/core';
import { parseWorkflow, WorkflowParser } from '@indaba/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contentHash } from '../src/run-control/confirm.js';
import { workflowId } from '../src/run-control/scan.js';
import { createWorkflowStore, SAVE_SUFFIX } from '../src/run-control/source.js';
import { makeTempDir } from './support.js';

/**
 * specs/web-app-editing-core, AC-05: what a save does when the disk changes under it, at the moments a test cannot reach
 * through the store itself: after the temporary file is written and before it is renamed over the target, and when the
 * rename fails. The file system is the real one; these hooks run inside it at those moments.
 */

const hooks: { afterChmod: (() => Promise<void>) | undefined; failRename: boolean } = {
  afterChmod: undefined,
  failRename: false,
};

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    chmod: async (...args: Parameters<typeof real.chmod>) => {
      await real.chmod(...args);
      // The save chmods its temporary file right after writing it: the moment before its last check.
      if (String(args[0]).endsWith(SAVE_SUFFIX) && hooks.afterChmod !== undefined) {
        const hook = hooks.afterChmod;
        hooks.afterChmod = undefined;
        await hook();
      }
    },
    rename: async (...args: Parameters<typeof real.rename>) => {
      if (hooks.failRename === true) {
        throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' });
      }
      return real.rename(...args);
    },
  };
});

const WORKFLOW = 'version: "1.0"\nname: demo\nsteps:\n  - id: a\n    runner: shell\n    commands: [x]\n';
const MINE = WORKFLOW.replace('name: demo', 'name: mine');
const THEIRS = WORKFLOW.replace('name: demo', 'name: theirs');
const FILE = 'demo.workflow.ai.yml';
const ID = workflowId(0, FILE);

beforeEach(() => {
  hooks.afterChmod = undefined;
  hooks.failRename = false;
});

async function project(parse = parseWorkflow) {
  const root = await makeTempDir();
  await writeFile(join(root, FILE), WORKFLOW);
  const store = createWorkflowStore({
    roots: [root],
    parse,
    diagnose: (text) => new WorkflowParser().diagnose(text),
    pid: 7,
  });
  const leftovers = async () => (await readdir(root)).filter((n) => n.endsWith(SAVE_SUFFIX));
  return { root, store, file: join(root, FILE), leftovers };
}

describe('a save when the disk changes under it', () => {
  it('does not overwrite a change made after its first check, and hands back that version', async () => {
    const { store, file, leftovers } = await project();
    const { contentHash: base } = await store.read(ID);
    hooks.afterChmod = () => writeFile(file, THEIRS);
    await expect(store.save(ID, { text: MINE, baseHash: base })).rejects.toMatchObject({
      code: 'changed_on_disk',
      detail: { current: { text: THEIRS, contentHash: contentHash(Buffer.from(THEIRS)) } },
    });
    expect(await readFile(file, 'utf8')).toBe(THEIRS);
    expect(await leftovers()).toEqual([]);
  });

  it('writes nothing through a target that became a link after its first check', async () => {
    const { store, file, leftovers } = await project();
    const outside = join(await makeTempDir(), 'outside.workflow.ai.yml');
    await writeFile(outside, WORKFLOW);
    const { contentHash: base } = await store.read(ID);
    hooks.afterChmod = async () => {
      await rm(file);
      await symlink(outside, file);
    };
    await expect(store.save(ID, { text: MINE, baseHash: base })).rejects.toMatchObject({
      code: 'workflow_not_found',
    });
    expect(await readFile(outside, 'utf8')).toBe(WORKFLOW);
    expect(await leftovers()).toEqual([]);
  });

  it('keeps the original and leaves no temporary file when the rename fails', async () => {
    const { store, file, leftovers } = await project();
    const { contentHash: base } = await store.read(ID);
    hooks.failRename = true;
    await expect(store.save(ID, { text: MINE, baseHash: base })).rejects.toMatchObject({ code: 'not_saved' });
    expect(await readFile(file, 'utf8')).toBe(WORKFLOW);
    expect(await leftovers()).toEqual([]);
  });

  it('says not_text when the version on disk it would hand back is not UTF-8', async () => {
    const { store, file } = await project();
    const { contentHash: base } = await store.read(ID);
    await writeFile(file, Buffer.from([0x6e, 0x61, 0x6d, 0x65, 0x3a, 0x20, 0xff, 0x0a]));
    await expect(store.save(ID, { text: MINE, baseHash: base })).rejects.toMatchObject({ code: 'not_text' });
  });

  it('reports a parser that fails for another reason as a problem, not a crash', async () => {
    const { store } = await project(() => {
      throw new Error('the parser broke');
    });
    expect(store.check('anything')).toEqual({ problems: [{ message: 'the parser broke' }] });
    const { problems } = await store.read(ID);
    expect(problems).toEqual([{ message: 'the parser broke' }]);
    expect(() => {
      throw new WorkflowValidationError(['x']);
    }).toThrow();
  });
});
