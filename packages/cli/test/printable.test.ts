import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { createPrintableFilter, printableText } from '../src/printable.js';
import { captureIo, FIXTURE_WORKFLOW, makeTempDir, writePlugin, writeWorkflow } from './support.js';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const CSI = `${ESC}[`;
const OSC = `${ESC}]`;

// The filter itself is tested in the engine; here only that the CLI exposes it under its names.
describe('the names the CLI exposes', () => {
  it('are the engine filter', () => {
    expect(printableText(`a${CSI}2Jb`)).toBe('ab');
    const filter = createPrintableFilter();
    expect(filter(`x${CSI}1`) + filter('mY')).toBe('xY');
  });
});

describe('what indaba run -vv prints', () => {
  const HOSTILE = `hello ${CSI}2J${OSC}0;pwned${BEL}world\r\nsecond ${CSI}31mline${CSI}0m\n`;

  const plugin = (): string => `import { RunResult } from '@indaba/core';
export default {
  name: 'noisy-plugin',
  register(host) {
    host.registerRunner({
      name: 'fake',
      async run(request) {
        const text = ${JSON.stringify(HOSTILE)};
        // split mid-sequence on purpose
        request.onOutput?.(text.slice(0, 9));
        request.onOutput?.(text.slice(9));
        return new RunResult({ exitCode: 0, output: text });
      },
    });
  },
};
`;

  it('shows only the text of what an agent streamed, never its escape sequences', async () => {
    const dir = await makeTempDir();
    const pluginFile = await writePlugin(dir, 'p.mjs', plugin());
    const workflow = await writeWorkflow(
      dir,
      'w.yml',
      FIXTURE_WORKFLOW.replace(/guards:\n\s+- type: "always_ok"\n/, ''),
    );
    const captured = captureIo(dir);
    const code = await main(['run', workflow, '--plugin', pluginFile, '-w', dir, '-vv'], captured.io);
    const out = captured.stdout();

    expect(code).toBe(0);
    expect(out).toContain('hello world\nsecond line\n');
    expect(out).not.toContain(ESC);
    expect(out).not.toContain(BEL);
    expect(out).not.toContain('\r');
    expect(out).not.toContain('pwned');
    expect(join(dir)).toBeTruthy();
  });
});

describe('the status line after streamed output', () => {
  it('starts on a fresh line when the agent text did not end with a newline', async () => {
    const dir = await makeTempDir();
    const source = `import { RunResult } from '@indaba/core';
export default {
  name: 'noisy-plugin',
  register(host) {
    host.registerRunner({
      name: 'fake',
      async run(request) {
        request.onOutput?.('an answer with no newline at the end');
        return new RunResult({ exitCode: 0, output: 'x' });
      },
    });
  },
};
`;
    const pluginFile = await writePlugin(dir, 'p.mjs', source);
    const workflow = await writeWorkflow(
      dir,
      'w.yml',
      FIXTURE_WORKFLOW.replace(/guards:\n\s+- type: "always_ok"\n/, ''),
    );
    const captured = captureIo(dir);
    await main(['run', workflow, '--plugin', pluginFile, '-w', dir, '-vv'], captured.io);
    const out = captured.stdout();

    expect(out).toContain('an answer with no newline at the end\n  work');
    expect(out).not.toMatch(/at the end {2}work/);
  });

  it('adds no blank line when the text already ended with one', async () => {
    const dir = await makeTempDir();
    const source = `import { RunResult } from '@indaba/core';
export default {
  name: 'tidy-plugin',
  register(host) {
    host.registerRunner({
      name: 'fake',
      async run(request) {
        request.onOutput?.('ends properly\\n');
        return new RunResult({ exitCode: 0, output: 'x' });
      },
    });
  },
};
`;
    const pluginFile = await writePlugin(dir, 'p.mjs', source);
    const workflow = await writeWorkflow(
      dir,
      'w.yml',
      FIXTURE_WORKFLOW.replace(/guards:\n\s+- type: "always_ok"\n/, ''),
    );
    const captured = captureIo(dir);
    await main(['run', workflow, '--plugin', pluginFile, '-w', dir, '-vv'], captured.io);

    expect(captured.stdout()).toContain('ends properly\n  work');
    expect(captured.stdout()).not.toContain('ends properly\n\n');
  });
});
