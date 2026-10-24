import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLogger,
  type EditorResponse,
  type EditWorkflowRequest,
  type LogRecord,
  type WorkflowEditResponse,
} from '@indaba/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_EDITS,
  MAX_KEY_LENGTH,
  MAX_PATH_PARTS,
  MAX_SOURCE_BODY_BYTES,
  MAX_SOURCE_BYTES,
  MAX_VALUE_DEPTH,
  type ServerHandle,
  startServer,
  type WorkflowEditor,
  WorkflowEditorError,
} from '../src/index.js';
import { editsOf } from '../src/workflow-editor.js';

/** specs/web-app-editing-forms, T-02 and T-03: the editor resources over HTTP, over an editor that is a fake. */

const TOKEN = ['editor', 'q'.repeat(24)].join('_');
const TEXT = 'version: "1.0"\nname: demo\nsteps: []\n';

let base: string;
let server: ServerHandle | undefined;
let logged: LogRecord[];
let edits: EditWorkflowRequest[];
let refusal: Error | undefined;

const info: EditorResponse = {
  schema: { type: 'object', properties: { name: { type: 'string' } } },
  catalog: {
    catalog: 1,
    runners: [{ name: 'shell', description: 'Runs commands.' }],
    guards: [],
    arbiters: [{ name: 'human', description: 'A person decides.' }],
    voters: [],
    prompts: [],
    values: {
      decisionTypes: ['consensus'],
      isolation: ['none'],
      failureActions: ['fail'],
      mcpPolicies: ['required'],
      promptAdditions: [],
    },
  },
};

const answer: WorkflowEditResponse = {
  text: 'version: "1.0"\nname: renamed\nsteps: []\n',
  value: { version: '1.0', name: 'renamed', steps: [] },
  problems: [{ message: 'steps must have at least one step', path: '$.steps', line: 3, column: 8 }],
};

const editor: WorkflowEditor = {
  info: () => info,
  edit: (req) => {
    edits.push(req);
    if (refusal !== undefined) throw refusal;
    return answer;
  },
};

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'indaba-editor-'));
  await mkdir(join(base, 'project', '.indaba', 'traces'), { recursive: true });
  await mkdir(join(base, 'site'), { recursive: true });
  await writeFile(join(base, 'site', 'index.html'), '<!doctype html>');
  logged = [];
  edits = [];
  refusal = undefined;
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(base, { recursive: true, force: true });
});

async function start(withEditor = true): Promise<ServerHandle> {
  server = await startServer({
    roots: [join(base, 'project')],
    staticDir: join(base, 'site'),
    token: TOKEN,
    logger: createLogger({
      sinks: [{ write: (record) => logged.push(record) }],
      clock: () => new Date('2026-10-23T12:00:00.000Z'),
      level: 'debug',
    }),
    ...(withEditor ? { workflowEditor: editor } : {}),
  });
  return server;
}

interface Answer {
  readonly status: number;
  readonly allow: string | undefined;
  readonly body: Record<string, unknown>;
}

function send(
  path: string,
  options: { method?: string; body?: string; type?: string; origin?: string | null; auth?: boolean } = {},
): Promise<Answer> {
  const method = options.method ?? 'GET';
  const origin =
    options.origin === undefined
      ? method === 'GET'
        ? undefined
        : `http://127.0.0.1:${server?.port}`
      : options.origin;
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: server?.port,
        method,
        path,
        headers: {
          Host: `127.0.0.1:${server?.port}`,
          ...(options.auth === false ? {} : { Authorization: `Bearer ${TOKEN}` }),
          ...(options.type === undefined ? {} : { 'Content-Type': options.type }),
          ...(origin === null || origin === undefined ? {} : { Origin: origin }),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(text) as Record<string, unknown>;
          } catch {
            // not JSON
          }
          resolve({ status: res.statusCode ?? 0, allow: res.headers.allow, body });
        });
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

