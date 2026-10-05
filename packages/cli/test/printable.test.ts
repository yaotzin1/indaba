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

describe('printableText: every boundary and every state', () => {
  const chr = (code: number): string => String.fromCodePoint(code);
  const DEL = chr(0x7f);

  it('drops each bidirectional control and keeps the characters next to them', () => {
    for (const code of [
      0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
    ]) {
      expect(printableText(`a${chr(code)}b`)).toBe('ab');
    }
    for (const code of [0x200d, 0x2010, 0x2029, 0x202f, 0x2065, 0x206a]) {
      expect(printableText(`a${chr(code)}b`)).toBe(`a${chr(code)}b`);
    }
  });

  it('keeps space and every printable ASCII character, drops the C0 controls around them', () => {
    expect(printableText(' ')).toBe(' ');
    expect(printableText(chr(0x1f))).toBe('');
    expect(printableText(chr(0x00))).toBe('');
    expect(printableText(chr(0x01))).toBe('');
    expect(printableText('~')).toBe('~');
    const printable = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => chr(0x20 + i)).join('');
    expect(printableText(printable)).toBe(printable);
  });

  it('drops DEL and every C1 control, and keeps the first character after them', () => {
    expect(printableText(`a${DEL}b`)).toBe('ab');
    for (let code = 0x80; code <= 0x9f; code++) {
      expect(printableText(`a${chr(code)}b`)).toBe('ab');
    }
    expect(printableText(chr(0xa0))).toBe(chr(0xa0));
    expect(printableText(chr(0xa1))).toBe(chr(0xa1));
  });

  it('keeps newline and tab, drops carriage return, form feed and vertical tab', () => {
    expect(printableText('a\nb\tc')).toBe('a\nb\tc');
    expect(printableText('a\rb\fc\vd')).toBe('abcd');
  });

  it('a control sequence ends at a final byte from @ to ~, and not before', () => {
    expect(printableText(`${CSI}@x`)).toBe('x');
    expect(printableText(`${CSI}~x`)).toBe('x');
    expect(printableText(`${CSI}Ax`)).toBe('x');
    expect(printableText(`${CSI}1;2;3Hx`)).toBe('x');
    // parameter and intermediate bytes (0x20-0x3f) do not end it
    expect(printableText(`${CSI}?25hx`)).toBe('x');
    expect(printableText(`${CSI}1 qx`)).toBe('x');
    expect(printableText(`${CSI}0123456789:;<=>?mX`)).toBe('X');
    // a byte above the final range does not end it either
    expect(printableText(`${CSI}1${DEL}2mX`)).toBe('X');
    // the first byte after the final one is ordinary text again
    expect(printableText(`${CSI}mhello`)).toBe('hello');
  });

  it.each([
    ['OSC', ']'],
    ['DCS', 'P'],
    ['SOS', 'X'],
    ['PM', '^'],
    ['APC', '_'],
  ])(
    'a %s string runs to BEL or to ESC backslash, and swallows everything in between',
    (_name, introducer) => {
      expect(printableText(`a${ESC}${introducer}payload${BEL}b`)).toBe('ab');
      expect(printableText(`a${ESC}${introducer}payload${ST}b`)).toBe('ab');
      expect(printableText(`a${ESC}${introducer}pay\nload${BEL}b`)).toBe('ab');
    },
  );

  it('an ESC inside a string that is not followed by a backslash does not end it', () => {
    expect(printableText(`a${OSC}0;x${ESC}yz${BEL}b`)).toBe('ab');
    expect(printableText(`a${OSC}0;x${ESC}${ESC}${ST}b`)).toBe('ab');
    expect(printableText(`a${OSC}0;x${ST}b`)).toBe('ab');
    // ESC followed by a backspace is not the terminator, so the string goes on to the BEL
    expect(printableText(`a${OSC}0;x${ESC}\b${BEL}b`)).toBe('ab');
  });

  it('an introducer swallows the character after ESC only when it is one, otherwise a two-character escape', () => {
    expect(printableText(`${ESC}cX`)).toBe('X');
    expect(printableText(`${ESC}7X`)).toBe('X');
    expect(printableText(`${ESC}=X`)).toBe('X');
    expect(printableText(`${ESC}]X${BEL}Y`)).toBe('Y');
  });

  it('a stream that ends in the middle of a sequence leaves the next stream unaffected only through its own filter', () => {
    const one = createPrintableFilter();
    one(`${CSI}12`);
    expect(one('3mafter')).toBe('after');
    expect(createPrintableFilter()('3mafter')).toBe('3mafter');
  });
});
