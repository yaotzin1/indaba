import { readFileSync } from 'node:fs';
import type { EditorCatalog, JsonObject, WorkflowProblem } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  checkLevel,
  contextOf,
  entryEdit,
  entryText,
  type Field,
  fieldPaths,
  fieldsOf,
  headerFields,
  integerOf,
  isOldStyle,
  lineOfPath,
  linesOf,
  nextStepId,
  pathText,
  placeProblems,
  presetEdits,
  presetOf,
  presetValue,
  roleMembers,
  stepMembers,
  unwrap,
  writeGlobs,
} from '../src/form-model.js';

/** specs/web-app-editing-forms, T-09: the form read from the real schema (the CLI's test keeps this file current). */

const schema = JSON.parse(
  readFileSync(new URL('./workflow-schema.json', import.meta.url), 'utf8'),
) as JsonObject;

const catalog: EditorCatalog = {
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
};

const value: JsonObject = {
  version: '1.0',
  name: 'site',
  artifacts: { spec: 'spec.md' },
  defaults: { mcp_policy: 'optional' },
  owner: 'someone',
  roles: { writer: { runner: 'acp', model: 'm', agent: 'claude' }, odd: 'not a mapping' },
  steps: [
    { id: 'build', runner: 'shell', commands: ['npm run build'] },
    {
      id: 'write',
      role: 'ghost',
      runner: ['acp', 'shell'],
      goal: 'Write it.',
      depends_on: ['build', 'gone'],
      on_failure: { action: 'retry_step', target: 'build', max_retries: 2 },
      permissions: { fs: { write: ['src/**'] } },
      guards: [{ type: 'git_diff_empty' }],
      arbiter: 'plugin-judge',
      commands: 3,
    },
    'not a step',
  ],
};

const context = contextOf(value, catalog);
const byKey = (fields: readonly Field[], key: string): Field => {
  const found = fields.find((f) => f.key === key);
  if (found === undefined) throw new Error(`no field ${key}`);
  return found;
};

