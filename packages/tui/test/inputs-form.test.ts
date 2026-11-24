import type { Logger } from '@indaba/engine';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.FORCE_COLOR = '1';
  process.env.CI = 'true';
});

import {
  answerHint,
  collectInputs,
  type FormField,
  type FormKey,
  type FormState,
  formLines,
  formResult,
  initialForm,
  reduceForm,
  takesLines,
} from '../src/index.js';
import { formKey } from '../src/ink/inputs-form-app.js';
import { plainText } from '../src/inputs-form.js';
import { FakeStdin, FakeStdout, KEY, until } from './terminal.js';

const field = (over: Partial<FormField> & Pick<FormField, 'name' | 'type'>): FormField => ({
  description: 'a thing',
  list: false,
  limits: {},
  ...over,
});
const FOLDERS = field({
  name: 'specs',
  type: 'path',
  list: true,
  description: 'The folders to review',
  limits: { kind: 'directory', minItems: 1, maxItems: 10 },
});
const TONE = field({
  name: 'tone',
  type: 'choice',
  choices: ['formal', 'short'],
  description: 'How it sounds',
});
const NOTE = field({ name: 'note', type: 'text', limits: { multiline: true, maxLength: 500 } });

const type = (state: FormState, text: string): FormState =>
  [...text].reduce<FormState>((s, c) => reduceForm(s, { char: c }), state);
const press = (state: FormState, ...keys: FormKey[]): FormState => keys.reduce(reduceForm, state);
const screen = (state: FormState): string =>
  formLines(state, true)
    .map((l) => l.text)
    .join('\n');

