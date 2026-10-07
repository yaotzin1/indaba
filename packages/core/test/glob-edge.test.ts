import { describe, expect, it } from 'vitest';
import { matchesAny, matchesGlob } from '../src/index.js';

describe('matchesGlob: path normalisation', () => {
  it.each([
    ['./src/a.ts', 'src/a.ts'],
    ['././src/a.ts', 'src/a.ts'],
    ['src/./a.ts', 'src/a.ts'],
    ['src//a.ts', 'src/a.ts'],
    ['/src/a.ts', 'src/a.ts'],
    ['src/a.ts/', 'src/a.ts'],
  ])('%s is the same path as %s', (written, plain) => {
    expect(matchesGlob(plain, written)).toBe(true);
    expect(matchesGlob(written, plain)).toBe(true);
  });

  it('treats backslashes as separators in the pattern and in the path', () => {
    expect(matchesGlob('src\\sub\\*.ts', 'src/sub/a.ts')).toBe(true);
    expect(matchesGlob('src/sub/*.ts', 'src\\sub\\a.ts')).toBe(true);
    expect(matchesGlob('src\\sub\\*.ts', 'src\\sub\\deeper\\a.ts')).toBe(false);
  });

  it('an empty path matches only a pattern that can match nothing', () => {
    expect(matchesGlob('**', '')).toBe(true);
    expect(matchesGlob('', '')).toBe(true);
    expect(matchesGlob('a', '')).toBe(false);
    expect(matchesGlob('*', '')).toBe(false);
  });
});

describe('matchesGlob: one segment', () => {
  it.each([
    ['abc', 'abc', true],
    ['abc', 'ab', false],
    ['ab', 'abc', false],
    ['abc', 'abd', false],
    ['?', 'a', true],
    ['?', '', false],
    ['?', 'ab', false],
    ['a?c', 'abc', true],
    ['a?c', 'ac', false],
    ['*', 'anything', true],
    ['a*', 'a', true],
    ['a*', 'abc', true],
    ['a*', 'ba', false],
    ['*a', 'a', true],
    ['*a', 'bca', true],
    ['*a', 'ab', false],
    ['a*b', 'ab', true],
    ['a*b', 'axxb', true],
    ['a*b', 'ba', false],
    ['a*b', 'abc', false],
    ['*ab*', 'xabx', true],
    ['*ab*', 'xaxb', false],
    ['*a*b*c*', 'xaxbxcx', true],
    ['*a*b*c*', 'xcxbxax', false],
    ['a**', 'a', true],
    ['a**', 'abc', true],
    ['**a', 'xa', true], // a `**` that is not a whole segment is two stars
    ['**a', 'x/a', false], // ... and stays inside one segment
    ['*.*', 'a.b', true],
    ['*.*', 'ab', false],
    ['a*a*a', 'aaa', true],
    ['a*a*a', 'aa', false],
    ['*?', 'a', true],
    ['*?', '', false],
    ['?*', 'abc', true],
  ])('%s against %s is %s', (pattern, text, expected) => {
    expect(matchesGlob(pattern, text)).toBe(expected);
  });

  it('needs the pattern to be used up as well as the text', () => {
    expect(matchesGlob('abc*d', 'abc')).toBe(false);
    expect(matchesGlob('abc*', 'abc')).toBe(true);
    expect(matchesGlob('abc?', 'abc')).toBe(false);
  });

  it('restarts after a failed attempt at the last star', () => {
    expect(matchesGlob('*abab', 'ababab')).toBe(true);
    expect(matchesGlob('*aab', 'aaab')).toBe(true);
    expect(matchesGlob('*aab', 'aaba')).toBe(false);
    expect(matchesGlob('a*ab', 'aab')).toBe(true);
    expect(matchesGlob('a*ab', 'ab')).toBe(false);
  });
});

