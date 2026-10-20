import { defineConfig } from 'vite';

/**
 * Builds the page into static files that @indaba/server serves. No inline script (the server's Content-Security-Policy
 * forbids one), no source maps in what ships, and the licence comments of every bundled library kept in the output.
 */
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    target: 'es2022',
  },
});
