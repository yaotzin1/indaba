// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  EditorResponse,
  JsonObject,
  JsonValue,
  WorkflowEdit,
  WorkflowProblem,
  WorkflowSourceResponse,
} from '@indaba/core';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiFailure, type Client, type EditAnswer, type Failure } from '../src/client.js';
import { idOf } from '../src/ui/FormView.js';
import { SourceScreen } from '../src/ui/SourceScreen.js';

/** specs/web-app-editing-forms, T-10 to T-12: the form, over a client whose editor works on JSON text. */

afterEach(cleanup);

const schema = JSON.parse(
  // A path, not a URL: under happy-dom, `URL` is the page's, which `readFileSync` does not take.
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'workflow-schema.json'), 'utf8'),
) as JsonObject;

const INFO: EditorResponse = {
  schema,
  catalog: {
    catalog: 1,
    runners: [
      { name: 'shell', description: 'Runs command lines.' },
      { name: 'acp', description: 'An agent over ACP.' },
    ],
    guards: [],
    arbiters: [{ name: 'human', description: 'A person decides.' }],
    voters: [],
    prompts: [],
    values: { decisionTypes: [], isolation: [], failureActions: [], mcpPolicies: [], promptAdditions: [] },
  },
};

const DOC: JsonObject = {
  version: '1.0',
  name: 'site',
  roles: { writer: { runner: 'acp', model: 'm' } },
  steps: [
    { id: 'build', runner: 'shell', commands: ['npm run build'] },
    { id: 'write', role: 'writer', goal: 'Write it.', depends_on: ['build'], guards: [{ type: 'x' }] },
  ],
};

/** JSON is YAML too, so the fake's text is the document as JSON, one key per line. */
const textOf = (doc: JsonValue): string => `${JSON.stringify(doc, null, 2)}\n`;
const TEXT = textOf(DOC);

/** The fake's own edit of a plain copy: the real one is `WorkflowDocument`, tested in the command line. */
function setAt(
  doc: JsonObject,
  path: readonly (string | number)[],
  value: JsonValue | undefined,
): JsonObject {
  const copy: Record<string, unknown> = structuredClone(doc);
  let node: Record<string | number, unknown> = copy;
  path.slice(0, -1).forEach((part, i) => {
    if (node[part] === undefined) {
      node[part] = typeof path[i + 1] === 'number' ? [] : {};
    }
    node = node[part] as Record<string | number, unknown>;
  });
  const last = path[path.length - 1] ?? '';
  if (value === undefined) {
    if (Array.isArray(node)) node.splice(Number(last), 1);
    else delete node[last];
  } else {
    node[last] = value;
  }
  return copy as JsonObject;
}

function applyEdit(doc: JsonObject, edit: WorkflowEdit): JsonObject {
  const steps = (Array.isArray(doc.steps) ? doc.steps : []) as JsonObject[];
  const indexOf = (id: string) => steps.findIndex((s) => s.id === id);
  switch (edit.op) {
    case 'set':
      return setAt(doc, edit.path, edit.value);
    case 'remove':
      return setAt(doc, edit.path, undefined);
    case 'addStep': {
      const at = edit.after === undefined ? steps.length : indexOf(edit.after) + 1;
      return { ...doc, steps: [...steps.slice(0, at), edit.step, ...steps.slice(at)] };
    }
    case 'removeStep':
      return { ...doc, steps: steps.filter((s) => s.id !== edit.id) };
    case 'moveStep': {
      const moving = steps[indexOf(edit.id)] as JsonObject;
      const rest = steps.filter((s) => s.id !== edit.id);
      const at = edit.after === undefined ? 0 : rest.findIndex((s) => s.id === edit.after) + 1;
      return { ...doc, steps: [...rest.slice(0, at), moving, ...rest.slice(at)] };
    }
  }
}

interface Fake extends Client {
  readonly edits: { text: string; edits: readonly WorkflowEdit[] }[];
  readonly saves: { text: string; baseHash: string }[];
  /** Answers of the editor are held until released, when set. */
  hold: boolean;
  release(): void;
}

