import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));

const files = readdirSync(srcDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, text: readFileSync(join(srcDir, name), 'utf8') }));

const others = (allowed: readonly string[]) => files.filter((f) => !allowed.includes(basename(f.name)));

describe('cli layering', () => {
  it('finds the sources', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('reads the process and the environment only in main, bin and the factory', () => {
    const offenders = others(['main.ts', 'bin.ts', 'engine-factory.ts']).filter((f) =>
      /\bprocess\b|\bgetenv\b|\.env\b|\benv\./.test(f.text),
    );
    expect(offenders.map((f) => f.name)).toEqual([]);
  });

  it('touches the real process only in main (default io) and bin', () => {
    const offenders = others(['main.ts', 'bin.ts']).filter((f) => /\bprocess\./.test(f.text));
    expect(offenders.map((f) => f.name)).toEqual([]);
  });

  it('names no concrete runner class anywhere', () => {
    const concrete = /\b(Shell|Claude|Codex|Cursor|Antigravity|OpenRouter|Command|AbstractCli)Runner\b/;
    expect(files.filter((f) => concrete.test(f.text)).map((f) => f.name)).toEqual([]);
  });

  it('writes through io: no console and no direct stdout', () => {
    const offenders = files.filter((f) => /\bconsole\.|process\.(stdout|stderr)\.write/.test(f.text));
    expect(offenders.map((f) => f.name)).toEqual([]);
  });

  it('imports only node:, the workspace packages and its own files', () => {
    const specifiers = files.flatMap((f) =>
      [...f.text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? ''),
    );
    const allowed = (s: string): boolean =>
      s.startsWith('./') || s.startsWith('node:') || /^@indaba\/(core|engine|runners)$/.test(s);
    expect(specifiers.filter((s) => !allowed(s))).toEqual([]);
  });
});
