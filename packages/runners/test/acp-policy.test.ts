import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PermissionMode, type StepPermissions } from '@indaba/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AcpFileServer,
  decidePermission,
  parseOptions,
  relativeToWorkdir,
  selectOption,
} from '../src/acp-policy.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function workdir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'indaba-policy-')));
  dirs.push(dir);
  return dir;
}

const WORK = resolve(tmpdir(), 'work');
const inside = (rel: string): string => join(WORK, rel);

const scope = (write: string[], extra: Partial<StepPermissions> = {}): StepPermissions => ({
  fsRead: [],
  fsWrite: write,
  terminal: PermissionMode.Deny,
  ...extra,
});

describe('decidePermission', () => {
  it.each(['edit', 'delete', 'move'])('%s is allowed only inside the write scope', (kind) => {
    const p = scope(['src/**']);
    expect(decidePermission(kind, [inside('src/a.ts')], p, WORK)).toBe('allowed');
    expect(decidePermission(kind, [inside('docs/a.md')], p, WORK)).toBe('rejected');
  });

  it.each(['edit', 'delete', 'move'])(
    '%s is rejected with no permissions block, whatever the location',
    (kind) => {
      expect(decidePermission(kind, [inside('src/a.ts')], undefined, WORK)).toBe('rejected');
    },
  );

  it.each(['edit', 'delete', 'move'])('%s needs every location in scope, not just one', (kind) => {
    const p = scope(['src/**']);
    expect(decidePermission(kind, [inside('src/a.ts'), inside('src/b.ts')], p, WORK)).toBe('allowed');
    expect(decidePermission(kind, [inside('src/a.ts'), inside('docs/b.md')], p, WORK)).toBe('rejected');
    expect(decidePermission(kind, [inside('docs/b.md'), inside('src/a.ts')], p, WORK)).toBe('rejected');
  });

  it('refuses an edit it cannot check: no locations, an empty list, or an empty write scope', () => {
    expect(decidePermission('edit', undefined, scope(['**']), WORK)).toBe('rejected');
    expect(decidePermission('edit', [], scope(['**']), WORK)).toBe('rejected');
    expect(decidePermission('edit', [inside('src/a.ts')], scope([]), WORK)).toBe('rejected');
  });

  it('refuses a location outside the working directory even when a glob would match it', () => {
    const p = scope(['**']);
    expect(decidePermission('edit', [resolve(tmpdir(), 'elsewhere', 'x.ts')], p, WORK)).toBe('rejected');
    expect(decidePermission('edit', ['../outside.ts'], p, WORK)).toBe('rejected');
  });

  it('reads a relative location as relative to the working directory', () => {
    expect(decidePermission('edit', ['src/a.ts'], scope(['src/**']), WORK)).toBe('allowed');
    expect(decidePermission('edit', ['docs/a.md'], scope(['src/**']), WORK)).toBe('rejected');
  });

  it('allows execute only when the terminal is allowed', () => {
    expect(decidePermission('execute', undefined, undefined, WORK)).toBe('rejected');
    expect(decidePermission('execute', undefined, scope([]), WORK)).toBe('rejected');
    expect(decidePermission('execute', undefined, scope([], { terminal: PermissionMode.Allow }), WORK)).toBe(
      'allowed',
    );
  });

  it('restricts reads only when read globs are given, and then needs every location', () => {
    const open = scope([]);
    expect(decidePermission('read', undefined, open, WORK)).toBe('allowed');
    expect(decidePermission('read', undefined, undefined, WORK)).toBe('allowed');
    const limited = scope([], { fsRead: ['src/**'] });
    expect(decidePermission('read', [inside('src/a.ts')], limited, WORK)).toBe('allowed');
    expect(decidePermission('read', [inside('secrets/k.txt')], limited, WORK)).toBe('rejected');
    expect(decidePermission('read', [inside('src/a.ts'), inside('secrets/k.txt')], limited, WORK)).toBe(
      'rejected',
    );
    expect(decidePermission('read', undefined, limited, WORK)).toBe('rejected');
    expect(decidePermission('read', [], limited, WORK)).toBe('rejected');
  });

  it.each(['search', 'fetch', 'think', 'switch_mode', 'other'])(
    '%s is allowed without asking for anything',
    (kind) => {
      expect(decidePermission(kind, undefined, undefined, WORK)).toBe('allowed');
      expect(decidePermission(kind, undefined, scope([]), WORK)).toBe('allowed');
    },
  );

  it.each(['teleport', '', 'EDIT', 'Edit', 'edit '])('a kind it does not know (%j) is rejected', (kind) => {
    expect(decidePermission(kind, [inside('src/a.ts')], scope(['**']), WORK)).toBe('rejected');
    expect(decidePermission(kind, undefined, undefined, WORK)).toBe('rejected');
  });
});