function fake(options: {
  readonly text?: string;
  readonly info?: EditorResponse | 'none' | 'fail';
  readonly problems?: (doc: JsonObject) => readonly WorkflowProblem[];
  readonly refuse?: (edit: WorkflowEdit) => string | undefined;
}): Fake {
  const never = (): never => {
    throw new Error('not in this test');
  };
  const held: (() => void)[] = [];
  const source: WorkflowSourceResponse = {
    workflow: {
      id: 'w1',
      name: 'site',
      path: 'site.workflow.ai.yml',
      project: 'shop',
      valid: true,
      problems: [],
    },
    text: options.text ?? TEXT,
    contentHash: 'a'.repeat(64),
    problems: [],
  };
  const client: Fake = {
    edits: [],
    saves: [],
    hold: false,
    release: () => {
      for (const go of held.splice(0)) go();
    },
    contract: async () => ({ contractVersion: '1.4.0' }),
    runs: never,
    run: never,
    followRun: never,
    followServer: never,
    stepLog: never,
    discussion: never,
    workflows: async () => undefined,
    startRun: never,
    startStatus: never,
    stopRun: never,
    loggingSettings: never,
    checkLoggingSettings: never,
    saveLoggingSettings: never,
    testLogSink: never,
    workflowSource: async () => source,
    saveWorkflowSource: async (_id, text, baseHash) => {
      client.saves.push({ text, baseHash });
      return { kind: 'saved', contentHash: 'b'.repeat(64), problems: [] };
    },
    checkWorkflow: async () => [],
    editor: async () => {
      if (options.info === 'fail') throw new ApiFailure({ kind: 'server', message: 'no' });
      return options.info === 'none' ? undefined : (options.info ?? INFO);
    },
    editWorkflow: (text, edits) => {
      client.edits.push({ text, edits });
      const answer = (): EditAnswer => {
        let doc: JsonObject;
        try {
          doc = JSON.parse(text) as JsonObject;
        } catch {
          return { kind: 'not_editable', message: 'invalid YAML: not JSON either' };
        }
        for (const [index, edit] of edits.entries()) {
          const refused = options.refuse?.(edit);
          if (refused !== undefined) return { kind: 'refused', message: refused, index };
          doc = applyEdit(doc, edit);
        }
        return { kind: 'edited', text: textOf(doc), value: doc, problems: options.problems?.(doc) ?? [] };
      };
      return client.hold
        ? new Promise((resolve) => held.push(() => resolve(answer())))
        : Promise.resolve(answer());
    },
  };
  return client;
}

function open(client: Fake, confirm: (message: string) => boolean = () => true) {
  const failures: Failure[] = [];
  render(
    h(SourceScreen, {
      client,
      workflowId: 'w1',
      navigate: () => undefined,
      onFatal: (failure: Failure) => failures.push(failure),
      leaveGuard: { current: undefined },
      confirm,
      canRun: false,
      noticeSeen: true,
      onNoticeSeen: () => undefined,
      checkDelayMs: 5,
    }),
  );
  return { failures };
}

const field = (label: RegExp | string) => screen.findByLabelText(label) as Promise<HTMLInputElement>;
const lastEdit = (client: Fake) => client.edits[client.edits.length - 1]?.edits;

describe('the form and the source view (AC-05)', () => {
  it('shows the form first, says which view is shown, and switches without losing the draft', async () => {
    const client = fake({});
    open(client);
    const name = await field(/^Name/);
    expect(name.value).toBe('site');
    expect(screen.getByRole('button', { name: 'Form' }).getAttribute('aria-pressed')).toBe('true');
    expect(client.edits[0]).toEqual({ text: TEXT, edits: [] });

    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    const area = (await screen.findByLabelText('The workflow file')) as HTMLTextAreaElement;
    expect(area.value).toBe(TEXT);
    const changed = TEXT.replace('"name": "site"', '"name": "shop"');
    fireEvent.change(area, { target: { value: changed } });
    fireEvent.click(screen.getByRole('button', { name: 'Form' }));
    // The form reads the text the source view left.
    await waitFor(() => expect(client.edits[client.edits.length - 1]).toEqual({ text: changed, edits: [] }));
    expect((await field(/^Name/)).value).toBe('shop');
  });

  it('shows only the source view when the server has no form, or cannot describe it', async () => {
    for (const info of ['none', 'fail'] as const) {
      const client = fake({ info });
      open(client);
      await screen.findByLabelText('The workflow file');
      expect(screen.queryByRole('button', { name: 'Form' })).toBeNull();
      expect(client.edits).toEqual([]);
      cleanup();
    }
  });

  it('starts in the source view when the form cannot read the text, and says why on the form', async () => {
    const client = fake({ text: 'steps: [' });
    open(client);
    await screen.findByLabelText('The workflow file');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Source' }).getAttribute('aria-pressed')).toBe('true'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Form' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('The form is not available: invalid YAML'),
    );
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Source' }));
    await screen.findByLabelText('The workflow file');
  });

  it('saves the text the form made', async () => {
    const client = fake({});
    open(client);
    const name = await field(/^Name/);
    fireEvent.change(name, { target: { value: 'shop' } });
    fireEvent.blur(name);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Not saved yet.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.saves).toHaveLength(1));
    expect(JSON.parse(client.saves[0]?.text ?? '')).toMatchObject({ name: 'shop' });
  });
});

