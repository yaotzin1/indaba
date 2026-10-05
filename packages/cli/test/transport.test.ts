import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { captureIo, makeTempDir, writeWorkflow } from './support.js';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const example = (name: string): string => join(root, 'examples', name);

async function run(args: string[], cwd?: string, env: Record<string, string | undefined> = {}) {
  const captured = captureIo(cwd ?? (await makeTempDir()), env);
  const code = await main(args, captured.io);
  return { code, out: captured.stdout(), err: captured.stderr() };
}

const WORKFLOW = (runner: string, extra = ''): string => `version: "1.0"
name: "t"
roles:
  worker: {runner: ${runner}, model: m}
steps:
  - id: "s"
    role: "worker"
    goal: "do it"
${extra}`;

describe('the shipped examples', () => {
  it.each(['transport-fallback.workflow.ai.yml', 'api-only.workflow.ai.yml'])(
    '%s validates and plans',
    async (name) => {
      const validated = await run(['validate', example(name)]);
      expect(validated.code, validated.out).toBe(0);
      expect(validated.out).not.toContain('warning:');

      const planned = await run(['plan', example(name)]);
      expect(planned.code, planned.out).toBe(0);
    },
  );

  it('shows the runner chain and the scope in the plan of the fallback example', async () => {
    const { out } = await run(['plan', example('transport-fallback.workflow.ai.yml')]);
    expect(out).toContain('runners acp -> claude-code');
    expect(out).toContain('may only change src/**, tests/**');
  });
});

describe('runner lists in a workflow file', () => {
  it('accepts a list of known runners', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'w.yml', WORKFLOW('[openrouter, acp, claude-code]'));
    expect((await run(['validate', file], dir)).code).toBe(0);
  });

  it('rejects a runner nobody registered, naming where', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'w.yml', WORKFLOW('[openrouter, nope]'));
    const r = await run(['validate', file], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('roles.worker.runner "nope" is not a known runner');
  });

  it('rejects an empty list and a repeated name', async () => {
    const dir = await makeTempDir();
    const empty = await run(['validate', await writeWorkflow(dir, 'a.yml', WORKFLOW('[]'))], dir);
    expect(empty.out).toContain('must not be an empty list');
    const twice = await run(['validate', await writeWorkflow(dir, 'b.yml', WORKFLOW('[acp, acp]'))], dir);
    expect(twice.out).toContain('lists the same runner twice');
  });

  it('warns, without failing, about permissions that nothing enforces early', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(
      dir,
      'w.yml',
      WORKFLOW('openrouter', '    permissions: {fs: {write: ["src/**"]}}\n'),
    );
    const r = await run(['validate', file], dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain('warning:');
    expect(r.out).toContain('has no isolation');
    expect(r.out).toContain('no acp runner');
  });
});

describe('endpoints configured in the environment', () => {
  const ENDPOINT = { INDABA_OPENAI_COMPAT_LOCAL_BASE_URL: 'http://localhost:11434/v1' };

  it('a workflow cannot use an endpoint that is not configured', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'w.yml', WORKFLOW('local'));
    const r = await run(['validate', file], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('"local" is not a known runner');
  });

  it('a configured endpoint becomes a runner of that name', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'w.yml', WORKFLOW('[local, claude-code]'));
    const r = await run(['validate', file], dir, ENDPOINT);
    expect(r.code, r.out).toBe(0);
  });

  it('refuses to redefine a built-in runner from the environment', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'w.yml', WORKFLOW('openrouter'));
    const r = await run(['validate', file], dir, {
      INDABA_OPENAI_COMPAT_OPENROUTER_BASE_URL: 'https://evil.test/v1',
    });
    expect(r.code).not.toBe(0);
    expect(`${r.out}${r.err}`).toContain('built-in runner');
  });

  it('refuses an endpoint URL that is not http(s)', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(dir, 'w.yml', WORKFLOW('local'));
    const r = await run(['validate', file], dir, {
      INDABA_OPENAI_COMPAT_LOCAL_BASE_URL: 'file:///etc/passwd',
    });
    expect(r.code).not.toBe(0);
    expect(`${r.out}${r.err}`).toContain('http(s)');
  });
});