describe('matchesGlob: ** across segments', () => {
  it.each([
    ['**', 'a', true],
    ['**', 'a/b/c', true],
    ['a/**', 'a', true],
    ['a/**', 'a/b', true],
    ['a/**', 'a/b/c', true],
    ['a/**', 'b/a', false],
    ['**/a', 'a', true],
    ['**/a', 'x/a', true],
    ['**/a', 'x/y/a', true],
    ['**/a', 'a/x', false],
    ['a/**/b', 'a/b', true],
    ['a/**/b', 'a/x/b', true],
    ['a/**/b', 'a/x/y/b', true],
    ['a/**/b', 'a/x/y', false],
    ['a/**/b', 'x/a/b', false],
    ['**/x/**/y', 'x/y', true],
    ['**/x/**/y', 'a/x/b/y', true],
    ['**/x/**/y', 'x/a/x/y', true],
    ['**/x/**/y', 'a/y', false],
    ['**/x/**/y', 'x/y/z', false],
    ['**/**', 'a/b', true],
    ['**/a/**', 'x/a/y', true],
    ['**/a/**', 'x/b/y', false],
    ['a/**/**/b', 'a/b', true],
    ['a', 'a/b', false],
    ['a/b', 'a', false],
    ['a/*', 'a/b/c', false],
    ['a/*', 'a', false],
    ['*/*', 'a/b', true],
    ['*/*', 'a', false],
  ])('%s against %s is %s', (pattern, path, expected) => {
    expect(matchesGlob(pattern, path)).toBe(expected);
  });

  it('finds a match after a wrong first guess for each **', () => {
    expect(matchesGlob('**/b/**/b', 'b/a/b/b')).toBe(true);
    expect(matchesGlob('**/b/**/c', 'b/b/b/b/c')).toBe(true);
    expect(matchesGlob('**/b/**/c', 'b/b/b/b')).toBe(false);
  });

  it('is not fooled by two different positions that would share a cache slot', () => {
    // pi * (n + 1) + si collides if either factor is computed wrongly; these walk many (pi, si) pairs
    const path = 'a/b/a/b/a/b/a/b';
    expect(matchesGlob('**/a/**/b/**/a/**/b', path)).toBe(true);
    expect(matchesGlob('**/b/**/b/**/b/**/b/**/b', path)).toBe(false);
    expect(matchesGlob('**/a/**/a/**/a/**/b', path)).toBe(true);
    expect(matchesGlob('**/a/**/a/**/a/**/a/**/b', path)).toBe(true);
    expect(matchesGlob('**/a/**/a/**/a/**/a/**/a/**/b', path)).toBe(false);
    expect(matchesGlob('**/a/**/a/**/a/**/a', path)).toBe(false);
  });
});

describe('matchesGlob: limits and traversal', () => {
  it('accepts a pattern or a path of exactly the longest length, and refuses one longer', () => {
    const p1024 = 'a'.repeat(1024);
    const p1025 = 'a'.repeat(1025);
    expect(matchesGlob(p1024, p1024)).toBe(true);
    expect(matchesGlob(p1025, p1025)).toBe(false);
    expect(matchesGlob('**', p1024)).toBe(true);
    expect(matchesGlob('**', p1025)).toBe(false);
    expect(matchesGlob(p1025, p1024)).toBe(false);
  });

  it('never matches a path that climbs out, however the pattern is written', () => {
    expect(matchesGlob('**', 'a/../b')).toBe(false);
    expect(matchesGlob('*/*', 'a/..')).toBe(false);
    expect(matchesGlob('..', '..')).toBe(false);
    expect(matchesGlob('**', '..\\x')).toBe(false);
    expect(matchesGlob('**', 'a..b')).toBe(true); // a segment that merely contains dots is fine
    expect(matchesGlob('**', '...')).toBe(true);
  });

  it('is case sensitive and does not special-case a dot at the start of a name', () => {
    expect(matchesGlob('src/**', 'SRC/a')).toBe(false);
    expect(matchesGlob('*', '.hidden')).toBe(true);
    expect(matchesGlob('**/*.ts', 'a/.b.ts')).toBe(true);
  });

  it('matchesAny is true when any pattern matches, and false for none', () => {
    expect(matchesAny(['x/**', 'src/**'], 'src/a.ts')).toBe(true);
    expect(matchesAny(['x/**', 'y/**'], 'src/a.ts')).toBe(false);
    expect(matchesAny([], 'src/a.ts')).toBe(false);
  });
});