describe('the inputs form state (AC-17, T-23)', () => {
  it('asks nothing and is done when there is nothing to ask', () => {
    expect(initialForm([]).outcome).toBe('done');
    expect(formResult(initialForm([]))).toEqual({ values: {} });
    expect(formLines(initialForm([]), true)).toEqual([]);
  });

  it('takes a single answer on Enter and moves to the next question', () => {
    let state = initialForm([
      TONE,
      field({ name: 'n', type: 'number', limits: { integer: true, min: 1, max: 5 } }),
    ]);
    expect(screen(state)).toContain('Question 1 of 2');
    expect(screen(state)).toContain('tone: How it sounds');
    expect(screen(state)).toContain('one of: formal, short');
    state = press(type(state, 'short'), 'enter');
    expect(state.index).toBe(1);
    expect(screen(state)).toContain('a whole number from 1 to 5');
    state = press(type(state, '3'), 'enter');
    expect(state.outcome).toBe('done');
    expect(formResult(state)).toEqual({ values: { tone: ['short'], n: ['3'] } });
  });

  it('never accepts an empty answer to a single value', () => {
    const state = press(initialForm([TONE]), 'enter');
    expect(state.index).toBe(0);
    expect(state.message).toBe('An answer is needed here.');
    expect(screen(state)).toContain('An answer is needed here.');
    // the next key clears the sentence
    expect(type(state, 'x').message).toBeUndefined();
    // blank is empty too
    expect(press(type(initialForm([TONE]), '   '), 'enter').message).toBe('An answer is needed here.');
  });

  it('reads a list one line at a time until an empty line', () => {
    let state = initialForm([FOLDERS]);
    expect(takesLines(FOLDERS)).toBe(true);
    expect(screen(state)).toContain('a folder inside the project; one per line, an empty line to finish');
    state = press(type(state, 'specs/a'), 'enter');
    state = press(type(state, 'specs/b'), 'enter');
    expect(screen(state)).toContain('  specs/a');
    expect(state.outcome).toBe('asking');
    state = press(state, 'enter');
    expect(state.outcome).toBe('done');
    expect(formResult(state)).toEqual({ values: { specs: ['specs/a', 'specs/b'] } });
  });

  it('does not finish a list with nothing in it', () => {
    const state = press(initialForm([FOLDERS]), 'enter');
    expect(state.outcome).toBe('asking');
    expect(state.message).toBe('Give at least one line, then an empty line to finish.');
  });

  it('joins the lines of a multi-line text into one value', () => {
    let state = initialForm([NOTE]);
    state = press(type(state, 'first'), 'enter');
    state = press(type(state, 'second'), 'enter', 'enter');
    expect(formResult(state)).toEqual({ values: { note: ['first\nsecond'] } });
  });

  it('erases with Backspace, by character and not by code unit', () => {
    let state = type(initialForm([TONE]), 'ab\u{1F600}');
    state = press(state, 'backspace');
    expect(state.draft).toBe('ab');
    expect(press(initialForm([TONE]), 'backspace').draft).toBe('');
  });

  it('cancels on Escape and on Ctrl+C, and then ignores every key', () => {
    for (const key of ['escape', 'ctrl-c'] as const) {
      const state = press(type(initialForm([TONE]), 'sh'), key);
      expect(state.outcome).toBe('cancelled');
      expect(formResult(state)).toBeUndefined();
      expect(press(state, { char: 'x' }, 'enter')).toBe(state);
    }
    expect(press(initialForm([]), 'enter').outcome).toBe('done');
  });

  it('keeps control characters out of the draft', () => {
    const state = initialForm([TONE]);
    expect(reduceForm(state, { char: '\u001b[31m' }).draft).toBe('[31m');
    expect(reduceForm(state, { char: '\u0007\u0085' })).toBe(state);
    expect(reduceForm(state, { char: 'a\tb' }).draft).toBe('ab');
  });

  it('cuts a pasted draft at a fixed length', () => {
    const state = reduceForm(initialForm([TONE]), { char: 'x'.repeat(30000) });
    expect(state.draft.length).toBe(20000);
  });

  it('shows what a workflow file said as one plain line, cut and 7-bit when asked', () => {
    expect(plainText('a\nb\u0007c', false)).toBe('a b c');
    expect(plainText('é'.repeat(400), false).endsWith('...')).toBe(true);
    expect(plainText('café', true)).toBe('caf?');
    expect(plainText('café', false)).toBe('café');
    const hostile = field({ name: 'x\ny', type: 'text', description: 'do this\u001b[2J now' });
    const text = screen(initialForm([hostile]));
    expect(text).toContain('x y: do this [2J now');
    expect(text).not.toContain('\u001b');
  });

  it('says what each type of answer looks like', () => {
    const hint = (f: FormField): string => answerHint(f, true);
    expect(hint(field({ name: 'a', type: 'boolean' }))).toBe('true or false');
    expect(hint(field({ name: 'a', type: 'number', limits: { min: 2 } }))).toBe('a number of at least 2');
    expect(hint(field({ name: 'a', type: 'number', limits: { max: 9 } }))).toBe('a number of at most 9');
    expect(hint(field({ name: 'a', type: 'number' }))).toBe('a number');
    expect(hint(field({ name: 'a', type: 'path', limits: { kind: 'file', extensions: '.md' } }))).toBe(
      'a file inside the project (.md)',
    );
    expect(hint(field({ name: 'a', type: 'path', limits: { kind: 'file' } }))).toBe(
      'a file inside the project',
    );
    expect(hint(field({ name: 'a', type: 'path', limits: { kind: 'any' } }))).toBe(
      'a file or folder inside the project',
    );
    expect(hint(field({ name: 'a', type: 'text', limits: { maxLength: 80 } }))).toBe(
      'text, up to 80 characters',
    );
    expect(hint(field({ name: 'a', type: 'text', limits: {} }))).toBe('text, up to  characters');
    expect(hint(field({ name: 'a', type: 'choice' }))).toBe('one of: ');
  });

  it('draws the cursor, the lines so far, and a key line that names what Enter does', () => {
    const state = press(type(initialForm([FOLDERS]), 'one'), 'enter');
    const text = screen(type(state, 'tw'));
    expect(text).toContain('> tw_');
    expect(text).toContain('Enter adds a line (empty line to finish)');
    expect(screen(initialForm([TONE]))).toContain('Enter answers');
  });
});