describe('fields (AC-06, AC-08)', () => {
  it('sends a text field’s edit when it loses focus or on Enter, not per key', async () => {
    const client = fake({});
    open(client);
    const name = await field(/^Name/);
    const before = client.edits.length;
    fireEvent.change(name, { target: { value: 'sh' } });
    fireEvent.change(name, { target: { value: 'shop' } });
    expect(client.edits).toHaveLength(before);
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(() => expect(lastEdit(client)).toEqual([{ op: 'set', path: ['name'], value: 'shop' }]));
    // Unchanged on blur: nothing more is sent.
    fireEvent.blur(name);
    expect(client.edits).toHaveLength(before + 1);
  });

  it('keeps a required field from being cleared, and removes a cleared optional one', async () => {
    const client = fake({});
    open(client);
    const name = await field(/^Name/);
    const before = client.edits.length;
    fireEvent.change(name, { target: { value: '  ' } });
    fireEvent.blur(name);
    expect(await screen.findByText('This cannot be empty.')).toBeTruthy();
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(client.edits).toHaveLength(before);

    fireEvent.click(screen.getByRole('button', { name: /^write/ }));
    const goal = await field(/^Goal/);
    expect(goal.tagName).toBe('TEXTAREA');
    fireEvent.change(goal, { target: { value: '' } });
    fireEvent.blur(goal);
    await waitFor(() => expect(lastEdit(client)).toEqual([{ op: 'remove', path: ['steps', 1, 'goal'] }]));
  });

  it('offers runners from the catalog at once, and marks a value it does not offer', async () => {
    const client = fake({
      text: textOf({ ...DOC, steps: [{ id: 'a', runner: 'plugin-runner', commands: ['x'] }] }),
    });
    open(client);
    const step = await screen.findByRole('group', { name: 'Step a' });
    const runner = within(step).getByLabelText(/^Runner runner$/) as HTMLSelectElement;
    const options = [...runner.options].map((o) => o.textContent);
    expect(options).toEqual(['Not set', 'shell', 'acp', 'plugin-runner (not available here)']);
    expect(runner.value).toBe('plugin-runner');
    fireEvent.change(runner, { target: { value: 'shell' } });
    await waitFor(() =>
      expect(lastEdit(client)).toEqual([{ op: 'set', path: ['steps', 0, 'runner'], value: 'shell' }]),
    );
    expect(await screen.findByText('Runs command lines.')).toBeTruthy();
  });

  it('sets what a step waits for from the other steps', async () => {
    const client = fake({});
    open(client);
    fireEvent.click(await screen.findByRole('button', { name: /^write/ }));
    const group = await screen.findByRole('group', { name: /^Waits for/ });
    const build = within(group).getByLabelText('build') as HTMLInputElement;
    expect(build.checked).toBe(true);
    fireEvent.click(build);
    await waitFor(() =>
      expect(lastEdit(client)).toEqual([{ op: 'remove', path: ['steps', 1, 'depends_on'] }]),
    );
  });

  it('takes whole numbers in a number field', async () => {
    const client = fake({
      text: textOf({
        ...DOC,
        steps: [
          { id: 'a', runner: 'shell', commands: ['x'], on_failure: { action: 'retry_step', max_retries: 1 } },
        ],
      }),
    });
    open(client);
    const retries = await field(/^Retries/);
    const before = client.edits.length;
    fireEvent.change(retries, { target: { value: 'two' } });
    fireEvent.blur(retries);
    expect(await screen.findByText('A whole number, such as 2.')).toBeTruthy();
    expect(client.edits).toHaveLength(before);
    fireEvent.change(retries, { target: { value: '3' } });
    fireEvent.blur(retries);
    await waitFor(() =>
      expect(lastEdit(client)).toEqual([
        { op: 'set', path: ['steps', 0, 'on_failure', 'max_retries'], value: 3 },
      ]),
    );
  });

  it('edits a list one item per line', async () => {
    const client = fake({});
    open(client);
    const commands = await field(/^Commands/);
    expect(commands.value).toBe('npm run build');
    fireEvent.change(commands, { target: { value: 'npm ci\n\n npm run build \n' } });
    fireEvent.blur(commands);
    await waitFor(() =>
      expect(lastEdit(client)).toEqual([
        { op: 'set', path: ['steps', 0, 'commands'], value: ['npm ci', 'npm run build'] },
      ]),
    );
  });

  it('names a field it does not edit and opens the source view at its key', async () => {
    const client = fake({});
    open(client);
    fireEvent.click(await screen.findByRole('button', { name: /^write/ }));
    // A field the file has, and one it does not, are told apart.
    expect(screen.getAllByText('Edited in the source view.').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Not in this file\./).length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Show guards in the source view' }));
    const area = (await screen.findByLabelText('The workflow file')) as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(area));
    const line = TEXT.split('\n').findIndex((l) => l.includes('"guards"'));
    expect(area.selectionStart).toBe(TEXT.split('\n').slice(0, line).join('\n').length + 1);
  });

  it('shows the draft’s value again, and the sentence at the top, when an edit is refused', async () => {
    const client = fake({ refuse: (edit) => (edit.op === 'set' ? 'the key is not allowed' : undefined) });
    open(client);
    const name = await field(/^Name/);
    fireEvent.change(name, { target: { value: 'shop' } });
    fireEvent.blur(name);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That change was not made: the key is not allowed',
    );
    await waitFor(() => expect(name.value).toBe('site'));
  });
});

