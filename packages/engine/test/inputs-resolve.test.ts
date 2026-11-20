import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalInputs, type InputDefinition, type PathInput, type TextInput } from '@indaba/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type InputFileSystem,
  nodeInputFileSystem,
  readInputDeclarations,
  resolveInputs,
  type SuppliedInputs,
} from '../src/index.js';

/** specs/workflow-inputs, T-11 to T-14: resolving the values against the declarations and the file system. */

const WORK = process.platform === 'win32' ? 'C:\\work' : '/work';
const at = (...parts: string[]): string => join(WORK, ...parts);

/** A file system of a few entries; `links` maps a path to where it really is. */
function fakeFs(
  entries: Readonly<Record<string, 'file' | 'dir'>>,
  links: Readonly<Record<string, string>> = {},
): InputFileSystem & { readonly looked: string[] } {
  const looked: string[] = [];
  return {
    looked,
    async realpath(path) {
      looked.push(path);
      const real = links[path] ?? path;
      if (real !== WORK && entries[real] === undefined) {
        throw Object.assign(new Error('not there'), { code: 'ENOENT' });
      }
      return real;
    },
    async stat(path) {
      const kind = entries[path];
      return kind === undefined ? undefined : { isFile: kind === 'file', isDirectory: kind === 'dir' };
    },
    async readText() {
      return '';
    },
  };
}

const text = (extra: Partial<TextInput> = {}): TextInput => ({
  type: 'text',
  name: 'topic',
  description: 'The topic',
  list: false,
  minItems: 1,
  maxItems: 1,
  maxLength: 50,
  multiline: false,
  ...extra,
});
const path = (extra: Partial<PathInput> = {}): PathInput => ({
  type: 'path',
  name: 'specs',
  description: 'The folders to review',
  list: true,
  minItems: 1,
  maxItems: 3,
  kind: 'directory',
  mustExist: true,
  extensions: [],
  ...extra,
});
const supply = (values: Record<string, readonly string[]>): SuppliedInputs => ({ values });
const declare = (...inputs: InputDefinition[]): Record<string, InputDefinition> =>
  Object.fromEntries(inputs.map((input) => [input.name, input]));

async function problemsOf(
  declarations: Record<string, InputDefinition>,
  values: Record<string, readonly string[]>,
  fileSystem: InputFileSystem = fakeFs({}),
): Promise<readonly string[]> {
  const result = await resolveInputs(declarations, supply(values), { workDir: WORK, fileSystem });
  return result.ok ? [] : result.problems.map((p) => p.message);
}

