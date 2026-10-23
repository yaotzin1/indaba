import { chmod, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger, type LogRecord, Span, SpanStarted, WorkflowValidationError } from '@indaba/core';
import { parseWorkflow, RunEventWriter } from '@indaba/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RunChild, RunStarter, StartOptions } from '../src/run-child.js';
import {
  ConfirmationStore,
  contentHash,
  MAX_HASHES_PER_WORKFLOW,
  MAX_USE_ITEM,
  summaryOfUse,
} from '../src/run-control/confirm.js';
import { createRunControl, RUN_INPUTS, RunControlError } from '../src/run-control/index.js';
import {
  MAX_WORKFLOW_BYTES,
  readWorkflow,
  SCAN_MAX_DEPTH,
  SCAN_MAX_FILES,
  scanRoots,
  workflowId,
} from '../src/run-control/scan.js';
import { makeTempDir } from './support.js';

/** Shaped like a key, built from parts so no file holds one (the security audit scans tests too). */
const FAKE_KEY = ['sk', 'or', 'v1', 'abcdefghijklmnopqrstuvwxyz0123'].join('-');

/** specs/web-app-actions, T-09, T-11 and T-12: the scan, the confirmation and the run control, with a fake child. */

const WORKFLOW = `version: "1.0"
name: demo
steps:
  - id: build
    runner: shell
    commands:
      - node -e "process.exit(0)"
`;

const RICH = `version: "1.0"
name: rich
roles:
  coder:
    runner: acp
    agent:
      command: [my-agent, --serve]
mcp_servers:
  files:
    command: npx
    args: [files-server, --root, .]
  remote:
    url: https://mcp.example.test/sse
steps:
  - id: build
    runner: shell
    commands:
      - npm test
  - id: write
    role: coder
    goal: write it
    permissions:
      fs:
        read: [src]
        write: []
      terminal: deny
  - id: argue
    role: coder
    goal: argue
    decision_type: consensus
    arbiter: human
    depends_on: [write]
`;

async function project(files: Readonly<Record<string, string>> = { 'demo.workflow.ai.yml': WORKFLOW }) {
  const root = await makeTempDir();
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...path.split('/')), text);
  }
  return root;
}