describe('permissions presets (AC-09)', () => {
  const withPermissions = (permissions: JsonValue | undefined) =>
    textOf({
      ...DOC,
      steps: [{ id: 'a', role: 'writer', goal: 'g', ...(permissions === undefined ? {} : { permissions }) }],
    });

  it('sets a preset, keeping what the agent may read, and lists the folders of the second', async () => {
    const client = fake({ text: withPermissions({ fs: { read: ['docs/**'] } }) });
    open(client);
    const readOnly = (await screen.findByLabelText('Read only')) as HTMLInputElement;
    expect(readOnly.checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Full access'));
    // One edit per path: the level is set and the key full access forbids is removed (AC-16).
    await waitFor(() =>
      expect(lastEdit(client)).toEqual([
        { op: 'set', path: ['steps', 0, 'permissions', 'level'], value: 'full' },
        { op: 'remove', path: ['steps', 0, 'permissions', 'fs'] },
      ]),
    );
    fireEvent.click(screen.getByLabelText('Edit only these folders'));
    const globs = (await screen.findByLabelText('Folders the agent may change')) as HTMLTextAreaElement;
    expect(globs.value).toBe('src/**');
    fireEvent.change(globs, { target: { value: 'src/**\nlib/**' } });
    fireEvent.blur(globs);
    await waitFor(() =>
      expect(lastEdit(client)).toEqual([
        { op: 'set', path: ['steps', 0, 'permissions', 'fs', 'write'], value: ['src/**', 'lib/**'] },
      ]),
    );
    fireEvent.click(screen.getByLabelText('Not set'));
    await waitFor(() =>
      expect(lastEdit(client)).toEqual([{ op: 'remove', path: ['steps', 0, 'permissions'] }]),
    );
    expect(screen.getByText(/is a request, not a rule/)).toBeTruthy();
  });

  it('shows a rule that is no preset as Custom and changes nothing until a preset is picked', async () => {
    const client = fake({ text: withPermissions({ fs: { write: ['**'] }, terminal: 'deny', network: 'x' }) });
    open(client);
    const custom = (await screen.findByLabelText('Custom')) as HTMLInputElement;
    expect(custom.checked).toBe(true);
    expect(custom.disabled).toBe(true);
    expect(client.edits.every((e) => e.edits.length === 0)).toBe(true);
    expect(screen.getByRole('button', { name: 'Show permissions in the source view' })).toBeTruthy();
  });
});

describe('permissions levels by runner (specs/agent-permissions, AC-16, AC-17)', () => {
  const level = (mode: string, scope: string, note: string) => ({ mode, scope, note });
  const permissions = {
    cli: {
      read: level('native', 'guard', 'plan_mode'),
      edit: level('native', 'guard', 'commands_not_limited'),
      full: level('native', 'none', 'bypass_permissions'),
    },
    limited: {
      read: level('unsupported', 'none', 'no_read_only_argument'),
      edit: level('after', 'guard', 'commands_not_limited'),
      full: level('unsupported', 'none', 'argument_unconfirmed'),
    },
    gate: {
      read: level('acp', 'acp', 'gate'),
      edit: level('acp', 'acp', 'gate'),
      full: level('acp', 'none', 'gate_allows_all'),
    },
  };
  const info = (...names: (keyof typeof permissions)[]): EditorResponse => ({
    ...INFO,
    catalog: {
      ...INFO.catalog,
      runners: names.map((name) => ({ name, description: '', permissions: permissions[name] })) as never,
    },
  });
  const docOf = (runner: JsonValue, block?: JsonValue) =>
    textOf({
      version: '1.0',
      name: 'site',
      steps: [{ id: 'a', runner, goal: 'g', ...(block === undefined ? {} : { permissions: block }) }],
    });

  it('refuses a level the runner cannot hold, in words from the note id, and writes nothing', async () => {
    const client = fake({ text: docOf('limited'), info: info('limited') });
    open(client);
    const readOnly = (await screen.findByLabelText('Read only')) as HTMLInputElement;
    expect(readOnly.disabled).toBe(true);
    expect(
      screen.getByText(/limited cannot do this: it has no way to run read-only that Indaba can hold/),
    ).toBeTruthy();
    expect((screen.getByLabelText('Full access') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/limited cannot do this: Indaba has not confirmed how to ask it/)).toBeTruthy();
    // The level it can hold, after the step only, is offered.
    const folders = screen.getByLabelText('Edit only these folders') as HTMLInputElement;
    expect(folders.disabled).toBe(false);
    fireEvent.click(folders);
    await waitFor(() =>
      expect(lastEdit(client)).toEqual([
        { op: 'set', path: ['steps', 0, 'permissions'], value: { level: 'edit', fs: { write: ['src/**'] } } },
      ]),
    );
    expect(client.edits.every((e) => e.edits.every((edit) => edit.op !== 'remove'))).toBe(true);
  });

  it('shows the qualifier for a level only checked after the step, and for commands not limited', async () => {
    const client = fake({
      text: docOf('limited', { level: 'edit', fs: { write: ['src/**'] } }),
      info: info('limited'),
    });
    open(client);
    await screen.findByLabelText('Edit only these folders');
    expect(
      screen.getByText('limited: the folders are checked after the step, not while it works.'),
    ).toBeTruthy();
    expect(screen.getByText('limited: commands the agent runs are not limited.')).toBeTruthy();
  });

  it('holds a level against every runner of the step’s chain, naming the one that cannot', async () => {
    const client = fake({ text: docOf(['cli', 'limited']), info: info('cli', 'limited') });
    open(client);
    const readOnly = (await screen.findByLabelText('Read only')) as HTMLInputElement;
    expect(readOnly.disabled).toBe(true);
    expect(screen.getAllByText(/limited cannot do this/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/cli cannot do this/)).toBeNull();
  });

  it('takes the runner of the role when the step names none', async () => {
    const text = textOf({
      version: '1.0',
      name: 'site',
      roles: { w: { runner: 'limited' } },
      steps: [{ id: 'a', role: 'w', goal: 'g' }],
    });
    const client = fake({ text, info: info('limited') });
    open(client);
    expect(((await screen.findByLabelText('Read only')) as HTMLInputElement).disabled).toBe(true);
  });

  it('says what Full access means when it is the level, and refuses nothing when the catalog says nothing', async () => {
    const client = fake({ text: docOf('gate', { level: 'full' }), info: info('gate') });
    open(client);
    expect(((await screen.findByLabelText('Full access')) as HTMLInputElement).checked).toBe(true);
    expect(
      screen.getAllByText("This step's agent can change anything and run anything and nobody approves it.")
        .length,
    ).toBeGreaterThan(0);
    cleanup();
    // An older server sends no map: nothing is disabled.
    const older = fake({ text: docOf('limited') });
    open(older);
    expect(((await screen.findByLabelText('Read only')) as HTMLInputElement).disabled).toBe(false);
  });

  it('marks an old-style block, the old full access among them, and leaves it as it is until it is changed', async () => {
    const client = fake({
      text: docOf('gate', { fs: { write: ['**'] }, terminal: 'allow' }),
      info: info('gate'),
    });
    open(client);
    expect(((await screen.findByLabelText('Full access')) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/old style: every folder and the terminal, with no level/)).toBeTruthy();
    expect(client.edits.every((e) => e.edits.length === 0)).toBe(true);
    fireEvent.click(screen.getByLabelText('Read only'));
    await waitFor(() =>
      expect(lastEdit(client)).toEqual([
        { op: 'set', path: ['steps', 0, 'permissions', 'level'], value: 'read' },
        { op: 'remove', path: ['steps', 0, 'permissions', 'fs'] },
        { op: 'remove', path: ['steps', 0, 'permissions', 'terminal'] },
      ]),
    );
    await waitFor(() => expect(screen.queryByText(/old style/)).toBeNull());
  });

  it('shows the default of the runner, not a claim that others are not limited, for a step with no level', async () => {
    const client = fake({ text: docOf('cli'), info: info('cli') });
    open(client);
    await screen.findByLabelText('Not set');
    expect(
      screen.getByText(/each runner keeps its own built-in default, which is not a level you chose/),
    ).toBeTruthy();
    expect(screen.queryByText(/other runners are not limited/)).toBeNull();
  });
});

describe('steps (AC-10)', () => {
  it('adds a step after the one shown, with an id no step has, and shows it', async () => {
    const client = fake({});
    open(client);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a step' }));
    await waitFor(() =>
      expect(lastEdit(client)).toEqual([
        { op: 'addStep', step: { id: 'step-1', runner: 'shell' }, after: 'build' },
      ]),
    );
    expect(await screen.findByRole('group', { name: 'Step step-1' })).toBeTruthy();
    const list = screen.getByRole('navigation', { name: 'Steps of this workflow' });
    expect(
      within(list)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['build', 'step-1', 'write']);
  });

  it('asks before removing a step, and moves one up and down', async () => {
    let asked = '';
    let answer = false;
    const client = fake({});
    open(client, (message) => {
      asked = message;
      return answer;
    });
    fireEvent.click(await screen.findByRole('button', { name: /^write/ }));
    const before = client.edits.length;
    fireEvent.click(await screen.findByRole('button', { name: 'Remove step write' }));
    expect(asked).toContain('Remove step write?');
    expect(client.edits).toHaveLength(before);
    expect((screen.getByRole('button', { name: 'Move down' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Move up' }));
    await waitFor(() => expect(lastEdit(client)).toEqual([{ op: 'moveStep', id: 'write' }]));
    // Still the step shown, now first.
    expect(((await screen.findByRole('button', { name: 'Move up' })) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Move down' }));
    await waitFor(() => expect(lastEdit(client)).toEqual([{ op: 'moveStep', id: 'write', after: 'build' }]));

    answer = true;
    fireEvent.click(await screen.findByRole('button', { name: 'Remove step write' }));
    await waitFor(() => expect(lastEdit(client)).toEqual([{ op: 'removeStep', id: 'write' }]));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^write/ })).toBeNull());
  });

  it('moves a step after the one two above, and offers no action for a step without a unique id', async () => {
    const client = fake({
      text: textOf({
        ...DOC,
        steps: [
          { id: 'a', runner: 'shell', commands: ['x'] },
          { id: 'b', runner: 'shell', commands: ['x'] },
          { id: 'c', runner: 'shell', commands: ['x'] },
          { runner: 'shell', commands: ['x'] },
          'not a step',
        ],
      }),
    });
    open(client);
    fireEvent.click(await screen.findByRole('button', { name: 'c' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move up' }));
    await waitFor(() => expect(lastEdit(client)).toEqual([{ op: 'moveStep', id: 'c', after: 'a' }]));
    fireEvent.click(screen.getAllByRole('button', { name: 'Step without an id' })[0] as HTMLElement);
    expect(await screen.findByText('Give this step a unique id to move or remove it here.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Step without an id' })[1] as HTMLElement);
    expect(await screen.findByText(/This is not a mapping of fields/)).toBeTruthy();
    // With no step that can be named, a new one goes at the end.
    fireEvent.click(screen.getByRole('button', { name: 'Add a step' }));
    await waitFor(() =>
      expect(lastEdit(client)).toEqual([{ op: 'addStep', step: { id: 'step-1', runner: 'shell' } }]),
    );
    // "Show in the source view" finds the step by its id among steps that are not all mappings.
    fireEvent.click(screen.getByRole('button', { name: 'c' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show guards in the source view' }));
    await screen.findByLabelText('The workflow file');
    fireEvent.click(screen.getByRole('button', { name: 'Form' }));
    await screen.findByRole('button', { name: 'Add a step' });
  });

  it('says when there are no roles and no steps', async () => {
    open(fake({ text: textOf({ version: '1.0', name: 'x' }) }));
    expect(await screen.findByText('No steps yet.')).toBeTruthy();
    expect(screen.getByText(/^No roles\./)).toBeTruthy();
  });
});

describe('problems at their field (AC-11, AC-12)', () => {
  const problems = (): readonly WorkflowProblem[] => [
    { message: 'step "write" uses unknown role "ghost"', path: '$.steps[1].role', line: 9, column: 5 },
    { message: 'step "write" needs a role or a runner', path: '$.steps[1]', line: 8, column: 5 },
    { message: 'roles must be a mapping', path: '$', line: 1, column: 1 },
  ];

  it('puts each problem at its field, its step or the top, and keeps them in the list', async () => {
    const client = fake({ problems });
    open(client);
    // A first edit, so the editor's problems are shown.
    const name = await field(/^Name/);
    fireEvent.change(name, { target: { value: 'shop' } });
    fireEvent.blur(name);
    await screen.findByText('Problems of the workflow');
    expect(screen.getByRole('button', { name: /^write \(has problems\)/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^write/ }));
    const step = await screen.findByRole('group', { name: 'Step write' });
    const role = within(step).getByLabelText(/^Role role$/) as HTMLSelectElement;
    expect(role.getAttribute('aria-invalid')).toBe('true');
    const describedBy = role.getAttribute('aria-describedby') ?? '';
    const problemId = idOf('f', ['steps', 1, 'role']);
    expect(describedBy.split(' ')).toContain(`${problemId}-problem`);
    expect(document.getElementById(`${problemId}-problem`)?.textContent).toBe(
      'step "write" uses unknown role "ghost"',
    );
    expect(screen.getByText('Problems in this step')).toBeTruthy();
    // The list of step 3a still has all three, and its buttons open the source view at the line.
    expect(screen.getByRole('heading', { name: '3 problems' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Go to line 9/ }));
    const area = (await screen.findByLabelText('The workflow file')) as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(area));
  });
});

describe('the order of edits (spec section 5)', () => {
  it('sends each edit with the text the one before returned', async () => {
    const client = fake({});
    open(client);
    const name = await field(/^Name/);
    client.hold = true;
    fireEvent.change(name, { target: { value: 'one' } });
    fireEvent.blur(name);
    const commands = await field(/^Commands/);
    fireEvent.change(commands, { target: { value: 'make' } });
    fireEvent.blur(commands);
    await waitFor(() => expect(client.edits.length).toBeGreaterThan(1));
    const count = client.edits.length;
    await act(async () => client.release());
    await waitFor(() => expect(client.edits).toHaveLength(count + 1));
    await act(async () => client.release());
    const second = client.edits[client.edits.length - 1];
    expect(JSON.parse(second?.text ?? '')).toMatchObject({ name: 'one' });
    expect(second?.edits).toEqual([{ op: 'set', path: ['steps', 0, 'commands'], value: ['make'] }]);
  });

  it('drops an answer for a draft that changed while it was on its way', async () => {
    const client = fake({});
    open(client);
    const name = await field(/^Name/);
    client.hold = true;
    fireEvent.change(name, { target: { value: 'late' } });
    fireEvent.blur(name);
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    const area = (await screen.findByLabelText('The workflow file')) as HTMLTextAreaElement;
    const typed = TEXT.replace('"site"', '"typed"');
    fireEvent.change(area, { target: { value: typed } });
    await act(async () => client.release());
    expect(area.value).toBe(typed);
  });

  it('reports a failure of the server as any lost connection', async () => {
    const client = fake({});
    client.editWorkflow = async () => {
      throw new ApiFailure({ kind: 'unreachable' });
    };
    const { failures } = open(client);
    await waitFor(() => expect(failures).toEqual([{ kind: 'unreachable' }]));
  });
});

describe('the rest of the fields (coverage of each kind)', () => {
  it('removes a number when it is cleared, and shows a problem of a group and of the permissions', async () => {
    const client = fake({
      text: textOf({
        ...DOC,
        steps: [
          {
            id: 'a',
            role: 'writer',
            goal: 'g',
            on_failure: { action: 'retry_step', max_retries: 1 },
            permissions: { fs: { write: ['**'] }, terminal: 'maybe' },
          },
        ],
      }),
      problems: () => [
        { message: 'on_failure is odd', path: '$.steps[0].on_failure' },
        { message: 'terminal must be allow or deny', path: '$.steps[0].permissions' },
      ],
    });
    open(client);
    const retries = await field(/^Retries/);
    fireEvent.change(retries, { target: { value: '' } });
    fireEvent.blur(retries);
    await waitFor(() =>
      expect(lastEdit(client)).toEqual([{ op: 'remove', path: ['steps', 0, 'on_failure', 'max_retries'] }]),
    );
    // At the group, and in the list of every problem (AC-11).
    await waitFor(() => expect(screen.getAllByText('on_failure is odd')).toHaveLength(2));
    for (const message of ['on_failure is odd', 'terminal must be allow or deny']) {
      expect(screen.getAllByText(message).some((e) => e.className === 'field-problem')).toBe(true);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Show permissions in the source view' }));
    await screen.findByLabelText('The workflow file');
  });

  it('renders a yes-or-no field and a value it cannot change, from whatever the schema says', async () => {
    const info: EditorResponse = {
      ...INFO,
      schema: {
        type: 'object',
        required: ['version'],
        properties: { version: { const: '1.0' }, draft: { type: 'boolean', description: 'Not run yet.' } },
      },
    };
    const client = fake({ info, text: textOf({ version: '1.0', draft: false }) });
    open(client);
    expect(await screen.findByText('1.0 (the only version this Indaba reads)')).toBeTruthy();
    const draft = (await field(/^draft/)) as HTMLInputElement;
    expect(draft.type).toBe('checkbox');
    fireEvent.click(draft);
    await waitFor(() => expect(lastEdit(client)).toEqual([{ op: 'set', path: ['draft'], value: true }]));
    expect(screen.getByText('Not run yet.')).toBeTruthy();
  });

  it('says when there is no other step to wait for, and marks a step it names that is gone', async () => {
    const client = fake({
      text: textOf({
        ...DOC,
        steps: [
          { id: 'a', runner: 'shell', commands: ['x'], on_failure: { action: 'retry_step', target: 'gone' } },
        ],
      }),
    });
    open(client);
    const group = await screen.findByText('Waits for');
    expect(within(group.closest('.field') as HTMLElement).getByText('Not set')).toBeTruthy();
    const target = (await field(/^Run again from/)) as unknown as HTMLSelectElement;
    expect([...target.options].map((o) => o.textContent)).toContain('gone (no such step)');
  });
});

describe('the screen around the form (spec section 5)', () => {
  it('reports nothing for an error of the page itself, and leaves the form usable', async () => {
    const client = fake({});
    const { failures } = open(client);
    const name = await field(/^Name/);
    client.editWorkflow = async () => {
      throw new TypeError('a defect');
    };
    fireEvent.change(name, { target: { value: 'x' } });
    fireEvent.blur(name);
    await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe('Checking...'));
    expect(failures).toEqual([]);
  });

  it('does nothing when it is closed before the server answers', async () => {
    const client = fake({});
    let answer: (value: EditorResponse | undefined) => void = () => undefined;
    let refuse: (error: Error) => void = () => undefined;
    client.editor = () =>
      new Promise((resolve, reject) => {
        answer = resolve;
        refuse = reject;
      });
    open(client);
    cleanup();
    await act(async () => answer(INFO));
    open(client);
    cleanup();
    await act(async () => refuse(new Error('gone')));
    expect(client.edits).toEqual([]);
  });
});
