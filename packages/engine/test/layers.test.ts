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

describe('engine layering', () => {
  const files = sourceFiles(srcDir);
  const specifiers = files.flatMap((file) =>
    importSpecifiers(readFileSync(file, 'utf8')).map((specifier) => ({ file, specifier })),
  );

  it('finds the sources', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports only relative files, node:*, yaml and @indaba/core', () => {
    const allowed = (s: string): boolean =>
      s.startsWith('./') ||
      s.startsWith('../') ||
      s.startsWith('node:') ||
      s === 'yaml' ||
      s === '@indaba/core';
    expect(specifiers.filter(({ specifier }) => !allowed(specifier))).toEqual([]);
  });

  it('never reaches the runners or the cli', () => {
    expect(
      specifiers.filter(({ specifier }) => /@indaba\/runners|indaba\/cli|^indaba$/.test(specifier)),
    ).toEqual([]);
  });

  it('uses .js extensions in relative imports', () => {
    expect(
      specifiers.filter(({ specifier }) => specifier.startsWith('.') && !specifier.endsWith('.js')),
    ).toEqual([]);
  });

  it('keeps the engine decision code free of clock, randomness and environment', () => {
    const edges = ['git.ts', 'system.ts', 'jsonl-span-exporter.ts'];
    const banned = [/Date\.now\(/, /new Date\(\s*\)/, /Math\.random\(/, /process\.env/, /randomBytes/];
    const offenders = files
      .filter((file) => !edges.some((edge) => file.endsWith(edge)))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return banned.filter((pattern) => pattern.test(source)).map((pattern) => `${file}: ${pattern}`);
      });
    expect(offenders).toEqual([]);
  });

  it('never enables a shell', () => {
    const offenders = files.filter((file) =>
      /shell\s*:\s*true|\bexec(Sync)?\(/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