describe('the fields of the form, from the schema (AC-06, AC-07)', () => {
  it('shows the workflow’s own fields in schema order, then a key the format does not know', () => {
    const fields = headerFields(schema, value);
    expect(fields.map((f) => [f.key, f.kind.kind])).toEqual([
      ['version', 'fixed'],
      ['name', 'text'],
      ['artifacts', 'source'],
      ['mcp_servers', 'source'],
      ['defaults', 'group'],
      ['owner', 'source'],
    ]);
    expect(byKey(fields, 'name')).toMatchObject({ required: true, path: ['name'], value: 'site' });
    expect(byKey(fields, 'owner').kind).toEqual({ kind: 'source', why: 'unknown_key' });
    expect(byKey(fields, 'artifacts').kind).toEqual({ kind: 'source', why: 'not_in_form' });
    const defaults = byKey(fields, 'defaults').kind;
    expect(defaults.kind === 'group' && defaults.fields[0]).toMatchObject({
      key: 'mcp_policy',
      path: ['defaults', 'mcp_policy'],
      kind: { kind: 'choice', choices: [{ value: 'required' }, { value: 'optional' }] },
    });
  });

  it('gives each field the schema’s sentence for it', () => {
    expect(byKey(headerFields(schema, value), 'name').description).toMatch(/^Non-empty string/);
  });

  it('offers a role’s runner from the catalog, and keeps the agent for the source view', () => {
    const [writer, odd] = roleMembers(schema, value, context);
    expect(writer?.name).toBe('writer');
    expect(byKey(writer?.fields ?? [], 'runner').kind).toEqual({
      kind: 'choice',
      choices: [
        { value: 'shell', description: 'Runs command lines.', missing: false },
        { value: 'acp', description: 'An agent over ACP.', missing: false },
      ],
    });
    expect(byKey(writer?.fields ?? [], 'agent').kind.kind).toBe('source');
    expect(odd).toMatchObject({ name: 'odd', mapping: false });
  });

  it('renders a step’s fields with the choices the document and the catalog give', () => {
    const [build, write, notStep] = stepMembers(schema, value, context);
    expect(build?.fields.map((f) => f.key).slice(0, 4)).toEqual(['id', 'role', 'runner', 'agent']);
    const fields = write?.fields ?? [];
    // A role not declared, and an arbiter no plugin registers here, are shown as they are and marked.
    expect(byKey(fields, 'role').kind).toEqual({
      kind: 'choice',
      choices: [
        { value: 'writer', description: '', missing: false },
        { value: 'odd', description: '', missing: false },
        { value: 'ghost', description: '', missing: true },
      ],
    });
    expect(byKey(fields, 'arbiter').kind).toMatchObject({
      kind: 'choice',
      choices: [{ value: 'human' }, { value: 'plugin-judge', missing: true }],
    });
    // A runner chain is a list of names; the goal has several lines.
    expect(byKey(fields, 'runner').kind).toEqual({ kind: 'list' });
    expect(byKey(fields, 'goal').kind).toEqual({ kind: 'text', multiline: true });
    // depends_on offers the other steps, and keeps a dependency that names no step, marked.
    expect(byKey(fields, 'depends_on').kind).toEqual({
      kind: 'multi',
      choices: [
        { value: 'build', description: '', missing: false },
        { value: 'gone', description: '', missing: true },
      ],
    });
    expect(byKey(fields, 'consensus_with').kind).toMatchObject({ kind: 'multi', choices: [{}, {}] });
    expect(byKey(fields, 'permissions').kind).toMatchObject({ kind: 'permissions' });
    expect(byKey(fields, 'guards').kind).toEqual({ kind: 'source', why: 'not_in_form' });
    // A value of a shape the form does not edit goes to the source view, never rewritten.
    expect(byKey(fields, 'commands').kind).toEqual({ kind: 'source', why: 'other_shape' });
    const onFailure = byKey(fields, 'on_failure').kind;
    expect(onFailure.kind === 'group' && onFailure.fields.map((f) => [f.key, f.kind.kind])).toEqual([
      ['action', 'choice'],
      ['target', 'choice'],
      ['max_retries', 'integer'],
    ]);
    expect(notStep).toMatchObject({ name: '', mapping: false });
  });

  it('sends a value of another shape to the source view for every kind', () => {
    const steps = stepMembers(
      schema,
      { steps: [{ id: 7, isolation: 3, on_failure: 'retry', depends_on: [1], decision_type: ['x'] }] },
      context,
    );
    const fields = steps[0]?.fields ?? [];
    for (const key of ['id', 'isolation', 'on_failure', 'depends_on', 'decision_type']) {
      expect(byKey(fields, key).kind, key).toEqual({ kind: 'source', why: 'other_shape' });
    }
    const failure = stepMembers(schema, { steps: [{ on_failure: { max_retries: 'two' } }] }, context);
    const group = byKey(failure[0]?.fields ?? [], 'on_failure').kind;
    expect(group.kind === 'group' && byKey(group.fields, 'max_retries').kind.kind).toBe('source');
  });

  it('reads an anyOf branch by the value’s type, and a value no branch fits as another shape', () => {
    const chain = { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] };
    const props = { type: 'object', properties: { a: chain, b: { type: 'boolean' }, c: { type: 'number' } } };
    const fields = fieldsOf(props, { a: { x: 1 }, b: true }, []);
    expect(fields.map((f) => f.kind.kind)).toEqual(['source', 'boolean', 'source']);
    expect(fieldsOf(props, { b: 'yes' }, [])[1]?.kind.kind).toBe('source');
    expect(fieldsOf({ type: 'object', properties: { o: { type: 'object' } } }, {}, [])[0]?.kind.kind).toBe(
      'source',
    );
    expect(fieldsOf({ type: 'object', properties: { o: { anyOf: [] } } }, {}, [])[0]?.kind.kind).toBe(
      'source',
    );
  });

  it('takes the “or null” off a schema, keeping its sentence', () => {
    expect(unwrap({ anyOf: [{ type: 'string' }, { type: 'null' }], description: 'd' })).toEqual({
      type: 'string',
      description: 'd',
    });
    expect(unwrap({ anyOf: [{ type: 'string', description: 'own' }, { type: 'null' }] })).toEqual({
      type: 'string',
      description: 'own',
    });
    const two = { anyOf: [{ type: 'string' }, { type: 'array' }] };
    expect(unwrap(two)).toBe(two);
  });

  it('lists every path a field is shown at, those inside groups too', () => {
    const fields = stepMembers(schema, value, context)[1]?.fields ?? [];
    const paths = fieldPaths(fields);
    expect(paths).toContain('$.steps[1].goal');
    expect(paths).toContain('$.steps[1].on_failure.max_retries');
    expect(pathText([])).toBe('$');
    expect(pathText(['steps', 0, 'id'])).toBe('$.steps[0].id');
  });
});

