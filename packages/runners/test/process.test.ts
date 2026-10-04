import { realpathSync } from 'node:fs';
import { RunnerError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { CommandRunner, loadNodePty, NodeProcessSpawner, type PtyModule } from '../src/index.js';
import { isAlive, nodeScript, TMP, waitUntil } from './support.js';

const real = await loadNodePty();
const noPty = new NodeProcessSpawner({ loadPty: async () => undefined });
const ESC = String.fromCharCode(27);

function runner(code: string, spawner = noPty, usePty = false): CommandRunner {
  return new CommandRunner('child', nodeScript(code), { spawner, usePty });
}

describe('piped fallback with a real child', () => {
  const script = 'console.log("one"); console.log("two"); console.error("bad"); process.exit(4)';

  it('captures stdout, stderr and the exit code separately', async () => {
    const chunks: string[] = [];
    const result = await runner(script, noPty, true).run({
      prompt: 'x',
      workdir: TMP,
      onOutput: (chunk) => chunks.push(chunk),
    });

    expect(result.mode).toBe('piped');
    expect(result.exitCode).toBe(4);
    expect(result.output.replaceAll('\r\n', '\n')).toBe('one\ntwo\n');
    expect(result.errorOutput.trim()).toBe('bad');
    expect(chunks.join('')).toContain('one');
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('falls back to pipes when node-pty cannot start the process', async () => {
    const broken: PtyModule = {
      spawn: () => {
        throw new Error('no native binding');
      },
    };
    const spawner = new NodeProcessSpawner({ loadPty: async () => broken });
    const result = await runner('console.log("ok")', spawner, true).run({ prompt: 'x', workdir: TMP });

    expect(result.mode).toBe('piped');
    expect(result.output.trim()).toBe('ok');
  });

  it('does not touch node-pty when a pipe is requested', async () => {
    let loaded = false;
    const spawner = new NodeProcessSpawner({
      loadPty: async () => {
        loaded = true;
        return undefined;
      },
    });
    await runner('0', spawner, false).run({ prompt: 'x', workdir: TMP });

    expect(loaded).toBe(false);
  });

  it('uses the working directory of the request', async () => {
    const result = await runner('process.stdout.write(process.cwd())').run({ prompt: 'x', workdir: TMP });

    expect(result.output.toLowerCase()).toBe(realpathSync(TMP).toLowerCase());
  });
});

describe('pseudo-terminal mode', () => {
  it('reports pty mode, merges output and strips escapes, with a fake terminal', async () => {
    let received: { file: string; args: string[] } | undefined;
    const fake: PtyModule = {
      spawn: (file, args) => {
        received = { file, args };
        const dataListeners: ((d: string) => void)[] = [];
        const exitListeners: ((e: { exitCode: number }) => void)[] = [];
        setTimeout(() => {
          for (const l of dataListeners) {
            l(`${ESC}[32mgreen${ESC}[0m\r\n`);
          }
          for (const l of exitListeners) {
            l({ exitCode: 2 });
          }
        }, 10);
        return {
          pid: 0,
          onData: (l) => dataListeners.push(l),
          onExit: (l) => exitListeners.push(l),
          kill: () => undefined,
        };
      },
    };
    const spawner = new NodeProcessSpawner({ loadPty: async () => fake });
    const result = await new CommandRunner('t', ['agent', '{prompt}'], { spawner }).run({
      prompt: 'p q',
      workdir: TMP,
    });

    expect(result.mode).toBe('pty');
    expect(result.exitCode).toBe(2);
    expect(result.output).toBe('green\n');
    expect(received).toEqual({ file: 'agent', args: ['p q'] });
  });

  it.skipIf(real === undefined)('runs a real child in a real pty when node-pty loads', async () => {
    const result = await runner(
      'console.log("tty:" + process.stdout.isTTY)',
      new NodeProcessSpawner(),
      true,
    ).run({
      prompt: 'x',
      workdir: TMP,
    });

    expect(['pty', 'piped']).toContain(result.mode);
    if (result.mode === 'pty') {
      expect(result.output).toContain('tty:true');
    }
    expect(result.exitCode).toBe(0);
  });
});

describe('timeout and abort kill the whole tree', () => {
  // The parent starts a grandchild, prints its pid and waits; both must die.
  const tree =
    'const c = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], ' +
    '{ stdio: "ignore" }); console.log(c.pid); setTimeout(() => {}, 60000)';

  function grandchild(output: string): number {
    return Number.parseInt(output.trim().split('\n')[0] ?? '', 10);
  }

  it('timeout kills parent and grandchild', async () => {
    const result = await runner(tree).run({ prompt: 'x', workdir: TMP, timeoutSeconds: 1 });
    const pid = grandchild(result.output);

    expect(result.exitCode).toBe(124);
    expect(result.errorOutput).toContain('Timed out after 1 seconds.');
    expect(Number.isInteger(pid)).toBe(true);
    expect(await waitUntil(() => !isAlive(pid))).toBe(true);
  });

  it('abort kills parent and grandchild', async () => {
    const controller = new AbortController();
    let pid = 0;
    const pending = runner(tree).run(
      {
        prompt: 'x',
        workdir: TMP,
        onOutput: (chunk) => {
          pid = grandchild(chunk);
          controller.abort();
        },
      },
      controller.signal,
    );
    const result = await pending;

    expect(result.exitCode).toBe(130);
    expect(result.errorOutput).toContain('Aborted');
    expect(pid).toBeGreaterThan(0);
    expect(await waitUntil(() => !isAlive(pid))).toBe(true);
  });

  it('an already aborted signal never starts the process', async () => {
    const controller = new AbortController();
    controller.abort();
    const started = Date.now();
    const result = await runner('setTimeout(() => {}, 30000)').run(
      { prompt: 'x', workdir: TMP },
      controller.signal,
    );

    expect(result.exitCode).toBe(130);
    expect(result.output).toBe('');
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('failures to start', () => {
  it('throws a RunnerError for a missing binary', async () => {
    const missing = new CommandRunner('m', ['indaba-no-such-binary-xyz', '{prompt}'], {
      usePty: false,
      spawner: noPty,
    });

    await expect(missing.run({ prompt: 'x', workdir: TMP })).rejects.toThrow(RunnerError);
    await expect(missing.run({ prompt: 'x', workdir: TMP })).rejects.toThrow(
      /Cannot start "indaba-no-such-binary-xyz"/,
    );
  });

  it('keeps the prompt and the environment out of the error message', async () => {
    const secret = ['tok', 'en-value-123'].join('');
    const missing = new CommandRunner('m', ['indaba-no-such-binary-xyz', '{prompt}'], {
      usePty: false,
      spawner: noPty,
    });
    const error = await missing
      .run({ prompt: `prompt-${secret}`, workdir: TMP, env: { SOME_TOKEN: secret } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RunnerError);
    expect(String((error as Error).message)).not.toContain(secret);
  });

  it('rejects a prompt with a NUL byte as a RunnerError that does not echo it', async () => {
    const nul = new CommandRunner('n', nodeScript('0', '{prompt}'), { usePty: false, spawner: noPty });
    const error = await nul
      .run({ prompt: `before${String.fromCharCode(0)}after`, workdir: TMP })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RunnerError);
    expect(String((error as Error).message)).not.toContain('before');
  });
});
