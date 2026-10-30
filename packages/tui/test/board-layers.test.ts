import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = join(fileURLToPath(new URL('..', import.meta.url)), 'src');

/** The names a file imports from `@indaba/engine`, with `type` imports marked. */
function engineImports(file: string): { name: string; type: boolean }[] {
  const text = readFileSync(join(src, file), 'utf8');
  const out: { name: string; type: boolean }[] = [];
  for (const match of text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+'@indaba\/engine'/g)) {
    for (const part of (match[2] ?? '').split(',')) {
      const name = part.trim();
      if (name !== '') {
        out.push({
          name: name.replace(/^type\s+/, ''),
          type: match[1] !== undefined || name.startsWith('type '),
        });
      }
    }
  }
  return out;
}

// specs/run-blackboard, AC-38: the pane reads the board only through BoardReader and the value types.
describe('what the board code takes from the engine (AC-38)', () => {
  it('keeps the state and the pane on record types and the sanitiser', () => {
    expect(engineImports('board-state.ts')).toEqual([{ name: 'BoardFileRecord', type: true }]);
    expect(engineImports('board-screen.ts')).toEqual([{ name: 'sanitize', type: false }]);
  });

  it('reads the board file through BoardReader alone, in the one place that opens it', () => {
    const readers = ['index.ts', 'dashboard.ts', 'ink/app.ts', 'screen.ts'].flatMap((file) =>
      engineImports(file)
        .filter((i) => /Board/.test(i.name))
        .map((i) => `${file}:${i.name}:${i.type ? 'type' : 'value'}`),
    );
    expect(readers.sort()).toEqual([
      'dashboard.ts:BoardFileRecord:type',
      'index.ts:BoardFileRecord:type',
      'index.ts:BoardReader:value',
      'ink/app.ts:BoardFileRecord:type',
    ]);
  });

  it('imports no board writer, no board file serialiser and nothing from core', () => {
    for (const file of ['board-state.ts', 'board-screen.ts', 'index.ts', 'dashboard.ts', 'ink/app.ts']) {
      const text = readFileSync(join(src, file), 'utf8');
      expect(text, file).not.toMatch(/BoardWriter|serializeBoardRecord|@indaba\/core/);
    }
  });
});