describe('where each problem is shown (AC-11)', () => {
  const p = (path: string | undefined): WorkflowProblem => ({
    message: `at ${path ?? 'nowhere'}`,
    ...(path === undefined ? {} : { path }),
  });

  it('at its field, the nearest field above it, its step, or the top', () => {
    const placed = placeProblems(
      [
        p('$.steps[0].role'),
        p('$.steps[0].commands[1]'),
        p('$.steps[1]'),
        p('$.steps[1].guards[0].type'),
        p('$.mcp_servers.files'),
        p('$'),
        p(undefined),
      ],
      ['$.steps[0].role', '$.steps[0].commands', '$.name'],
    );
    expect([...placed.byField.entries()].map(([k, v]) => [k, v.length])).toEqual([
      ['$.steps[0].role', 1],
      ['$.steps[0].commands', 1],
    ]);
    expect(placed.byStep.get(1)?.map((x) => x.path)).toEqual(['$.steps[1]', '$.steps[1].guards[0].type']);
    expect(placed.top.map((x) => x.path)).toEqual(['$.mcp_servers.files', '$', undefined]);
  });
});

describe('the permissions presets (AC-09, C-04)', () => {
  it('names each preset exactly, and anything else custom', () => {
    expect(presetOf(undefined)).toBe('none');
    expect(presetOf(null)).toBe('none');
    expect(presetOf({ fs: { write: [] }, terminal: 'deny' })).toBe('read_only');
    expect(presetOf({ fs: { read: ['docs/**'] } })).toBe('read_only');
    expect(presetOf({})).toBe('read_only');
    expect(presetOf({ fs: { write: ['src/**', 'test/**'] }, terminal: 'deny' })).toBe('folders');
    expect(presetOf({ fs: { write: ['**'] }, terminal: 'allow' })).toBe('full');
    for (const custom of [
      { fs: { write: ['**'] } },
      { fs: { write: ['src/**'] }, terminal: 'allow' },
      { fs: { write: [] }, terminal: 'maybe' },
      { fs: { write: 'src' } },
      { fs: { read: [1] } },
      { fs: { delete: [] } },
      { fs: 'all' },
      { network: 'allow' },
      'read-only',
    ]) {
      expect(presetOf(custom), JSON.stringify(custom)).toBe('custom');
    }
  });

  it('writes a preset with its level, keeping what the step may read (specs/agent-permissions, AC-16)', () => {
    const current = { fs: { read: ['docs/**'], write: ['x'] }, terminal: 'allow' };
    expect(presetValue('none', current, [])).toBeUndefined();
    expect(presetValue('read_only', current, [])).toEqual({ level: 'read', fs: { read: ['docs/**'] } });
    expect(presetValue('read_only', undefined, [])).toEqual({ level: 'read' });
    expect(presetValue('folders', undefined, ['src/**'])).toEqual({
      level: 'edit',
      fs: { write: ['src/**'] },
    });
    expect(presetValue('full', current, [])).toEqual({ level: 'full' });
    for (const preset of ['read_only', 'folders', 'full'] as const) {
      expect(presetOf(presetValue(preset, current, ['src/**']))).toBe(preset);
    }
    expect(writeGlobs(current)).toEqual(['x']);
    expect(writeGlobs(undefined)).toEqual([]);
  });

  it('reads a block with a level as the preset it is, and any other shape as custom', () => {
    expect(presetOf({ level: 'read' })).toBe('read_only');
    expect(presetOf({ level: 'read', fs: { read: ['docs/**'] }, terminal: 'deny' })).toBe('read_only');
    expect(presetOf({ level: 'edit', fs: { write: ['src/**'] } })).toBe('folders');
    expect(presetOf({ level: 'full' })).toBe('full');
    for (const custom of [
      { level: 'read', fs: { write: ['src/**'] } },
      { level: 'read', terminal: 'allow' },
      { level: 'edit' },
      { level: 'edit', fs: { write: ['src/**'] }, terminal: 'allow' },
      { level: 'edit', fs: { write: ['**'] } },
      { level: 'full', fs: { write: ['**'] } },
      { level: 'full', terminal: 'allow' },
      { level: 'sometimes' },
    ]) {
      expect(presetOf(custom), JSON.stringify(custom)).toBe('custom');
    }
  });

  it('shows the old shapes under their names, marked old style, and the old full access is not the level full', () => {
    const oldFull = { fs: { write: ['**'] }, terminal: 'allow' };
    expect(presetOf(oldFull)).toBe('full');
    expect(isOldStyle(oldFull)).toBe(true);
    expect(isOldStyle({ fs: { write: ['src/**'] } })).toBe(true);
    expect(isOldStyle({ fs: { write: [] }, terminal: 'deny' })).toBe(true);
    expect(isOldStyle({ level: 'full' })).toBe(false);
    expect(isOldStyle({ level: 'edit', fs: { write: ['src/**'] } })).toBe(false);
    expect(isOldStyle(undefined)).toBe(false);
    expect(isOldStyle({ fs: { write: ['**'] }, network: 'x' })).toBe(false);
  });

  it('switches presets with one edit per path, removing the keys the new shape forbids', () => {
    const path = ['steps', 0, 'permissions'];
    const old = { fs: { read: ['docs/**'], write: ['src/**'] }, terminal: 'allow' };
    expect(presetEdits('read_only', old, path, [])).toEqual([
      { op: 'set', path: [...path, 'level'], value: 'read' },
      { op: 'remove', path: [...path, 'fs', 'write'] },
      { op: 'remove', path: [...path, 'terminal'] },
    ]);
    expect(presetEdits('full', old, path, [])).toEqual([
      { op: 'set', path: [...path, 'level'], value: 'full' },
      { op: 'remove', path: [...path, 'fs'] },
      { op: 'remove', path: [...path, 'terminal'] },
    ]);
    expect(presetEdits('folders', { level: 'read' }, path, ['src/**'])).toEqual([
      { op: 'set', path: [...path, 'level'], value: 'edit' },
      { op: 'set', path: [...path, 'fs'], value: { write: ['src/**'] } },
    ]);
    expect(presetEdits('folders', old, path, ['lib/**'])).toEqual([
      { op: 'set', path: [...path, 'level'], value: 'edit' },
      { op: 'set', path: [...path, 'fs', 'write'], value: ['lib/**'] },
      { op: 'remove', path: [...path, 'terminal'] },
    ]);
    // Only a write list: the whole fs goes. Something odd in fs goes too.
    expect(presetEdits('read_only', { fs: { write: ['x'] } }, path, [])).toEqual([
      { op: 'set', path: [...path, 'level'], value: 'read' },
      { op: 'remove', path: [...path, 'fs'] },
    ]);
    expect(presetEdits('read_only', { fs: 'all' }, path, [])).toEqual([
      { op: 'set', path: [...path, 'level'], value: 'read' },
      { op: 'remove', path: [...path, 'fs'] },
    ]);
    expect(presetEdits('read_only', { level: 'full' }, path, [])).toEqual([
      { op: 'set', path: [...path, 'level'], value: 'read' },
    ]);
    // Nothing there, or not a mapping: the block is written whole; "not set" removes the key.
    expect(presetEdits('full', undefined, path, [])).toEqual([{ op: 'set', path, value: { level: 'full' } }]);
    expect(presetEdits('read_only', 'odd', path, [])).toEqual([
      { op: 'set', path, value: { level: 'read' } },
    ]);
    expect(presetEdits('none', old, path, [])).toEqual([{ op: 'remove', path }]);
  });

  it('checks a level against the runners of a step from the catalog alone (AC-16, AC-17)', () => {
    const native = { mode: 'native', scope: 'guard', note: 'plan_mode' } as const;
    const levels = {
      read: native,
      edit: { mode: 'after', scope: 'guard', note: 'commands_not_limited' },
      full: { mode: 'native', scope: 'none', note: 'bypass_permissions' },
    } as const;
    const noRead = {
      ...levels,
      read: { mode: 'unsupported', scope: 'none', note: 'no_read_only_argument' },
    } as const;
    expect(checkLevel([{ runner: 'a', levels }], 'read')).toEqual({
      kind: 'ok',
      runners: [{ runner: 'a', checkedAfter: true, commandsNotLimited: false }],
    });
    expect(checkLevel([{ runner: 'a', levels }], 'edit')).toEqual({
      kind: 'ok',
      runners: [{ runner: 'a', checkedAfter: true, commandsNotLimited: true }],
    });
    expect(checkLevel([{ runner: 'a', levels }], 'full')).toEqual({
      kind: 'ok',
      runners: [{ runner: 'a', checkedAfter: false, commandsNotLimited: false }],
    });
    // Any runner of the chain that cannot hold it refuses it, naming that runner and the note.
    expect(
      checkLevel(
        [
          { runner: 'a', levels },
          { runner: 'b', levels: noRead },
        ],
        'read',
      ),
    ).toEqual({ kind: 'refused', runner: 'b', note: 'no_read_only_argument' });
    // A catalog that says nothing (an older server), or no runner at all, refuses nothing.
    expect(checkLevel([{ runner: 'a', levels: undefined }], 'read')).toEqual({ kind: 'unknown' });
    expect(checkLevel([], 'full')).toEqual({ kind: 'unknown' });
  });

  it('gives a step the runners of its own list, else of its role, with what the catalog says', () => {
    const levels = {
      read: { mode: 'native', scope: 'guard', note: 'x' },
      edit: { mode: 'native', scope: 'guard', note: 'x' },
      full: { mode: 'native', scope: 'none', note: 'x' },
    } as const;
    const withLevels: EditorCatalog = {
      ...catalog,
      runners: [
        { name: 'shell', description: '' },
        { name: 'acp', description: '', permissions: levels },
        { name: 'codex', description: '', permissions: levels },
      ],
    };
    const doc: JsonObject = {
      version: '1.0',
      name: 'x',
      roles: { writer: { runner: ['acp', 'codex'] }, odd: 'not a mapping' },
      steps: [
        { id: 'a', role: 'writer', goal: 'g' },
        { id: 'b', runner: 'codex', role: 'writer', goal: 'g' },
        { id: 'c', role: 'odd', goal: 'g' },
        { id: 'd', runner: 'shell', commands: ['x'] },
        { id: 'e', runner: 'ghost', goal: 'g' },
      ],
    };
    const kinds = stepMembers(schema, doc, contextOf(doc, withLevels)).map((member) => {
      const kind = byKey(member.fields, 'permissions').kind;
      return kind.kind === 'permissions' ? kind.runners.map((r) => [r.runner, r.levels !== undefined]) : [];
    });
    expect(kinds).toEqual([
      [
        ['acp', true],
        ['codex', true],
      ],
      [['codex', true]],
      [],
      [['shell', false]],
      [['ghost', false]],
    ]);
  });
});

