import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Manifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
}

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as Manifest;

describe('what installing indaba brings (specs/tui-default)', () => {
  it('carries the terminal dashboard, the rich view, as a dependency', () => {
    expect(manifest.dependencies).toHaveProperty('@indaba/tui');
    expect(manifest.peerDependencies ?? {}).not.toHaveProperty('@indaba/tui');
  });

  it('leaves the web view, a nicer copy of it, an optional peer', () => {
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@indaba/server');
    expect(manifest.peerDependencies).toHaveProperty('@indaba/server');
    expect(manifest.peerDependenciesMeta?.['@indaba/server']?.optional).toBe(true);
  });
});