describe('the scan (T-09)', () => {
  it('finds workflow files, nested and default, and nothing else', async () => {
    const root = await project({
      'a.workflow.ai.yml': WORKFLOW,
      'deep/er/b.workflow.ai.yaml': WORKFLOW,
      '.indaba/workflow.ai.yml': WORKFLOW,
      '.indaba/run-inputs/web-abc.yml': WORKFLOW,
      '.indaba/worktrees/t/c.workflow.ai.yml': WORKFLOW,
      'node_modules/x/d.workflow.ai.yml': WORKFLOW,
      '.git/e.workflow.ai.yml': WORKFLOW,
      'sub/.indaba/workflow.ai.yml': WORKFLOW,
      'notes.yml': WORKFLOW,
      'workflow.ai.yml': 'governance: {}\n',
    });
    const scan = await scanRoots([root]);
    expect(scan.found.map((f) => f.path).sort()).toEqual([
      '.indaba/workflow.ai.yml',
      'a.workflow.ai.yml',
      'deep/er/b.workflow.ai.yaml',
    ]);
    expect(scan.truncated).toBe(false);
  });

  it('stops at its depth', async () => {
    const deep = `${Array.from({ length: SCAN_MAX_DEPTH + 1 }, (_, i) => `d${i}`).join('/')}/x.workflow.ai.yml`;
    const near = `${Array.from({ length: SCAN_MAX_DEPTH }, (_, i) => `d${i}`).join('/')}/y.workflow.ai.yml`;
    const root = await project({ [deep]: WORKFLOW, [near]: WORKFLOW });
    expect((await scanRoots([root])).found.map((f) => f.path)).toEqual([near]);
  });

  it('follows no link, to a folder or a file', async () => {
    const outside = await project({ 'secret.workflow.ai.yml': WORKFLOW });
    const root = await project({});
    await symlink(outside, join(root, 'linked'), 'dir');
    await symlink(join(outside, 'secret.workflow.ai.yml'), join(root, 'one.workflow.ai.yml'));
    expect((await scanRoots([root])).found).toEqual([]);
  });

  it('says when it stopped at its count', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= SCAN_MAX_FILES; i += 1) {
      files[`w${String(i).padStart(3, '0')}.workflow.ai.yml`] = WORKFLOW;
    }
    const scan = await scanRoots([await project(files)]);
    expect(scan.found).toHaveLength(SCAN_MAX_FILES);
    expect(scan.truncated).toBe(true);
  });

  it('gives an id that is stable, opaque and different per root', async () => {
    const one = await project();
    const two = await project();
    const [a, b] = (await scanRoots([one, two])).found;
    expect(a?.id).toBe(workflowId(0, 'demo.workflow.ai.yml'));
    expect(b?.id).toBe(workflowId(1, 'demo.workflow.ai.yml'));
    expect(a?.id).not.toBe(b?.id);
    expect(a?.id).toMatch(/^[0-9a-f]{32}$/);
    expect((await scanRoots([one, two])).found[0]?.id).toBe(a?.id);
  });

  it('reads no file that grew past the limit or became a link', async () => {
    const root = await project();
    const [found] = (await scanRoots([root])).found;
    if (found === undefined) {
      throw new Error('no workflow found');
    }
    await writeFile(found.file, 'x'.repeat(MAX_WORKFLOW_BYTES + 1));
    await expect(readWorkflow(found)).rejects.toMatchObject({ reason: 'too_large' });
    const outside = await project();
    await writeFile(found.file, '');
    await import('node:fs/promises').then((fs) => fs.rm(found.file));
    await symlink(join(outside, 'demo.workflow.ai.yml'), found.file);
    await expect(readWorkflow(found)).rejects.toMatchObject({ reason: 'missing' });
  });
});

