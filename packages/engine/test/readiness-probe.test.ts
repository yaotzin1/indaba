import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createReadinessProbe } from '../src/index.js';

let root = '';
let bin = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'indaba-ready-'));
  bin = join(root, 'bin');
  mkdirSync(bin);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** An empty program file that may be run. */
function program(path: string): void {
  writeFileSync(path, '');
  chmodSync(path, 0o755);
}

const registry = (...names: string[]) => ({ has: (n: string) => names.includes(n) });

describe('createReadinessProbe', () => {
  it('says whether a variable is set and nothing else; empty is not set', () => {
    const probe = createReadinessProbe(root, { A: 'x', B: '' }, registry());
    expect([probe.isEnvSet('A'), probe.isEnvSet('B'), probe.isEnvSet('C')]).toEqual([true, false, false]);
  });

  it('reads variable names case-insensitively on Windows only', () => {
    expect(
      createReadinessProbe(root, { path: 'x' }, registry(), { platform: 'win32' }).isEnvSet('PATH'),
    ).toBe(true);
    expect(
      createReadinessProbe(root, { path: 'x' }, registry(), { platform: 'linux' }).isEnvSet('PATH'),
    ).toBe(false);
  });

  it('classifies a file, a folder, a missing path and a path outside the project', () => {
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'a.md'), 'x');
    const probe = createReadinessProbe(root, {}, registry());
    expect(probe.fileState('docs/a.md')).toBe('file');
    expect(probe.fileState('docs')).toBe('directory');
    expect(probe.fileState('docs/none.md')).toBe('missing');
    expect(probe.fileState('../x')).toBe('outside');
    expect(probe.fileState(join(tmpdir(), 'x'))).toBe('outside');
  });

  it('treats a link that leads out of the project as outside', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'indaba-elsewhere-'));
    try {
      symlinkSync(elsewhere, join(root, 'link'), 'dir');
    } catch {
      rmSync(elsewhere, { recursive: true, force: true });
      return; // creating a link needs a privilege on some machines
    }
    try {
      expect(createReadinessProbe(root, {}, registry()).fileState('link')).toBe('outside');
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('finds a program on PATH by scanning directories', () => {
    program(join(bin, 'tool'));
    const probe = createReadinessProbe(root, { PATH: bin }, registry(), { platform: 'linux' });
    expect(probe.hasExecutable('tool')).toBe(true);
    expect(probe.hasExecutable('other')).toBe(false);
    expect(probe.hasExecutable('../tool')).toBe(false);
  });

  it('on Windows finds an .exe but not a .cmd shim', () => {
    writeFileSync(join(bin, 'real.exe'), '');
    writeFileSync(join(bin, 'shim.cmd'), '');
    const probe = createReadinessProbe(root, { Path: bin, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, registry(), {
      platform: 'win32',
    });
    expect(probe.hasExecutable('real')).toBe(true);
    expect(probe.hasExecutable('shim')).toBe(false);
  });

  it('a runner is available when registered and, for an agent CLI, its program is found', () => {
    program(join(bin, 'claude'));
    const probe = createReadinessProbe(root, { PATH: bin }, registry('claude-code', 'codex', 'shell'), {
      platform: 'linux',
    });
    expect(probe.isRunnerRegistered('claude-code')).toBe(true);
    expect(probe.isRunnerRegistered('codex')).toBe(false);
    expect(probe.isRunnerRegistered('nope')).toBe(false);
    expect(probe.isRunnerRegistered('shell')).toBe(true);
  });

  it('names the variables a runner reads and never lists a value', () => {
    const env = {
      INDABA_ACP_PASS_ENV: 'GEMINI_API_KEY, HOME_*',
      INDABA_OPENAI_COMPAT_MY_LLM_KEY_ENV: 'MY_LLM_KEY',
      MY_LLM_KEY: 'sk-secret',
    };
    const probe = createReadinessProbe(root, env, registry());
    expect(probe.envNamesOf('openrouter')).toEqual(['OPENROUTER_API_KEY']);
    expect(probe.envNamesOf('acp')).toEqual(['GEMINI_API_KEY']);
    expect(probe.envNamesOf('my-llm')).toEqual(['MY_LLM_KEY']);
    expect(probe.envNamesOf('codex')).toEqual([]);
    expect(JSON.stringify(probe.envNamesOf('my-llm'))).not.toContain('sk-secret');
  });

  it('tells a git folder from a plain one', () => {
    expect(createReadinessProbe(root, {}, registry()).workspaceKind()).toBe('plain');
    mkdirSync(join(root, '.git'));
    expect(createReadinessProbe(root, {}, registry()).workspaceKind()).toBe('git');
  });
});

describe('review corrections', () => {
  it('a configured codex command replaces the default program, as the registry does', () => {
    program(join(bin, 'codex-x'));
    const probe = createReadinessProbe(
      root,
      { PATH: bin, INDABA_CODEX_CMD: 'codex-x exec {prompt}' },
      registry('codex'),
      { platform: 'linux' },
    );
    expect(probe.isRunnerRegistered('codex')).toBe(true);
  });

  it('a file without the execute bit is not a program on POSIX; a name that carries .exe is found on Windows', () => {
    if (process.platform !== 'win32') {
      writeFileSync(join(bin, 'plain'), '');
      chmodSync(join(bin, 'plain'), 0o644);
      expect(
        createReadinessProbe(root, { PATH: bin }, registry(), { platform: 'linux' }).hasExecutable('plain'),
      ).toBe(false);
    }
    writeFileSync(join(bin, 'git.exe'), '');
    const win = createReadinessProbe(root, { PATH: bin }, registry(), { platform: 'win32' });
    expect(win.hasExecutable('git.exe')).toBe(true);
    expect(win.hasExecutable('git')).toBe(true);
  });

  it('sees the git folder from a subfolder', () => {
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'sub'));
    expect(createReadinessProbe(join(root, 'sub'), {}, registry()).workspaceKind()).toBe('git');
  });
});
