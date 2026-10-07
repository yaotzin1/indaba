import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GuardType } from '@indaba/core';
import { describe, expect, it } from 'vitest';
import { DiffWithinScopeGuard, Git } from '../src/index.js';
import { makeGitRepo } from './support.js';

const IDENTITY = [
  '-c',
  'user.name=Indaba Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
];
const git = new Git();
const guard = new DiffWithinScopeGuard();
const definition = (paths: string[]): { type: string; paths: string[] } => ({
  type: GuardType.DiffWithinScope,
  paths,
});
const NUL = String.fromCharCode(0);

/** A repo with src/app.txt (from the helper) and, committed too, top.txt and docs/guide.md. */
async function project(): Promise<string> {
  const repo = await makeGitRepo();
  await writeFile(join(repo, 'top.txt'), 'top\n');
  await mkdir(join(repo, 'docs'), { recursive: true });
  await writeFile(join(repo, 'docs', 'guide.md'), 'guide\n');
  await git.run(['add', '-A'], repo);
  await git.run([...IDENTITY, 'commit', '-q', '-m', 'more files'], repo);
  return repo;
}

/** A Git that returns canned output, so every shape of status line can be fed to the guard. */
class FakeGit extends Git {
  constructor(
    private readonly status: string,
    private readonly prefix = '',
  ) {
    super();
  }

  override async run(args: readonly string[]): Promise<string> {
    return args[0] === 'rev-parse'
      ? `${this.prefix}
`
      : this.status;
  }
}

/** What the guard reports as outside an empty scope: every changed path that is not Indaba's own. */
async function reported(status: string, prefix = ''): Promise<string[]> {
  const verdict = await new DiffWithinScopeGuard(new FakeGit(status, prefix)).check(definition([]), '.');
  if (verdict.passed) {
    return [];
  }
  return (verdict.message ?? '').split('\n').slice(1);
}

