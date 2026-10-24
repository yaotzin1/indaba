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
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
  });
}

interface Import {
  readonly file: string;
  readonly specifier: string;
  /** The whole statement, to tell `import type` from a value import. */
  readonly statement: string;
}

function importsOf(name: string): Import[] {
  return sourceFiles(srcOf(name)).flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    const statements = [
      ...text.matchAll(/\bimport\s+[^;]*?\bfrom\s+['"]([^'"]+)['"]/g),
      ...text.matchAll(/\bimport\s+['"]([^'"]+)['"]/g),
      ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...text.matchAll(/\bexport\s+[^;]*?\bfrom\s+['"]([^'"]+)['"]/g),
    ];
    return statements.map((m) => ({
      file: relative(srcOf(name), file).split(sep).join('/'),
      specifier: m[1] ?? '',
      statement: m[0],
    }));
  });
}

/** What the page may load: its own files, the UI libraries it bundles, and its fonts and stylesheets. */
const ALLOWED = [
  /^\.\.?\//,
  /^react$/,
  /^react-dom\/client$/,
  /^apsw-gridwright\/react$/,
  /^apsw-gridwright\/styles\.css$/,
  /^@xyflow\/react$/,
  /^@xyflow\/react\/dist\/base\.css$/,
  /^@dagrejs\/dagre$/,
  /^@fontsource\/atkinson-hyperlegible-(next|mono)\/\d{3}\.css$/,
];

describe('web layering (AC-01)', () => {
  const imports = importsOf('web');

  it('finds the sources', () => {
    expect(sourceFiles(srcOf('web')).length).toBeGreaterThan(8);
  });

  it('imports only its own files and the libraries it bundles', () => {
    const offenders = imports.filter(
      (i) => i.specifier !== '@indaba/core' && !ALLOWED.some((pattern) => pattern.test(i.specifier)),
    );
    expect(offenders).toEqual([]);
  });

  it('takes nothing but types from @indaba/core, so no Node code reaches the browser', () => {
    const offenders = imports.filter(
      (i) => i.specifier === '@indaba/core' && !/^import\s+type\b/.test(i.statement),
    );
    expect(offenders).toEqual([]);
  });

  it('imports no node: module, no other Indaba package, and not MUI', () => {
    const offenders = imports.filter((i) =>
      /^(node:|@indaba\/(?!core$)|indaba$|@mui|ink$)/.test(i.specifier),
    );
    expect(offenders).toEqual([]);
  });

  it('renders text as text: no HTML sink and nothing that runs a string (AC-16)', () => {
    for (const file of sourceFiles(srcOf('web'))) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(
        /dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write/,
      );
      expect(text, file).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|\bsetTimeout\s*\(\s*['"`]/);
      expect(text, file).not.toMatch(/\bnew\s+EventSource\b|localStorage\.setItem\([^)]*token/i);
    }
  });

  it.each(['core', 'engine', 'runners', 'tui', 'server', 'cli'])('is not imported by %s', (name) => {
    const offenders = importsOf(name).filter((i) => i.specifier.startsWith('@indaba/web'));
    expect(offenders).toEqual([]);
  });

  it('is a private package whose libraries are bundled, so it adds nothing to a consumer tree', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(packagesDir, 'web', 'package.json'), 'utf8'));
    expect(manifest).toMatchObject({ name: '@indaba/web', private: true });
    expect(manifest).not.toHaveProperty('dependencies');
    expect(manifest).not.toHaveProperty('peerDependencies');
  });
});

describe('the page knows no runner by name (specs/agent-permissions, AC-16)', () => {
  it('names none of the built-in runners in a TypeScript file: what each can do comes from the catalog', () => {
    // Built from fragments, so this file is not itself a hit.
    const names = [
      'claude' + '-code',
      'code' + 'x',
      'anti' + 'gravity',
      'open' + 'code',
      'cur' + 'sor',
      'open' + 'router',
    ];
    const hits = sourceFiles(srcOf('web')).flatMap((file) => {
      if (!file.endsWith('.ts')) {
        return [];
      }
      const text = readFileSync(file, 'utf8');
      return names
        .filter((name) => text.includes(name))
        .map((name) => `${relative(srcOf('web'), file)}: ${name}`);
    });
    expect(hits).toEqual([]);
  });
});
