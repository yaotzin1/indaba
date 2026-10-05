/**
 * Agent and command output is untrusted text on a programmable surface. Escape sequences in it can
 * move the cursor, clear the screen, retitle the window or plant a link, and a carriage return can
 * overwrite what was just printed. This keeps printable text, newlines and tabs, and drops the rest,
 * including whole escape sequences (CSI, OSC, and two-character escapes), C0 and C1 controls and the
 * bidirectional overrides that make text read differently from how it is stored.
 *
 * The filter is stateful because a sequence can be split across two chunks of a stream.
 */
export type Sanitizer = (chunk: string) => string;

const ESC = 0x1b;
const BEL = 0x07;
const NEWLINE = 0x0a;
const TAB = 0x09;

function isBidiControl(code: number): boolean {
  return (
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0x200e ||
    code === 0x200f
  );
}

type State = 'text' | 'escape' | 'csi' | 'string' | 'string-escape';

export function createSanitizer(): Sanitizer {
  let state: State = 'text';

  return (chunk) => {
    let out = '';
    for (const char of chunk) {
      const code = char.codePointAt(0) ?? 0;
      switch (state) {
        case 'text':
          if (code === ESC) {
            state = 'escape';
          } else if (code === NEWLINE || code === TAB) {
            out += char;
          } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || isBidiControl(code)) {
            // dropped: other C0 controls (including carriage return), DEL, C1 controls, bidi overrides
          } else {
            out += char;
          }
          break;
        case 'escape':
          // ESC [ starts a control sequence, ESC ] (and P, X, ^, _) a string that ends with BEL or ESC \.
          if (char === '[') {
            state = 'csi';
          } else if (char === ']' || char === 'P' || char === 'X' || char === '^' || char === '_') {
            state = 'string';
          } else {
            state = 'text'; // a two-character escape: both characters are gone
          }
          break;
        case 'csi':
          // parameter and intermediate bytes continue it; a final byte in 0x40-0x7e ends it
          if (code >= 0x40 && code <= 0x7e) {
            state = 'text';
          }
          break;
        case 'string':
          if (code === BEL) {
            state = 'text';
          } else if (code === ESC) {
            state = 'string-escape';
          }
          break;
        case 'string-escape':
          state = char === '\\' ? 'text' : 'string';
          break;
      }
    }
    return out;
  };
}

/** For a single piece of text that is not part of a stream. */
export function sanitize(text: string): string {
  return createSanitizer()(text);
}
