// @vitest-environment happy-dom
import type {
  RegistryAddRootResponse,
  RegistryAnnotateRequest,
  RegistryCopyRequest,
  RegistryEntryView,
  RegistryListResponse,
  RegistryResolveRootResponse,
  RegistryRootView,
} from '@indaba/core';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure, type Client, type RegistryAnswer } from '../src/client.js';
import { App } from '../src/ui/App.js';
import { WorkflowsScreen } from '../src/ui/WorkflowsScreen.js';
import { T } from './fixtures.js';

afterEach(cleanup);

/** specs/web-app-registry, T-09 to T-11: the Workflows screen and its dialogs, over a fake client. */

const NOW = Date.parse(T(30));
const clock = { now: () => NOW, timeZone: 'UTC' };

const BLOG = 'a1b2c3d4e5f60718';
const SHOP = 'b2c3d4e5f6071829';
const roots: RegistryRootView[] = [
  { id: BLOG, name: 'blog', folder: '/work/blog', readable: true },
  { id: SHOP, name: 'shop', folder: '/work/shop', readable: true },
];

const entry = (over: Partial<RegistryEntryView> = {}): RegistryEntryView => ({
  id: '1'.repeat(16),
  name: 'site',
  project: 'blog',
  tags: [],
  hidden: false,
  path: 'site.workflow.ai.yml',
  rootId: BLOG,
  origin: 'scanned',
  validation: { state: 'valid' },
  removable: false,
  ...over,
});

const SITE = entry();
const DOCS = entry({
  id: '2'.repeat(16),
  name: 'docs',
  project: 'shop',
  path: 'docs.workflow.ai.yml',
  rootId: SHOP,
  tags: ['weekly'],
  lastRun: {
    runId: 'r1',
    startedAt: T(20),
    status: 'completed',
    workflow: 'docs',
    cost: { usd: 0.5, unknown: 0, calls: 2 },
  },
});
const SECRET = entry({ id: '3'.repeat(16), name: 'secret', path: 'secret.workflow.ai.yml', hidden: true });
const GONE = entry({
  id: '4'.repeat(16),
  name: 'gone',
  path: 'gone.workflow.ai.yml',
  validation: { state: 'missing', reason: 'the file is gone' },
  removable: true,
});
const ODD = entry({ id: '5'.repeat(16), name: 'odd', path: 'odd.yml', origin: 'added', removable: true });

interface Calls {
  annotate: { id: string; request: RegistryAnnotateRequest }[];
  copy: { id: string; request: RegistryCopyRequest }[];
  remove: string[];
  resolve: string[];
  add: string[];
  scans: number;
  lists: number;
}

interface Fake extends Client {
  readonly calls: Calls;
  /** What the next call of that name answers instead of its normal result. */
  readonly next: Partial<
    Record<'annotate' | 'copy' | 'remove' | 'resolve' | 'add' | 'scan', RegistryAnswer<never>>
  >;
  entries: RegistryEntryView[];
  failList?: ApiFailure;
}

