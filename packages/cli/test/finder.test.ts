import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkflowRegistry } from '@indaba/core';
import { FileWorkflowRegistry, parseWorkflow, WorkflowParser } from '@indaba/engine';
import { describe, expect, it } from 'vitest';
import type { RunStarter } from '../src/run-child.js';
import { createWorkflowFinder, RESCAN_INTERVAL_MS, scanFinder } from '../src/run-control/finder.js';
import { createRunControl } from '../src/run-control/index.js';
import { createWorkflowStore } from '../src/run-control/source.js';
import { makeTempDir } from './support.js';

/** specs/workflow-registry, T-12 and T-13: `indaba ui` finds workflows through the registry. */

const workflow = (name: string): string =>
  `version: "1.0"\nname: ${name}\nsteps:\n  - id: a\n    runner: shell\n    commands: [make]\n`;

async function setup(files: Record<string, string>) {
  const root = await makeTempDir();
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...path.split('/')), text);
  }
  let now = Date.parse('2026-10-23T12:00:00.000Z');
  let n = 0;
  const registry = new FileWorkflowRegistry({
    roots: [root],
    parse: parseWorkflow,
    clock: () => new Date(now),
    ids: () => {
      n += 1;
      return n.toString(16).padStart(16, '0');
    },
  });
  let scans = 0;
  const counted: WorkflowRegistry = {
    roots: () => registry.roots(),
    list: (o) => registry.list(o),
    get: (id) => registry.get(id),
    scan: (o) => {
      scans += 1;
      return registry.scan(o);
    },
    add: (f) => registry.add(f),
    annotate: (id, a) => registry.annotate(id, a),
    remove: (id) => registry.remove(id),
    copy: (id, to) => registry.copy(id, to),
  };
  const finder = createWorkflowFinder({ registry: counted, clock: () => new Date(now) });
  return {
    root,
    registry,
    finder,
    scans: () => scans,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('the registry finder (AC-14)', () => {
  it('scans on the first list, and again only when the last scan is 30 seconds old', async () => {
    const { finder, scans, advance, root } = await setup({ 'site.workflow.ai.yml': workflow('site') });
    const first = await finder.list();
    expect(first.found.map((f) => [f.id, f.path, f.root])).toEqual([
      ['0000000000000001', 'site.workflow.ai.yml', root],
    ]);
    expect(first.truncated).toBe(false);
    expect(scans()).toBe(1);
    await writeFile(join(root, 'new.workflow.ai.yml'), workflow('new'));
    advance(RESCAN_INTERVAL_MS - 1);
    expect((await finder.list()).found).toHaveLength(1);
    expect(scans()).toBe(1);
    advance(1);
    expect((await finder.list()).found).toHaveLength(2);
    expect(scans()).toBe(2);
  });

  it('shares one scan between two callers at once', async () => {
    const { finder, scans } = await setup({ 'site.workflow.ai.yml': workflow('site') });
    await Promise.all([finder.list(), finder.list()]);
    expect(scans()).toBe(1);
  });

  it('finds an id exactly, never by a prefix, and not a missing file', async () => {
    const { finder, root, advance } = await setup({
      'site.workflow.ai.yml': workflow('site'),
      'gone.workflow.ai.yml': workflow('gone'),
    });
    await finder.list();
    expect(await finder.find('0000000000000002')).toMatchObject({ path: 'site.workflow.ai.yml' });
    expect(await finder.find('000000000000000')).toBeUndefined();
    await rm(join(root, 'gone.workflow.ai.yml'));
    advance(RESCAN_INTERVAL_MS);
    expect((await finder.list()).found.map((f) => f.path)).toEqual(['site.workflow.ai.yml']);
    expect(await finder.find('0000000000000001')).toBeUndefined();
  });

  it('scans once more for an id it does not know, when the last scan is a second old', async () => {
    const { finder, root, scans, advance } = await setup({});
    await finder.list();
    await writeFile(join(root, 'late.workflow.ai.yml'), workflow('late'));
    expect(await finder.find('0000000000000001')).toBeUndefined();
    expect(scans()).toBe(1);
    advance(1000);
    expect(await finder.find('0000000000000001')).toMatchObject({ path: 'late.workflow.ai.yml' });
    expect(scans()).toBe(2);
  });

  it('keeps step 2’s scan and ids without a registry (C-13)', async () => {
    const { root } = await setup({ 'site.workflow.ai.yml': workflow('site') });
    const finder = scanFinder([root]);
    const { found } = await finder.list();
    expect(found[0]?.id).toMatch(/^[0-9a-f]{32}$/);
    expect(await finder.find(found[0]?.id ?? '')).toMatchObject({ path: 'site.workflow.ai.yml' });
    expect(await finder.find('x')).toBeUndefined();
  });
});

describe('the run control and the store on the registry (AC-14, AC-15)', () => {
  const starter: RunStarter = () => {
    throw new Error('nothing starts in this test');
  };

  it('lists by registry id with the person’s name, project, tags and hidden flag, and starts by that id', async () => {
    const { finder, registry, root } = await setup({ 'site.workflow.ai.yml': workflow('site') });
    await finder.list();
    await registry.annotate('0000000000000001', {
      name: 'Web',
      project: 'shop',
      tags: ['web'],
      hidden: true,
    });
    const config = await makeTempDir();
    const control = createRunControl({
      roots: [root],
      finder,
      starter,
      environment: {},
      confirmationFile: join(config, 'confirmed.json'),
      pid: 1,
      ids: () => '0'.repeat(24),
      parse: parseWorkflow,
    });
    const list = await control.list();
    expect(list.workflows).toEqual([
      {
        id: '0000000000000001',
        name: 'Web',
        path: 'site.workflow.ai.yml',
        project: 'shop',
        tags: ['web'],
        hidden: true,
        valid: true,
        problems: [],
      },
    ]);
    await expect(control.start({ workflowId: '0000000000000001' })).rejects.toMatchObject({
      code: 'confirmation_required',
    });
    await expect(control.start({ workflowId: 'ffffffffffffffff' })).rejects.toMatchObject({
      code: 'workflow_not_found',
    });
    await control.stopAll();
  });

  it('reads and saves a source by registry id', async () => {
    const { finder, registry, root } = await setup({ 'site.workflow.ai.yml': workflow('site') });
    await finder.list();
    await registry.annotate('0000000000000001', { name: 'Web' });
    const store = createWorkflowStore({
      roots: [root],
      finder,
      parse: parseWorkflow,
      diagnose: (text: string) => new WorkflowParser().diagnose(text),
      pid: 1,
    });
    const source = await store.read('0000000000000001');
    expect(source.workflow).toMatchObject({
      id: '0000000000000001',
      name: 'Web',
      path: 'site.workflow.ai.yml',
    });
    const saved = await store.save('0000000000000001', {
      text: workflow('renamed'),
      baseHash: source.contentHash,
    });
    expect(saved.problems).toEqual([]);
    await expect(store.read('0000000000000009')).rejects.toMatchObject({ code: 'workflow_not_found' });
  });
});
