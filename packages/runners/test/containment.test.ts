import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunnerUnavailableError } from '@indaba/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BASELINE_ENV_NAMES,
  buildRunnerEnvironment,
  ClaudeRunner,
  CodexRunner,
  CommandRunner,
  NodeProcessSpawner,
  ShellRunner,
} from '../src/index.js';
import { FakeSpawner, nodeScript } from './support.js';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function workdir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'indaba-contain-'));
  dirs.push(dir);
  return dir;
}

const HOST = {
  PATH: '/bin',
  HOME: '/home/x',
  TEMP: 'C:\\Users\\x\\AppData\\Local\\Temp',
  TMPDIR: '/tmp',
  AWS_SECRET_ACCESS_KEY: 'aws-secret-value',
  GITHUB_TOKEN: 'github-token-value',
  DATABASE_URL: 'postgres://db',
  ANTHROPIC_API_KEY: 'anthropic-key-value',
  OPENAI_API_KEY: 'openai-key-value',
  OPENROUTER_API_KEY: 'router-key-value',
  CLAUDE_CONFIG_DIR: '/claude',
  CODEX_HOME: '/codex',
  CI: 'true',
  PNPM_HOME: '/pnpm',
  NPM_CONFIG_REGISTRY: 'https://registry.example',
  MY_EXTRA: 'extra',
};

describe('buildRunnerEnvironment', () => {
  it('keeps the baseline, the prefixes and the passed names, and nothing else', () => {
    const env = buildRunnerEnvironment({
      source: HOST,
      prefixes: ['ANTHROPIC_'],
      passEnv: ['MY_*'],
    });
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/home/x',
      ANTHROPIC_API_KEY: 'anthropic-key-value',
      NPM_CONFIG_REGISTRY: 'https://registry.example',
      MY_EXTRA: 'extra',
    });
  });

  it('never carries the host TEMP, TMP or TMPDIR, and sets them to the confined directory', () => {
    const env = buildRunnerEnvironment({ source: HOST, tempDir: '/w/.indaba/tmp' });
    expect(env.TEMP).toBe('/w/.indaba/tmp');
    expect(env.TMP).toBe('/w/.indaba/tmp');
    expect(env.TMPDIR).toBe('/w/.indaba/tmp');
    expect(BASELINE_ENV_NAMES.has('TEMP')).toBe(false);
  });

  it('lets an explicit addition win, including over the confined directory', () => {
    const env = buildRunnerEnvironment({
      source: HOST,
      additions: { TMP: '/mine', FROM_REQUEST: 'r' },
      tempDir: '/w/.indaba/tmp',
    });
    expect(env.TMP).toBe('/mine');
    expect(env.TEMP).toBe('/w/.indaba/tmp');
    expect(env.FROM_REQUEST).toBe('r');
  });

  it('compares names without regard to case and keeps the spelling of the source', () => {
    const env = buildRunnerEnvironment({ source: { Path: 'C:\\bin', Secret_Thing: 'x' }, passEnv: ['path'] });
    expect(env).toEqual({ Path: 'C:\\bin' });
  });

  it('starts from nothing without a source', () => {
    expect(buildRunnerEnvironment({})).toEqual({});
  });
});

