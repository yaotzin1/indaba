import { defineConfig } from 'vitest/config';

// End-to-end tests run the built `indaba` binary as a child process (`pnpm e2e` builds first).
// They are slower than the unit tests and share temp git repositories, so files run one after another.
export default defineConfig({
  test: {
    include: ['packages/*/e2e/**/*.e2e.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
