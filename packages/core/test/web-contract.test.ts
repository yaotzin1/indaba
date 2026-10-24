import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('../src/web-contract', import.meta.url));
const files = readdirSync(dir).filter((name) => name.endsWith('.ts'));

/** Lines of code, with the comments dropped. */
function code(name: string): string {
  return readFileSync(join(dir, name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('the web contract', () => {
  it('finds its sources', () => {
    expect(files).toEqual(['api.ts', 'index.ts', 'registry.ts', 'run.ts']);
  });

  it.each(files)('%s declares types only: no value, no function, no class', (name) => {
    expect(code(name)).not.toMatch(/\bexport\s+(const|let|var|function|class|enum|default)\b/);
  });

  it.each(files)('%s imports only types, and only from its own folder', (name) => {
    const specifiers = [...code(name).matchAll(/\bimport\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/g)];
    for (const match of specifiers) {
      expect(match[0]).toMatch(/^import type\b/);
      expect(match[1]).toMatch(/^\.\//);
    }
  });

  it('exports every shape through the index as a type', () => {
    const index = code('index.ts');
    expect(index).not.toMatch(/\bexport\s+\{/);
    expect(index.match(/\bexport type\b/g)?.length).toBe(3);
  });
});
