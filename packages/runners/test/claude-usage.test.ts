import { PermissionLevel } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { ClaudeRunner } from '../src/index.js';
import { FakeSpawner, TMP } from './support.js';

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

const resultEvent = (extra: Record<string, unknown> = {}) =>
  line({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'AGREEMENT: fine',
    total_cost_usd: 0.05,
    usage: {
      input_tokens: 2,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 20,
      output_tokens: 4,
    },
    modelUsage: { 'claude-sonnet-5-5': {} },
    ...extra,
  });

const assistantEvent = (text: string) =>
  line({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

/** A spawner that prints `stdout` the way a pipe delivers it: in chunks that cut lines in half. */
function printing(
  stdout: string,
  stderr = '',
  outcome: { exitCode?: number; timedOut?: boolean; aborted?: boolean } = {},
) {
  return new FakeSpawner((spec) => {
    for (let at = 0; at < stdout.length; at += 7) {
      spec.onData('stdout', stdout.slice(at, at + 7));
    }
    if (stderr !== '') {
      spec.onData('stderr', stderr);
    }
    return outcome;
  });
}

describe('ClaudeRunner usage reporting (specs/claude-code-usage)', () => {
  it('asks for stream-json after the prompt and runs on pipes even when a terminal is allowed (AC-01, AC-09)', async () => {
    const spawner = printing(resultEvent());
    const runner = new ClaudeRunner({ spawner, usePty: true });
    await runner.run({ prompt: 'go', workdir: TMP, model: 'opus' });

    expect(spawner.last.command).toEqual([
      'claude',
      '-p',
      'go',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'opus',
    ]);
    expect(spawner.last.usePty).toBe(false);
  });

  it('returns the answer, the tokens, the cost and the model of the result event (AC-02 to AC-05)', async () => {
    const spawner = printing(`${assistantEvent('draft')}${resultEvent()}`);
    const result = await new ClaudeRunner({ spawner }).run({ prompt: 'go', workdir: TMP });

    expect(result.output).toBe('AGREEMENT: fine');
    expect(result.usage?.inputTokens).toBe(32);
    expect(result.usage?.outputTokens).toBe(4);
    expect(result.reportedCostUsd).toBe(0.05);
    expect(result.model).toBe('claude-sonnet-5-5');
    expect(result.mode).toBe('piped');
    expect(result.succeeded()).toBe(true);
  });

  it('keeps the requested model when the CLI names none or several (AC-05)', async () => {
    const spawner = printing(resultEvent({ modelUsage: { a: {}, b: {} } }));
    const result = await new ClaudeRunner({ spawner }).run({ prompt: 'go', workdir: TMP, model: 'opus' });
    expect(result.model).toBe('opus');

    const none = await new ClaudeRunner({ spawner: printing(resultEvent({ modelUsage: {} })) }).run({
      prompt: 'go',
      workdir: TMP,
    });
    expect(none.model).toBeUndefined();
  });

  it('gives the answer to onOutput once, not the JSON lines (AC-08)', async () => {
    const chunks: string[] = [];
    const spawner = printing(`${assistantEvent('draft')}${resultEvent()}`);
    await new ClaudeRunner({ spawner }).run({
      prompt: 'go',
      workdir: TMP,
      onOutput: (chunk) => chunks.push(chunk),
    });

    expect(chunks).toEqual(['AGREEMENT: fine']);
  });

  it('does not call onOutput for an empty answer', async () => {
    const chunks: string[] = [];
    await new ClaudeRunner({ spawner: printing('') }).run({
      prompt: 'go',
      workdir: TMP,
      onOutput: (c) => chunks.push(c),
    });
    expect(chunks).toEqual([]);
  });

  it('lets a failing onOutput fail the run as it did before', async () => {
    const run = new ClaudeRunner({ spawner: printing(resultEvent()) }).run({
      prompt: 'go',
      workdir: TMP,
      onOutput: () => {
        throw new Error('consumer broke');
      },
    });
    await expect(run).rejects.toThrow('consumer broke');
  });

  it('keeps a non-zero exit code and its error result (AC-10)', async () => {
    const spawner = printing(resultEvent({ is_error: true, result: 'Boom' }), 'warning on stderr', {
      exitCode: 1,
    });
    const result = await new ClaudeRunner({ spawner }).run({ prompt: 'go', workdir: TMP });

    expect(result.exitCode).toBe(1);
    expect(result.succeeded()).toBe(false);
    expect(result.output).toBe('Boom');
    expect(result.errorOutput).toBe('warning on stderr');
    expect(result.usage?.outputTokens).toBe(4);
  });

  it('reports a timeout with the partial answer and no usage (AC-06, AC-10)', async () => {
    const spawner = printing(assistantEvent('half an answer'), '', { exitCode: 124, timedOut: true });
    const result = await new ClaudeRunner({ spawner }).run({ prompt: 'go', workdir: TMP, timeoutSeconds: 5 });

    expect(result.exitCode).toBe(124);
    expect(result.output).toBe('half an answer');
    expect(result.usage).toBeUndefined();
    expect(result.reportedCostUsd).toBeUndefined();
    expect(result.errorOutput).toContain('Timed out after 5 seconds.');
  });

  it('reports an abort with no usage (AC-10)', async () => {
    const spawner = printing('', '', { exitCode: 130, aborted: true });
    const result = await new ClaudeRunner({ spawner }).run({ prompt: 'go', workdir: TMP });

    expect(result.exitCode).toBe(130);
    expect(result.output).toBe('');
    expect(result.errorOutput).toContain('Aborted.');
  });

  it('shows plain stdout when it is not JSON at all, so an error is not swallowed (AC-06)', async () => {
    const spawner = printing('error: unknown option --output-format\n', '', { exitCode: 1 });
    const result = await new ClaudeRunner({ spawner }).run({ prompt: 'go', workdir: TMP });

    expect(result.output).toBe('error: unknown option --output-format\n');
    expect(result.usage).toBeUndefined();
  });

  it('does not show raw JSON lines when the run was cut before an answer (AC-06)', async () => {
    const spawner = printing(
      line({ type: 'system', subtype: 'init', cwd: 'C:\\secret', tools: ['Bash'] }),
      '',
      {
        exitCode: 124,
        timedOut: true,
      },
    );
    const result = await new ClaudeRunner({ spawner }).run({ prompt: 'go', workdir: TMP });

    expect(result.output).toBe('');
  });

  it('keeps the plain-text call and result with reportUsage: false (AC-11)', async () => {
    const spawner = printing('plain answer\n');
    const runner = new ClaudeRunner({ spawner, usePty: false, reportUsage: false });
    const chunks: string[] = [];
    const result = await runner.run({ prompt: 'go', workdir: TMP, onOutput: (c) => chunks.push(c) });

    expect(spawner.last.command).toEqual(['claude', '-p', 'go', '--permission-mode', 'acceptEdits']);
    expect(result.output).toBe('plain answer\n');
    expect(result.usage).toBeUndefined();
    expect(chunks.join('')).toBe('plain answer\n');
  });

  it('keeps a pseudo-terminal when it is allowed and reporting is off (AC-11)', async () => {
    const spawner = printing('x');
    await new ClaudeRunner({ spawner, reportUsage: false }).run({ prompt: 'go', workdir: TMP });
    expect(spawner.last.usePty).toBe(true);
  });

  it('leaves an extraArgs that already chooses an output format alone (AC-11)', async () => {
    for (const extraArgs of [
      ['--output-format', 'json'],
      ['--permission-mode', 'plan', '--output-format=text'],
    ]) {
      const spawner = printing('plain\n');
      const result = await new ClaudeRunner({ spawner, extraArgs }).run({ prompt: 'go', workdir: TMP });

      expect(spawner.last.command).toEqual(['claude', '-p', 'go', ...extraArgs]);
      expect(spawner.last.command).not.toContain('--verbose');
      expect(result.output).toBe('plain\n');
      expect(result.usage).toBeUndefined();
    }
  });

  it('puts the usage flags before a written permission level (AC-10)', async () => {
    const spawner = printing(resultEvent());
    await new ClaudeRunner({ spawner }).run({
      prompt: 'go',
      workdir: TMP,
      permissionLevel: PermissionLevel.Read,
    });

    const command = spawner.last.command;
    expect(command.slice(0, 6)).toEqual([
      'claude',
      '-p',
      'go',
      '--output-format',
      'stream-json',
      '--verbose',
    ]);
    expect(command).toContain('--permission-mode');
    expect(command[command.indexOf('--permission-mode') + 1]).toBe('plan');
  });

  it('does not repeat a --verbose the embedder already passed, and still puts the written level last (AC-10)', async () => {
    const spawner = printing(resultEvent());
    await new ClaudeRunner({
      spawner,
      extraArgs: ['--verbose', '--permission-mode', 'bypassPermissions'],
    }).run({
      prompt: 'go',
      workdir: TMP,
      permissionLevel: PermissionLevel.Read,
    });

    const command = spawner.last.command;
    expect(command.filter((arg) => arg === '--verbose')).toHaveLength(1);
    expect(command.slice(0, 5)).toEqual(['claude', '-p', 'go', '--output-format', 'stream-json']);
    expect(command.slice(-2)).toEqual(['--permission-mode', 'plan']);
  });

  it('does not mistake a plain warning before the JSON for the whole output, and never shows the init event (AC-06)', async () => {
    const init = line({ type: 'system', subtype: 'init', cwd: 'C:\\secret', tools: ['Bash'] });
    const spawner = printing(`warning: update available\n${init}`, '', { exitCode: 124, timedOut: true });
    const result = await new ClaudeRunner({ spawner }).run({ prompt: 'go', workdir: TMP });

    expect(result.output).toBe('');
  });

  it('keeps the usage of an error result that has no answer text (AC-03, AC-10)', async () => {
    const error = line({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      total_cost_usd: 0.3,
      usage: { input_tokens: 9, output_tokens: 1 },
    });
    const result = await new ClaudeRunner({
      spawner: printing(assistantEvent('partial') + error, '', { exitCode: 1 }),
    }).run({ prompt: 'go', workdir: TMP });

    expect(result.exitCode).toBe(1);
    expect(result.output).toBe('partial');
    expect(result.usage?.inputTokens).toBe(9);
    expect(result.reportedCostUsd).toBe(0.3);
  });
});