describe('relativeToWorkdir', () => {
  it('gives a /-separated path inside, and undefined outside', () => {
    expect(relativeToWorkdir(WORK, inside('src/a.ts'))).toBe('src/a.ts');
    expect(relativeToWorkdir(WORK, 'src/a.ts')).toBe('src/a.ts');
    expect(relativeToWorkdir(WORK, WORK)).toBe('');
    expect(relativeToWorkdir(WORK, resolve(tmpdir(), 'other', 'a.ts'))).toBeUndefined();
    expect(relativeToWorkdir(WORK, '../x')).toBeUndefined();
    expect(relativeToWorkdir(WORK, `${WORK}-sibling/a.ts`)).toBeUndefined();
  });
});

describe('selectOption and parseOptions', () => {
  const options = [
    { optionId: 'always', kind: 'allow_always' },
    { optionId: 'yes', kind: 'allow_once' },
    { optionId: 'never', kind: 'reject_always' },
    { optionId: 'no', kind: 'reject_once' },
  ];

  it('picks the once-option that matches the decision, never an always-option', () => {
    expect(selectOption(options, 'allowed')).toBe('yes');
    expect(selectOption(options, 'rejected')).toBe('no');
    expect(
      selectOption(
        [options[0], options[2]].filter((o) => o !== undefined),
        'allowed',
      ),
    ).toBeUndefined();
    expect(
      selectOption(
        [options[0], options[2]].filter((o) => o !== undefined),
        'rejected',
      ),
    ).toBeUndefined();
    expect(selectOption([], 'allowed')).toBeUndefined();
  });

  it('keeps well-formed options and drops everything else', () => {
    expect(
      parseOptions([
        { optionId: 'a', kind: 'allow_once', name: 'Allow' },
        null,
        7,
        'text',
        [],
        {},
        { optionId: 'no-kind' },
        { kind: 'no-id' },
        { optionId: 1, kind: 'allow_once' },
        { optionId: 'x', kind: 5 },
        { optionId: 'b', kind: 'reject_once' },
      ]),
    ).toEqual([
      { optionId: 'a', kind: 'allow_once' },
      { optionId: 'b', kind: 'reject_once' },
    ]);
  });

  it('is empty for anything that is not a list', () => {
    expect(parseOptions(undefined)).toEqual([]);
    expect(parseOptions(null)).toEqual([]);
    expect(parseOptions({ optionId: 'a', kind: 'allow_once' })).toEqual([]);
    expect(parseOptions('allow_once')).toEqual([]);
    expect(parseOptions([])).toEqual([]);
  });
});

