import type { RegistryEntryView, RegistryListResponse } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  annotationOf,
  copyTargets,
  detailsProblems,
  formOf,
  hiddenCount,
  refusalWords,
  rootOf,
  rowsOf,
  scanSentence,
  tagsFromText,
} from '../src/registry-model.js';
import { parseRoute } from '../src/ui/router.js';

/** specs/web-app-registry, T-11: the rules of the Workflows screen, without a screen. */

const entry = (over: Partial<RegistryEntryView> = {}): RegistryEntryView => ({
  id: '3f2a9c1d0b7e4a65',
  name: 'site',
  project: 'blog',
  tags: [],
  hidden: false,
  path: 'site.workflow.ai.yml',
  rootId: 'a1b2c3d4e5f60718',
  origin: 'scanned',
  validation: { state: 'valid' },
  removable: false,
  ...over,
});

const list = (entries: readonly RegistryEntryView[]): RegistryListResponse => ({
  entries,
  roots: [
    { id: 'a1b2c3d4e5f60718', name: 'blog', folder: '/work/blog', readable: true },
    { id: 'b2c3d4e5f6071829', name: 'shop', folder: '/work/shop', readable: true },
    { id: 'c3d4e5f607182930', name: 'gone', folder: '/work/gone', readable: false },
  ],
  truncated: false,
});

describe('the rows', () => {
  it('leaves hidden entries out unless asked, and counts them', () => {
    const l = list([entry(), entry({ id: 'b'.repeat(16), name: 'secret', hidden: true })]);
    expect(rowsOf(l, false).map((r) => r.name)).toEqual(['site']);
    expect(rowsOf(l, true).map((r) => r.name)).toEqual(['site', 'secret']);
    expect(hiddenCount(l)).toBe(1);
  });

  it('says the state with a symbol and a word, and the reason behind a problem', () => {
    const l = list([
      entry(),
      entry({ id: 'b'.repeat(16), validation: { state: 'invalid', message: 'steps must not be empty' } }),
      entry({ id: 'c'.repeat(16), validation: { state: 'missing', reason: 'the file is gone' } }),
    ]);
    const [valid, invalid, missing] = rowsOf(l, true);
    expect(valid?.state).toMatchObject({ symbol: '✓', word: 'valid' });
    expect(valid?.stateWhy).toBe('');
    expect(invalid?.state).toMatchObject({ symbol: '✗', word: 'invalid' });
    expect(invalid?.stateWhy).toBe('steps must not be empty');
    expect(missing?.state).toMatchObject({ symbol: '▲', word: 'missing' });
    expect(missing?.stateWhy).toBe('the file is gone');
    // A file that is gone opens nothing.
    expect([valid?.opens, invalid?.opens, missing?.opens]).toEqual([true, true, false]);
  });

  it('shows the last run as the Runs screen does, and nothing for a workflow that never ran', () => {
    const l = list([
      entry({
        lastRun: {
          runId: 'r1',
          startedAt: '2026-10-24T10:00:00.000Z',
          status: 'completed',
          workflow: 'site',
          cost: { usd: 0.5, unknown: 0, calls: 2 },
        },
      }),
      entry({ id: 'b'.repeat(16) }),
    ]);
    const [ran, never] = rowsOf(l, true);
    expect(ran?.lastLook).toMatchObject({ word: 'completed' });
    expect(ran?.lastCost).toEqual({ usd: 0.5, unknown: 0, calls: 2 });
    expect(ran?.lastStartedAt).toBe('2026-10-24T10:00:00.000Z');
    expect(never?.lastLook).toBeUndefined();
    expect(never?.lastCost).toBeUndefined();
  });

  it('puts the tags in one string for sorting and search, and finds the folder of an entry', () => {
    const l = list([entry({ tags: ['a', 'b'] })]);
    expect(rowsOf(l, true)[0]?.tags).toBe('a, b');
    expect(rootOf(l, entry())?.name).toBe('blog');
    expect(rootOf(l, entry({ rootId: 'f'.repeat(16) }))).toBeUndefined();
  });
});