describe('entries and edits (AC-08, AC-10)', () => {
  const field = (over: Partial<Field>): Field => ({
    key: 'goal',
    path: ['steps', 0, 'goal'],
    description: '',
    required: false,
    value: 'old',
    kind: { kind: 'text', multiline: false },
    ...over,
  });

  it('sets a changed value, removes a cleared optional one, and makes no edit otherwise', () => {
    expect(entryEdit(field({}), 'new')).toEqual({
      kind: 'edit',
      edit: { op: 'set', path: ['steps', 0, 'goal'], value: 'new' },
    });
    expect(entryEdit(field({}), 'old')).toEqual({ kind: 'unchanged' });
    expect(entryEdit(field({}), '')).toEqual({
      kind: 'edit',
      edit: { op: 'remove', path: ['steps', 0, 'goal'] },
    });
    expect(entryEdit(field({ value: undefined }), '')).toEqual({ kind: 'unchanged' });
    expect(entryEdit(field({}), [])).toMatchObject({ kind: 'edit', edit: { op: 'remove' } });
    expect(entryEdit(field({ value: ['a'] }), ['a'])).toEqual({ kind: 'unchanged' });
    expect(entryEdit(field({ required: true }), '')).toEqual({ kind: 'required' });
    expect(entryEdit(field({}), undefined)).toMatchObject({ kind: 'edit', edit: { op: 'remove' } });
  });

  it('reads whole numbers, lines and a value’s text', () => {
    expect(integerOf(' 3 ')).toBe(3);
    expect(integerOf('-1')).toBe(-1);
    expect(integerOf('1.5')).toBeUndefined();
    expect(integerOf('')).toBeUndefined();
    expect(integerOf('99999999999999999999')).toBeUndefined();
    expect(linesOf(' a \n\n b\n')).toEqual(['a', 'b']);
    expect(entryText(undefined)).toBe('');
    expect(entryText(null)).toBe('');
    expect(entryText(['a', 3, 'b'])).toBe('a\nb');
    expect(entryText(2)).toBe('2');
    expect(entryText({ a: 1 })).toBe('');
  });

  it('names a new step step-N with the smallest N not taken (C-05)', () => {
    expect(nextStepId([])).toBe('step-1');
    expect(nextStepId(['step-1', 'step-3', 'build'])).toBe('step-2');
  });

  it('reads the context of a document with no roles or steps', () => {
    expect(contextOf({}, catalog)).toEqual({ catalog, roles: [], stepIds: [] });
    expect(headerFields(schema, {}).find((f) => f.key === 'name')?.value).toBeUndefined();
  });
});

