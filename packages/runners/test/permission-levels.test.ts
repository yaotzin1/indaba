import {
  EnforcementMode,
  isPermissionCapable,
  MAX_DENIAL_WINDOW,
  type PermissionLevel,
  permissionCapabilitiesOf,
  type Runner,
} from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { decidePermission } from '../src/acp-policy.js';
import {
  AcpRunner,
  AntigravityRunner,
  ClaudeRunner,
  CodexRunner,
  CursorRunner,
  OpenCodeRunner,
  OpenRouterRunner,
  ShellRunner,
} from '../src/index.js';
import { FakeSpawner, TMP } from './support.js';

async function commandOf(
  make: (spawner: FakeSpawner) => Runner,
  permissionLevel?: PermissionLevel,
): Promise<readonly string[]> {
  const spawner = new FakeSpawner();
  await make(spawner).run({
    prompt: 'p',
    workdir: TMP,
    ...(permissionLevel !== undefined ? { permissionLevel } : {}),
  });
  return spawner.last.command;
}

const claude = (spawner: FakeSpawner) => new ClaudeRunner({ spawner, usePty: false });
const agy = (spawner: FakeSpawner) => new AntigravityRunner({ spawner, usePty: false });

describe('claude-code levels (specs/agent-permissions AC-07, AC-08)', () => {
  it('passes the permission mode of each written level', async () => {
    expect(await commandOf(claude, 'read')).toEqual(['claude', '-p', 'p', '--permission-mode', 'plan']);
    expect(await commandOf(claude, 'edit')).toEqual([
      'claude',
      '-p',
      'p',
      '--permission-mode',
      'acceptEdits',
    ]);
    expect(await commandOf(claude, 'full')).toEqual([
      'claude',
      '-p',
      'p',
      '--permission-mode',
      'bypassPermissions',
    ]);
  });

  it('keeps its built-in default for a step that writes no level', async () => {
    expect(await commandOf(claude)).toEqual(['claude', '-p', 'p', '--permission-mode', 'acceptEdits']);
  });

  it('puts the written level after extraArgs so an embedder cannot widen it', async () => {
    const make = (spawner: FakeSpawner) =>
      new ClaudeRunner({ spawner, usePty: false, extraArgs: ['--permission-mode', 'bypassPermissions'] });
    const command = await commandOf(make, 'read');
    expect(command.slice(-2)).toEqual(['--permission-mode', 'plan']);
    expect(command.lastIndexOf('--permission-mode')).toBe(command.length - 2);
  });

  it('keeps extraArgs as the replacement default when no level is written', async () => {
    const make = (spawner: FakeSpawner) => new ClaudeRunner({ spawner, usePty: false, extraArgs: ['--x'] });
    expect(await commandOf(make)).toEqual(['claude', '-p', 'p', '--x']);
  });
});

describe('codex levels', () => {
  const codex = (spawner: FakeSpawner) => new CodexRunner({ spawner, usePty: false });

  it("keeps today's sandbox with no level and with the written level edit", async () => {
    expect(await commandOf(codex)).toEqual(['codex', 'exec', '--sandbox', 'workspace-write', 'p']);
    expect(await commandOf(codex, 'edit')).toEqual(['codex', 'exec', '--sandbox', 'workspace-write', 'p']);
  });

  it('offers read and full as unsupported until their arguments are confirmed', () => {
    const modes = Object.fromEntries(
      permissionCapabilitiesOf(codex(new FakeSpawner())).map((c) => [c.level, c.mode]),
    );
    expect(modes).toEqual({ read: 'unsupported', edit: 'native', full: 'unsupported' });
  });
});

describe('antigravity levels and the silent refusal (AC-11)', () => {
  it('passes --mode for read and edit, the skip flag for full, and nothing with no level', async () => {
    expect(await commandOf(agy)).toEqual(['agy', '-p', 'p']);
    expect(await commandOf(agy, 'read')).toEqual(['agy', '--mode', 'plan', '-p', 'p']);
    expect(await commandOf(agy, 'edit')).toEqual(['agy', '--mode', 'accept-edits', '-p', 'p']);
    expect(await commandOf(agy, 'full')).toEqual(['agy', '--dangerously-skip-permissions', '-p', 'p']);
  });

  it('recognises the refusal message, from fragments, at either end of a long output', () => {
    const runner = new AntigravityRunner();
    const message = [
      'The tool write_file ',
      'required the write_file permission',
      ' that headless mode cannot prompt for.',
    ].join('');
    expect(runner.canRecogniseDenial).toBe(true);
    expect(runner.permissionDenied(message)).toBe(true);
    expect(runner.permissionDenied(`${message}${'x'.repeat(MAX_DENIAL_WINDOW * 4)}`)).toBe(true);
    expect(runner.permissionDenied(`${'x'.repeat(MAX_DENIAL_WINDOW * 4)}${message}`)).toBe(true);
    expect(runner.permissionDenied('all good')).toBe(false);
  });

  it('does not read the middle of a very long output', () => {
    const message = 'required the write_file permission that headless mode cannot prompt for';
    const long = `${'x'.repeat(MAX_DENIAL_WINDOW * 2)}${message}${'y'.repeat(MAX_DENIAL_WINDOW * 2)}`;
    expect(new AntigravityRunner().permissionDenied(long)).toBe(false);
  });
});

