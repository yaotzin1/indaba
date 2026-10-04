import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import {
  captureIo,
  FIXTURE_WORKFLOW,
  fakePluginSource,
  makeTempDir,
  writePlugin,
  writeWorkflow,
} from './support.js';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const example = join(root, 'examples', 'task-pipeline.workflow.ai.yml');
const mcpExample = join(root, 'examples', 'mcp.workflow.ai.yml');

async function run(args: string[], cwd?: string, env: Record<string, string | undefined> = {}) {
  const captured = captureIo(cwd ?? (await makeTempDir()), env);
  const code = await main(args, captured.io);
  return { code, out: captured.stdout(), err: captured.stderr() };
}

describe('arguments and exit codes', () => {
  it('prints help and exits 0', async () => {
    for (const flag of ['--help', '-h']) {
      const r = await run([flag]);
      expect(r.code).toBe(0);
      expect(r.out).toContain('Usage: indaba <command>');
    }
  });

  it('prints the package version', async () => {
    const manifest: unknown = JSON.parse(readFileSync(join(root, 'packages', 'cli', 'package.json'), 'utf8'));
    const version =
      typeof manifest === 'object' && manifest !== null && 'version' in manifest ? manifest.version : '';
    for (const flag of ['--version', '-V']) {
      const r = await run([flag]);
      expect(r).toEqual({ code: 0, out: `${String(version)}\n`, err: '' });
    }
  });

  it('prints per-command help', async () => {
    const r = await run(['run', '--help']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('--workdir');
    expect(r.out).toContain('--plugin');
  });

  it.each([
    [[], 'No command given.'],
    [['frobnicate'], 'Unknown command "frobnicate".'],
    [['validate', '--nope'], '--nope'],
    [['validate', 'a.yml', 'b.yml'], 'Too many arguments'],
    [['plan', '--workdir', 'x'], "Unknown option '--workdir'"],
    [['run', '--timeout', 'abc'], '--timeout must be a positive number'],
    [['run', '--timeout', '0'], '--timeout must be a positive number'],
    [['run', '--plugin'], 'argument missing'],
  ])('rejects %j with a usage error', async (args, message) => {
    const r = await run(args);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    expect(r.err).toContain(message);
    expect(r.err).toContain('Usage: indaba');
  });
});

describe('validate', () => {
  it('accepts the example workflow', async () => {
    const r = await run(['validate', example]);
    expect(r).toEqual({ code: 0, out: 'indaba-task-pipeline is valid (4 steps, 3 roles).\n', err: '' });
  });

  it('resolves the file against the working directory', async () => {
    const dir = await makeTempDir();
    await writeWorkflow(
      dir,
      'w.yml',
      'version: "1.0"\nname: "x"\nsteps:\n  - id: "s"\n    runner: "shell"\n    commands: ["echo"]\n',
    );
    const r = await run(['validate', 'w.yml'], dir);
    expect(r.out).toBe('x is valid (1 steps, 0 roles).\n');
  });

  it('lists every problem and exits 1', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(
      dir,
      'bad.yml',
      'version: "9"\nsteps:\n  - id: "a"\n    depends_on: ["ghost"]\n',
    );
    const r = await run(['validate', file], dir);
    expect(r.code).toBe(1);
    expect(r.out.startsWith(`${file} is invalid:\n - `)).toBe(true);
    expect(r.out.split('\n').filter((l) => l.startsWith(' - ')).length).toBeGreaterThan(1);
  });

  it('reports a missing file and exits 1', async () => {
    const r = await run(['validate', 'nope.yml']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('nope.yml is invalid:');
    expect(r.out).toContain('cannot read workflow file');
  });
});

describe('plan', () => {
  it('prints the execution order of the example', async () => {
    const r = await run(['plan', example]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      [
        '1. rfc [architect]',
        '2. code [implementer] (after rfc)',
        '3. verify [shell: pnpm test && pnpm typecheck] (after code)',
        '4. debate_review [reviewer] (after verify; consensus with architect)',
        '',
      ].join('\n'),
    );
  });

  it('prints MCP findings and fails on an error', async () => {
    const r = await run(['plan', mcpExample]);
    expect(r.out).toMatch(/MCP (error|warning): step "/);
    expect(r.code === 0 || r.code === 1).toBe(true);
    if (r.out.includes('MCP error:')) {
      expect(r.code).toBe(1);
    }
  });
});

describe('run', () => {
  it('runs a workflow with an injected runner and exits 0', async () => {
    const dir = await makeTempDir();
    const plugin = await writePlugin(dir, 'p.mjs', fakePluginSource(join(dir, 'log.jsonl')));
    const file = await writeWorkflow(dir, 'f.yml', FIXTURE_WORKFLOW);
    const r = await run(['run', file, '--plugin', plugin, '--task-id', 't1'], dir);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^Running ext-flow\n {2}work +PENDING -> RUNNING\n/);
    expect(r.out).toMatch(/Task t1 finished: COMPLETED \(trace [0-9a-f]{32}\)\n$/);
  });

  it('exits 1 when a step fails and says why', async () => {
    const dir = await makeTempDir();
    const plugin = await writePlugin(dir, 'p.mjs', fakePluginSource(join(dir, 'log.jsonl'), 3));
    const file = await writeWorkflow(dir, 'f.yml', FIXTURE_WORKFLOW);
    const r = await run(['run', file, '--plugin', plugin], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('finished: FAILED');
    expect(r.out).toContain('boom');
  });

  it('exits 1 when the working directory does not exist', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'f.yml', FIXTURE_WORKFLOW);
    const r = await run(['run', file, '--workdir', 'missing'], dir);
    expect(r).toEqual({ code: 1, out: 'Working directory does not exist.\n', err: '' });
  });

  it('exits 130 and reports CANCELLED when the signal is already aborted', async () => {
    const dir = await makeTempDir();
    const plugin = await writePlugin(dir, 'p.mjs', fakePluginSource(join(dir, 'log.jsonl')));
    const file = await writeWorkflow(dir, 'f.yml', FIXTURE_WORKFLOW);
    const controller = new AbortController();
    controller.abort();
    const captured = captureIo(dir, {}, controller.signal);
    expect(await main(['run', file, '--plugin', plugin], captured.io)).toBe(130);
    expect(captured.stdout()).toContain('finished: CANCELLED');
  });

  it('reports an invalid workflow without running anything', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'f.yml', 'version: "1.0"\nname: "x"\nsteps: []\n');
    const r = await run(['run', file], dir);
    expect(r.code).toBe(1);
  });
});