describe('the line of a field in the text (AC-07)', () => {
  const YAML = [
    '# A workflow.', //  1
    'version: "1.0"', // 2
    'name: x', // 3
    'roles:', // 4
    '  writer:', // 5
    '    runner: acp', // 6
    '    agent: claude', // 7
    'steps:', // 8
    '  - id: build', // 9
    '    runner: shell', // 10
    '    guards:', // 11
    '      - type: git_diff_empty', // 12
    '  - runner: shell', // 13
    '    id: "check"', // 14
    '    on_failure:', // 15
    '      action: fail', // 16
    '    guards: []', // 17
    '',
  ].join('\n');
  const ids = ['build', 'check'];

  it('finds a top-level key, a role’s key and a step’s key', () => {
    expect(lineOfPath(YAML, ['name'], ids)).toBe(3);
    expect(lineOfPath(YAML, ['roles', 'writer', 'agent'], ids)).toBe(7);
    expect(lineOfPath(YAML, ['steps', 0, 'guards'], ids)).toBe(11);
    // A step whose id is not its first key: from the dash that opens it.
    expect(lineOfPath(YAML, ['steps', 1, 'runner'], ids)).toBe(13);
    expect(lineOfPath(YAML, ['steps', 1, 'guards'], ids)).toBe(17);
    expect(lineOfPath(YAML, ['steps', 1, 'on_failure', 'action'], ids)).toBe(16);
  });

  it('falls back to the nearest line it can find, or to none', () => {
    expect(lineOfPath(YAML, ['mcp_servers'], ids)).toBeUndefined();
    expect(lineOfPath(YAML, [], ids)).toBeUndefined();
    expect(lineOfPath(YAML, ['steps', 2, 'id'], ids)).toBe(8);
    expect(lineOfPath(YAML, ['steps', 0, 'id'], ['ghost'])).toBe(8);
    expect(lineOfPath(YAML, ['roles', 'nobody', 'agent'], ids)).toBe(4);
    expect(lineOfPath(YAML, ['steps', 0, 'guards', 0, 'type'], ids)).toBe(11);
    expect(lineOfPath(YAML, ['roles', 'writer', 'nothing'], ids)).toBe(5);
  });
});

