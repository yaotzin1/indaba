import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/index.js';
import { createPrintableFilter, printableText } from '../src/printable.js';
import { captureIo, FIXTURE_WORKFLOW, makeTempDir, writePlugin, writeWorkflow } from './support.js';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const CSI = `${ESC}[`;
const OSC = `${ESC}]`;
const ST = `${ESC}\\`;

describe('printableText', () => {
  it('keeps ordinary text, newlines, tabs and non-latin characters', () => {
    const text = 'Hello, world!\n\tindented éè 你好 😀 done\n';
    expect(printableText(text)).toBe(text);
  });

  it.each([
    ['clear screen', `before${CSI}2Jafter`, 'beforeafter'],
    ['colour', `${CSI}31;1mred${CSI}0m`, 'red'],
    ['cursor movement', `a${CSI}10;20Hb${CSI}3Ac`, 'abc'],
    ['private mode', `x${CSI}?1049hy`, 'xy'],
    ['window title (BEL)', `a${OSC}0;pwned${BEL}b`, 'ab'],
    ['window title (ST)', `a${OSC}2;pwned${ST}b`, 'ab'],
    ['hyperlink', `${OSC}8;;https://evil.test${ST}click${OSC}8;;${ST}`, 'click'],
    ['device control string', `a${ESC}Pq#0;2;0;0;0${ST}b`, 'ab'],
    ['two-character escape', `a${ESC}cb`, 'ab'],
    ['carriage return that would overwrite', 'real text\rFAKE', 'real textFAKE'],
    ['bell and backspace', 'a\u0007b\u0008c', 'abc'],
    ['null and DEL', 'a\u0000b\u007fc', 'abc'],
    ['C1 control', 'a\u009bb', 'ab'],
    ['bidi override', 'abc‮def', 'abcdef'],
    ['bidi isolate', 'a⁦b⁩c', 'abc'],
  ])('removes %s', (_label, input, expected) => {
    expect(printableText(input)).toBe(expected);
  });

  it('turns CRLF into a plain newline', () => {
    expect(printableText('a\r\nb')).toBe('a\nb');
  });

  it('removes a sequence that is never finished, without leaking what follows into text', () => {
    expect(printableText(`ok${OSC}0;never ends`)).toBe('ok');
    expect(printableText(`ok${CSI}12`)).toBe('ok');
    expect(printableText(`ok${ESC}`)).toBe('ok');
  });
});

describe('createPrintableFilter across chunks', () => {
  it('removes a sequence split at any point', () => {
    const whole = `a${CSI}2Jb${OSC}0;title${BEL}c${OSC}8;;url${ST}d`;
    for (let cut = 1; cut < whole.length; cut++) {
      const filter = createPrintableFilter();
      expect(filter(whole.slice(0, cut)) + filter(whole.slice(cut))).toBe('abcd');
    }
  });

  it('keeps a filter per stream, so one stream cannot affect another', () => {
    const first = createPrintableFilter();
    const second = createPrintableFilter();
    first(`${OSC}0;half`);
    expect(second('plain')).toBe('plain');
    expect(first(`${BEL}after`)).toBe('after');
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