const EDIT = '/api/v1/workflows/edit';
const post = (value: unknown, extra: Parameters<typeof send>[1] = {}) =>
  send(EDIT, { method: 'POST', body: JSON.stringify(value), type: 'application/json', ...extra });

/** A value `depth` levels deep: an array inside an array, around a string. */
function nested(depth: number): unknown {
  let value: unknown = 'x';
  for (let i = 0; i < depth; i += 1) {
    value = [value];
  }
  return value;
}

describe('the editor resources (AC-01 to AC-03)', () => {
  it('answers the schema and the catalog', async () => {
    await start();
    const got = await send('/api/v1/editor');
    expect(got.status).toBe(200);
    expect(got.body).toEqual(info);
  });

  it('applies edits through the editor and answers its result', async () => {
    await start();
    const got = await post({ text: TEXT, edits: [{ op: 'set', path: ['name'], value: 'renamed' }] });
    expect(got.status).toBe(200);
    expect(got.body).toEqual(answer);
    expect(edits).toEqual([{ text: TEXT, edits: [{ op: 'set', path: ['name'], value: 'renamed' }] }]);
  });

  it('passes each kind of edit with only its own fields, and nothing else of the body', async () => {
    await start();
    const sent = [
      { op: 'set', path: ['steps', 0, 'goal'], value: { a: [1, true, null] }, extra: 'dropped' },
      { op: 'remove', path: ['steps', 0, 'role'], value: 'dropped' },
      { op: 'addStep', step: { id: 'b', runner: 'shell' }, after: 'a', path: ['dropped'] },
      { op: 'addStep', step: { id: 'c' } },
      { op: 'removeStep', id: 'b', after: 'dropped' },
      { op: 'moveStep', id: 'a', after: 'c' },
      { op: 'moveStep', id: 'a' },
    ];
    const got = await post({ text: TEXT, edits: sent, path: '../../etc/passwd', id: 'x' });
    expect(got.status).toBe(200);
    expect(edits).toEqual([
      {
        text: TEXT,
        edits: [
          { op: 'set', path: ['steps', 0, 'goal'], value: { a: [1, true, null] } },
          { op: 'remove', path: ['steps', 0, 'role'] },
          { op: 'addStep', step: { id: 'b', runner: 'shell' }, after: 'a' },
          { op: 'addStep', step: { id: 'c' } },
          { op: 'removeStep', id: 'b' },
          { op: 'moveStep', id: 'a', after: 'c' },
          { op: 'moveStep', id: 'a' },
        ],
      },
    ]);
  });

  it('keeps a key named __proto__ as an own key, so the editor can refuse it by name', async () => {
    await start();
    const body = `{"text":${JSON.stringify(TEXT)},"edits":[{"op":"set","path":["x"],"value":{"__proto__":{"polluted":1}}}]}`;
    const got = await send(EDIT, { method: 'POST', body, type: 'application/json' });
    expect(got.status).toBe(200);
    const edit = edits[0]?.edits[0];
    const value = edit?.op === 'set' ? edit.value : undefined;
    expect(typeof value).toBe('object');
    expect(Object.keys(value ?? {})).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('maps the editor’s two refusals to 422, with the first line of its sentence', async () => {
    await start();
    refusal = new WorkflowEditorError('not_editable', 'invalid YAML: bad at line 1\n\n  a: [\n  ^\n');
    const unreadable = await post({ text: 'a: [', edits: [] });
    expect(unreadable.status).toBe(422);
    expect(unreadable.body).toMatchObject({ code: 'not_editable' });
    expect(String(unreadable.body.message)).toContain('invalid YAML: bad at line 1');
    expect(String(unreadable.body.message)).not.toContain('a: [');

    refusal = new WorkflowEditorError('edit_refused', 'the key "__proto__" is not allowed', {
      index: 0,
      path: '$.__proto__',
    });
    const refused = await post({ text: TEXT, edits: [{ op: 'remove', path: ['__proto__'] }] });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'edit_refused', index: 0, path: '$.__proto__' });
    expect(logged.filter((r) => r.message === 'edit refused').map((r) => r.fields)).toEqual([
      { code: 'not_editable' },
      { code: 'edit_refused', index: 0 },
    ]);
  });

  it('recognises a refusal by its name and code, as one from another copy of the package would be', async () => {
    await start();
    const copy = Object.assign(new Error('no step has the id "z"'), {
      name: 'WorkflowEditorError',
      code: 'edit_refused',
      detail: { index: 2 },
    });
    refusal = copy;
    const got = await post({ text: TEXT, edits: [] });
    expect(got.status).toBe(422);
    expect(got.body).toMatchObject({ code: 'edit_refused', index: 2 });
    expect(got.body).not.toHaveProperty('path');
  });

  it('treats an unknown code, a refusal without its index, or another error as a fault', async () => {
    await start();
    for (const error of [
      new WorkflowEditorError('something_else', 'x'),
      new WorkflowEditorError('edit_refused', 'x'),
      new TypeError('a defect'),
    ]) {
      refusal = error;
      expect((await post({ text: TEXT, edits: [] })).status).toBe(500);
    }
  });

  it('says the contract version 1.5.0', async () => {
    await start();
    expect((await send('/api/v1/contract')).body).toEqual({ contractVersion: '1.5.0' });
  });
});