describe('how the guard reads git status', () => {
  it('reads every NUL-separated entry as the path after the two status letters and a space', async () => {
    expect(await reported(` M src/a.ts${NUL}?? new file.txt${NUL}A  b.ts${NUL}`)).toEqual([
      'src/a.ts',
      'new file.txt',
      'b.ts',
    ]);
    expect(await reported('')).toEqual([]);
    expect(await reported(NUL)).toEqual([]);
  });

  it.each([
    ['a rename in the index', `R  new.ts${NUL}old.ts${NUL}`],
    ['a copy in the index', `C  new.ts${NUL}old.ts${NUL}`],
    ['a rename in the working tree', ` R new.ts${NUL}old.ts${NUL}`],
    ['a copy in the working tree', ` C new.ts${NUL}old.ts${NUL}`],
    ['a rename with a change on top', `RM new.ts${NUL}old.ts${NUL}`],
  ])('reports both the new and the original path for %s', async (_label, status) => {
    expect(await reported(status)).toEqual(['new.ts', 'old.ts']);
  });

  it('does not take the entry after a plain change for an original path', async () => {
    expect(await reported(` M a.ts${NUL} M b.ts${NUL}`)).toEqual(['a.ts', 'b.ts']);
    expect(await reported(`A  a.ts${NUL}D  b.ts${NUL}?? c.ts${NUL}`)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('reads on correctly after a rename', async () => {
    expect(await reported(`R  new.ts${NUL}old.ts${NUL} M other.ts${NUL}`)).toEqual([
      'new.ts',
      'old.ts',
      'other.ts',
    ]);
  });

  it('survives a rename entry whose original path is missing', async () => {
    expect(await reported(`R  new.ts${NUL}`)).toEqual(['new.ts', '']);
  });

  it("exempts Indaba's runtime folder and what is inside it, and nothing that only looks like it", async () => {
    const status = [
      ' M .indaba',
      '?? .indaba/artifacts/spec.md',
      '?? .indaba/',
      '?? .indabax',
      '?? .indabax/y',
      '?? x/.indaba/y',
      '?? indaba/y',
    ]
      .map((entry) => `${entry}${NUL}`)
      .join('');
    expect(await reported(status)).toEqual(['.indabax', '.indabax/y', 'x/.indaba/y', 'indaba/y']);
  });

  it('strips the working-directory prefix, and reports a path outside it as such', async () => {
    const status = ` M src/a.ts${NUL} M srcx/b.ts${NUL} M top.txt${NUL}`;
    expect(await reported(status, 'src/')).toEqual([
      'a.ts',
      '(outside the working directory)',
      '(outside the working directory)',
    ]);
  });
});

describe('DiffWithinScopeGuard in a real repository', () => {
  it('fails a rename out of the scope, naming where it went', async () => {
    const repo = await project();
    await git.run(['mv', 'src/app.txt', 'moved.txt'], repo);
    const verdict = await guard.check(definition(['src/**']), repo);
    expect(verdict.passed).toBe(false);
    expect(verdict.message).toContain('moved.txt');
  });

  it('fails a rename INTO the scope when the original was outside it', async () => {
    const repo = await project();
    await git.run(['mv', 'top.txt', 'src/top.txt'], repo);
    const verdict = await guard.check(definition(['src/**']), repo);
    expect(verdict.passed).toBe(false);
    expect(verdict.message).toContain('top.txt');
  });

  it('passes a rename inside the scope', async () => {
    const repo = await project();
    await git.run(['mv', 'src/app.txt', 'src/renamed.txt'], repo);
    expect((await guard.check(definition(['src/**']), repo)).passed).toBe(true);
  });

  it('passes a deletion inside the scope and fails one outside it', async () => {
    const repo = await project();
    await rm(join(repo, 'src', 'app.txt'));
    expect((await guard.check(definition(['src/**']), repo)).passed).toBe(true);
    await rm(join(repo, 'top.txt'));
    const verdict = await guard.check(definition(['src/**']), repo);
    expect(verdict.passed).toBe(false);
    expect(verdict.message).toContain('top.txt');
  });

  it('says what is allowed and lists every path outside it, one per line', async () => {
    const repo = await project();
    await writeFile(join(repo, 'top.txt'), 'changed\n');
    await writeFile(join(repo, 'docs', 'guide.md'), 'changed\n');
    await writeFile(join(repo, 'src', 'app.txt'), 'changed\n');
    const verdict = await guard.check(definition(['src/**', 'extra/**']), repo);
    expect(verdict.passed).toBe(false);
    expect(verdict.message).toBe(
      ['Changes outside the allowed scope (src/**, extra/**):', 'docs/guide.md', 'top.txt'].join('\n'),
    );
  });

  it('says that nothing is allowed for an empty list', async () => {
    const repo = await project();
    await writeFile(join(repo, 'src', 'app.txt'), 'changed\n');
    const verdict = await guard.check(definition([]), repo);
    expect(verdict.message).toBe('Changes outside the allowed scope (nothing):\nsrc/app.txt');
  });

  it("exempts Indaba's runtime folder and nothing that merely looks like it", async () => {
    const repo = await project();
    await mkdir(join(repo, '.indaba', 'artifacts'), { recursive: true });
    await writeFile(join(repo, '.indaba', 'artifacts', 'x.md'), 'x');
    expect((await guard.check(definition([]), repo)).passed).toBe(true);
    await mkdir(join(repo, '.indabax'), { recursive: true });
    await writeFile(join(repo, '.indabax', 'y.md'), 'y');
    const verdict = await guard.check(definition([]), repo);
    expect(verdict.passed).toBe(false);
    expect(verdict.message).toContain('.indabax/y.md');
  });

  it('measures paths from the working directory when it is a subdirectory', async () => {
    const repo = await project();
    await writeFile(join(repo, 'src', 'app.txt'), 'changed\n');
    await writeFile(join(repo, 'src', 'new.txt'), 'new\n');
    const inSrc = join(repo, 'src');
    expect((await guard.check(definition(['*.txt']), inSrc)).passed).toBe(true);
    const narrow = await guard.check(definition(['new.txt']), inSrc);
    expect(narrow.passed).toBe(false);
    expect(narrow.message).toContain('app.txt');
    expect(narrow.message).not.toContain('src/app.txt');
  });

  it('reports a change outside the working directory as such, and not as a path', async () => {
    const repo = await project();
    await writeFile(join(repo, 'src', 'app.txt'), 'changed\n');
    await writeFile(join(repo, 'top.txt'), 'changed\n');
    const verdict = await guard.check(definition(['**']), join(repo, 'src'));
    expect(verdict.passed).toBe(false);
    expect(verdict.message).toBe('Changes outside the allowed scope (**):\n(outside the working directory)');
  });

  it('does not take a sibling folder that shares a name prefix for the working directory', async () => {
    const repo = await project();
    await mkdir(join(repo, 'srcx'), { recursive: true });
    await writeFile(join(repo, 'srcx', 'a.txt'), 'a\n');
    const verdict = await guard.check(definition(['**']), join(repo, 'src'));
    expect(verdict.passed).toBe(false);
    expect(verdict.message).toContain('(outside the working directory)');
  });

  it('fails closed, with the reason, when git cannot be read', async () => {
    const repo = await project();
    await rename(join(repo, '.git'), join(repo, '.git-moved'));
    const verdict = await guard.check(definition(['**']), repo);
    expect(verdict.passed).toBe(false);
    expect(verdict.message).toMatch(/^Cannot inspect git state: /);
  });
});
