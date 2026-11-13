import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProcessOutcome, ProcessSpawner, ProcessSpec } from '../src/index.js';

/** A working directory of its own per test file: the runners create and remove `.indaba/tmp` in it, so files must not share one. */
export const TMP = mkdtempSync(join(tmpdir(), 'indaba-runners-'));
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));

/** Records what a runner asked for and answers with a canned outcome; never starts anything. */
export class FakeSpawner implements ProcessSpawner {
  readonly specs: ProcessSpec[] = [];

  constructor(
    private readonly script: (spec: ProcessSpec) => Partial<ProcessOutcome> | undefined = () => undefined,
  ) {}

  async run(spec: ProcessSpec): Promise<ProcessOutcome> {
    this.specs.push(spec);
    const outcome = this.script(spec);
    return { exitCode: 0, timedOut: false, aborted: false, mode: 'piped', ...outcome };
  }

  get last(): ProcessSpec {
    const spec = this.specs.at(-1);
    if (spec === undefined) {
      throw new Error('The fake spawner was not called.');
    }
    return spec;
  }
}

/** A node program as an argument vector, runnable on every platform. */
export function nodeScript(code: string, ...args: string[]): string[] {
  return [process.execPath, '-e', code, ...args];
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitUntil(condition: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return condition();
}