function fake(initial: readonly RegistryEntryView[], options: { unavailable?: boolean } = {}): Fake {
  const never = (): never => {
    throw new Error('not in this test');
  };
  const calls: Calls = { annotate: [], copy: [], remove: [], resolve: [], add: [], scans: 0, lists: 0 };
  const client: Fake = {
    calls,
    next: {},
    entries: [...initial],
    contract: async () => ({ contractVersion: '1.6.0' }),
    runs: async () => [],
    run: never,
    followRun: never,
    followServer: (handlers, signal) => {
      handlers.onState('live');
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve()));
    },
    stepLog: never,
    discussion: never,
    workflows: async () => undefined,
    startRun: never,
    startStatus: never,
    stopRun: never,
    workflowSource: never,
    saveWorkflowSource: never,
    checkWorkflow: async () => undefined,
    editor: never,
    editWorkflow: never,
    loggingSettings: never,
    checkLoggingSettings: never,
    saveLoggingSettings: never,
    testLogSink: never,
    async registry(): Promise<RegistryListResponse | undefined> {
      calls.lists += 1;
      if (client.failList !== undefined) {
        throw client.failList;
      }
      return options.unavailable === true ? undefined : { entries: client.entries, roots, truncated: false };
    },
    async scanRegistry() {
      calls.scans += 1;
      return (
        client.next.scan ?? {
          kind: 'ok',
          value: {
            reports: [
              {
                rootId: BLOG,
                found: 4,
                added: 1,
                changed: 0,
                moved: 0,
                missing: 0,
                invalid: 0,
                truncated: false,
                recovered: false,
              },
            ],
          },
        }
      );
    },
    async annotateEntry(id, request) {
      calls.annotate.push({ id, request });
      if (client.next.annotate !== undefined) {
        return client.next.annotate;
      }
      const found = client.entries.find((e) => e.id === id);
      if (found === undefined) {
        return { kind: 'refused', code: 'not_found' };
      }
      const changed: RegistryEntryView = {
        ...found,
        ...(typeof request.name === 'string' ? { name: request.name } : {}),
        ...(request.tags === undefined ? {} : { tags: request.tags }),
        ...(request.hidden === undefined ? {} : { hidden: request.hidden }),
      };
      client.entries = client.entries.map((e) => (e.id === id ? changed : e));
      return { kind: 'ok', value: changed };
    },
    async copyEntry(id, request) {
      calls.copy.push({ id, request });
      if (client.next.copy !== undefined) {
        return client.next.copy;
      }
      const copy = entry({
        id: '9'.repeat(16),
        name: 'site',
        path: `${request.name ?? 'site'}.workflow.ai.yml`,
        rootId: request.rootId,
        origin: 'copied',
        copiedFrom: id,
      });
      client.entries = [...client.entries, copy];
      return { kind: 'ok', value: { entry: copy, toReview: ['name: site', 'steps[0].commands: make'] } };
    },
    async removeEntry(id) {
      calls.remove.push(id);
      if (client.next.remove !== undefined) {
        return client.next.remove;
      }
      client.entries = client.entries.filter((e) => e.id !== id);
      return { kind: 'ok', value: null };
    },
    async resolveFolder(path) {
      calls.resolve.push(path);
      if (client.next.resolve !== undefined) {
        return client.next.resolve;
      }
      const value: RegistryResolveRootResponse = {
        folder: '/work/other',
        name: 'other',
        alreadyCovered: false,
        found: 3,
        atLeast: false,
      };
      return { kind: 'ok', value };
    },
    async addFolder(folder) {
      calls.add.push(folder);
      if (client.next.add !== undefined) {
        return client.next.add;
      }
      const value: RegistryAddRootResponse = {
        root: { id: 'c'.repeat(16), name: 'other', folder, readable: true },
        alreadyCovered: false,
        report: {
          rootId: 'c'.repeat(16),
          found: 3,
          added: 3,
          changed: 0,
          moved: 0,
          missing: 0,
          invalid: 0,
          truncated: false,
          recovered: false,
        },
      };
      return { kind: 'ok', value };
    },
  };
  return client;
}

function screenFor(
  client: Client,
  over: { showHidden?: boolean; canOpen?: boolean; navigate?: () => void } = {},
) {
  const navigate = over.navigate ?? vi.fn();
  const failures: unknown[] = [];
  const view = render(
    h(WorkflowsScreen, {
      client,
      clock,
      navigate,
      onFatal: (failure) => failures.push(failure),
      showHidden: over.showHidden ?? false,
      canOpen: over.canOpen ?? true,
    }),
  );
  return { navigate, failures, view };
}

const rowOf = (name: string): HTMLElement => {
  const row = screen.getAllByRole('row').find((r) => within(r).queryByText(name) !== null);
  if (row === undefined) {
    throw new Error(`no row for ${name}`);
  }
  return row;
};
const select = async (name: string): Promise<void> => {
  fireEvent.click(within(rowOf(name)).getByRole('checkbox'));
  await screen.findByText(`Selected: ${name}`);
};
const ready = async (): Promise<void> => {
  await screen.findByRole('grid', { name: 'Workflows in your folders' });
};

