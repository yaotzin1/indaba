import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultPageDirectory } from '../src/index.js';

const here = join('base', 'server');

describe('defaultPageDirectory', () => {
  it('prefers the page the package carries', () => {
    const present = new Set([
      join(here, 'page', 'index.html'),
      join(here, '..', 'web', 'dist', 'index.html'),
    ]);
    expect(defaultPageDirectory(here, (path) => present.has(path))).toBe(join(here, 'page'));
  });

  it('falls back to the build of the web package in a checkout', () => {
    const present = new Set([join(here, '..', 'web', 'dist', 'index.html')]);
    expect(defaultPageDirectory(here, (path) => present.has(path))).toBe(join(here, '..', 'web', 'dist'));
  });

  it('says so when the page has not been built', () => {
    expect(defaultPageDirectory(here, () => false)).toBeUndefined();
  });

  it('looks in the real checkout without throwing', () => {
    expect(() => defaultPageDirectory()).not.toThrow();
  });
});
