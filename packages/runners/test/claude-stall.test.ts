import { isStallCapable } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { ClaudeRunner, STALL_EXIT_CODE } from '../src/index.js';
import { FakeSpawner, TMP } from './support.js';

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;
const resultEvent = line({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'AGREEMENT: fine',
  total_cost_usd: 0.05,
  usage: { input_tokens: 2, output_tokens: 4 },
});

describe('ClaudeRunner and stall detection (specs/step-stalls, AC-15 to AC-17, C-17)', () => {
  it('can report activity while it reads the stream', () => {
    const runner = new ClaudeRunner({ spawner: new FakeSpawner() });

    expect(runner.canReportActivity).toBe(true);
    expect(isStallCapable(runner)).toBe(true);
  });

  it('cannot in plain mode, where nothing arrives before the end: reportUsage false', () => {
    const runner = new ClaudeRunner({ spawner: new FakeSpawner(), reportUsage: false });

    expect(runner.canReportActivity).toBe(false);
    expect(isStallCapable(runner)).toBe(false);
  });

  it('cannot when the embedder chose its own output format', () => {
    for (const extraArgs of [['--output-format', 'text'], ['--output-format=json']]) {
      const runner = new ClaudeRunner({ spawner: new FakeSpawner(), extraArgs });
      expect(runner.canReportActivity).toBe(false);
    }
  });

  it('passes the silence limit to the process layer and adds nothing to the command line (AC-15)', async () => {
    const without = new FakeSpawner((spec) => {
      spec.onData('stdout', resultEvent);
      return undefined;
    });
    await new ClaudeRunner({ spawner: without }).run({ prompt: 'go', workdir: TMP });
    const withLimit = new FakeSpawner((spec) => {
      spec.onData('stdout', resultEvent);
      return undefined;
    });
    await new ClaudeRunner({ spawner: withLimit }).run({ prompt: 'go', workdir: TMP, stallSeconds: 90 });

    expect(withLimit.last.command).toEqual(without.last.command);
    expect(withLimit.last.stallSeconds).toBe(90);
    expect('stallSeconds' in without.last).toBe(false);
    expect(withLimit.last.usePty).toBe(false);
  });

  it('gives the same result with and without a limit (AC-16)', async () => {
    const make = () =>
      new FakeSpawner((spec) => {
        spec.onData('stdout', resultEvent);
        return undefined;
      });
    const a = await new ClaudeRunner({ spawner: make() }).run({ prompt: 'go', workdir: TMP });
    const b = await new ClaudeRunner({ spawner: make() }).run({
      prompt: 'go',
      workdir: TMP,
      stallSeconds: 90,
    });

    expect(b.output).toBe(a.output);
    expect(b.usage).toEqual(a.usage);
    expect(b.reportedCostUsd).toBe(a.reportedCostUsd);
    expect(b.exitCode).toBe(a.exitCode);
    expect(b.stalled).toBeUndefined();
  });

  it('returns a stalled result, with the partial stream it had read, when the process layer stops it', async () => {
    const spawner = new FakeSpawner((spec) => {
      spec.onData('stdout', line({ type: 'system', subtype: 'init' }));
      return { exitCode: STALL_EXIT_CODE, stalled: true };
    });
    const result = await new ClaudeRunner({ spawner }).run({ prompt: 'go', workdir: TMP, stallSeconds: 90 });

    expect(result.stalled).toBe(true);
    expect(result.succeeded()).toBe(false);
    expect(result.exitCode).toBe(STALL_EXIT_CODE);
    expect(result.errorOutput).toContain('Stalled: no activity for 90 seconds.');
  });
});
