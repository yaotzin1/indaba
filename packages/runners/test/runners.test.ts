import { RunnerError } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import {
  AbstractCliRunner,
  AntigravityRunner,
  ClaudeRunner,
  CodexRunner,
  CommandRunner,
  CursorRunner,
  OpenRouterRunner,
  RunnerRegistry,
  ShellRunner,
  SseParser,
  shellInvocation,
} from '../src/index.js';
import { FakeSpawner, nodeScript, TMP } from './support.js';

const hostile = ['a b;', ['$(', 'touch pwned', ')'].join('')].join(' ');

describe('ShellRunner', () => {
  it('captures streams and the exit code', async () => {
    let seen = '';
    const result = await new ShellRunner().run({
      prompt: 'echo out&& echo err 1>&2&& exit 3',
      workdir: TMP,
      onOutput: (chunk) => {
        seen += chunk;
      },
    });

    expect(result.exitCode).toBe(3);
    expect(result.output.trim()).toBe('out');
    expect(result.errorOutput.trim()).toBe('err');
    expect(result.failureText()).toBe('err');
    expect(result.mode).toBe('piped');
    expect(seen).toContain('out');
  });

  it('times out with exit code 124', async () => {
    const started = Date.now();
    const line = `"${process.execPath}" -e "setTimeout(() => {}, 20000)"`;
    const result = await new ShellRunner().run({ prompt: line, workdir: TMP, timeoutSeconds: 0.3 });

    expect(result.exitCode).toBe(124);
    expect(result.errorOutput).toContain('Timed out');
    expect(Date.now() - started).toBeLessThan(10000);
  });

  it('starts the interpreter with an argument array', () => {
    expect(shellInvocation('echo hi', 'linux')).toEqual({
      command: ['/bin/sh', '-c', 'echo hi'],
      verbatimArguments: false,
    });
    expect(shellInvocation('echo hi', 'win32')).toEqual({
      command: ['cmd.exe', '/d', '/s', '/c', '"echo hi"'],
      verbatimArguments: true,
    });
  });

  it('passes the environment additions to the child', async () => {
    const result = await new ShellRunner().run({
      prompt: `"${process.execPath}" -e "process.stdout.write(process.env.INDABA_PROBE)"`,
      workdir: TMP,
      env: { INDABA_PROBE: 'visible' },
    });

    expect(result.output).toBe('visible');
  });
});

describe('CommandRunner', () => {
  it('substitutes whole arguments, never splitting or interpreting them', async () => {
    const runner = new CommandRunner(
      'echoer',
      nodeScript('process.stdout.write(process.argv.slice(1).join("|"))', '{prompt}', '{model}'),
      { usePty: false },
    );
    const result = await runner.run({ prompt: 'a b; rm -rf /', workdir: TMP, model: 'm1' });

    expect(result.output).toBe('a b; rm -rf /|m1');
  });

  it('keeps a hostile prompt as exactly one argv element', async () => {
    const runner = new CommandRunner(
      'argv',
      nodeScript('process.stdout.write(JSON.stringify(process.argv.slice(1)))', '{prompt}'),
      { usePty: false },
    );
    const nasty = `${hostile} "quoted" 'single' & | > < \`tick\` %PATH% --flag`;
    const result = await runner.run({ prompt: nasty, workdir: TMP });

    expect(JSON.parse(result.output)).toEqual([nasty]);
  });
});

