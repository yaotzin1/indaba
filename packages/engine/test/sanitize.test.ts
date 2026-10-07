import { describe, expect, it } from 'vitest';
import { createSanitizer, sanitize } from '../src/index.js';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const CSI = `${ESC}[`;
const OSC = `${ESC}]`;
const ST = `${ESC}\\`;

describe('sanitize', () => {
  it('keeps ordinary text, newlines, tabs and non-latin characters', () => {
    const text = 'Hello, world!\n\tindented éè 你好 😀 done\n';
    expect(sanitize(text)).toBe(text);
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
    expect(sanitize(input)).toBe(expected);
  });

  it('turns CRLF into a plain newline', () => {
    expect(sanitize('a\r\nb')).toBe('a\nb');
  });

  it('removes a sequence that is never finished, without leaking what follows into text', () => {
    expect(sanitize(`ok${OSC}0;never ends`)).toBe('ok');
    expect(sanitize(`ok${CSI}12`)).toBe('ok');
    expect(sanitize(`ok${ESC}`)).toBe('ok');
  });
});

describe('createSanitizer across chunks', () => {
  it('removes a sequence split at any point', () => {
    const whole = `a${CSI}2Jb${OSC}0;title${BEL}c${OSC}8;;url${ST}d`;
    for (let cut = 1; cut < whole.length; cut++) {
      const filter = createSanitizer();
      expect(filter(whole.slice(0, cut)) + filter(whole.slice(cut))).toBe('abcd');
    }
  });

  it('keeps a filter per stream, so one stream cannot affect another', () => {
    const first = createSanitizer();
    const second = createSanitizer();
    first(`${OSC}0;half`);
    expect(second('plain')).toBe('plain');
    expect(first(`${BEL}after`)).toBe('after');
  });
});

describe('sanitize: every boundary and every state', () => {
  const chr = (code: number): string => String.fromCodePoint(code);
  const DEL = chr(0x7f);

  it('drops each bidirectional control and keeps the characters next to them', () => {
    for (const code of [
      0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
    ]) {
      expect(sanitize(`a${chr(code)}b`)).toBe('ab');
    }
    for (const code of [0x200d, 0x2010, 0x2029, 0x202f, 0x2065, 0x206a]) {
      expect(sanitize(`a${chr(code)}b`)).toBe(`a${chr(code)}b`);
    }
  });

  it('keeps space and every printable ASCII character, drops the C0 controls around them', () => {
    expect(sanitize(' ')).toBe(' ');
    expect(sanitize(chr(0x1f))).toBe('');
    expect(sanitize(chr(0x00))).toBe('');
    expect(sanitize(chr(0x01))).toBe('');
    expect(sanitize('~')).toBe('~');
    const printable = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => chr(0x20 + i)).join('');
    expect(sanitize(printable)).toBe(printable);
  });

  it('drops DEL and every C1 control, and keeps the first character after them', () => {
    expect(sanitize(`a${DEL}b`)).toBe('ab');
    for (let code = 0x80; code <= 0x9f; code++) {
      expect(sanitize(`a${chr(code)}b`)).toBe('ab');
    }
    expect(sanitize(chr(0xa0))).toBe(chr(0xa0));
    expect(sanitize(chr(0xa1))).toBe(chr(0xa1));
  });

  it('keeps newline and tab, drops carriage return, form feed and vertical tab', () => {
    expect(sanitize('a\nb\tc')).toBe('a\nb\tc');
    expect(sanitize('a\rb\fc\vd')).toBe('abcd');
  });

  it('a control sequence ends at a final byte from @ to ~, and not before', () => {
    expect(sanitize(`${CSI}@x`)).toBe('x');
    expect(sanitize(`${CSI}~x`)).toBe('x');
    expect(sanitize(`${CSI}Ax`)).toBe('x');
    expect(sanitize(`${CSI}1;2;3Hx`)).toBe('x');
    // parameter and intermediate bytes (0x20-0x3f) do not end it
    expect(sanitize(`${CSI}?25hx`)).toBe('x');
    expect(sanitize(`${CSI}1 qx`)).toBe('x');
    expect(sanitize(`${CSI}0123456789:;<=>?mX`)).toBe('X');
    // a byte above the final range does not end it either
    expect(sanitize(`${CSI}1${DEL}2mX`)).toBe('X');
    // the first byte after the final one is ordinary text again
    expect(sanitize(`${CSI}mhello`)).toBe('hello');
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
      expect(sanitize(`a${ESC}${introducer}payload${BEL}b`)).toBe('ab');
      expect(sanitize(`a${ESC}${introducer}payload${ST}b`)).toBe('ab');
      expect(sanitize(`a${ESC}${introducer}pay\nload${BEL}b`)).toBe('ab');
    },
  );

  it('an ESC inside a string that is not followed by a backslash does not end it', () => {
    expect(sanitize(`a${OSC}0;x${ESC}yz${BEL}b`)).toBe('ab');
    expect(sanitize(`a${OSC}0;x${ESC}${ESC}${ST}b`)).toBe('ab');
    expect(sanitize(`a${OSC}0;x${ST}b`)).toBe('ab');
    // ESC followed by a backspace is not the terminator, so the string goes on to the BEL
    expect(sanitize(`a${OSC}0;x${ESC}\b${BEL}b`)).toBe('ab');
  });

  it('an introducer swallows the character after ESC only when it is one, otherwise a two-character escape', () => {
    expect(sanitize(`${ESC}cX`)).toBe('X');
    expect(sanitize(`${ESC}7X`)).toBe('X');
    expect(sanitize(`${ESC}=X`)).toBe('X');
    expect(sanitize(`${ESC}]X${BEL}Y`)).toBe('Y');
  });

  it('a stream that ends in the middle of a sequence leaves the next stream unaffected only through its own filter', () => {
    const one = createSanitizer();
    one(`${CSI}12`);
    expect(one('3mafter')).toBe('after');
    expect(createSanitizer()('3mafter')).toBe('3mafter');
  });
});