describe('a server without an editor (AC-13)', () => {
  it('answers 404 editor_unavailable and allows no POST', async () => {
    await start(false);
    const got = await send('/api/v1/editor');
    expect(got.status).toBe(404);
    expect(got.body).toMatchObject({ code: 'editor_unavailable' });
    const posted = await post({ text: TEXT, edits: [] });
    expect(posted.status).toBe(405);
    expect(posted.allow).toBe('GET');
    expect(edits).toEqual([]);
  });

  it('answers 404 to a GET of the edit address, without an editor', async () => {
    await start(false);
    expect((await send(EDIT)).body).toMatchObject({ code: 'editor_unavailable' });
  });
});

describe('the checks of an edit request (AC-13)', () => {
  it('takes only POST on the edit address, and only GET on the editor', async () => {
    await start();
    const got = await send(EDIT);
    expect(got.status).toBe(405);
    expect(got.allow).toBe('POST');
    expect(
      (await send('/api/v1/editor', { method: 'POST', body: '{}', type: 'application/json' })).status,
    ).toBe(405);
  });

  it('takes no edit without the page’s own Origin or the token', async () => {
    await start();
    expect((await post({ text: TEXT, edits: [] }, { origin: null })).status).toBe(403);
    expect((await post({ text: TEXT, edits: [] }, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await post({ text: TEXT, edits: [] }, { auth: false })).status).toBe(401);
    expect((await send('/api/v1/editor', { auth: false })).status).toBe(401);
    expect(edits).toEqual([]);
  });

  it('refuses a body of the wrong type, size or shape before the editor sees it', async () => {
    await start();
    expect((await send(EDIT, { method: 'POST', body: '{}', type: 'text/plain' })).status).toBe(415);
    expect((await send(EDIT, { method: 'POST', body: '{', type: 'application/json' })).status).toBe(400);
    expect((await post({ edits: [] })).status).toBe(400);
    expect((await post({ text: 3, edits: [] })).status).toBe(400);
    expect((await post({ text: TEXT })).status).toBe(400);
    expect((await post({ text: TEXT, edits: {} })).status).toBe(400);
    // Multibyte characters count as bytes.
    expect((await post({ text: 'é'.repeat(MAX_SOURCE_BYTES / 2 + 1), edits: [] })).status).toBe(413);
    expect((await post({ text: 'x'.repeat(MAX_SOURCE_BODY_BYTES), edits: [] })).status).toBe(413);
    expect(edits).toEqual([]);
  });

  it('names the edit it refuses by its index and never repeats a value', async () => {
    await start();
    const got = await post({
      text: TEXT,
      edits: [
        { op: 'remove', path: ['ok'] },
        { op: 'eval', code: 'SECRET' },
      ],
    });
    expect(got.status).toBe(400);
    expect(got.body.message).toBe('Edit 1 is not an edit the page can make.');
    expect(JSON.stringify(got.body)).not.toContain('SECRET');
    expect(JSON.stringify(logged)).not.toContain('SECRET');
  });
});

describe('editsOf: the limits of an edit (AC-13)', () => {
  const ok = (edit: unknown) => editsOf({ edits: [edit] }).ok;

  it('takes at most MAX_EDITS edits', () => {
    const one = { op: 'remove', path: ['a'] };
    expect(editsOf({ edits: Array.from({ length: MAX_EDITS }, () => one) }).ok).toBe(true);
    expect(editsOf({ edits: Array.from({ length: MAX_EDITS + 1 }, () => one) })).toEqual({
      ok: false,
      message: `The request carries more than ${MAX_EDITS} edits.`,
    });
    expect(editsOf([]).ok).toBe(false);
    expect(editsOf(null).ok).toBe(false);
  });

  it('takes a path of 1 to MAX_PATH_PARTS keys and indexes, each bounded', () => {
    expect(ok({ op: 'remove', path: Array.from({ length: MAX_PATH_PARTS }, () => 'a') })).toBe(true);
    expect(ok({ op: 'remove', path: Array.from({ length: MAX_PATH_PARTS + 1 }, () => 'a') })).toBe(false);
    expect(ok({ op: 'remove', path: [] })).toBe(false);
    expect(ok({ op: 'remove', path: 'steps' })).toBe(false);
    expect(ok({ op: 'remove', path: ['a'.repeat(MAX_KEY_LENGTH)] })).toBe(true);
    expect(ok({ op: 'remove', path: ['a'.repeat(MAX_KEY_LENGTH + 1)] })).toBe(false);
    expect(ok({ op: 'remove', path: ['steps', 0] })).toBe(true);
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 2, null, true, {}]) {
      expect(ok({ op: 'remove', path: ['steps', bad] })).toBe(false);
    }
  });

  it('takes a value at most MAX_VALUE_DEPTH levels deep, of JSON only', () => {
    expect(ok({ op: 'set', path: ['a'], value: nested(MAX_VALUE_DEPTH) })).toBe(true);
    expect(ok({ op: 'set', path: ['a'], value: nested(MAX_VALUE_DEPTH + 1) })).toBe(false);
    expect(ok({ op: 'set', path: ['a'], value: { b: nested(MAX_VALUE_DEPTH) } })).toBe(false);
    expect(ok({ op: 'set', path: ['a'], value: null })).toBe(true);
    expect(ok({ op: 'set', path: ['a'] })).toBe(false);
    expect(ok({ op: 'set', path: ['a'], value: Number.POSITIVE_INFINITY })).toBe(false);
    expect(ok({ op: 'set', path: ['a'], value: () => 1 })).toBe(false);
  });

  it('takes a step that is an object, and an id and an after that are bounded names', () => {
    expect(ok({ op: 'addStep', step: { id: 'a' } })).toBe(true);
    expect(ok({ op: 'addStep', step: ['a'] })).toBe(false);
    expect(ok({ op: 'addStep', step: { id: nested(MAX_VALUE_DEPTH) } })).toBe(false);
    expect(ok({ op: 'addStep', step: { id: 'a' }, after: '' })).toBe(false);
    expect(ok({ op: 'removeStep', id: 'a'.repeat(MAX_KEY_LENGTH) })).toBe(true);
    expect(ok({ op: 'removeStep', id: 'a'.repeat(MAX_KEY_LENGTH + 1) })).toBe(false);
    expect(ok({ op: 'removeStep', id: '' })).toBe(false);
    expect(ok({ op: 'moveStep', id: 'a', after: 3 })).toBe(false);
    expect(ok({ op: 'moveStep' })).toBe(false);
    expect(ok('remove')).toBe(false);
    expect(ok({ path: ['a'] })).toBe(false);
  });
});