describe('what a key press means', () => {
  const key = (over: Record<string, boolean> = {}) =>
    ({
      ctrl: false,
      meta: false,
      return: false,
      escape: false,
      backspace: false,
      delete: false,
      ...over,
    }) as never;
  it('maps Ink keys to form keys', () => {
    expect(formKey('c', key({ ctrl: true }))).toBe('ctrl-c');
    expect(formKey('', key({ return: true }))).toBe('enter');
    expect(formKey('', key({ escape: true }))).toBe('escape');
    expect(formKey('', key({ backspace: true }))).toBe('backspace');
    expect(formKey('', key({ delete: true }))).toBe('backspace');
    expect(formKey('a', key({ ctrl: true }))).toBeUndefined();
    expect(formKey('a', key({ meta: true }))).toBeUndefined();
    expect(formKey('', key())).toBeUndefined();
    expect(formKey('a', key())).toEqual({ char: 'a' });
  });
});

function recordingLogger(records: string[]): Logger {
  const log = (component: string, message: string, fields?: Readonly<Record<string, unknown>>): void => {
    records.push(JSON.stringify({ component, message, fields }));
  };
  const logger: Logger = {
    error: log,
    warn: log,
    info: log,
    debug: log,
    child: () => logger,
    flush: async () => undefined,
  };
  return logger;
}

describe('collectInputs on a terminal', () => {
  const terminal = () => {
    const stdout = new FakeStdout(100, 30);
    const stdin = new FakeStdin();
    return {
      stdout,
      stdin,
      io: {
        stdout: stdout as unknown as NodeJS.WritableStream,
        stdin: stdin as unknown as NodeJS.ReadableStream,
      },
    };
  };

  it('asks, returns the answers and gives the terminal back, without writing a value to the log', async () => {
    const { stdout, stdin, io } = terminal();
    const records: string[] = [];
    const marker = 'MARKER-7f3a';
    const done = collectInputs({
      fields: [TONE, FOLDERS],
      ascii: true,
      color: false,
      logger: recordingLogger(records),
      ...io,
    });
    await until(() => stdout.text.includes('How it sounds'));
    // a chunk with text and a return is a paste to Ink, so the return is its own key, as a person's is
    stdin.type(marker);
    await until(() => stdout.text.includes(`> ${marker}_`));
    stdin.type('\r');
    await until(() => stdout.text.includes('The folders to review'));
    stdin.type('specs/a');
    await until(() => stdout.text.includes('> specs/a_'));
    stdin.type('\r');
    await until(() => stdout.text.includes('  specs/a'));
    stdin.type('\r');
    const result = await done;
    expect(result).toEqual({ values: { tone: [marker], specs: ['specs/a'] } });
    expect(stdin.rawMode).toBe(false);
    expect(records.join('\n')).not.toContain(marker);
    expect(records.join('\n')).not.toContain('specs/a');
    expect(records.join('\n')).toContain('"inputs":2');
    expect(records.join('\n')).toContain('"answered":true');
  });

  it('returns undefined when the person cancels', async () => {
    const { stdout, stdin, io } = terminal();
    const records: string[] = [];
    const done = collectInputs({
      fields: [TONE],
      ascii: false,
      color: true,
      logger: recordingLogger(records),
      ...io,
    });
    await until(() => stdout.text.includes('How it sounds'));
    stdin.type(KEY.escape);
    expect(await done).toBeUndefined();
    expect(records.join('\n')).toContain('"answered":false');
  });

  it('returns at once, with nothing, when there is nothing to ask', async () => {
    const { io } = terminal();
    expect(await collectInputs({ fields: [], ascii: true, color: false, ...io })).toEqual({ values: {} });
  });
});