describe('the list', () => {
  it('shows every workflow with its project, last result, cost and state, and the folders it looks in', async () => {
    screenFor(fake([SITE, DOCS, GONE]));
    await ready();
    expect(screen.getByText('Looking in: blog, shop.')).toBeDefined();
    const docs = rowOf('docs');
    expect(within(docs).getByText('shop')).toBeDefined();
    expect(within(docs).getByText('weekly')).toBeDefined();
    expect(within(docs).getByText(/completed/)).toBeDefined();
    expect(within(docs).getByText('$0.50')).toBeDefined();
    expect(within(docs).getByText(/valid/)).toBeDefined();
    const site = rowOf('site');
    expect(within(site).getByText('never run')).toBeDefined();
    expect(within(rowOf('gone')).getByText(/missing/)).toBeDefined();
  });

  it('opens a workflow from its name, but not one whose file is gone', async () => {
    const { navigate } = screenFor(fake([SITE, GONE]));
    await ready();
    fireEvent.click(within(rowOf('site')).getByRole('link', { name: 'site' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'workflow', workflowId: SITE.id });
    expect(within(rowOf('gone')).queryByRole('link')).toBeNull();
  });

  it('offers no link when the server does not open workflow files', async () => {
    screenFor(fake([SITE]), { canOpen: false });
    await ready();
    expect(within(rowOf('site')).queryByRole('link')).toBeNull();
  });

  it('leaves hidden entries out and counts them; Show hidden is a change of address', async () => {
    const { navigate } = screenFor(fake([SITE, SECRET]));
    await ready();
    expect(screen.queryByText('secret')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show hidden (1)' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'workflows', showHidden: true }, { replace: true });
  });

  it('shows hidden entries, marked, when the address asks for them', async () => {
    screenFor(fake([SITE, SECRET]), { showHidden: true });
    await ready();
    expect(within(rowOf('secret')).getByText('(hidden)')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Show hidden (1)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('says so when there is nothing, and when the server has no list', async () => {
    screenFor(fake([]));
    expect(await screen.findByText('No workflow found yet.')).toBeDefined();
    cleanup();
    screenFor(fake([], { unavailable: true }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'This server does not offer the list of workflows.',
    );
  });

  it('asks for the list again when the window gains focus', async () => {
    const client = fake([SITE]);
    screenFor(client);
    await ready();
    const before = client.calls.lists;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(client.calls.lists).toBeGreaterThan(before));
  });

  it('passes a failure that retrying cannot fix on', async () => {
    const client = fake([SITE]);
    client.failList = new ApiFailure({ kind: 'unauthorized' });
    const { failures } = screenFor(client);
    await waitFor(() => expect(failures).toEqual([{ kind: 'unauthorized' }]));
  });
});

describe('acting on one workflow', () => {
  it('offers the actions only for a selected workflow, and names it', async () => {
    screenFor(fake([SITE, DOCS]));
    await ready();
    expect(screen.getByText('Select a workflow to act on it.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull();
    await select('docs');
    for (const name of ['Edit details', 'Hide', 'Copy to another project', 'Remove from the list']) {
      expect(screen.getByRole('button', { name })).toBeDefined();
    }
  });

  it('hides and shows with one press, announcing it', async () => {
    const client = fake([SITE]);
    screenFor(client);
    await ready();
    await select('site');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(client.calls.annotate).toEqual([{ id: SITE.id, request: { hidden: true } }]));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: '' }).textContent).toContain('site is hidden'),
    );
    // Gone from the list, and so from the selection.
    await waitFor(() => expect(screen.queryByText('Selected: site')).toBeNull());
  });

  it('shows a hidden one again', async () => {
    const client = fake([SECRET]);
    screenFor(client, { showHidden: true });
    await ready();
    await select('secret');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() =>
      expect(client.calls.annotate).toEqual([{ id: SECRET.id, request: { hidden: false } }]),
    );
  });

  it('says in words, with the next step, why an action was refused', async () => {
    const client = fake([SITE]);
    client.next.annotate = { kind: 'refused', code: 'store_failed' };
    screenFor(client);
    await ready();
    await select('site');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The list could not be saved.');
    expect(alert.textContent).toContain('Check that the folder can be written to');
    expect(alert.textContent).not.toMatch(/\b[45]\d\d\b/);
  });

  it('reads the list again when the workflow is no longer there', async () => {
    const client = fake([SITE]);
    screenFor(client);
    await ready();
    await select('site');
    client.entries = [];
    const before = client.calls.lists;
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(client.calls.lists).toBeGreaterThan(before));
    expect((await screen.findByRole('alert')).textContent).toContain('no longer in the list');
  });
});

