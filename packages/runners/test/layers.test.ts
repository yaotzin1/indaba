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

describe('runners boundary', () => {
  const files = sourceFiles(srcDir);

  it('finds the sources', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('imports only relative files, node:* and @indaba/core', () => {
    for (const file of files) {
      for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
        const allowed =
          specifier.startsWith('./') || specifier.startsWith('node:') || specifier === '@indaba/core';
        expect(allowed, `${file} imports ${specifier}`).toBe(true);
      }
    }
  });

  it('never reaches the engine or the cli', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/@indaba\/engine|from\s+['"]indaba['"]/);
    }
  });

  it('loads node-pty only lazily, by name, never as a static import', () => {
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/^\s*import[^;]*['"]node-pty['"]/m);
    }
  });
});