describe('the summary of use and the confirmation (T-11)', () => {
  it('lists runners, commands, permissions and who is needed, from the definition', () => {
    const use = summaryOfUse(parseWorkflow(RICH));
    expect(use.runners).toEqual(['shell', 'acp']);
    expect(use.commands).toEqual([
      'role coder: my-agent --serve',
      'build: npm test',
      'MCP server files: npx files-server --root .',
    ]);
    expect(use.permissions).toEqual([
      'build: runner default (unrestricted)',
      'write: read src; write nothing; terminal deny',
      'argue: runner default (unrestricted)',
    ]);
    expect(use.needsPerson).toEqual(['argue']);
    const open = RICH.replace('read: [src]', 'read: []');
    expect(summaryOfUse(parseWorkflow(open)).permissions[1]).toBe(
      'write: read anything; write nothing; terminal deny',
    );
  });

  it('cuts a long item and drops control sequences', () => {
    const esc = String.fromCharCode(27);
    const text = WORKFLOW.replace(
      'node -e "process.exit(0)"',
      `echo ${esc}[31m${'x'.repeat(MAX_USE_ITEM * 2)}`,
    );
    const [command] = summaryOfUse(parseWorkflow(text)).commands;
    expect(command?.length).toBeLessThanOrEqual(MAX_USE_ITEM);
    expect(command).not.toContain(esc);
  });

  it('keeps hashes per root and path, at most ten, and treats a corrupt store as empty', async () => {
    const dir = await makeTempDir();
    const file = join(dir, 'indaba', 'confirmed-workflows.json');
    const store = new ConfirmationStore(file, 1);
    const hash = (n: number): string => contentHash(Buffer.from(String(n)));
    expect(await store.has('/r', 'a.yml', hash(0))).toBe(false);
    for (let i = 0; i <= MAX_HASHES_PER_WORKFLOW; i += 1) {
      await store.add('/r', 'a.yml', hash(i));
    }
    expect(await store.has('/r', 'a.yml', hash(0))).toBe(false);
    expect(await store.has('/r', 'a.yml', hash(MAX_HASHES_PER_WORKFLOW))).toBe(true);
    expect(await store.has('/other', 'a.yml', hash(MAX_HASHES_PER_WORKFLOW))).toBe(false);
    expect((await readdir(join(dir, 'indaba'))).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    await writeFile(file, '{ not json');
    expect(await store.has('/r', 'a.yml', hash(MAX_HASHES_PER_WORKFLOW))).toBe(false);
    await writeFile(file, JSON.stringify({ '/r': { 'a.yml': ['nothex', 7, hash(1)] }, '/s': 5, '/t': [] }));
    expect(await store.has('/r', 'a.yml', hash(1))).toBe(true);
    expect(await store.has('/r', 'a.yml', 'nothex')).toBe(false);
  });
});

/** A child the test ends; it writes a trace through the engine's own writer when told, as a real run does. */
interface FakeRun {
  readonly args: readonly string[];
  readonly options: StartOptions;
  readonly calls: string[];
  finish(code: number): void;
  /** Writes the root span of a trace with this task id, through `RunEventWriter`, the engine's writer. */
  trace(traceId: string): Promise<void>;
  /** What was in the run copy when the child started. */
  readonly input: Promise<string>;
}

function fakeStarter(behaviour: { ignoresCancel?: boolean; stderr?: string; throws?: boolean } = {}) {
  const runs: FakeRun[] = [];
  const starter: RunStarter = (args, options): RunChild => {
    if (behaviour.throws === true) {
      throw new Error('spawn EAGAIN');
    }
    const calls: string[] = [];
    let finish: (code: number) => void = () => undefined;
    const exited = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const file = args[args.length - 1] ?? '';
    const taskId = args[args.indexOf('--task-id') + 1] ?? '';
    runs.push({
      args,
      options,
      calls,
      finish,
      input: readFile(join(options.cwd, file), 'utf8'),
      trace: async (traceId) => {
        const writer = new RunEventWriter({
          directory: join(options.cwd, '.indaba', 'traces'),
          clock: { now: () => new Date('2026-10-22T12:00:00.000Z') },
        });
        const span = new Span(
          traceId,
          'r'.repeat(16),
          undefined,
          'indaba.task demo',
          new Date('2026-10-22T12:00:00Z'),
          {
            'indaba.task.id': taskId,
          },
        );
        await writer.onSpanStarted(new SpanStarted(span));
      },
    });
    return {
      exited,
      stderr: () => behaviour.stderr ?? '',
      cancel: () => {
        calls.push('cancel');
        if (behaviour.ignoresCancel !== true) {
          finish(130);
        }
      },
      kill: () => {
        calls.push('kill');
        finish(137);
      },
      release: () => {
        calls.push('release');
      },
    };
  };
  return { starter, runs };
}

let logged: LogRecord[];
let counter: number;

beforeEach(() => {
  logged = [];
  counter = 0;
});

async function controlFor(
  roots: readonly string[],
  starter: RunStarter,
  extra: Partial<Parameters<typeof createRunControl>[0]> = {},
) {
  const config = await makeTempDir();
  const control = createRunControl({
    roots,
    starter,
    environment: { HOME: '/home/someone', OPENROUTER_API_KEY: FAKE_KEY },
    confirmationFile: join(config, 'indaba', 'confirmed-workflows.json'),
    pid: 1,
    ids: () => {
      counter += 1;
      return counter.toString(16).padStart(24, '0');
    },
    parse: parseWorkflow,
    logger: createLogger({
      sinks: [{ write: (record) => logged.push(record) }],
      clock: () => new Date('2026-10-22T12:00:00.000Z'),
      level: 'debug',
    }),
    graceMs: 30,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...extra,
  });
  return { control, config };
}

/** Confirms and starts the first workflow of a fresh list. */
async function confirmAndStart(control: Awaited<ReturnType<typeof controlFor>>['control'], index = 0) {
  const workflow = (await control.list()).workflows[index];
  if (workflow === undefined) {
    throw new Error('no workflow listed');
  }
  const refusal = await control.start({ workflowId: workflow.id }).catch((error: unknown) => error);
  if (!(refusal instanceof RunControlError) || refusal.code !== 'confirmation_required') {
    throw new Error(`expected a confirmation, got ${String(refusal)}`);
  }
  const hash = refusal.detail?.contentHash;
  if (typeof hash !== 'string') {
    throw new Error('no hash');
  }
  return { workflow, hash, started: await control.start({ workflowId: workflow.id, confirmedHash: hash }) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

/**
 * Asks for a start's status until it is the one expected: each call starts a lookup of the traces in the background,
 * which a slow file system (Windows) may not finish in one short pause.
 */
async function statusUntil(
  control: { startStatus(startId: string): unknown },
  startId: string,
  expected: unknown,
): Promise<unknown> {
  let last: unknown;
  for (let i = 0; i < 200; i += 1) {
    last = control.startStatus(startId);
    if (JSON.stringify(last) === JSON.stringify(expected)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return last;
}

describe('the run control (T-12)', () => {
  it('lists valid and invalid workflows with their problems', async () => {
    const root = await project({
      'demo.workflow.ai.yml': WORKFLOW,
      'bad.workflow.ai.yml': 'version: "1.0"\nsteps: []\n',
    });
    const { control } = await controlFor([root], fakeStarter().starter);
    const { workflows } = await control.list();
    const bad = workflows.find((w) => w.path === 'bad.workflow.ai.yml');
    expect(bad).toMatchObject({ valid: false, name: 'bad' });
    expect(bad?.problems.length).toBeGreaterThan(0);
    expect(workflows.find((w) => w.path === 'demo.workflow.ai.yml')).toMatchObject({
      valid: true,
      name: 'demo',
      problems: [],
    });
  });

  it('asks first, then runs the confirmed bytes from a copy, in the root, with an argument array (AC-03 to AC-05)', async () => {
    const root = await project();
    const { starter, runs } = fakeStarter();
    const { control } = await controlFor([root], starter);
    const workflow = (await control.list()).workflows[0];
    if (workflow === undefined) {
      throw new Error('none');
    }
    const asked = await control.start({ workflowId: workflow.id }).catch((e: unknown) => e);
    expect(asked).toMatchObject({ code: 'confirmation_required' });
    // Nothing was written to the project for the 409.
    await expect(readdir(join(root, RUN_INPUTS))).rejects.toThrow();
    expect(runs).toHaveLength(0);

    const confirmedHash = (asked as RunControlError).detail?.contentHash;
    expect(confirmedHash).toBe(contentHash(Buffer.from(WORKFLOW)));
    const started = await control.start({ workflowId: workflow.id, confirmedHash: String(confirmedHash) });
    expect(started.startId).toMatch(/^web-[0-9a-f]{24}$/);
    const [run] = runs;
    expect(run?.options.cwd).toBe(root);
    expect(run?.args).toEqual([
      'run',
      '--workdir',
      root,
      '--task-id',
      started.startId,
      '--',
      `.indaba/run-inputs/${started.startId}.yml`,
    ]);
    expect(await run?.input).toBe(WORKFLOW);
    expect(run?.options.environment).toMatchObject({ HOME: '/home/someone' });

    // The same content does not ask again.
    const again = await control.start({ workflowId: workflow.id });
    expect(again.startId).not.toBe(started.startId);

    // The copy goes when the child exits.
    run?.finish(0);
    runs[1]?.finish(0);
    let left = await readdir(join(root, RUN_INPUTS));
    for (let i = 0; i < 200 && left.length > 0; i += 1) {
      await flush();
      left = await readdir(join(root, RUN_INPUTS));
    }
    expect(left).toEqual([]);
  });

  it('asks again when the content changed, even with the old hash', async () => {
    const root = await project();
    const { control } = await controlFor([root], fakeStarter().starter);
    const { workflow, hash } = await confirmAndStart(control);
    await writeFile(join(root, 'demo.workflow.ai.yml'), WORKFLOW.replace('name: demo', 'name: changed'));
    const refusal = await control
      .start({ workflowId: workflow.id, confirmedHash: hash })
      .catch((e: unknown) => e);
    expect(refusal).toMatchObject({ code: 'confirmation_required' });
    expect((refusal as RunControlError).detail?.contentHash).not.toBe(hash);
  });

  it('refuses an unknown id, an invalid workflow and a store it cannot write', async () => {
    const root = await project({
      'demo.workflow.ai.yml': WORKFLOW,
      'bad.workflow.ai.yml': 'version: "1.0"\nsteps: []\n',
    });
    const { control, config } = await controlFor([root], fakeStarter().starter);
    await expect(control.start({ workflowId: '../../etc/passwd' })).rejects.toMatchObject({
      code: 'workflow_not_found',
    });
    const bad = (await control.list()).workflows.find((w) => !w.valid);
    await expect(control.start({ workflowId: bad?.id ?? '' })).rejects.toMatchObject({
      code: 'workflow_invalid',
      detail: { problems: expect.arrayContaining([expect.any(String)]) },
    });
    if (process.platform !== 'win32' && process.getuid?.() !== 0) {
      await mkdir(join(config, 'indaba'), { recursive: true });
      await chmod(join(config, 'indaba'), 0o500);
      const good = (await control.list()).workflows.find((w) => w.valid);
      const asked = await control.start({ workflowId: good?.id ?? '' }).catch((e: unknown) => e);
      const hash = (asked as RunControlError).detail?.contentHash as string;
      await expect(control.start({ workflowId: good?.id ?? '', confirmedHash: hash })).rejects.toMatchObject({
        code: 'not_saved',
      });
      await chmod(join(config, 'indaba'), 0o700);
    }
  });

  it('arrives unconfirmed with a project that carries its own confirmation file', async () => {
    const root = await project();
    const hash = contentHash(Buffer.from(WORKFLOW));
    await mkdir(join(root, '.indaba'), { recursive: true });
    await writeFile(
      join(root, '.indaba', 'confirmed-workflows.json'),
      JSON.stringify({ [root]: { 'demo.workflow.ai.yml': [hash] } }),
    );
    const { control } = await controlFor([root], fakeStarter().starter);
    const id = (await control.list()).workflows[0]?.id ?? '';
    await expect(control.start({ workflowId: id })).rejects.toMatchObject({ code: 'confirmation_required' });
  });

  it('starts each root’s run in its own root (AC-03)', async () => {
    const one = await project();
    const two = await project();
    const { starter, runs } = fakeStarter();
    const { control } = await controlFor([one, two], starter);
    await confirmAndStart(control, 0);
    await confirmAndStart(control, 1);
    expect(runs.map((r) => r.options.cwd)).toEqual([one, two]);
    expect(runs.map((r) => r.args[2])).toEqual([one, two]);
  });

  it('holds to the limit: five starts against four (AC-06)', async () => {
    const root = await project();
    const { starter, runs } = fakeStarter();
    const { control } = await controlFor([root], starter);
    const { workflow } = await confirmAndStart(control);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => control.start({ workflowId: workflow.id })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'too_many_runs' } });
    expect(runs).toHaveLength(4);
    runs[0]?.finish(0);
    await flush();
    await expect(control.start({ workflowId: workflow.id })).resolves.toMatchObject({
      startId: expect.any(String),
    });
  });

  it('refuses a start when an existing file holds the copy’s name, and leaves nothing running', async () => {
    const root = await project();
    const { starter, runs } = fakeStarter();
    const { control } = await controlFor([root], starter, { ids: () => 'a'.repeat(24) });
    const { workflow, started } = await confirmAndStart(control);
    expect(started.startId).toBe(`web-${'a'.repeat(24)}`);
    await expect(control.start({ workflowId: workflow.id })).rejects.toMatchObject({ code: 'start_failed' });
    expect(runs).toHaveLength(1);
  });

  it('removes the copy and says start_failed when the child cannot be started', async () => {
    const root = await project();
    const { control } = await controlFor([root], fakeStarter({ throws: true }).starter);
    const workflow = (await control.list()).workflows[0];
    const asked = await control.start({ workflowId: workflow?.id ?? '' }).catch((e: unknown) => e);
    await expect(
      control.start({
        workflowId: workflow?.id ?? '',
        confirmedHash: (asked as RunControlError).detail?.contentHash as string,
      }),
    ).rejects.toMatchObject({ code: 'start_failed' });
    expect(await readdir(join(root, RUN_INPUTS))).toEqual([]);
    expect(JSON.stringify(logged)).not.toContain('sk-or-v1');
  });

  it('sweeps copies left by an earlier crash, before it writes a new one', async () => {
    const root = await project({
      'demo.workflow.ai.yml': WORKFLOW,
      '.indaba/run-inputs/web-old.yml': WORKFLOW,
    });
    const { control } = await controlFor([root], fakeStarter().starter);
    await confirmAndStart(control);
    expect((await readdir(join(root, RUN_INPUTS))).includes('web-old.yml')).toBe(false);
  });

  it('learns the trace id from the root span the engine writes, also with runs starting together (AC-08)', async () => {
    const root = await project();
    const { starter, runs } = fakeStarter();
    const { control } = await controlFor([root], starter);
    const first = await confirmAndStart(control);
    const second = await control.start({ workflowId: first.workflow.id });
    expect(control.startStatus(first.started.startId)).toEqual({ state: 'starting' });
    // Written in the opposite order of the starts: a folder diff would give each the other's trace.
    await runs[1]?.trace('2'.repeat(32));
    await runs[0]?.trace('1'.repeat(32));
    const one = { state: 'running', runId: '1'.repeat(32) };
    const two = { state: 'running', runId: '2'.repeat(32) };
    expect(await statusUntil(control, first.started.startId, one)).toEqual(one);
    expect(await statusUntil(control, second.startId, two)).toEqual(two);
    expect(control.startStatus('web-nothing')).toBeUndefined();
    expect(control.isAlive('1'.repeat(32))).toBe(true);
    expect(control.isAlive('9'.repeat(32))).toBe(false);
  });

  it('looks again at a trace whose first line was still being written, and ignores what is not a root record', async () => {
    const root = await project();
    const { starter } = fakeStarter();
    const { control } = await controlFor([root], starter);
    const { started } = await confirmAndStart(control);
    const traces = join(root, '.indaba', 'traces');
    await mkdir(traces, { recursive: true });
    const half = join(traces, `${'5'.repeat(32)}.events.jsonl`);
    const record = JSON.stringify({
      type: 'span_started',
      at: '2026-10-22T12:00:00.000Z',
      trace_id: '5'.repeat(32),
      span_id: 'r'.repeat(16),
      parent_span_id: null,
      name: 'indaba.task demo',
      attributes: { 'indaba.task.id': started.startId },
    });
    // Half a line: no newline yet, as when the engine is in the middle of writing it.
    await writeFile(half, record.slice(0, 40));
    await writeFile(join(traces, 'not-a-run.events.jsonl'), `${record}\n`);
    await writeFile(join(traces, `${'6'.repeat(32)}.jsonl`), `${record}\n`);
    await writeFile(join(traces, `${'7'.repeat(32)}.events.jsonl`), '{"type":"step_status"}\n');
    control.startStatus(started.startId);
    await flush();
    expect(control.startStatus(started.startId)).toEqual({ state: 'starting' });
    await writeFile(half, `${record}\n`);
    const running = { state: 'running', runId: '5'.repeat(32) };
    expect(await statusUntil(control, started.startId, running)).toEqual(running);
  });

  it('reports a start that ended without a trace as failed, with its first line cleaned (AC-15)', async () => {
    const root = await project();
    const esc = String.fromCharCode(27);
    const { starter, runs } = fakeStarter({
      stderr: `\n${esc}[31mbad key ${FAKE_KEY}${esc}[0m\nsecond line\n`,
    });
    const { control } = await controlFor([root], starter);
    const { started } = await confirmAndStart(control);
    runs[0]?.finish(1);
    let status = control.startStatus(started.startId);
    for (let k = 0; k < 200 && status?.state === 'starting'; k += 1) {
      await flush();
      status = control.startStatus(started.startId);
    }
    expect(status?.state).toBe('failed');
    expect(status?.failure).toContain('bad key');
    expect(status?.failure).not.toContain('sk-or-v1');
    expect(status?.failure).not.toContain(esc);
    expect(status?.failure).not.toContain('second line');
  });

  it('stops a run it started: cancel while alive, ended after; nothing for another run (AC-09)', async () => {
    const root = await project();
    const { starter, runs } = fakeStarter({ ignoresCancel: true });
    const { control } = await controlFor([root], starter);
    await confirmAndStart(control);
    await runs[0]?.trace('1'.repeat(32));
    const running = { state: 'running', runId: '1'.repeat(32) };
    expect(await statusUntil(control, `web-${'1'.padStart(24, '0')}`, running)).toEqual(running);
    expect(control.stop('1'.repeat(32))).toEqual({ state: 'stopping' });
    expect(control.stop('1'.repeat(32))).toEqual({ state: 'stopping' });
    expect(runs[0]?.calls).toEqual(['cancel', 'cancel']);
    expect(control.stop('3'.repeat(32))).toBeUndefined();
    runs[0]?.finish(130);
    await flush();
    expect(control.stop('1'.repeat(32))).toEqual({ state: 'ended' });
    expect(control.isAlive('1'.repeat(32))).toBe(false);
  });

  it('at exit cancels each run, kills only one still alive after the grace, and logs it (AC-11)', async () => {
    const root = await project();
    const polite = fakeStarter();
    const stubborn = fakeStarter({ ignoresCancel: true });
    let which = 0;
    const starter: RunStarter = (args, options) =>
      (which++ === 0 ? polite.starter : stubborn.starter)(args, options);
    const { control } = await controlFor([root], starter);
    const { workflow } = await confirmAndStart(control);
    await control.start({ workflowId: workflow.id });
    await control.stopAll();
    expect(polite.runs[0]?.calls).toEqual(['cancel']);
    expect(stubborn.runs[0]?.calls).toEqual(['cancel', 'kill']);
    expect(await readdir(join(root, RUN_INPUTS))).toEqual([]);
    expect(logged.find((r) => r.message === 'runs stopped at exit')?.fields).toEqual({
      cancelled: 1,
      killed: 1,
    });
    await expect(control.stopAll()).resolves.toBeUndefined();
  });

  it('never signals a run that had already exited', async () => {
    const root = await project();
    const { starter, runs } = fakeStarter();
    const { control } = await controlFor([root], starter);
    await confirmAndStart(control);
    runs[0]?.finish(0);
    await flush();
    await control.stopAll();
    expect(runs[0]?.calls).toEqual([]);
  });

  it('passes a parse failure that is not a validation error on as a fault', async () => {
    const root = await project();
    const { control } = await controlFor([root], fakeStarter().starter, {
      parse: () => {
        throw new Error('parser broke');
      },
    });
    const listed = (await control.list()).workflows[0];
    expect(listed).toMatchObject({ valid: false, problems: ['parser broke'] });
    await expect(control.start({ workflowId: listed?.id ?? '' })).rejects.toThrow('parser broke');
    expect(() => {
      throw new WorkflowValidationError(['x']);
    }).toThrow();
  });
});

describe('the run control: what the first round of tests left out', () => {
  it('lists a file over 1 MiB as invalid, and refuses to start it', async () => {
    const root = await project({ 'big.workflow.ai.yml': `name: x\n# ${'x'.repeat(MAX_WORKFLOW_BYTES)}\n` });
    const { control } = await controlFor([root], fakeStarter().starter);
    const [big] = (await control.list()).workflows;
    expect(big).toMatchObject({ valid: false, name: 'big' });
    expect(big?.problems[0]).toMatch(/larger than 1 MiB/);
    await expect(control.start({ workflowId: big?.id ?? '' })).rejects.toMatchObject({
      code: 'workflow_invalid',
      detail: { problems: [expect.stringMatching(/larger than 1 MiB/)] },
    });
  });

  it('starts nothing with a generated id of the wrong shape', async () => {
    const root = await project();
    const { starter, runs } = fakeStarter();
    const { control } = await controlFor([root], starter, { ids: () => '../../x' });
    const workflow = (await control.list()).workflows[0];
    const asked = await control.start({ workflowId: workflow?.id ?? '' }).catch((e: unknown) => e);
    const hash = String((asked as RunControlError).detail?.contentHash);
    await expect(
      control.start({ workflowId: workflow?.id ?? '', confirmedHash: hash }),
    ).rejects.toMatchObject({
      code: 'start_failed',
    });
    expect(runs).toEqual([]);
    await expect(readdir(join(root, RUN_INPUTS))).rejects.toThrow();
  });

  it('says not_saved when the confirmation store cannot be written, whoever runs the test', async () => {
    const root = await project();
    const config = await makeTempDir();
    // A file where the store's folder must be: no user, root included, can write the store under it.
    await writeFile(join(config, 'indaba'), 'not a folder');
    const { starter, runs } = fakeStarter();
    const { control } = await controlFor([root], starter, {
      confirmationFile: join(config, 'indaba', 'confirmed-workflows.json'),
    });
    const workflow = (await control.list()).workflows[0];
    const asked = await control.start({ workflowId: workflow?.id ?? '' }).catch((e: unknown) => e);
    const hash = String((asked as RunControlError).detail?.contentHash);
    await expect(
      control.start({ workflowId: workflow?.id ?? '', confirmedHash: hash }),
    ).rejects.toMatchObject({
      code: 'not_saved',
    });
    expect(runs).toEqual([]);
    expect(logged.map((r) => r.message)).toContain('a confirmation could not be saved');
  });

  it('takes no task id from a root record that does not carry a string one', async () => {
    const root = await project();
    const { starter } = fakeStarter();
    const { control } = await controlFor([root], starter);
    const { started } = await confirmAndStart(control);
    const traces = join(root, '.indaba', 'traces');
    await mkdir(traces, { recursive: true });
    const record = (task: unknown) =>
      `${JSON.stringify({
        type: 'span_started',
        at: '2026-10-22T12:00:00.000Z',
        trace_id: '8'.repeat(32),
        span_id: 'r'.repeat(16),
        parent_span_id: null,
        name: 'indaba.task demo',
        attributes: { 'indaba.task.id': task },
      })}\n`;
    await writeFile(join(traces, `${'8'.repeat(32)}.events.jsonl`), record(7));
    control.startStatus(started.startId);
    await flush();
    expect(control.startStatus(started.startId)).toEqual({ state: 'starting' });
  });

  it('says the run ended before it started when it wrote nothing to its error stream', async () => {
    const root = await project();
    const { starter, runs } = fakeStarter({ stderr: '\n  \n' });
    const { control } = await controlFor([root], starter);
    const { started } = await confirmAndStart(control);
    runs[0]?.finish(1);
    let status = control.startStatus(started.startId);
    for (let i = 0; i < 200 && status?.state === 'starting'; i += 1) {
      await flush();
      status = control.startStatus(started.startId);
    }
    expect(status).toEqual({ state: 'failed', failure: 'The run ended before it started.' });
  });
});

describe('summaryOfUse at the level full (specs/agent-permissions AC-04)', () => {
  it('says full access, not "write nothing"', () => {
    const wf = parseWorkflow(
      'version: "1.0"\nname: f\nroles:\n  w: {runner: claude-code}\nsteps:\n  - id: s\n    role: w\n    goal: g\n    permissions:\n      level: full\n',
    );
    expect(summaryOfUse(wf).permissions).toEqual([
      's: FULL ACCESS: the agent can change anything and run anything and nobody approves it',
    ]);
  });
});
