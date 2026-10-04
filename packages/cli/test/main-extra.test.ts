import { describe, expect, it } from 'vitest';
import { createEngine, loadPlugin, main } from '../src/index.js';
import { captureIo, FIXTURE_WORKFLOW, makeTempDir, writePlugin, writeWorkflow } from './support.js';

async function run(args: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  const captured = captureIo(cwd, env);
  const code = await main(args, captured.io);
  return { code, out: captured.stdout(), err: captured.stderr() };
}

/** A plugin with a runner "fake" whose body is the given statements; `request` is in scope. */
function runnerPlugin(body: string, extra = ''): string {
  return `import { RunResult, StepStatusChanged, TokenUsage } from '@indaba/core';
export default {
  name: 'p',
  register(host) {
    host.registerRunner({ name: 'fake', async run(request) { ${body} } });
    host.registerGuard({ type: 'always_ok', async check() { return { passed: true }; } });
    ${extra}
  },
};
`;
}

async function setup(source: string, workflow = FIXTURE_WORKFLOW) {
  const dir = await makeTempDir();
  const plugin = await writePlugin(dir, 'p.mjs', source);
  const file = await writeWorkflow(dir, 'f.yml', workflow);
  return { dir, plugin, file };
}

describe('run options', () => {
  it('prints the cost of priced spans with -v and streams output with -vv', async () => {
    const { dir, plugin, file } = await setup(
      runnerPlugin(
        "request.onOutput?.('streamed-chunk'); return new RunResult({ exitCode: 0, output: 'done', usage: new TokenUsage(1000, 2000), model: 'anthropic/claude-sonnet-4' });",
      ),
    );

    const quiet = await run(['run', file, '--plugin', plugin], dir);
    const verbose = await run(['run', file, '--plugin', plugin, '-v'], dir);
    const loud = await run(['run', file, '--plugin', plugin, '-vv'], dir);

    expect(quiet.out).not.toContain('$');
    expect(quiet.out).not.toContain('streamed-chunk');
    expect(verbose.out).toContain('invoke_agent fake: $0.0330');
    expect(verbose.out).not.toContain('streamed-chunk');
    expect(loud.out).toContain('streamed-chunk');
    expect(loud.out).toContain('$0.0330');
  });

  it('skips the cost line for spans without a price', async () => {
    const { dir, plugin, file } = await setup(
      runnerPlugin("return new RunResult({ exitCode: 0, output: 'done' });"),
    );

    const r = await run(['run', file, '--plugin', plugin, '-v'], dir);

    expect(r.code).toBe(0);
    expect(r.out).not.toContain('$');
  });

  it('accepts a working directory, a task id and a timeout', async () => {
    const { dir, plugin, file } = await setup(
      runnerPlugin('return new RunResult({ exitCode: 0, output: String(request.timeoutSeconds) });'),
    );

    const r = await run(
      ['run', file, '-w', '.', '--task-id', 'my-task', '--timeout', '7', '--plugin', plugin],
      dir,
    );

    expect(r.code).toBe(0);
    expect(r.out).toContain('Task my-task finished: COMPLETED');
  });

  it('exits 2 when the run escalates', async () => {
    const workflow = `${FIXTURE_WORKFLOW}    on_failure:\n      action: "escalate"\n`;
    const { dir, plugin, file } = await setup(
      runnerPlugin("return new RunResult({ exitCode: 1, output: '', errorOutput: 'cannot' });"),
      workflow,
    );

    const r = await run(['run', file, '--plugin', plugin], dir);

    expect(r.code).toBe(2);
    expect(r.out).toContain('finished: ESCALATED');
  });

  it('reports a crash that is not an Indaba error on stderr and exits 1', async () => {
    const { dir, plugin, file } = await setup(runnerPlugin("throw new TypeError('kaboom');"));

    const r = await run(['run', file, '--plugin', plugin], dir);

    expect(r.code).toBe(1);
    expect(r.err).toContain('kaboom');
    expect(r.out).not.toContain('kaboom');
  });

  it('redacts credentials from the failure reason and ignores short or unrelated values', async () => {
    const secret = ['long', 'credential', 'value'].join('-');
    const { dir, plugin, file } = await setup(
      runnerPlugin(
        `return new RunResult({ exitCode: 1, output: '', errorOutput: 'leaked ${secret} and abc and visible-value' });`,
      ),
    );

    const r = await run(['run', file, '--plugin', plugin], dir, {
      MY_API_TOKEN: secret,
      SHORT_SECRET: 'abc',
      PLAIN_NAME: 'visible-value',
      EMPTY_KEY: undefined,
    });

    expect(r.out).toContain('[redacted]');
    expect(r.out).not.toContain(secret);
    expect(r.out).toContain('visible-value');
    expect(r.out).toContain('abc');
  });

  it('reports a failing event listener on stderr, redacted, and keeps running', async () => {
    const secret = ['listener', 'secret', 'value'].join('-');
    const { dir, plugin, file } = await setup(
      runnerPlugin(
        "return new RunResult({ exitCode: 0, output: 'done' });",
        `host.addListener(StepStatusChanged, (event) => {
          if (event.to === 'RUNNING') { throw new Error('bad ${secret}'); }
          if (event.to === 'VALIDATING') { throw 'plain text'; }
        });`,
      ),
    );

    const r = await run(['run', file, '--plugin', plugin], dir, { LISTENER_SECRET: secret });

    expect(r.code).toBe(0);
    expect(r.err).toContain('Listener failed: bad [redacted]');
    expect(r.err).toContain('Listener failed: plain text');
    expect(r.err).not.toContain(secret);
  });
});

