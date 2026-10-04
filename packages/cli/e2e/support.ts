import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeAll } from 'vitest';

export const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
export const binPath = join(repoRoot, 'packages', 'cli', 'dist', 'bin.js');
export const corePath = join(repoRoot, 'packages', 'core', 'dist', 'index.js');
export const examplesDir = join(repoRoot, 'examples');

/** Call once at the top of a file: every test fails with one clear message when the build is missing. */
export function requireBuild(): void {
  beforeAll(() => {
    for (const file of [binPath, corePath]) {
      if (!existsSync(file)) {
        throw new Error(`${file} is missing: run pnpm build first.`);
      }
    }
  });
}

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

export async function makeTempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'indaba-e2e-')));
  tempDirs.push(dir);
  return dir;
}

const SENSITIVE = /key|token|secret|password|credential/i;

/** The host environment minus anything that looks like a credential, plus what the test sets. */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !SENSITIVE.test(name)) {
      env[name] = value;
    }
  }
  return { ...env, NO_COLOR: '1', ...extra };
}

export interface CliResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunningCli {
  readonly child: ChildProcess;
  readonly result: Promise<CliResult>;
  stdout(): string;
}

/** Starts the built CLI: `node packages/cli/dist/bin.js <args>`, no shell. */
export function startCli(args: readonly string[], cwd: string, env: Record<string, string> = {}): RunningCli {
  const child = spawn(process.execPath, [binPath, ...args], {
    cwd,
    env: childEnv(env),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const result = new Promise<CliResult>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, result, stdout: () => stdout };
}

export function runCli(
  args: readonly string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<CliResult> {
  return startCli(args, cwd, env).result;
}

export async function waitFor(
  check: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

function git(cwd: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, windowsHide: true }, (error) =>
      error === null ? resolve() : reject(error),
    );
  });
}

/** A temp directory that is a git repository with one commit. */
export async function makeGitRepo(): Promise<string> {
  const dir = await makeTempDir();
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.name', 'Indaba E2E']);
  await git(dir, ['config', 'user.email', 'e2e@example.invalid']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  await git(dir, ['config', 'core.autocrlf', 'false']);
  await writeFile(join(dir, 'readme.txt'), 'hello\n');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

export async function writeFileIn(dir: string, name: string, content: string): Promise<string> {
  const file = join(dir, name);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, content);
  return file;
}

/** Every record of every trace file under `<dir>/.indaba/traces`. */
export async function readTraceRecords(dir: string): Promise<Record<string, unknown>[]> {
  const traces = join(dir, '.indaba', 'traces');
  const records: Record<string, unknown>[] = [];
  for (const name of (await readdir(traces)).filter((n) => n.endsWith('.jsonl'))) {
    for (const line of (await readFile(join(traces, name), 'utf8')).split(/\r?\n/)) {
      if (line === '') {
        continue;
      }
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`Trace line is not a JSON object: ${line}`);
      }
      records.push(Object.fromEntries(Object.entries(parsed)));
    }
  }
  return records;
}

export async function readAllTraceText(dir: string): Promise<string> {
  const traces = join(dir, '.indaba', 'traces');
  let text = '';
  for (const name of await readdir(traces)) {
    text += await readFile(join(traces, name), 'utf8');
  }
  return text;
}

/** A plugin written as plain ESM; it loads @indaba/core from the built package by file URL. */
export function pluginSource(body: string): string {
  return `import { GuardResult, RunResult, StepStatusChanged } from ${JSON.stringify(pathToFileURL(corePath).href)};\n${body}`;
}
