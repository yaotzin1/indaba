import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));

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

describe('core boundary', () => {
  const files = sourceFiles(srcDir);

  it('finds the sources', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports only relative modules: no node: builtins, no packages', () => {
    const offenders = files.flatMap((file) =>
      importSpecifiers(readFileSync(file, 'utf8'))
        .filter((specifier) => !specifier.startsWith('./') && !specifier.startsWith('../'))
        .map((specifier) => `${file}: ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it('uses .js extensions in relative imports', () => {
    const offenders = files.flatMap((file) =>
      importSpecifiers(readFileSync(file, 'utf8'))
        .filter((specifier) => specifier.startsWith('.') && !specifier.endsWith('.js'))
        .map((specifier) => `${file}: ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it('reads no clock, randomness or environment in decision logic', () => {
    const banned = [/Date\.now\(/, /new Date\(\s*\)/, /Math\.random\(/, /process\.env/];
    const offenders = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return banned.filter((pattern) => pattern.test(source)).map((pattern) => `${file}: ${pattern}`);
    });
    expect(offenders).toEqual([]);
  });
});
