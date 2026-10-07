import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANCEL_MESSAGE, createRunStarter } from '../src/run-child.js';
import { makeTempDir, writeWorkflow } from './support.js';

/** The same executable that runs the tests stands in for `node bin.js`: the script is a stand-in for the CLI. */
async function starterFor(source: string) {
  const dir = await makeTempDir();
  const script = await writeWorkflow(dir, 'child.mjs', source);
  return { dir, start: createRunStarter(process.execPath, script) };
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
    const child = createRunStarter(join(dir, 'no-such-node'), join(dir, 'child.mjs'))([], {
      cwd: dir,
      environment: process.env,
    });
    expect(await child.exited).toBe(1);
    expect(child.stderr()).toContain('ENOENT');
  });
});
