import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@indaba/core': src('core'),
      '@indaba/engine': src('engine'),
      '@indaba/runners': src('runners'),
      '@indaba/tui': src('tui'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      // The process entry point: a few lines of wiring, exercised by `pnpm smoke` on the packed install.
      exclude: ['packages/cli/src/bin.ts'],
      reporter: ['text-summary', 'text'],
      // The maintainer's floor. Raise it, never lower it; see architectural_rules in workflow.ai.yml.
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