describe('plan and validate extras', () => {
  it('prints a step that names a runner rather than a role', async () => {
    const dir = await makeTempDir();
    const file = await writeWorkflow(
      dir,
      'w.yml',
      'version: "1.0"\nname: x\nsteps:\n  - {id: a, runner: claude-code, goal: g}\n  - {id: b, runner: shell, commands: [one, two], depends_on: [a]}\n',
    );

    const r = await run(['plan', file], dir);

    expect(r.code).toBe(0);
    expect(r.out).toContain('1. a [claude-code]\n');
    expect(r.out).toContain('2. b [shell: one && two] (after a)\n');
  });

  it('fails plan on a file that cannot be read', async () => {
    const dir = await makeTempDir();

    const r = await run(['plan', 'nope.yml'], dir);

    expect(r.code).toBe(1);
    expect(r.out).toContain('cannot read workflow file');
  });
});

describe('plugin failures that are not Errors', () => {
  it('describes a module that throws a plain value while loading', async () => {
    const dir = await makeTempDir();
    await writePlugin(dir, 'throws.mjs', "throw 'plain failure';\n");

    await expect(loadPlugin('./throws.mjs', dir)).rejects.toThrow(
      'Cannot load plugin "./throws.mjs": plain failure',
    );
  });

  it('describes a registration that rejects with a plain value', async () => {
    const dir = await makeTempDir();

    await expect(
      createEngine({
        projectDir: dir,
        plugins: [
          {
            name: 'plain',
            register: () => Promise.reject('plain rejection'),
          },
        ],
      }),
    ).rejects.toThrow('Plugin "plain" failed to register: plain rejection');
  });

  it('applies a step timeout to the executor it builds', async () => {
    const dir = await makeTempDir();
    const seen: (number | undefined)[] = [];
    const bundle = await createEngine({
      projectDir: dir,
      stepTimeoutSeconds: 11,
      plugins: [
        {
          name: 'spy',
          register: (host) => {
            host.registerRunner({
              name: 'spy',
              run: async (request) => {
                seen.push(request.timeoutSeconds);
                const { RunResult } = await import('@indaba/core');
                return new RunResult({ exitCode: 0, output: '' });
              },
            });
          },
        },
      ],
    });
    const workflow = bundle.parser.parse(
      'version: "1.0"\nname: x\nsteps:\n  - {id: a, runner: spy, goal: g}\n',
    );

    await bundle.engine.run(workflow, { taskId: 't' });

    expect(seen).toEqual([11]);
  });
});