describe('Edit details', () => {
  it('sends only what changed and announces it', async () => {
    const client = fake([DOCS]);
    screenFor(client);
    await ready();
    await select('docs');
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Details of docs' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Weekly docs' } });
    fireEvent.change(within(dialog).getByLabelText('Tags'), { target: { value: 'weekly, team' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(client.calls.annotate).toEqual([
        { id: DOCS.id, request: { name: 'Weekly docs', tags: ['weekly', 'team'] } },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Weekly docs')).toBeDefined();
    expect(screen.getByText(/Saved the details of Weekly docs/)).toBeDefined();
  });

  it('asks for the default again when a name is emptied', async () => {
    const client = fake([DOCS]);
    screenFor(client);
    await ready();
    await select('docs');
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.calls.annotate[0]?.request).toEqual({ name: null }));
  });

  it('sends nothing when nothing changed, and refuses a name that is too long before sending', async () => {
    const client = fake([DOCS]);
    screenFor(client);
    await ready();
    await select('docs');
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Nothing changed.')).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'n'.repeat(121) } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('longer than 120 characters');
    expect(client.calls.annotate).toEqual([]);
  });

  it('shows a refusal inside the dialog and keeps it open', async () => {
    const client = fake([DOCS]);
    client.next.annotate = { kind: 'refused', code: 'invalid_request' };
    screenFor(client);
    await ready();
    await select('docs');
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('cannot be saved');
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('closes on Escape and gives focus back to the button that opened it', async () => {
    screenFor(fake([DOCS]));
    await ready();
    await select('docs');
    const opener = screen.getByRole('button', { name: 'Edit details' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    expect(document.activeElement?.textContent).toBe('Details of docs');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});

describe('a dialog keeps focus inside', () => {
  it('moves from the last control to the first on Tab, and back on Shift+Tab', async () => {
    screenFor(fake([DOCS]));
    await ready();
    await select('docs');
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = await screen.findByRole('dialog');
    const buttons = within(dialog).getAllByRole('button');
    const first = within(dialog).getByRole('button', { name: 'Close' });
    const last = within(dialog).getByRole('button', { name: 'Cancel' });
    expect(buttons[0]).toBe(first);
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    // Any other key does nothing.
    fireEvent.keyDown(dialog, { key: 'a' });
    expect(screen.getByRole('dialog')).toBeDefined();
  });
});

describe('Copy to another project', () => {
  it('copies into another folder, shows what to review and opens the copy', async () => {
    const client = fake([SITE]);
    const { navigate } = screenFor(client);
    await ready();
    await select('site');
    fireEvent.click(screen.getByRole('button', { name: 'Copy to another project' }));
    const dialog = await screen.findByRole('dialog', { name: 'Copy site to another project' });
    // The folder the original is not in comes first.
    expect((within(dialog).getByLabelText('Copy into') as HTMLSelectElement).value).toBe(SHOP);
    fireEvent.change(within(dialog).getByLabelText('File name (optional)'), {
      target: { value: 'site-shop' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    await waitFor(() =>
      expect(client.calls.copy).toEqual([{ id: SITE.id, request: { rootId: SHOP, name: 'site-shop' } }]),
    );
    const done = await screen.findByRole('dialog', { name: 'Copied' });
    expect(within(done).getByText(/site-shop.workflow.ai.yml/)).toBeDefined();
    expect(within(done).getByText('steps[0].commands: make')).toBeDefined();
    fireEvent.click(within(done).getByRole('button', { name: 'Open the copy' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'workflow', workflowId: '9'.repeat(16) });
  });

  it('sends no name when none was typed, and never a path', async () => {
    const client = fake([SITE]);
    screenFor(client);
    await ready();
    await select('site');
    fireEvent.click(screen.getByRole('button', { name: 'Copy to another project' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(client.calls.copy).toEqual([{ id: SITE.id, request: { rootId: SHOP } }]));
    expect(JSON.stringify(client.calls.copy)).not.toContain('/work');
  });

  it('refuses a file name with a folder in it before sending', async () => {
    const client = fake([SITE]);
    screenFor(client);
    await ready();
    await select('site');
    fireEvent.click(screen.getByRole('button', { name: 'Copy to another project' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('File name (optional)'), { target: { value: '../x' } });
    expect(within(dialog).getByRole('alert').textContent).toContain('cannot be used');
    expect((within(dialog).getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(true);
    expect(client.calls.copy).toEqual([]);
  });

  it('says that a taken name copied nothing, and asks for another', async () => {
    const client = fake([SITE]);
    client.next.copy = { kind: 'refused', code: 'exists' };
    screenFor(client);
    await ready();
    await select('site');
    fireEvent.click(screen.getByRole('button', { name: 'Copy to another project' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('nothing was copied');
    expect(alert.textContent).toContain('another name');
  });
});

describe('Import a folder', () => {
  const open = async (client: Fake) => {
    screenFor(client);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Import a folder' }));
    return screen.findByRole('dialog', { name: 'Import a folder' });
  };

  it('shows the folder the path leads to, and adds that folder, not the text typed', async () => {
    const client = fake([SITE]);
    const dialog = await open(client);
    fireEvent.change(within(dialog).getByLabelText('Folder path'), { target: { value: '../other' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Look at this folder' }));
    expect((await within(dialog).findByTestId('resolved-folder')).textContent).toBe('/work/other');
    expect(within(dialog).getByText('Indaba found 3 workflow files in it.')).toBeDefined();
    expect(within(dialog).getByText(/be able to run, the workflow files in this folder/)).toBeDefined();
    // Nothing is added until the person says so.
    expect(client.calls.add).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add this folder' }));
    await waitFor(() => expect(client.calls.add).toEqual(['/work/other']));
    expect(client.calls.resolve).toEqual(['../other']);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Now looking in /work/other: 3 workflow files.')).toBeDefined();
  });

  it('says "at least" when a limit stopped the count, and that a covered folder is covered', async () => {
    const client = fake([SITE]);
    client.next.resolve = {
      kind: 'ok',
      value: { folder: '/work/blog', name: 'blog', alreadyCovered: true, found: 200, atLeast: true },
    } as RegistryAnswer<never>;
    const dialog = await open(client);
    fireEvent.change(within(dialog).getByLabelText('Folder path'), { target: { value: '/work/blog' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Look at this folder' }));
    expect(await within(dialog).findByText('Indaba found at least 200 workflow files in it.')).toBeDefined();
    expect(within(dialog).getByText('Indaba already looks in this folder.')).toBeDefined();
    expect(within(dialog).queryByText(/be able to run/)).toBeNull();
  });

  it('refuses a path that is not a folder, and lets the person try another', async () => {
    const client = fake([SITE]);
    client.next.resolve = { kind: 'refused', code: 'not_a_folder' };
    const dialog = await open(client);
    fireEvent.change(within(dialog).getByLabelText('Folder path'), { target: { value: '/nope' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Look at this folder' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('not a folder Indaba can read');
    expect(client.calls.add).toEqual([]);
    expect((within(dialog).getByLabelText('Folder path') as HTMLInputElement).value).toBe('/nope');
  });

  it('goes back from the shown folder to choose another, adding nothing', async () => {
    const client = fake([SITE]);
    const dialog = await open(client);
    fireEvent.change(within(dialog).getByLabelText('Folder path'), { target: { value: '/x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Look at this folder' }));
    await within(dialog).findByTestId('resolved-folder');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose another folder' }));
    expect(within(dialog).getByLabelText('Folder path')).toBeDefined();
    expect(client.calls.add).toEqual([]);
  });

  it('says when the folder cannot be added after all', async () => {
    const client = fake([SITE]);
    client.next.add = { kind: 'refused', code: 'store_failed' };
    const dialog = await open(client);
    fireEvent.change(within(dialog).getByLabelText('Folder path'), { target: { value: '/x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Look at this folder' }));
    await within(dialog).findByTestId('resolved-folder');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add this folder' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('could not be saved');
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('does not look at an empty path', async () => {
    const client = fake([SITE]);
    const dialog = await open(client);
    expect(
      (within(dialog).getByRole('button', { name: 'Look at this folder' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(client.calls.resolve).toEqual([]);
  });
});

describe('Remove from the list', () => {
  it('names what will happen and asks; the file is never deleted', async () => {
    const client = fake([GONE]);
    screenFor(client);
    await ready();
    await select('gone');
    fireEvent.click(screen.getByRole('button', { name: 'Remove from the list' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove gone from the list?' });
    expect(within(dialog).getByText(/The file is not deleted/)).toBeDefined();
    expect(client.calls.remove).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from the list' }));
    await waitFor(() => expect(client.calls.remove).toEqual([GONE.id]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/gone is no longer on the list. The file is untouched./)).toBeDefined();
    expect(screen.queryByText('Selected: gone')).toBeNull();
  });

  it('can be cancelled, and then nothing is sent', async () => {
    const client = fake([ODD]);
    screenFor(client);
    await ready();
    await select('odd');
    fireEvent.click(screen.getByRole('button', { name: 'Remove from the list' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(client.calls.remove).toEqual([]);
  });

  it('offers Hide instead for a file a scan would list again, and removes nothing', async () => {
    const client = fake([SITE]);
    screenFor(client);
    await ready();
    await select('site');
    fireEvent.click(screen.getByRole('button', { name: 'Remove from the list' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/cannot be removed/)).toBeDefined();
    expect(within(dialog).queryByRole('button', { name: 'Remove from the list' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hide it' }));
    await waitFor(() => expect(client.calls.annotate).toEqual([{ id: SITE.id, request: { hidden: true } }]));
    expect(client.calls.remove).toEqual([]);
  });

  it('explains a race: the server says the file would return', async () => {
    const client = fake([ODD]);
    client.next.remove = { kind: 'refused', code: 'would_return' };
    screenFor(client);
    await ready();
    await select('odd');
    fireEvent.click(screen.getByRole('button', { name: 'Remove from the list' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from the list' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Hide it instead.');
  });
});

describe('Scan again', () => {
  it('scans and reports what it found in words', async () => {
    const client = fake([SITE]);
    screenFor(client);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    await waitFor(() => expect(client.calls.scans).toBe(1));
    expect(await screen.findByText('Found 4 workflow files, 1 new.')).toBeDefined();
  });

  it('sends one scan for two quick presses', async () => {
    const client = fake([SITE]);
    screenFor(client);
    await ready();
    const button = screen.getByRole('button', { name: 'Scan again' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(client.calls.scans).toBe(1));
  });
});

describe('in the page', () => {
  const inPage = (client: Client, path: string) => {
    window.history.replaceState(null, '', path);
    return render(
      h(App, {
        client,
        clock,
        win: window,
        origin: 'http://127.0.0.1:4173',
        root: { dataset: {} as DOMStringMap },
        store: undefined,
        tickMs: 60_000,
      }),
    );
  };

  it('offers Workflows in the menu when the server has the list, and opens it', async () => {
    inPage(fake([SITE]), '/');
    const link = await screen.findByRole('link', { name: 'Workflows' });
    fireEvent.click(link);
    await ready();
    expect(screen.getByRole('heading', { level: 2, name: 'Workflows' })).toBeDefined();
    expect(window.location.pathname).toBe('/workflows');
    expect(screen.getByRole('link', { name: 'Workflows' }).getAttribute('aria-current')).toBe('page');
  });

  it('offers no menu item when the server has no list, and says so at the address', async () => {
    inPage(fake([], { unavailable: true }), '/');
    await screen.findByRole('link', { name: 'Runs' });
    expect(screen.queryByRole('link', { name: 'Workflows' })).toBeNull();
    cleanup();
    inPage(fake([], { unavailable: true }), '/workflows');
    expect((await screen.findByRole('alert')).textContent).toContain('does not offer the list of workflows');
  });

  it('keeps Show hidden in the address', async () => {
    inPage(fake([SITE, SECRET]), '/workflows');
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Show hidden (1)' }));
    await waitFor(() => expect(window.location.search).toBe('?hidden=1'));
    expect(await screen.findByText('secret')).toBeDefined();
  });
});
