import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = (name: string): string => fileURLToPath(new URL(`../src/${name}`, import.meta.url));

/** The files of Home that decide what is shown: they take state in and give a screen out, and touch nothing else. */
const PURE = ['keymap.ts', 'home-state.ts', 'home-screen.ts'];

function specifiers(text: string): string[] {
  return [...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
}

describe('the pure files of Home (specs/tui-home, T-04)', () => {
  it.each(PURE)('%s imports neither Ink, React nor a node: module', (name) => {
    for (const specifier of specifiers(readFileSync(src(name), 'utf8'))) {
      expect(specifier).not.toMatch(/^(node:|ink|react)/);
      expect(specifier.startsWith('./') || specifier === '@indaba/engine').toBe(true);
    }
  });

  it.each(PURE)('%s reads no clock, no environment and writes nothing', (name) => {
    const text = readFileSync(src(name), 'utf8');
    expect(text).not.toMatch(/Date\.now|new Date\(|Math\.random|process\.|console\./);
  });

  it('the Ink binding of Home reaches Ink only through the adapter', () => {
    for (const name of ['ink/home-app.ts', 'home.ts']) {
      for (const specifier of specifiers(readFileSync(src(name), 'utf8'))) {
        expect(specifier).not.toMatch(/^(ink|react)/);
      }
    }
  });
});