describe('resolveInputs with a fake file system (T-11)', () => {
  it('checks and stores every value, and gives the digest of the canonical text', async () => {
    const declarations = declare(
      text(),
      path({ list: true }),
      {
        type: 'choice',
        name: 'tone',
        description: 'x',
        list: false,
        minItems: 1,
        maxItems: 1,
        choices: ['formal', 'short'],
      },
      { type: 'number', name: 'n', description: 'x', integer: true, min: 1, max: 5 },
      { type: 'boolean', name: 'dry', description: 'x' },
    );
    const fileSystem = fakeFs({ [at('specs', 'a')]: 'dir', [at('specs', 'b')]: 'dir' });
    const result = await resolveInputs(
      declarations,
      supply({
        topic: ['billing\r\nrefunds'.replace('\r\n', ' ')],
        specs: ['specs/a', './specs//b/'],
        tone: ['short'],
        n: ['3'],
        dry: ['false'],
      }),
      { workDir: WORK, fileSystem, asked: ['topic', 'ghost'] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.inputs.values).toEqual({
      topic: 'billing refunds',
      specs: ['specs/a', 'specs/b'],
      tone: 'short',
      n: 3,
      dry: false,
    });
    expect(result.inputs.asked).toEqual(['topic']);
    expect(result.inputs.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.inputs.digest).toBe(
      createHash('sha256').update(canonicalInputs(declarations, result.inputs.values), 'utf8').digest('hex'),
    );
  });

  it('applies a default for a value that was not given, and the default is part of the digest', async () => {
    const declarations = declare(text({ default: 'standard', minItems: 0 }));
    const first = await resolveInputs(declarations, supply({}), { workDir: WORK, fileSystem: fakeFs({}) });
    const second = await resolveInputs(declarations, supply({ topic: ['standard'] }), {
      workDir: WORK,
      fileSystem: fakeFs({}),
    });
    const other = await resolveInputs(declare(text({ default: 'other', minItems: 0 })), supply({}), {
      workDir: WORK,
      fileSystem: fakeFs({}),
    });
    expect(first.ok && first.inputs.values).toEqual({ topic: 'standard' });
    expect(first.ok && second.ok && first.inputs.digest === second.inputs.digest).toBe(true);
    expect(first.ok && other.ok && first.inputs.digest !== other.inputs.digest).toBe(true);
  });

  it('keeps an empty default list as an empty list, and checks a default path against the file system', async () => {
    const empty = await resolveInputs(declare(path({ default: [], minItems: 0 })), supply({}), {
      workDir: WORK,
      fileSystem: fakeFs({}),
    });
    expect(empty.ok && empty.inputs.values).toEqual({ specs: [] });
    expect(await problemsOf(declare(path({ list: false, maxItems: 1, default: 'specs/gone' })), {})).toEqual([
      '"specs/gone" does not exist. Check the spelling, or choose another folder.',
    ]);
  });

  it('gives the same digest for the same options in any order', async () => {
    const declarations = declare(text({ name: 'a' }), text({ name: 'b' }));
    const one = await resolveInputs(declarations, supply({ a: ['x'], b: ['y'] }), { workDir: WORK });
    const two = await resolveInputs(declarations, supply({ b: ['y'], a: ['x'] }), { workDir: WORK });
    expect(one.ok && two.ok && one.inputs.digest === two.inputs.digest).toBe(true);
  });

  it('reports a missing input with what to type, and lists it in `missing`', async () => {
    const declarations = declare(path(), text({ name: 'note', default: 'x', minItems: 0 }));
    const result = await resolveInputs(declarations, supply({}), { workDir: WORK, fileSystem: fakeFs({}) });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.missing.map((input) => input.name)).toEqual(['specs']);
    expect(result.problems).toEqual([
      {
        input: 'specs',
        code: 'missing',
        message:
          'The workflow needs a value for "specs": The folders to review. Add --input specs=<folder> (repeat it for more than one), or run it in a terminal to be asked.',
      },
    ]);
  });

  it('words the missing line for a single text, file and unrestricted path', async () => {
    const single = await problemsOf(declare(text()), {});
    expect(single[0]).toContain('Add --input topic=<value>, or run it');
    expect(single[0]).not.toContain('repeat');
    expect(
      await problemsOf(declare(path({ name: 'f', kind: 'file', list: false, maxItems: 1 })), {}),
    ).toEqual([expect.stringContaining('--input f=<file>')]);
    expect(await problemsOf(declare(path({ name: 'p', kind: 'any', list: false, maxItems: 1 })), {})).toEqual(
      [expect.stringContaining('--input p=<path>')],
    );
  });

  it('names an input the workflow does not declare, and lists the ones it does', async () => {
    const declarations = declare(text());
    expect(await problemsOf(declarations, { topic: ['x'], spec: ['y'] })).toEqual([
      'This workflow has no input called "spec". It takes: topic.',
    ]);
    expect(await problemsOf({}, { spec: ['y'] })).toEqual([
      'This workflow has no input called "spec". It takes no inputs.',
    ]);
  });

  it('refuses the same input twice when it is not a list, and the bounds of a list', async () => {
    const fileSystem = fakeFs({
      [at('a')]: 'dir',
      [at('b')]: 'dir',
      [at('c')]: 'dir',
      [at('d')]: 'dir',
    });
    expect(await problemsOf(declare(text()), { topic: ['a', 'b'] })).toEqual([
      '"topic" was given more than once, and it takes a single value.',
    ]);
    expect(await problemsOf(declare(path()), { specs: ['a', 'b', 'c', 'd'] }, fileSystem)).toEqual([
      '"specs" takes at most 3 folders; 4 were given.',
    ]);
    expect(await problemsOf(declare(path({ minItems: 2 })), { specs: ['a'] }, fileSystem)).toEqual([
      '"specs" takes at least 2 folders; 1 were given.',
    ]);
  });

  it('reports every problem at once, not the first', async () => {
    const declarations = declare(
      text({ maxLength: 3 }),
      { type: 'number', name: 'n', description: 'x', integer: true, min: 1, max: 5 },
      path({ name: 'where', list: false, maxItems: 1 }),
      text({ name: 'absent' }),
    );
    expect(
      await problemsOf(declarations, {
        topic: ['toolong'],
        n: ['many'],
        where: ['../secrets'],
        extra: ['x'],
      }),
    ).toEqual([
      'This workflow has no input called "extra". It takes: topic, n, where, absent.',
      '"topic" is longer than the 3 characters it may have (it has 7).',
      '"n" must be a whole number from 1 to 5; "many" is not.',
      '"../secrets" is outside the folder the workflow runs in. Choose a folder inside it.',
      expect.stringContaining('The workflow needs a value for "absent"'),
    ]);
  });

  it('refuses a path that does not exist, is the wrong kind, or has the wrong extension, with the words of the spec', async () => {
    const fileSystem = fakeFs({
      [at('specs', 'a.md')]: 'file',
      [at('notes.txt')]: 'file',
      [at('docs')]: 'dir',
    });
    expect(await problemsOf(declare(path()), { specs: ['specs/billng'] }, fileSystem)).toEqual([
      '"specs/billng" does not exist. Check the spelling, or choose another folder.',
    ]);
    expect(await problemsOf(declare(path()), { specs: ['specs/a.md'] }, fileSystem)).toEqual([
      '"specs/a.md" is a file, but "specs" takes folders.',
    ]);
    const files = declare(path({ kind: 'file', extensions: ['.md'] }));
    expect(await problemsOf(files, { specs: ['docs'] }, fileSystem)).toEqual([
      '"docs" is a folder, but "specs" takes files.',
    ]);
    expect(await problemsOf(files, { specs: ['notes.txt'] }, fileSystem)).toEqual([
      '"notes.txt" is not one of the file types this input takes (.md).',
    ]);
    expect((await problemsOf(files, { specs: ['specs/a.md'] }, fileSystem)).length).toBe(0);
  });

  it('compares extensions without regard to case, on the real entry', async () => {
    const fileSystem = fakeFs({ [at('a.MD')]: 'file' });
    expect(
      await problemsOf(
        declare(path({ kind: 'file', extensions: ['.md'], list: false, maxItems: 1 })),
        { specs: ['a.MD'] },
        fileSystem,
      ),
    ).toEqual([]);
  });

  it('lets a path that does not have to exist stand, but still checks one that does', async () => {
    const fileSystem = fakeFs({ [at('there')]: 'file' });
    const loose = declare(path({ mustExist: false, list: false, maxItems: 1 }));
    expect(await problemsOf(loose, { specs: ['not/yet'] }, fileSystem)).toEqual([]);
    expect(await problemsOf(loose, { specs: ['there'] }, fileSystem)).toEqual([
      '"there" is a file, but "specs" takes folders.',
    ]);
  });

  it('refuses a path that is a link pointing out of the directory (fake)', async () => {
    const outside = process.platform === 'win32' ? 'C:\\elsewhere\\x' : '/elsewhere/x';
    const fileSystem = fakeFs({ [outside]: 'dir', [at('link')]: 'dir' }, { [at('link')]: outside });
    expect(
      await problemsOf(declare(path({ list: false, maxItems: 1 })), { specs: ['link'] }, fileSystem),
    ).toEqual(['"link" is outside the folder the workflow runs in. Choose a folder inside it.']);
  });

  it('says a path could not be looked at when the file system fails for another reason', async () => {
    const broken: InputFileSystem = {
      realpath: async (p) => {
        if (p === WORK) {
          return p;
        }
        throw Object.assign(new Error('no'), { code: 'EACCES' });
      },
      stat: async () => undefined,
      readText: async () => '',
    };
    expect(await problemsOf(declare(path({ list: false, maxItems: 1 })), { specs: ['x'] }, broken)).toEqual([
      '"x" could not be looked at.',
    ]);
    const noRoot: InputFileSystem = { ...broken, realpath: async () => Promise.reject(new Error('x')) };
    expect(await problemsOf(declare(path({ list: false, maxItems: 1 })), { specs: ['x'] }, noRoot)).toEqual([
      'The folder the workflow runs in could not be looked at.',
    ]);
    const noStat: InputFileSystem = {
      ...broken,
      realpath: async (p) => p,
      stat: async () => Promise.reject(new Error('x')),
    };
    expect(await problemsOf(declare(path({ list: false, maxItems: 1 })), { specs: ['x'] }, noStat)).toEqual([
      '"x" could not be looked at.',
    ]);
  });

  it('treats an entry that vanishes between the two looks as missing', async () => {
    const vanishing: InputFileSystem = {
      realpath: async (p) => p,
      stat: async () => undefined,
      readText: async () => '',
    };
    expect(
      await problemsOf(declare(path({ list: false, maxItems: 1 })), { specs: ['x'] }, vanishing),
    ).toEqual(['"x" does not exist. Check the spelling, or choose another folder.']);
    expect(
      await problemsOf(
        declare(path({ list: false, maxItems: 1, mustExist: false })),
        { specs: ['x'] },
        vanishing,
      ),
    ).toEqual([]);
  });

  it('confines a path that does not exist yet through the nearest folder that does (must_exist: false)', async () => {
    const outside = process.platform === 'win32' ? 'C:\\elsewhere\\x' : '/elsewhere/x';
    const fileSystem = fakeFs(
      { [outside]: 'dir', [at('link')]: 'dir', [at('real')]: 'dir' },
      { [at('link')]: outside },
    );
    const loose = declare(path({ mustExist: false, list: false, maxItems: 1, kind: 'any' }));
    expect(await problemsOf(loose, { specs: ['link/new.txt'] }, fileSystem)).toEqual([
      '"link/new.txt" is outside the folder the workflow runs in. Choose a path inside it.',
    ]);
    expect(await problemsOf(loose, { specs: ['link/a/b/c'] }, fileSystem)).toEqual([
      '"link/a/b/c" is outside the folder the workflow runs in. Choose a path inside it.',
    ]);
    expect(await problemsOf(loose, { specs: ['real/new.txt'] }, fileSystem)).toEqual([]);
    expect(await problemsOf(loose, { specs: ['brand/new/file'] }, fileSystem)).toEqual([]);
    const broken: InputFileSystem = {
      ...fileSystem,
      realpath: async (p) => {
        if (p === WORK || p.endsWith('real')) {
          return p;
        }
        throw Object.assign(new Error('no'), { code: p.endsWith('x') ? 'ENOENT' : 'EACCES' });
      },
    };
    expect(await problemsOf(loose, { specs: ['real/x'] }, broken)).toEqual([]);
    expect(await problemsOf(loose, { specs: ['deep/er/x'] }, broken)).toEqual([
      '"deep/er/x" could not be looked at.',
    ]);
  });

  it('checks the extensions of a path that does not exist yet by its name (must_exist: false)', async () => {
    const declarations = declare(
      path({ kind: 'file', extensions: ['.md'], mustExist: false, list: false, maxItems: 1 }),
    );
    expect(await problemsOf(declarations, { specs: ['out/x.exe'] })).toEqual([
      '"out/x.exe" is not one of the file types this input takes (.md).',
    ]);
    expect(await problemsOf(declarations, { specs: ['out/x.MD'] })).toEqual([]);
  });

  it('throws only for a programming error', async () => {
    await expect(resolveInputs({}, supply({}), { workDir: '' })).rejects.toThrow('working directory');
  });

  it('accepts a workflow with no inputs and no values', async () => {
    const result = await resolveInputs({}, supply({}), { workDir: WORK });
    expect(result.ok && result.inputs.values).toEqual({});
  });

  it('reads the declarations of a file and resolves them', async () => {
    const { declarations } = readInputDeclarations(
      'inputs:\n  topic:\n    type: text\n    description: "x"\n    default: "d"\n',
    );
    const result = await resolveInputs(declarations, supply({}), { workDir: WORK });
    expect(result.ok && result.inputs.values).toEqual({ topic: 'd' });
  });
});