describe('keys and values the format may gain (question-contract, review-gate, agent-permissions)', () => {
  it('keeps a review key on a step and in defaults as a field of the source view, not dropped', () => {
    const doc = {
      version: '1.0',
      name: 'x',
      defaults: { mcp_policy: 'required', review: { by: 'person' } },
      steps: [{ id: 'a', runner: 'shell', commands: ['x'], review: { required: true } }],
    };
    const review = stepMembers(schema, doc, contextOf(doc, catalog))[0]?.fields.find(
      (f) => f.key === 'review',
    );
    expect(review).toMatchObject({
      path: ['steps', 0, 'review'],
      kind: { kind: 'source', why: 'unknown_key' },
    });
    const defaults = headerFields(schema, doc).find((f) => f.key === 'defaults')?.kind;
    expect(defaults?.kind === 'group' && defaults.fields.find((f) => f.key === 'review')).toMatchObject({
      path: ['defaults', 'review'],
      kind: { kind: 'source', why: 'unknown_key' },
    });
  });

  it('reads a permission level it does not know as Custom, which the form never changes by itself', () => {
    expect(presetOf({ fs: { write: [] }, terminal: 'ask' })).toBe('custom');
    expect(presetOf({ level: 'ask' })).toBe('custom');
    expect(presetOf({ fs: { write: ['src/**'] }, terminal: 'deny', level: 'ask' })).toBe('custom');
  });
});