describe('AcpFileServer: reading', () => {
  async function server(read: string[] = []): Promise<{ files: AcpFileServer; dir: string }> {
    const dir = await workdir();
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'a.txt'), 'one\ntwo\nthree\nfour');
    await writeFile(join(dir, 'top.txt'), 'top');
    return { files: await AcpFileServer.create(dir, scope(['src/**'], { fsRead: read })), dir };
  }

  it('returns the whole file, or the part asked for with line and limit', async () => {
    const { files, dir } = await server();
    const path = join(dir, 'src', 'a.txt');
    expect(await files.read({ path })).toEqual({ content: 'one\ntwo\nthree\nfour' });
    expect(await files.read({ path, line: 2 })).toEqual({ content: 'two\nthree\nfour' });
    expect(await files.read({ path, limit: 2 })).toEqual({ content: 'one\ntwo' });
    expect(await files.read({ path, line: 2, limit: 2 })).toEqual({ content: 'two\nthree' });
    expect(await files.read({ path, line: 1, limit: 1 })).toEqual({ content: 'one' });
    expect(await files.read({ path, limit: 0 })).toEqual({ content: '' });
  });

  it('ignores a line below 1, a negative limit, and values that are not numbers', async () => {
    const { files, dir } = await server();
    const path = join(dir, 'src', 'a.txt');
    const whole = { content: 'one\ntwo\nthree\nfour' };
    expect(await files.read({ path, line: 0 })).toEqual(whole);
    expect(await files.read({ path, line: -3 })).toEqual(whole);
    expect(await files.read({ path, limit: -1 })).toEqual(whole);
    expect(await files.read({ path, line: '2', limit: '1' })).toEqual(whole);
    expect(await files.read({ path, line: 2.9 })).toEqual({ content: 'two\nthree\nfour' });
  });

  it('refuses with a distinct message for each reason', async () => {
    const { files, dir } = await server(['src/**']);
    const message = async (params: unknown): Promise<string> =>
      await files.read(params).then(
        () => 'no error',
        (e: unknown) => (e as Error).message,
      );
    expect(await message(undefined)).toBe('A file path is required.');
    expect(await message(null)).toBe('A file path is required.');
    expect(await message('src/a.txt')).toBe('A file path is required.');
    expect(await message({})).toBe('A file path is required.');
    expect(await message({ path: '' })).toBe('A file path is required.');
    expect(await message({ path: 42 })).toBe('A file path is required.');
    expect(await message({ path: `/${'a'.repeat(4096)}` })).toBe('A file path is required.');
    expect(await message({ path: 'src/a.txt' })).toBe('The path must be absolute.');
    expect(await message({ path: `${join(dir, 'src', 'a.txt')}\0x` })).toBe('The path must be absolute.');
    expect(await message({ path: resolve(tmpdir(), 'elsewhere.txt') })).toBe(
      'The path is outside the working directory.',
    );
    expect(await message({ path: join(dir, '..', 'x.txt') })).toBe(
      'The path is outside the working directory.',
    );
    expect(await message({ path: join(dir, '.git', 'config') })).toBe(
      'The path is not available to an agent.',
    );
    expect(await message({ path: join(dir, '.INDABA', 'x') })).toBe('The path is not available to an agent.');
    expect(await message({ path: join(dir, 'top.txt') })).toBe(
      'Reading this path is outside the step scope.',
    );
    expect(await message({ path: join(dir, 'src', 'missing.txt') })).toBe('The file cannot be read.');
    expect(await message({ path: join(dir, 'src') })).toBe('The file cannot be read.');
  });

  it('accepts a path of exactly the longest allowed length and refuses one longer', async () => {
    const { files, dir } = await server();
    const pad = (n: number): string => join(dir, 'x'.repeat(n));
    const exact = pad(4096 - dir.length - 1);
    expect(exact.length).toBe(4096);
    const refused = await files.read({ path: exact }).catch((e: unknown) => (e as Error).message);
    expect(refused).toBe('The file cannot be read.'); // got past the length check
    const tooLong = await files.read({ path: `${exact}x` }).catch((e: unknown) => (e as Error).message);
    expect(tooLong).toBe('A file path is required.');
  });

  it('serves a file of exactly the size limit and refuses one byte more', async () => {
    const { files, dir } = await server();
    const limit = 10 * 1024 * 1024;
    await writeFile(join(dir, 'src', 'big.txt'), 'x'.repeat(limit));
    await writeFile(join(dir, 'src', 'bigger.txt'), 'x'.repeat(limit + 1));
    expect((await files.read({ path: join(dir, 'src', 'big.txt') })).content.length).toBe(limit);
    await expect(files.read({ path: join(dir, 'src', 'bigger.txt') })).rejects.toThrow(
      'The file is too large.',
    );
  });

  it('refuses a path that leads outside through a link, with its own message', async () => {
    const { files, dir } = await server();
    const outside = await workdir();
    await writeFile(join(outside, 'target.txt'), 'secret');
    try {
      await symlink(outside, join(dir, 'src', 'link'), 'junction');
    } catch {
      return; // a platform or account that cannot create links
    }
    await expect(files.read({ path: join(dir, 'src', 'link', 'target.txt') })).rejects.toThrow(
      'The path leads outside the working directory.',
    );
  });
});