describe('resolveInputs against a real directory (T-12)', () => {
  let dir: string;
  let outside: string;

  beforeEach(async () => {
    const base = await mkdtemp(join(tmpdir(), 'indaba-inputs-'));
    dir = join(base, 'project');
    outside = join(base, 'outside');
    await mkdir(join(dir, 'specs', 'billing'), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(dir, 'specs', 'a.md'), 'x');
    await writeFile(join(outside, 'secret.md'), 'x');
  });
  afterEach(async () => {
    await rm(join(dir, '..'), { recursive: true, force: true });
  });

  const resolve = async (declaration: InputDefinition, values: string[]): Promise<readonly string[]> => {
    const result = await resolveInputs(declare(declaration), supply({ [declaration.name]: values }), {
      workDir: dir,
    });
    return result.ok ? [] : result.problems.map((p) => p.message);
  };

  it('accepts a real folder and an absolute path inside it, and stores both relative', async () => {
    const result = await resolveInputs(
      declare(path()),
      supply({ specs: ['specs/billing', join(dir, 'specs')] }),
      { workDir: dir },
    );
    expect(result.ok && result.inputs.values).toEqual({ specs: ['specs/billing', 'specs'] });
  });

  it('refuses a path outside, absolute or with .., and one that does not exist', async () => {
    expect(await resolve(path({ list: false, maxItems: 1 }), [outside])).toEqual([
      expect.stringContaining('is outside the folder the workflow runs in'),
    ]);
    expect(await resolve(path({ list: false, maxItems: 1 }), ['../outside'])).toEqual([
      expect.stringContaining('is outside the folder the workflow runs in'),
    ]);
    expect(await resolve(path({ list: false, maxItems: 1 }), ['specs/missing'])).toEqual([
      '"specs/missing" does not exist. Check the spelling, or choose another folder.',
    ]);
  });

  it('refuses a link or junction that leaves the directory, and accepts one that stays inside', async () => {
    try {
      // A junction needs no privilege on Windows; a directory symlink does not on POSIX.
      await symlink(outside, join(dir, 'out-link'), process.platform === 'win32' ? 'junction' : 'dir');
      await symlink(
        join(dir, 'specs'),
        join(dir, 'in-link'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      // The platform cannot make a link here (no permission): say so instead of passing silently.
      throw new Error(`this test needs to create a link and could not: ${String(error)}`);
    }
    expect(await resolve(path({ list: false, maxItems: 1 }), ['out-link'])).toEqual([
      '"out-link" is outside the folder the workflow runs in. Choose a folder inside it.',
    ]);
    expect(await resolve(path({ list: false, maxItems: 1, kind: 'any' }), ['out-link/secret.md'])).toEqual([
      expect.stringContaining('is outside the folder the workflow runs in'),
    ]);
    expect(await resolve(path({ list: false, maxItems: 1 }), ['in-link'])).toEqual([]);
  });

  it('checks the kind and the extension on the real entry', async () => {
    const file = path({ kind: 'file', extensions: ['.md'], list: false, maxItems: 1 });
    expect(await resolve(file, ['specs/a.md'])).toEqual([]);
    expect(await resolve(file, ['specs'])).toEqual(['"specs" is a folder, but "specs" takes files.']);
    expect(await resolve(path({ list: false, maxItems: 1 }), ['specs/a.md'])).toEqual([
      '"specs/a.md" is a file, but "specs" takes folders.',
    ]);
  });
});

describe('the real file system of the engine (T-13)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'indaba-inputs-fs-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('says nothing is there for a missing entry and what is there for a real one', async () => {
    await writeFile(join(dir, 'f.txt'), 'hi');
    expect(await nodeInputFileSystem.stat(join(dir, 'gone'))).toBeUndefined();
    expect(await nodeInputFileSystem.stat(join(dir, 'f.txt'))).toEqual({ isFile: true, isDirectory: false });
    expect(await nodeInputFileSystem.stat(dir)).toEqual({ isFile: false, isDirectory: true });
    // a file where a folder is expected is also "not there", not a failure
    expect(await nodeInputFileSystem.stat(join(dir, 'f.txt', 'x'))).toBeUndefined();
    expect((await nodeInputFileSystem.realpath(dir)).length).toBeGreaterThan(0);
  });

  it('reads a text file as UTF-8 and refuses one longer than the limit, by size and by characters', async () => {
    await writeFile(join(dir, 'ok.txt'), 'h\u00e9llo \u{1F600}');
    expect(await nodeInputFileSystem.readText(join(dir, 'ok.txt'), 10)).toBe('h\u00e9llo \u{1F600}');
    await expect(nodeInputFileSystem.readText(join(dir, 'ok.txt'), 3)).rejects.toThrow(
      'longer than 3 characters',
    );
    await writeFile(join(dir, 'big.txt'), 'x'.repeat(100));
    await expect(nodeInputFileSystem.readText(join(dir, 'big.txt'), 10)).rejects.toThrow(
      'longer than 10 characters',
    );
    await expect(nodeInputFileSystem.readText(join(dir, 'gone.txt'), 10)).rejects.toThrow();
  });

  it('rethrows a failure that is not "not there"', async () => {
    await expect(nodeInputFileSystem.stat('\u0000bad')).rejects.toThrow();
  });
});
