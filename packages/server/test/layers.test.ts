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

const importsOf = (name: string): { file: string; specifier: string }[] =>
  sourceFiles(srcOf(name)).flatMap((file) =>
    importSpecifiers(readFileSync(file, 'utf8')).map((specifier) => ({
      file: relative(srcOf(name), file).split(sep).join('/'),
      specifier,
    })),
  );

describe('server layering', () => {
  const imports = importsOf('server');

  it('finds the sources', () => {
    expect(sourceFiles(srcOf('server')).length).toBeGreaterThan(3);
  });

  it('imports only its own files, node:*, @indaba/core and @indaba/engine', () => {
    const offenders = imports.filter(
      (i) =>
        !(
          i.specifier.startsWith('./') ||
          i.specifier.startsWith('node:') ||
          i.specifier === '@indaba/core' ||
          i.specifier === '@indaba/engine'
        ),
    );
    expect(offenders).toEqual([]);
  });

  it('imports no UI package, no runner and not the command line', () => {
    const offenders = imports.filter((i) =>
      /^(react|react-dom|ink|@mui|@xyflow|@indaba\/web|@indaba\/tui|@indaba\/runners|indaba)(\/|$)/.test(
        i.specifier,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('logs through the injected Logger: no console and no direct stdout or stderr (specs/logging, AC-03)', () => {
    const offenders = sourceFiles(srcOf('server')).filter((file) =>
      /\bconsole\.|process\.(stdout|stderr)\.write/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('writes nothing and starts nothing: no file write, no process, no environment', () => {
    for (const file of sourceFiles(srcOf('server'))) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/\b(writeFile|appendFile|unlink|rm|rename|mkdir|spawn|exec|fork)\s*\(/);
      expect(text, file).not.toMatch(/\bprocess\.env\b|child_process/);
    }
  });

  it.each(['core', 'engine', 'runners', 'tui'])('is not imported by %s', (name) => {
    const offenders = importsOf(name).filter((i) => i.specifier.startsWith('@indaba/server'));
    expect(offenders).toEqual([]);
  });
});
