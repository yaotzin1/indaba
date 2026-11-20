import { describe, expect, it } from 'vitest';
import {
  type BooleanInput,
  type ChoiceInput,
  canonicalInputs,
  checkBooleanValue,
  checkChoiceValue,
  checkNumberValue,
  checkTextValue,
  describeInputs,
  type InputDefinition,
  isInputName,
  type NumberInput,
  normalizeInputPath,
  numberFits,
  type PathInput,
  quoteValue,
  type TextInput,
} from '../src/index.js';

/** specs/workflow-inputs, T-02 to T-05: the pure checks. Hostile strings are built from fragments. */

const text = (extra: Partial<TextInput> = {}): TextInput => ({
  type: 'text',
  name: 'topic',
  description: 'The topic',
  list: false,
  minItems: 1,
  maxItems: 1,
  maxLength: 20,
  multiline: false,
  ...extra,
});
const choice: ChoiceInput = {
  type: 'choice',
  name: 'tone',
  description: 'The tone',
  list: false,
  minItems: 1,
  maxItems: 1,
  choices: ['formal', 'friendly', 'short'],
};
interface NumberExtra {
  integer?: boolean;
  min?: number | undefined;
  max?: number | undefined;
}
const number = (extra: NumberExtra = {}): NumberInput => {
  const min = 'min' in extra ? extra.min : 1;
  const max = 'max' in extra ? extra.max : 5;
  return {
    type: 'number',
    name: 'retries',
    description: 'How many',
    integer: extra.integer ?? true,
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
};
const flag: BooleanInput = { type: 'boolean', name: 'dry', description: 'Dry run' };
const path = (extra: Partial<PathInput> = {}): PathInput => ({
  type: 'path',
  name: 'specs',
  description: 'Folders',
  list: false,
  minItems: 1,
  maxItems: 1,
  kind: 'directory',
  mustExist: true,
  extensions: [],
  ...extra,
});

const ch = (code: number): string => String.fromCharCode(code);
const problem = (check: { ok: boolean; problem?: { code: string; message: string } }) =>
  check.ok ? undefined : check.problem;

describe('input names', () => {
  it('starts with a letter, then letters, digits, _ and -, at most 64', () => {
    expect(isInputName('specs')).toBe(true);
    expect(isInputName('a-b_9')).toBe(true);
    expect(isInputName('a'.repeat(64))).toBe(true);
    for (const bad of ['', '9a', '_a', '-a', 'a b', 'a.b', 'a'.repeat(65), '__proto__', 'a/b']) {
      expect(isInputName(bad), bad).toBe(false);
    }
  });
});

describe('checkTextValue (AC-19)', () => {
  it('accepts a plain value and keeps its leading and trailing spaces', () => {
    expect(checkTextValue(text(), '  hello  ')).toEqual({ ok: true, value: '  hello  ' });
    expect(checkTextValue(text(), 'tab\there')).toEqual({ ok: true, value: 'tab\there' });
  });

  it('turns every line ending into a line feed when the input is multiline', () => {
    const input = text({ multiline: true, maxLength: 100 });
    expect(checkTextValue(input, 'a\r\nb\rc\nd')).toEqual({ ok: true, value: 'a\nb\nc\nd' });
  });

  it('refuses a line break when the input takes a single line, saying where', () => {
    const result = problem(checkTextValue(text(), 'ab\ncd'));
    expect(result?.code).toBe('bad_characters');
    expect(result?.message).toBe(
      '"topic" contains a character that cannot be used (a line break, and this input takes a single line at position 3).',
    );
  });

  it('refuses NUL, other control characters, DEL and C1 controls', () => {
    for (const code of [0x00, 0x01, 0x08, 0x0b, 0x1b, 0x7f, 0x85, 0x9b]) {
      const result = problem(checkTextValue(text(), `ab${ch(code)}cd`));
      expect(result?.code, String(code)).toBe('bad_characters');
      expect(result?.message).toContain('a hidden control character at position 3');
    }
  });

  it('refuses text-direction controls', () => {
    for (const code of [0x202a, 0x202e, 0x2066, 0x2069]) {
      const result = problem(checkTextValue(text(), `x${ch(code)}`));
      expect(result?.code, String(code)).toBe('bad_characters');
      expect(result?.message).toContain('a text-direction control character at position 2');
    }
    expect(checkTextValue(text(), `x${ch(0x202f)}`).ok).toBe(true);
  });

  it('refuses a broken surrogate pair and accepts a whole one', () => {
    expect(problem(checkTextValue(text(), `a${ch(0xd800)}b`))?.message).toContain(
      'a broken character at position 2',
    );
    expect(problem(checkTextValue(text(), `a${ch(0xdc00)}b`))?.code).toBe('bad_characters');
    expect(checkTextValue(text(), 'a\u{1F600}b').ok).toBe(true);
  });

  it('counts characters, not code units, against max_length', () => {
    const input = text({ maxLength: 3 });
    expect(checkTextValue(input, '\u{1F600}\u{1F600}\u{1F600}').ok).toBe(true);
    const long = problem(checkTextValue(input, 'abcd'));
    expect(long?.code).toBe('too_long');
    expect(long?.message).toBe('"topic" is longer than the 3 characters it may have (it has 4).');
  });
});

describe('checkChoiceValue and checkBooleanValue (AC-20)', () => {
  it('takes exactly one of the choices', () => {
    expect(checkChoiceValue(choice, 'short')).toEqual({ ok: true, value: 'short' });
    const result = problem(checkChoiceValue(choice, 'Short'));
    expect(result?.code).toBe('not_a_choice');
    expect(result?.message).toBe('"tone" must be one of: formal, friendly, short. "Short" is not.');
  });

  it('takes exactly true or false', () => {
    expect(checkBooleanValue(flag, 'true')).toEqual({ ok: true, value: true });
    expect(checkBooleanValue(flag, 'false')).toEqual({ ok: true, value: false });
    for (const bad of ['TRUE', 'yes', '1', '', ' true']) {
      expect(problem(checkBooleanValue(flag, bad))?.code, bad).toBe('wrong_type');
    }
    expect(problem(checkBooleanValue(flag, 'yes'))?.message).toBe(
      '"dry" must be true or false; "yes" is not.',
    );
  });
});

describe('checkNumberValue (AC-20)', () => {
  it('takes a decimal numeral with a dot', () => {
    expect(checkNumberValue(number(), '3')).toEqual({ ok: true, value: 3 });
    expect(checkNumberValue(number({ integer: false }), '2.5')).toEqual({ ok: true, value: 2.5 });
    expect(checkNumberValue(number({ integer: false, min: -5 }), '-0.25')).toEqual({
      ok: true,
      value: -0.25,
    });
  });

  it('writes minus zero as zero', () => {
    const result = checkNumberValue(number({ min: undefined, max: undefined }), '-0');
    expect(result).toEqual({ ok: true, value: 0 });
    expect(Object.is(result.ok ? result.value : 1, 0)).toBe(true);
  });

  it('refuses locale forms, exponents, NaN, Infinity, signs, spaces and empty', () => {
    const loose = number({ integer: false, min: undefined, max: undefined });
    for (const bad of [
      '1,5',
      '1e3',
      '1E3',
      'NaN',
      'Infinity',
      '-Infinity',
      '+1',
      ' 1',
      '1 ',
      '',
      '.5',
      '5.',
      '01',
      '0x10',
      '1_000',
      '1 000',
    ]) {
      expect(problem(checkNumberValue(loose, bad))?.code, bad).toBe('wrong_type');
    }
  });

  it('refuses a numeral too large to be a number', () => {
    const loose = number({ integer: false, min: undefined, max: undefined });
    expect(problem(checkNumberValue(loose, '9'.repeat(400)))?.code).toBe('wrong_type');
  });

  it('refuses a fraction for a whole number, and a value outside min and max', () => {
    expect(problem(checkNumberValue(number(), '2.5'))?.code).toBe('wrong_type');
    const out = problem(checkNumberValue(number(), '9'));
    expect(out?.code).toBe('out_of_range');
    expect(out?.message).toBe('"retries" must be a whole number from 1 to 5; "9" is not.');
    expect(problem(checkNumberValue(number(), 'many'))?.message).toBe(
      '"retries" must be a whole number from 1 to 5; "many" is not.',
    );
  });

  it('words each combination of bounds', () => {
    expect(problem(checkNumberValue(number({ max: undefined }), '0'))?.message).toContain(
      'a whole number of at least 1',
    );
    expect(problem(checkNumberValue(number({ min: undefined }), '9'))?.message).toContain(
      'a whole number of at most 5',
    );
    expect(problem(checkNumberValue(number({ min: undefined, max: undefined }), 'x'))?.message).toContain(
      '"retries" must be a whole number;',
    );
    expect(
      problem(checkNumberValue(number({ integer: false, min: undefined, max: undefined }), 'x'))?.message,
    ).toContain('must be a number;');
  });

  it('says whether a number satisfies a declaration', () => {
    expect(numberFits(number(), 3)).toBe(true);
    expect(numberFits(number(), 6)).toBe(false);
    expect(numberFits(number(), 1.5)).toBe(false);
    expect(numberFits(number({ integer: false }), 1.5)).toBe(true);
    expect(numberFits(number({ integer: false }), Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('review findings of slice 1', () => {
  it('refuses a tab in a path, though a text value may hold one', () => {
    expect(normalizeInputPath(path(), 'a\tb').ok).toBe(false);
    expect(problem(normalizeInputPath(path(), 'a\tb'))?.code).toBe('bad_characters');
    expect(checkTextValue(text(), 'a\tb').ok).toBe(true);
  });

  it('refuses a numeral a double cannot hold exactly, and one written with an exponent', () => {
    const loose = number({ integer: false, min: undefined, max: undefined });
    for (const bad of [
      '9007199254740993',
      '1.000000000000000000001',
      '1000000000000000000000',
      '0.0000001',
      '1234567890123456',
    ]) {
      expect(problem(checkNumberValue(loose, bad))?.code, bad).toBe('wrong_type');
    }
    for (const good of ['123456789012345', '0.000001', '-0.5', '1000000']) {
      expect(checkNumberValue(loose, good).ok, good).toBe(true);
    }
    expect(problem(checkNumberValue(number(), '1.000000000000000000001'))?.code).toBe('wrong_type');
  });

  it('does not echo a text-direction control in a message', () => {
    expect(quoteValue(`a${ch(0x202e)}b${ch(0x2066)}c`)).toBe('a b c');
    expect(problem(checkChoiceValue(choice, `${ch(0x202e)}evil`))?.message).not.toContain(ch(0x202e));
  });
});

describe('quoteValue (AC-29)', () => {
  it('cuts a value to 80 characters and shows control characters as spaces', () => {
    expect(quoteValue('a'.repeat(80))).toBe('a'.repeat(80));
    expect(quoteValue('a'.repeat(81))).toBe(`${'a'.repeat(80)}...`);
    expect(quoteValue(`a${ch(0x1b)}b${ch(0x0a)}c`)).toBe('a b c');
  });

  it('never lets a message carry more than 80 characters of a value', () => {
    const long = 'x'.repeat(500);
    expect(problem(checkChoiceValue(choice, long))?.message.length).toBeLessThan(200);
    expect(problem(checkBooleanValue(flag, long))?.message).not.toContain('x'.repeat(81));
    expect(problem(checkNumberValue(number(), long))?.message).not.toContain('x'.repeat(81));
  });
});

describe('normalizeInputPath (AC-18, T-04)', () => {
  const ok = (raw: string, base?: string) => {
    const result = normalizeInputPath(path(), raw, base);
    return result.ok ? result.value : `${result.problem.code}`;
  };

  it('stores a relative path with slashes, without ./ or a trailing slash', () => {
    expect(ok('specs/billing')).toBe('specs/billing');
    expect(ok('./specs//billing/')).toBe('specs/billing');
    expect(ok('specs\\billing\\x')).toBe('specs/billing/x');
    expect(ok('specs/./billing/../refunds')).toBe('specs/refunds');
    expect(ok('.')).toBe('.');
    expect(ok('a/..')).toBe('.');
  });

  it('refuses a path that leaves the directory after the .. are removed', () => {
    for (const raw of ['..', '../x', 'a/../../x', '..\\secrets', 'a/b/../../..']) {
      expect(ok(raw), raw).toBe('outside_directory');
    }
    expect(normalizeInputPath(path(), '../secrets').ok).toBe(false);
    expect(problem(normalizeInputPath(path(), '../secrets'))?.message).toBe(
      '"../secrets" is outside the folder the workflow runs in. Choose a folder inside it.',
    );
  });

  it('says file when the input takes files', () => {
    expect(problem(normalizeInputPath(path({ kind: 'file' }), '../a.md'))?.message).toContain(
      'Choose a file inside it.',
    );
  });

  it('refuses UNC and device paths in every spelling', () => {
    for (const raw of [
      '\\\\server\\share\\x',
      '//server/share/x',
      '\\\\?\\C:\\x',
      '\\\\.\\pipe\\x',
      '//?/C:/x',
      '//./x',
    ]) {
      expect(ok(raw, 'C:/work'), raw).toBe('outside_directory');
    }
  });

  it('refuses a drive letter with no root, and any absolute path with nothing to compare against', () => {
    expect(ok('C:x', 'C:/work')).toBe('outside_directory');
    expect(ok('C:', 'C:/work')).toBe('outside_directory');
    expect(ok('C:\\work\\a')).toBe('outside_directory');
    expect(ok('/work/a')).toBe('outside_directory');
    expect(ok('/work/a', 'work')).toBe('outside_directory');
  });

  it('accepts an absolute path inside the working directory and stores it relative (POSIX)', () => {
    expect(ok('/work/specs/billing', '/work')).toBe('specs/billing');
    expect(ok('/work/specs/../specs/x/', '/work/')).toBe('specs/x');
    expect(ok('/work', '/work')).toBe('.');
    expect(ok('/work/../etc', '/work')).toBe('outside_directory');
    expect(ok('/workshop/a', '/work')).toBe('outside_directory');
    expect(ok('/other/a', '/work')).toBe('outside_directory');
  });

  it('accepts an absolute path inside the working directory (Windows spellings), ignoring case', () => {
    expect(ok('C:\\Work\\Specs\\Billing', 'c:/work')).toBe('Specs/Billing');
    expect(ok('c:/WORK/specs', 'C:\\Work')).toBe('specs');
    expect(ok('D:\\work\\a', 'C:\\work')).toBe('outside_directory');
    expect(ok('C:\\Workshop\\a', 'C:\\Work')).toBe('outside_directory');
    expect(ok('C:\\Work\\..\\Windows', 'C:\\Work')).toBe('outside_directory');
  });

  it('compares case exactly on a POSIX base', () => {
    expect(ok('/Work/a', '/work')).toBe('outside_directory');
  });

  it('refuses a drive path against a POSIX base and a POSIX path against a drive base', () => {
    expect(ok('C:/work/a', '/work')).toBe('outside_directory');
    expect(ok('/work/a', 'C:/work')).toBe('outside_directory');
  });

  it('refuses an empty value and hidden characters', () => {
    expect(ok('')).toBe('missing');
    expect(ok('   ')).toBe('missing');
    expect(ok(`a${ch(0)}b`)).toBe('bad_characters');
    expect(ok(`a${ch(0x1b)}b`)).toBe('bad_characters');
    expect(ok(`a${ch(0x202e)}b`)).toBe('bad_characters');
    expect(ok('a\nb')).toBe('bad_characters');
  });

  it('keeps shell metacharacters and spaces as plain name characters', () => {
    expect(ok('a b/$(x);`y`')).toBe('a b/$(x);`y`');
  });
});

describe('describeInputs and canonicalInputs (T-05)', () => {
  const declarations: Record<string, InputDefinition> = {
    topic: text({ name: 'topic', default: 'x' }),
    tone: choice,
    retries: number(),
    dry: flag,
    specs: path({ list: true, minItems: 1, maxItems: 10, extensions: [] }),
    notes: path({ name: 'notes', kind: 'file', extensions: ['.md', '.txt'] }),
  };

  it('describes each input for a form, in declaration order', () => {
    const described = describeInputs(declarations);
    expect(described.map((d) => d.name)).toEqual(['topic', 'tone', 'retries', 'dry', 'specs', 'notes']);
    expect(described[0]).toMatchObject({
      type: 'text',
      hasDefault: true,
      default: 'x',
      list: false,
      limits: { maxLength: 20, multiline: false },
    });
    expect(described[1]).toMatchObject({ choices: ['formal', 'friendly', 'short'], hasDefault: false });
    expect(described[2]?.limits).toEqual({ integer: true, min: 1, max: 5 });
    expect(described[3]?.limits).toEqual({});
    expect(described[4]).toMatchObject({
      list: true,
      limits: { kind: 'directory', mustExist: true, minItems: 1, maxItems: 10 },
    });
    expect(described[5]?.limits).toMatchObject({ extensions: '.md,.txt' });
  });

  it('writes the example of data-model.md exactly', () => {
    const only = { specs: declarations.specs as InputDefinition };
    expect(canonicalInputs(only, { specs: ['specs/billing', 'specs/refunds'] })).toBe(
      '{"v":1,"inputs":{"specs":{"type":"path","value":["specs/billing","specs/refunds"]}}}',
    );
  });

  it('does not depend on the order of the declarations or of the values', () => {
    const values = { topic: 'x', tone: 'short', retries: 2, dry: false, specs: ['a'], notes: 'n.md' };
    const reversed = Object.fromEntries(Object.entries(declarations).reverse());
    const reversedValues = Object.fromEntries(Object.entries(values).reverse());
    expect(canonicalInputs(declarations, values)).toBe(canonicalInputs(reversed, reversedValues));
    expect(canonicalInputs(declarations, values)).toContain(
      '"inputs":{"dry":{"type":"boolean","value":false},"notes"',
    );
  });

  it('keeps the order of a list, includes values that came from defaults and empty lists, and skips inputs with no value', () => {
    const canonical = canonicalInputs(declarations, { specs: ['b', 'a'], topic: '' });
    expect(canonical).toBe(
      '{"v":1,"inputs":{"specs":{"type":"path","value":["b","a"]},"topic":{"type":"text","value":""}}}',
    );
    expect(canonicalInputs(declarations, { specs: [] })).toContain('"value":[]');
    expect(canonicalInputs(declarations, {})).toBe('{"v":1,"inputs":{}}');
  });

  it('writes minus zero as zero and ignores a value for an input that is not declared', () => {
    expect(canonicalInputs({ retries: number() }, { retries: -0, ghost: 'x' })).toBe(
      '{"v":1,"inputs":{"retries":{"type":"number","value":0}}}',
    );
  });
});