describe('the environment of a CLI runner (AC-04, AC-05)', () => {
  it('strips unrelated secrets and keeps the provider prefixes and passEnv', async () => {
    const spawner = new FakeSpawner();
    const dir = await workdir();
    await new ClaudeRunner({ spawner, env: HOST, passEnv: ['MY_EXTRA'] }).run({ prompt: 'p', workdir: dir });
    const env = spawner.last.env;
    expect(env.ANTHROPIC_API_KEY).toBe('anthropic-key-value');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/claude');
    expect(env.MY_EXTRA).toBe('extra');
    expect(env.PATH).toBe('/bin');
    for (const name of [
      'AWS_SECRET_ACCESS_KEY',
      'GITHUB_TOKEN',
      'DATABASE_URL',
      'OPENAI_API_KEY',
      'OPENROUTER_API_KEY',
    ]) {
      expect(env[name]).toBeUndefined();
    }
    expect(spawner.last.inheritEnv).toBe(false);
  });

  it('gives each runner only its own provider', async () => {
    const spawner = new FakeSpawner();
    const dir = await workdir();
    await new CodexRunner({ spawner, env: HOST }).run({ prompt: 'p', workdir: dir });
    expect(spawner.last.env.OPENAI_API_KEY).toBe('openai-key-value');
    expect(spawner.last.env.CODEX_HOME).toBe('/codex');
    expect(spawner.last.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('passes no provider to a runner described by configuration, unless named', async () => {
    const spawner = new FakeSpawner();
    const dir = await workdir();
    await new CommandRunner('x', ['x', '{prompt}'], { spawner, env: HOST }).run({
      prompt: 'p',
      workdir: dir,
    });
    expect(spawner.last.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('takes the variables of this process when no environment is given', async () => {
    const spawner = new FakeSpawner();
    const dir = await workdir();
    await new CommandRunner('x', ['x'], { spawner }).run({ prompt: 'p', workdir: dir });
    expect(spawner.last.env.PATH ?? spawner.last.env.Path).toBe(process.env.PATH ?? process.env.Path);
  });
});

describe('the environment of the shell runner (AC-06)', () => {
  it('keeps toolchain variables and never a provider key', async () => {
    const spawner = new FakeSpawner();
    const dir = await workdir();
    await new ShellRunner({ spawner, env: HOST }).run({ prompt: 'pnpm test', workdir: dir });
    const env = spawner.last.env;
    expect(env.CI).toBe('true');
    expect(env.PNPM_HOME).toBe('/pnpm');
    expect(env.NPM_CONFIG_REGISTRY).toBe('https://registry.example');
    for (const name of [
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'OPENROUTER_API_KEY',
      'GITHUB_TOKEN',
      'MY_EXTRA',
    ]) {
      expect(env[name]).toBeUndefined();
    }
  });

  it('passes a provider key when it is named in passEnv or in the request', async () => {
    const spawner = new FakeSpawner();
    const dir = await workdir();
    await new ShellRunner({ spawner, env: HOST, passEnv: ['OPENAI_API_KEY'] }).run({
      prompt: 'x',
      workdir: dir,
      env: { ANTHROPIC_API_KEY: 'from-request' },
    });
    expect(spawner.last.env.OPENAI_API_KEY).toBe('openai-key-value');
    expect(spawner.last.env.ANTHROPIC_API_KEY).toBe('from-request');
  });
});

describe('the process layer without a complete environment (AC-07)', () => {
  it('adds to a baseline of this process, never to all of it', async () => {
    const name = 'INDABA_CONTAIN_SECRET';
    process.env[name] = 'visible-only-if-merged';
    try {
      const dir = await workdir();
      const out: string[] = [];
      await new NodeProcessSpawner().run({
        command: nodeScript(`process.stdout.write(String(process.env.${name}) + '|' + process.env.ADDED)`),
        cwd: dir,
        env: { ADDED: 'yes' },
        usePty: false,
        timeoutSeconds: 10,
        onData: (_stream, chunk) => out.push(chunk),
      });
      expect(out.join('')).toBe('undefined|yes');
    } finally {
      delete process.env[name];
    }
  });
});

describe('the confined temporary directory (AC-01 to AC-03)', () => {
  it('points TEMP, TMP and TMPDIR at <workdir>/.indaba/tmp, which exists during the call and not after', async () => {
    const dir = await workdir();
    const tempDir = join(dir, '.indaba', 'tmp');
    let existedDuring = false;
    const spawner = new FakeSpawner(() => {
      existedDuring = existsSync(tempDir);
      return undefined;
    });
    await new ShellRunner({ spawner, env: HOST }).run({ prompt: 'x', workdir: dir });
    expect(spawner.last.env.TEMP).toBe(tempDir);
    expect(spawner.last.env.TMP).toBe(tempDir);
    expect(spawner.last.env.TMPDIR).toBe(tempDir);
    expect(existedDuring).toBe(true);
    expect(existsSync(tempDir)).toBe(false);
  });

  it('starts every call with an empty directory', async () => {
    const dir = await workdir();
    const tempDir = join(dir, '.indaba', 'tmp');
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, 'leftover'), 'x');
    let leftover = true;
    const spawner = new FakeSpawner(() => {
      leftover = existsSync(join(tempDir, 'leftover'));
      return undefined;
    });
    await new ShellRunner({ spawner }).run({ prompt: 'x', workdir: dir });
    expect(leftover).toBe(false);
  });

  it('removes it after a non-zero exit, a timeout, a stall and an abort', async () => {
    for (const outcome of [
      { exitCode: 3 },
      { exitCode: 124, timedOut: true },
      { exitCode: 125, stalled: true },
      { exitCode: 130, aborted: true },
    ]) {
      const dir = await workdir();
      const spawner = new FakeSpawner(() => outcome);
      await new ShellRunner({ spawner }).run({ prompt: 'x', workdir: dir });
      expect(existsSync(join(dir, '.indaba', 'tmp'))).toBe(false);
    }
  });

  it('removes it when the spawner throws', async () => {
    const dir = await workdir();
    const spawner = {
      run: () => Promise.reject(new RunnerUnavailableError('cannot start')),
    };
    await expect(new ShellRunner({ spawner }).run({ prompt: 'x', workdir: dir })).rejects.toThrow(
      'cannot start',
    );
    expect(existsSync(join(dir, '.indaba', 'tmp'))).toBe(false);
  });

  it('is a runner that cannot start when the working directory does not exist', async () => {
    const dir = join(await workdir(), 'missing');
    const spawner = new FakeSpawner();
    await expect(new ShellRunner({ spawner }).run({ prompt: 'x', workdir: dir })).rejects.toBeInstanceOf(
      RunnerUnavailableError,
    );
    expect(spawner.specs).toHaveLength(0);
  });

  it('lets calls that overlap in one working directory share it until the last one ends', async () => {
    const dir = await workdir();
    const tempDir = join(dir, '.indaba', 'tmp');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = {
      run: async () => {
        await gate;
        return { exitCode: 0, timedOut: false, aborted: false, mode: 'piped' as const };
      },
    };
    const first = new ShellRunner({ spawner: slow }).run({ prompt: 'x', workdir: dir });
    await new ShellRunner({ spawner: new FakeSpawner() }).run({ prompt: 'x', workdir: dir });
    expect(existsSync(tempDir)).toBe(true);
    release();
    await first;
    expect(existsSync(tempDir)).toBe(false);
  });
});

describe('ClaudeRunner and subagents (AC-08, AC-09)', () => {
  const commandOf = async (
    options: ConstructorParameters<typeof ClaudeRunner>[0],
  ): Promise<readonly string[]> => {
    const spawner = new FakeSpawner();
    await new ClaudeRunner({ spawner, ...options }).run({ prompt: 'p', workdir: await workdir() });
    return spawner.last.command;
  };

  it('passes --disallowedTools Task by default, in both the stream and the plain call', async () => {
    for (const reportUsage of [true, false]) {
      const command = await commandOf({ reportUsage });
      expect(command[command.indexOf('--disallowedTools') + 1]).toBe('Task');
    }
  });

  it('omits it with allowSubagents: true', async () => {
    expect(await commandOf({ allowSubagents: true })).not.toContain('--disallowedTools');
  });

  it('leaves a tool filter the embedder wrote alone', async () => {
    for (const extraArgs of [
      ['--disallowedTools', 'Bash'],
      ['--disallowed-tools=Bash'],
      ['--allowedTools', 'Read'],
      ['--allowed-tools', 'Read'],
    ]) {
      const command = await commandOf({ extraArgs });
      expect(
        command.filter((arg) => arg.toLowerCase().includes('disallowed') && !extraArgs.includes(arg)),
      ).toEqual([]);
      expect(command).not.toContain('Task');
    }
  });

  it('keeps a written permission level last', async () => {
    const spawner = new FakeSpawner();
    await new ClaudeRunner({ spawner }).run({
      prompt: 'p',
      workdir: await workdir(),
      permissionLevel: 'read',
    });
    expect(spawner.last.command.slice(-2)).toEqual(['--permission-mode', 'plan']);
  });
});