describe('opencode and cursor', () => {
  it('opencode passes --auto only for full; read is unsupported and edit is checked after the step', async () => {
    const make = (spawner: FakeSpawner) => new OpenCodeRunner({ spawner, usePty: false });
    expect(await commandOf(make)).toEqual(['opencode', 'run', 'p']);
    expect(await commandOf(make, 'edit')).toEqual(['opencode', 'run', 'p']);
    expect(await commandOf(make, 'full')).toEqual(['opencode', 'run', '--auto', 'p']);
    const table = Object.fromEntries(
      permissionCapabilitiesOf(new OpenCodeRunner()).map((c) => [c.level, [c.mode, c.note]]),
    );
    expect(table.read?.[0]).toBe(EnforcementMode.Unsupported);
    expect(table.edit).toEqual([EnforcementMode.After, 'commands_not_limited']);
    expect(table.full?.[0]).toBe(EnforcementMode.Native);
  });

  it('cursor offers only edit, and only as a check after the step', () => {
    const modes = Object.fromEntries(
      permissionCapabilitiesOf(new CursorRunner()).map((c) => [c.level, c.mode]),
    );
    expect(modes).toEqual({ read: 'unsupported', edit: 'after', full: 'unsupported' });
  });
});

describe('the other runners', () => {
  it('the acp runner holds every level through its gate', () => {
    const runner = new AcpRunner();
    expect(isPermissionCapable(runner)).toBe(true);
    expect(permissionCapabilitiesOf(runner).map((c) => c.mode)).toEqual(['acp', 'acp', 'acp']);
    expect(runner.canRecogniseDenial).toBe(false);
    expect(runner.permissionDenied('anything')).toBe(false);
  });

  it('an API runner cannot act, so each level is native', () => {
    const runner = new OpenRouterRunner({ apiKey: 'k' });
    expect(permissionCapabilitiesOf(runner).map((c) => c.mode)).toEqual(['native', 'native', 'native']);
  });

  it('the shell runner supports no level', () => {
    expect(isPermissionCapable(new ShellRunner())).toBe(false);
    expect(permissionCapabilitiesOf(new ShellRunner())).toEqual([]);
  });
});

describe('decidePermission at full', () => {
  it('allows every request, including an edit with no block and a command', () => {
    expect(decidePermission('edit', ['/w/a.ts'], undefined, '/w', 'full')).toBe('allowed');
    expect(decidePermission('execute', undefined, undefined, '/w', 'full')).toBe('allowed');
    expect(decidePermission('delete', ['/w/a.ts'], undefined, '/w', 'full')).toBe('allowed');
  });

  it('is unchanged without the level', () => {
    expect(decidePermission('edit', ['/w/a.ts'], undefined, '/w')).toBe('rejected');
    expect(decidePermission('execute', undefined, undefined, '/w', 'read')).toBe('rejected');
  });
});

describe('extraArgs can never widen a written level (AC-07)', () => {
  it('drops the permission flags of claude-code, whatever their spelling, when a level is written', async () => {
    const make = (spawner: FakeSpawner) =>
      new ClaudeRunner({
        spawner,
        usePty: false,
        extraArgs: ['--dangerously-skip-permissions', '--permission-mode=bypassPermissions', '--verbose'],
      });
    expect(await commandOf(make, 'read')).toEqual([
      'claude',
      '-p',
      'p',
      '--verbose',
      '--permission-mode',
      'plan',
    ]);
  });

  it('drops antigravity, codex and opencode permission flags the same way', async () => {
    const antigravity = (spawner: FakeSpawner) =>
      new AntigravityRunner({
        spawner,
        usePty: false,
        extraArgs: ['--dangerously-skip-permissions', '--mode', 'auto', '--x'],
      });
    expect(await commandOf(antigravity, 'read')).toEqual(['agy', '--x', '--mode', 'plan', '-p', 'p']);

    const codex = (spawner: FakeSpawner) =>
      new CodexRunner({
        spawner,
        usePty: false,
        extraArgs: ['--sandbox', 'danger-full-access', '--full-auto', '--y'],
      });
    expect(await commandOf(codex, 'edit')).toEqual([
      'codex',
      'exec',
      '--y',
      '--sandbox',
      'workspace-write',
      'p',
    ]);

    const opencode = (spawner: FakeSpawner) =>
      new OpenCodeRunner({ spawner, usePty: false, extraArgs: ['--auto', '--z'] });
    expect(await commandOf(opencode, 'edit')).toEqual(['opencode', 'run', '--z', 'p']);
    expect(await commandOf(opencode, 'full')).toEqual(['opencode', 'run', '--z', '--auto', 'p']);
  });

  it('leaves extraArgs alone when no level is written, as before', async () => {
    const opencode = (spawner: FakeSpawner) =>
      new OpenCodeRunner({ spawner, usePty: false, extraArgs: ['--auto'] });
    expect(await commandOf(opencode)).toEqual(['opencode', 'run', '--auto', 'p']);
  });
});
