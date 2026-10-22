import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANCEL_MESSAGE, createRunStarter, treeKiller } from '../src/run-child.js';
import { makeTempDir, writeWorkflow } from './support.js';

/**
 * Whether a process still runs. A process that was killed but not yet reaped is a zombie: it answers a signal 0, yet
 * runs nothing. Where an init does not reap orphans (a container), it stays one, so on Linux its state decides.
 */
function running(pid: number): boolean {
  if (process.platform === 'linux') {
    try {
      return readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[2] !== 'Z';
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** What the binary passes on this platform, with the real `process.kill`. */
const posixKill = treeKiller(process.platform, {
  spawn: (command, args, options) => spawn(command, [...args], options),
  kill: (pid, signal) => process.kill(pid, signal),
});

/** The same executable that runs the tests stands in for `node bin.js`: the script is a stand-in for the CLI. */
async function starterFor(source: string) {
  const dir = await makeTempDir();
  const script = await writeWorkflow(dir, 'child.mjs', source);
  return { dir, start: createRunStarter(process.execPath, script, posixKill) };
}

describe('createRunStarter: a real child process', () => {
  it('passes the arguments as an array and reports the exit status and the error stream', async () => {
    const { dir, start } = await starterFor(
      'process.stderr.write(JSON.stringify(process.argv.slice(2))); process.exit(3);',
    );
    const child = start(['run', 'my workflow.yml', '--x=$(nope)'], { cwd: dir, environment: process.env });
    expect(await child.exited).toBe(3);
    expect(JSON.parse(child.stderr())).toEqual(['run', 'my workflow.yml', '--x=$(nope)']);
  });

  it('runs in the directory it is given and sees the environment it is given', async () => {
    const { dir, start } = await starterFor(
      "process.stderr.write(process.cwd() + '|' + process.env.INDABA_TEST_VALUE);",
    );
    const child = start([], { cwd: dir, environment: { ...process.env, INDABA_TEST_VALUE: 'seen' } });
    await child.exited;
    const [cwd, value] = child.stderr().split('|');
    expect(value).toBe('seen');
    expect(cwd?.toLowerCase()).toBe(dir.toLowerCase());
  });

  it('keeps only the end of a very long error stream', async () => {
    const { dir, start } = await starterFor(
      "process.stderr.write('x'.repeat(30000) + 'END'); process.exitCode = 1;",
    );
    const child = start([], { cwd: dir, environment: process.env });
    await child.exited;
    expect(child.stderr().length).toBeLessThanOrEqual(8192);
    expect(child.stderr().endsWith('END')).toBe(true);
  });

  it('cancels through the channel, on every OS, and the child chooses how to stop', async () => {
    const { dir, start } = await starterFor(`
      process.on('message', (message) => {
        if (message === ${JSON.stringify(CANCEL_MESSAGE)}) { process.exit(130); }
      });
      process.stderr.write('ready');
      setTimeout(() => process.exit(0), 20000);
    `);
    const child = start([], { cwd: dir, environment: process.env });
    while (child.stderr() === '') {
      await new Promise((r) => setTimeout(r, 20));
    }
    child.cancel();
    expect(await child.exited).toBe(130);
  });

  it('cancelling a run that has ended is harmless', async () => {
    const { dir, start } = await starterFor('process.exit(0);');
    const child = start([], { cwd: dir, environment: process.env });
    expect(await child.exited).toBe(0);
    expect(() => child.cancel()).not.toThrow();
    expect(() => child.release()).not.toThrow();
  });

  it('lets a released run carry on and finish by itself', async () => {
    const { dir, start } = await starterFor(`
      process.on('disconnect', () => process.stderr.write(''));
      setTimeout(() => process.exit(0), 150);
    `);
    const child = start([], { cwd: dir, environment: process.env });
    expect(() => child.release()).not.toThrow();
  });

  it('reports a program that cannot be started as a failed run with the reason', async () => {
    const dir = await makeTempDir();
    const child = createRunStarter(
      join(dir, 'no-such-node'),
      join(dir, 'child.mjs'),
      posixKill,
    )([], {
      cwd: dir,
      environment: process.env,
    });
    expect(await child.exited).toBe(1);
    expect(child.stderr()).toContain('ENOENT');
  });

  it('kills a child that ignores cancel, with the children it started (POSIX group, T-10)', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const { dir, start } = await starterFor(`
      import { spawn } from 'node:child_process';
      process.on('message', () => undefined);
      const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
      process.stderr.write(String(grandchild.pid) + '\\n');
      setTimeout(() => {}, 60000);
    `);
    const child = start([], { cwd: dir, environment: process.env });
    while (!child.stderr().includes('\n')) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const grandchild = Number(child.stderr().trim());
    child.cancel();
    child.kill();
    expect(await child.exited).toBe(1);
    // The grandchild was in the child's group, so it went too. Polled briefly: the kernel reaps it asynchronously.
    let alive = running(grandchild);
    for (let i = 0; i < 50 && alive; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      alive = running(grandchild);
    }
    expect(alive).toBe(false);
  });

  it('signals nothing once the child has exited, or when it never started', async () => {
    const killed: number[] = [];
    const { dir } = await starterFor('process.exit(0);');
    const script = join(dir, 'child.mjs');
    const child = createRunStarter(process.execPath, script, (pid) => killed.push(pid))([], {
      cwd: dir,
      environment: process.env,
    });
    expect(await child.exited).toBe(0);
    child.kill();
    child.kill();
    const never = createRunStarter(join(dir, 'no-such-node'), script, (pid) => killed.push(pid))([], {
      cwd: dir,
      environment: process.env,
    });
    await never.exited;
    never.kill();
    expect(killed).toEqual([]);
  });

  it('kills a live child by its own pid, through the tree killer it was given', async () => {
    const killed: number[] = [];
    const { dir } = await starterFor('setTimeout(() => {}, 60000);');
    const child = createRunStarter(process.execPath, join(dir, 'child.mjs'), (pid) => {
      killed.push(pid);
      process.kill(pid, 'SIGKILL');
    })([], { cwd: dir, environment: process.env });
    child.kill();
    await child.exited;
    expect(killed).toHaveLength(1);
    expect(killed[0]).toBeGreaterThan(0);
  });
});

describe('treeKiller', () => {
  it('on Windows runs taskkill for the tree, as an argument array, with no window and no shell', () => {
    const spawned: { command: string; args: readonly string[]; options: unknown }[] = [];
    const kill = treeKiller('win32', {
      spawn: (command, args, options) => {
        spawned.push({ command, args, options });
        return { on: () => undefined };
      },
      kill: () => {
        throw new Error('not on Windows');
      },
    });
    kill(4242);
    expect(spawned).toEqual([
      {
        command: 'taskkill',
        args: ['/PID', '4242', '/T', '/F'],
        options: { stdio: 'ignore', windowsHide: true },
      },
    ]);
  });

  it('elsewhere sends SIGKILL to the process group, and a group already gone is no error', () => {
    const sent: [number, string][] = [];
    const deps = {
      spawn: () => {
        throw new Error('no taskkill here');
      },
      kill: (pid: number, signal: NodeJS.Signals) => {
        sent.push([pid, signal]);
        if (pid === -7) {
          throw new Error('ESRCH');
        }
      },
    };
    treeKiller('linux', deps)(4242);
    treeKiller('darwin', deps)(4243);
    expect(() => treeKiller('linux', deps)(7)).not.toThrow();
    expect(sent).toEqual([
      [-4242, 'SIGKILL'],
      [-4243, 'SIGKILL'],
      [-7, 'SIGKILL'],
    ]);
  });
});
