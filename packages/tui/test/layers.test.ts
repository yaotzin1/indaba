import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packagesDir = fileURLToPath(new URL('../..', import.meta.url));
const srcOf = (name: string): string => join(packagesDir, name, 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function importSpecifiers(source: string): string[] {
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((m) => m[1] ?? ''));
}

const isUi = (s: string): boolean =>
  s === 'ink' || s === 'react' || s.startsWith('ink/') || s.startsWith('react/');

describe('tui layering', () => {
  const tuiFiles = sourceFiles(srcOf('tui'));
  const imports = tuiFiles.flatMap((file) =>
    importSpecifiers(readFileSync(file, 'utf8')).map((specifier) => ({
      file: relative(srcOf('tui'), file).split(sep).join('/'),
      specifier,
    })),
  );

  it('finds the sources', () => {
    expect(tuiFiles.length).toBeGreaterThan(0);
  });

  it('imports ink and react in one file only, the adapter', () => {
    const files = new Set(imports.filter((i) => isUi(i.specifier)).map((i) => i.file));
    expect([...files]).toEqual(['ink/adapter.ts']);
  });

  it('imports only itself, @indaba/engine, and (in the adapter) ink and react', () => {
    const offenders = imports.filter(
      (i) =>
        !(
          i.specifier.startsWith('./') ||
          i.specifier.startsWith('../') ||
          i.specifier === '@indaba/engine' ||
          (i.file === 'ink/adapter.ts' && isUi(i.specifier))
        ),
    );
    expect(offenders).toEqual([]);
  });

  it.each(['core', 'engine', 'runners', 'cli'])('is not reached by a static import from %s', (name) => {
    const offenders = sourceFiles(srcOf(name))
      .flatMap((file) =>
        importSpecifiers(readFileSync(file, 'utf8')).map((specifier) => ({ file, specifier })),
      )
      .filter((i) => isUi(i.specifier) || i.specifier.startsWith('@indaba/tui'))
      .filter((i) => !(name === 'cli' && i.specifier === '@indaba/tui'));
    expect(offenders).toEqual([]);
  });
});
