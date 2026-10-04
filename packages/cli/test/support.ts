import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Git } from '@indaba/engine';
import { afterEach } from 'vitest';
import type { Io } from '../src/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

export async function makeTempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'indaba-cli-')));
  tempDirs.push(dir);
  return dir;
}

export async function makeGitRepo(): Promise<string> {
  const dir = await makeTempDir();
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', 'app.txt'), 'v1\n');
  const git = new Git();
  await git.run(['init', '-q', '-b', 'main'], dir);
  await git.run(['config', 'core.autocrlf', 'false'], dir);
  await git.run(['add', '-A'], dir);
  await git.run(
    [
      '-c',
      'user.name=Indaba Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      'init',
    ],
    dir,
  );
  return dir;
}

export interface Captured {
  readonly io: Io;
  stdout(): string;
  stderr(): string;
}

export function captureIo(
  cwd: string,
  env: Record<string, string | undefined> = {},
  signal?: AbortSignal,
): Captured {
  let out = '';
  let err = '';
  return {
    io: {
      stdout: {
        write: (text) => {
          out += text;
        },
      },
      stderr: {
        write: (text) => {
          err += text;
        },
      },
      env,
      cwd,
      ...(signal === undefined ? {} : { signal }),
    },
    stdout: () => out,
    stderr: () => err,
  };
}

/** Writes a plugin module (plain ESM) into `dir` and returns its path. */
export async function writePlugin(dir: string, name: string, source: string): Promise<string> {
  const file = join(dir, name);
  await writeFile(file, source);
  return file;
}

export async function writeWorkflow(dir: string, name: string, yaml: string): Promise<string> {
  const file = join(dir, name);
  await writeFile(file, yaml);
  return file;
}

export function parseLog(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line));
}

export const FIXTURE_WORKFLOW = `version: "1.0"
name: "ext-flow"
roles:
  worker:
    runner: "fake"
steps:
  - id: "work"
    role: "worker"
    goal: "do the thing"
    guards:
      - type: "always_ok"
`;

/**
 * A plugin written as plain ESM source: a runner "fake", a guard type "always_ok" and a listener,
 * each appending a line to `logFile` so the test can see them run. Nothing here is in core, engine
 * or runners.
 */
export function fakePluginSource(logFile: string, runnerExitCode = 0): string {
  return `import { appendFileSync } from 'node:fs';
import { EOL } from 'node:os';
import { GuardResult, RunResult, StepStatusChanged } from '@indaba/core';

const log = (line) => appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(line) + EOL);

export default {
  name: 'fake-plugin',
  register(host) {
    host.registerRunner({
      name: 'fake',
      async run(request) {
        log('runner:' + request.prompt.includes('do the thing'));
        return new RunResult({ exitCode: ${runnerExitCode}, output: 'done', errorOutput: ${runnerExitCode === 0 ? "''" : "'boom'"} });
      },
    });
    host.registerGuard({
      type: 'always_ok',
      async check() {
        log('guard:always_ok');
        return GuardResult.pass();
      },
    });
    host.addListener(StepStatusChanged, (event) => log('event:' + event.stepId + ':' + event.to));
  },
};
`;
}
