import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';

// Used only by Stryker. The architecture and layers tests read the source text of the packages to
// check imports and banned calls; Stryker rewrites that source with its own instrumentation, so they
// would fail on code that is fine. They guard structure, not behaviour, and run in `pnpm qa`.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: [...configDefaults.exclude, '**/architecture.test.ts', '**/layers.test.ts'],
    },
  }),
);
