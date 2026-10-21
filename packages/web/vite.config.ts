import { defineConfig } from 'vite';

/**
 * Builds the page into static files that @indaba/server serves. No inline script (the server's Content-Security-Policy
 * forbids one) and no source maps in what ships. The minifier drops the libraries' licence comments, so the licences
 * travel as a file instead: `scripts/stage-page.mjs` writes `THIRD-PARTY-LICENSES.txt` beside the page when it is
 * staged into @indaba/server (task T-10 of specs/web-app).
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