describe('AcpFileServer: writing', () => {
  async function server(write: string[] = ['src/**']): Promise<{ files: AcpFileServer; dir: string }> {
    const dir = await workdir();
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'a.txt'), 'old');
    return { files: await AcpFileServer.create(dir, scope(write)), dir };
  }

  it('writes a new file, creating the folders, and overwrites an existing one', async () => {
    const { files, dir } = await server();
    expect(await files.write({ path: join(dir, 'src', 'deep', 'er', 'n.txt'), content: 'new' })).toBeNull();
    expect(await readFile(join(dir, 'src', 'deep', 'er', 'n.txt'), 'utf8')).toBe('new');
    await files.write({ path: join(dir, 'src', 'a.txt'), content: 'replaced' });
    expect(await readFile(join(dir, 'src', 'a.txt'), 'utf8')).toBe('replaced');
    await files.write({ path: join(dir, 'src', 'empty.txt'), content: '' });
    expect(await readFile(join(dir, 'src', 'empty.txt'), 'utf8')).toBe('');
  });

  it('refuses with a distinct message for each reason, and writes nothing', async () => {
    const { files, dir } = await server();
    const message = async (params: unknown): Promise<string> =>
      await files.write(params).then(
        () => 'no error',
        (e: unknown) => (e as Error).message,
      );
    expect(await message(undefined)).toBe('A file path is required.');
    expect(await message({ content: 'x' })).toBe('A file path is required.');
    expect(await message({ path: join(dir, 'src', 'n.txt') })).toBe('The content is missing or too large.');
    expect(await message({ path: join(dir, 'src', 'n.txt'), content: 7 })).toBe(
      'The content is missing or too large.',
    );
    expect(await message({ path: join(dir, 'src', 'n.txt'), content: null })).toBe(
      'The content is missing or too large.',
    );
    expect(await message({ path: join(dir, 'top.txt'), content: 'x' })).toBe(
      'Writing this path is outside the step scope.',
    );
    expect(await message({ path: join(dir, '.git', 'hooks', 'pre-commit'), content: 'x' })).toBe(
      'The path is not available to an agent.',
    );
    expect(await message({ path: resolve(tmpdir(), 'elsewhere.txt'), content: 'x' })).toBe(
      'The path is outside the working directory.',
    );
    await expect(readFile(join(dir, 'top.txt'), 'utf8')).rejects.toThrow();
  });

  it('writes content of exactly the size limit and refuses one byte more', async () => {
    const { files, dir } = await server();
    const limit = 10 * 1024 * 1024;
    await files.write({ path: join(dir, 'src', 'big.txt'), content: 'x'.repeat(limit) });
    expect((await readFile(join(dir, 'src', 'big.txt'), 'utf8')).length).toBe(limit);
    await expect(
      files.write({ path: join(dir, 'src', 'bigger.txt'), content: 'x'.repeat(limit + 1) }),
    ).rejects.toThrow('The content is missing or too large.');
    await expect(readFile(join(dir, 'src', 'bigger.txt'), 'utf8')).rejects.toThrow();
  });

  it('counts the size in bytes, not characters', async () => {
    const { files, dir } = await server();
    const limit = 10 * 1024 * 1024;
    await expect(
      files.write({ path: join(dir, 'src', 'wide.txt'), content: 'é'.repeat(limit / 2 + 1) }),
    ).rejects.toThrow('The content is missing or too large.');
  });

  it('refuses to write through a symbolic link, leaving its target alone', async () => {
    const { files, dir } = await server();
    const target = join(dir, 'src', 'target.txt');
    await writeFile(target, 'untouched');
    try {
      await symlink(target, join(dir, 'src', 'link.txt'), 'file');
    } catch {
      return; // a platform or account that cannot create links
    }
    await expect(files.write({ path: join(dir, 'src', 'link.txt'), content: 'x' })).rejects.toThrow(
      'The path is a symbolic link.',
    );
    expect(await readFile(target, 'utf8')).toBe('untouched');
  });

  it('allows nothing when there are no write globs', async () => {
    const { files, dir } = await server([]);
    await expect(files.write({ path: join(dir, 'src', 'a.txt'), content: 'x' })).rejects.toThrow(
      'Writing this path is outside the step scope.',
    );
    expect(await readFile(join(dir, 'src', 'a.txt'), 'utf8')).toBe('old');
  });
});