describe('CLI runner command lines', () => {
  it('ClaudeRunner builds an argument vector without a shell', async () => {
    const spawner = new FakeSpawner();
    const runner = new ClaudeRunner({ spawner, usePty: false });
    await runner.run({ prompt: hostile, workdir: TMP, model: 'opus' });

    expect(runner.name).toBe('claude-code');
    expect(spawner.last.command).toEqual([
      'claude',
      '-p',
      hostile,
      '--permission-mode',
      'acceptEdits',
      '--model',
      'opus',
    ]);
    expect(spawner.last.usePty).toBe(false);
  });

  it('CodexRunner builds an exec command with the workspace sandbox', async () => {
    const spawner = new FakeSpawner();
    await new CodexRunner({ spawner }).run({ prompt: hostile, workdir: TMP, model: 'gpt-5-codex' });

    expect(spawner.last.command).toEqual([
      'codex',
      'exec',
      '--sandbox',
      'workspace-write',
      '--model',
      'gpt-5-codex',
      hostile,
    ]);
  });

  it('AntigravityRunner builds a headless print command', async () => {
    const spawner = new FakeSpawner();
    await new AntigravityRunner({ spawner }).run({
      prompt: 'review this',
      workdir: TMP,
      model: 'some-model',
    });

    expect(spawner.last.command).toEqual(['agy', '--model', 'some-model', '-p', 'review this']);
  });

  it('AntigravityRunner never skips permissions unless asked', async () => {
    const spawner = new FakeSpawner();
    await new AntigravityRunner({ spawner }).run({ prompt: 'x', workdir: TMP });

    expect(spawner.last.command.join(' ')).not.toContain('dangerously');
  });

  it('CursorRunner builds a print command', async () => {
    const spawner = new FakeSpawner();
    await new CursorRunner({ spawner }).run({ prompt: 'p', workdir: TMP, model: 'm' });

    expect(spawner.last.command).toEqual(['cursor-agent', '-p', 'p', '--model', 'm']);
  });

  it('strips ANSI sequences and CRLF from agent output', async () => {
    const esc = String.fromCharCode(27);
    const bel = String.fromCharCode(7);
    const raw = `${esc}[31mhello${esc}[0m\r\n${esc}]0;title${bel}world`;
    expect(AbstractCliRunner.stripAnsi(raw)).toBe('hello\nworld');

    const spawner = new FakeSpawner((spec) => {
      spec.onData('stdout', raw);
      return { mode: 'pty' };
    });
    const result = await new CursorRunner({ spawner }).run({ prompt: 'p', workdir: TMP });
    expect(result.output).toBe('hello\nworld');
    expect(result.mode).toBe('pty');
  });

  it('applies the default timeout and the request timeout', async () => {
    const spawner = new FakeSpawner();
    await new CursorRunner({ spawner }).run({ prompt: 'p', workdir: TMP });
    expect(spawner.last.timeoutSeconds).toBe(900);
    await new CursorRunner({ spawner }).run({ prompt: 'p', workdir: TMP, timeoutSeconds: 5 });
    expect(spawner.last.timeoutSeconds).toBe(5);
  });

  it('reports a timeout with exit code 124 and a message', async () => {
    const spawner = new FakeSpawner(() => ({ exitCode: 124, timedOut: true }));
    const result = await new CursorRunner({ spawner }).run({ prompt: 'p', workdir: TMP, timeoutSeconds: 2 });

    expect(result.exitCode).toBe(124);
    expect(result.errorOutput).toContain('Timed out after 2 seconds.');
  });

  it('surfaces an error thrown by the output callback after the process ends', async () => {
    const spawner = new FakeSpawner((spec) => {
      spec.onData('stdout', 'x');
      spec.onData('stdout', 'y');
      return undefined;
    });
    let calls = 0;
    const run = new CursorRunner({ spawner }).run({
      prompt: 'p',
      workdir: TMP,
      onOutput: () => {
        calls += 1;
        throw new Error('sink failed');
      },
    });

    await expect(run).rejects.toThrow('sink failed');
    expect(calls).toBe(1);
  });
});

describe('SseParser', () => {
  it('handles split chunks, comments and CRLF', () => {
    const p = new SseParser();

    expect(p.feed(': OPENROUTER PROCESSING\n\ndata: {"a"')).toEqual([]);
    expect(p.feed(':1}\r\n\r\ndata: [DONE]\n\n')).toEqual(['{"a":1}', '[DONE]']);
  });

  it('does not double a CRLF split across chunks', () => {
    const p = new SseParser();

    expect(p.feed('data: one\r')).toEqual([]);
    expect(p.feed('\n\r\ndata: two\n\n')).toEqual(['one', 'two']);
  });

  it('joins multi-line data', () => {
    expect(new SseParser().feed('data: a\ndata: b\n\n')).toEqual(['a\nb']);
  });
});

describe('RunnerRegistry', () => {
  it('looks up runners and explains misses', () => {
    const registry = RunnerRegistry.withDefaults({ INDABA_CODEX_CMD: 'mycodex run {prompt}' });

    for (const name of ['shell', 'claude-code', 'cursor', 'codex', 'antigravity', 'openrouter']) {
      expect(registry.get(name).name).toBe(name);
      expect(registry.has(name)).toBe(true);
    }
    expect(registry.names()).toHaveLength(6);
    expect(() => registry.get('nope')).toThrow(RunnerError);
    expect(() => registry.get('nope')).toThrow('Unknown runner "nope"');
    expect(new RunnerRegistry().has('x')).toBe(false);
    expect(() => new RunnerRegistry().get('x')).toThrow('Registered: none.');
  });

  it('uses first-class runners and honours env overrides', () => {
    const fallback = RunnerRegistry.withDefaults({});
    expect(fallback.get('codex')).toBeInstanceOf(CodexRunner);
    expect(fallback.get('antigravity')).toBeInstanceOf(AntigravityRunner);

    const custom = RunnerRegistry.withDefaults({ INDABA_CODEX_CMD: 'mycodex go {prompt}' });
    expect(custom.get('codex')).toBeInstanceOf(CommandRunner);
    expect(RunnerRegistry.withDefaults({ INDABA_CODEX_CMD: '   ' }).get('codex')).toBeInstanceOf(CodexRunner);
  });

  it('registers new engines under open names without touching the package', () => {
    const registry = RunnerRegistry.withDefaults({});
    registry.register(new CommandRunner('gemini', ['gemini', '-p', '{prompt}']));

    expect(registry.get('gemini').name).toBe('gemini');
    expect(registry.names()).toContain('gemini');
  });

  it('lets a registration replace a built-in by name', () => {
    const registry = RunnerRegistry.withDefaults({});
    const replacement = new CommandRunner('shell', ['x']);
    registry.register(replacement);

    expect(registry.get('shell')).toBe(replacement);
  });

  it('builds the openrouter runner from the injected key', () => {
    expect(RunnerRegistry.withDefaults({ OPENROUTER_API_KEY: 'k' }).get('openrouter')).toBeInstanceOf(
      OpenRouterRunner,
    );
  });
});