describe('what a form changes', () => {
  it('splits tags at commas, trimmed, each once', () => {
    expect(tagsFromText(' a, b ,a,, c ')).toEqual(['a', 'b', 'c']);
    expect(tagsFromText('')).toEqual([]);
  });

  it('sends only what changed, and nothing when nothing did', () => {
    const e = entry({ tags: ['x'] });
    expect(annotationOf(e, formOf(e))).toBeUndefined();
    expect(annotationOf(e, { ...formOf(e), name: ' New ' })).toEqual({ name: 'New' });
    expect(annotationOf(e, { ...formOf(e), tags: 'x, y' })).toEqual({ tags: ['x', 'y'] });
    expect(annotationOf(e, { ...formOf(e), tags: 'x ,x' })).toBeUndefined();
    expect(annotationOf(e, { name: 'N', project: 'P', tags: '' })).toEqual({
      name: 'N',
      project: 'P',
      tags: [],
    });
  });

  it('asks for the default again when a name or a project is emptied', () => {
    const e = entry();
    expect(annotationOf(e, { ...formOf(e), name: '   ' })).toEqual({ name: null });
    expect(annotationOf(e, { ...formOf(e), project: '' })).toEqual({ project: null });
  });

  it('names what is wrong before anything is sent', () => {
    const e = entry();
    expect(detailsProblems(formOf(e))).toEqual([]);
    expect(detailsProblems({ ...formOf(e), name: 'n'.repeat(121) })).toEqual([
      'The name is longer than 120 characters.',
    ]);
    expect(detailsProblems({ ...formOf(e), project: 'p'.repeat(121) })).toEqual([
      'The project is longer than 120 characters.',
    ]);
    expect(
      detailsProblems({ ...formOf(e), tags: Array.from({ length: 21 }, (_, i) => `t${i}`).join(',') }),
    ).toEqual(['There can be at most 20 tags.']);
    expect(detailsProblems({ ...formOf(e), tags: 't'.repeat(41) })).toEqual([
      'A tag can have at most 40 characters.',
    ]);
  });

  it('offers only folders that can be read as copy targets', () => {
    expect(copyTargets(list([])).map((r) => r.name)).toEqual(['blog', 'shop']);
  });
});

describe('the words', () => {
  it('reports a scan in plain words, with what stopped it', () => {
    const report = {
      rootId: 'a1b2c3d4e5f60718',
      found: 3,
      added: 1,
      changed: 0,
      moved: 0,
      missing: 2,
      invalid: 0,
      truncated: false,
      recovered: false,
    };
    expect(scanSentence([report])).toBe('Found 3 workflow files, 1 new, 2 missing.');
    expect(scanSentence([{ ...report, found: 1, added: 0, missing: 0 }])).toBe('Found 1 workflow file.');
    expect(
      scanSentence([
        report,
        {
          ...report,
          rootId: 'b'.repeat(16),
          found: 2,
          added: 0,
          missing: 0,
          truncated: true,
          recovered: true,
        },
      ]),
    ).toBe(
      'Found 5 workflow files, 1 new, 2 missing. A limit stopped the scan, so some files may be missing. The saved list could not be read, so it was set aside and started again.',
    );
  });

  it('words every refusal the server gives, and a general one for a code it does not know', () => {
    for (const code of [
      'not_found',
      'exists',
      'outside_roots',
      'would_return',
      'not_a_workflow',
      'not_a_folder',
      'store_failed',
      'invalid_request',
    ]) {
      const words = refusalWords(code);
      expect(words.message, code).not.toBe(refusalWords('made_up').message);
      expect(words.next.length, code).toBeGreaterThan(0);
      expect(`${words.message} ${words.next}`, code).not.toMatch(/\b[45]\d\d\b/);
    }
    expect(refusalWords('made_up').message).toBe('The server did not do that.');
  });
});

describe('the address of the screen', () => {
  it('reads Show hidden from the address, and only the exact value', () => {
    expect(parseRoute('/workflows', '')).toEqual({ name: 'workflows', showHidden: false });
    expect(parseRoute('/workflows', '?hidden=1')).toEqual({ name: 'workflows', showHidden: true });
    expect(parseRoute('/workflows', '?hidden=yes')).toEqual({ name: 'workflows', showHidden: false });
    expect(parseRoute('/workflows/3f2a9c1d0b7e4a65', '')).toEqual({
      name: 'workflow',
      workflowId: '3f2a9c1d0b7e4a65',
    });
  });
});
