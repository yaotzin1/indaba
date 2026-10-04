import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (name: string): string => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@indaba/core': src('core'),
      '@indaba/engine': src('engine'),
      '@indaba/runners': src('runners'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
