/**
 * Films site/reel/reel.html into the reel on the landing page.
 *
 *   node site/reel/render.mjs                      docs/assets/indaba-reel.mp4 and docs/assets/indaba-reel-poster.jpg
 *   node site/reel/render.mjs --stills 2.4,5.6     PNG stills of those moments into site/reel/stills/ (not committed)
 *
 * Needs ffmpeg on the PATH, Playwright with a Chromium (or Chrome at $CHROME), and `pnpm install` for the fonts
 * (the same Atkinson Hyperlegible files the site uses, from packages/web/node_modules/@fontsource). This is a
 * maintainer's tool: nothing in CI runs it, and the film it writes is committed.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ASSETS = path.join(ROOT, 'docs', 'assets');
const FONTS = path.join(ROOT, 'packages', 'web', 'node_modules', '@fontsource');

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');

const args = process.argv.slice(2);
const stillsAt = args.includes('--stills') ? args[args.indexOf('--stills') + 1].split(',').map(Number) : null;

const fonts = [
    ['Next', 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-400-normal.woff2', '400'],
    ['Next', 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-700-normal.woff2', '700'],
    ['Next', 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-800-normal.woff2', '800'],
    ['Mono', 'atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-400-normal.woff2', '400'],
    ['Mono', 'atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-700-normal.woff2', '700'],
].map(([family, file, weight]) => ({ family, weight, data: fs.readFileSync(path.join(FONTS, file)).toString('base64') }));

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(path.join(HERE, 'reel.html')).href);
await page.evaluate(async (list) => {
    for (const f of list) {
        const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
        const face = new FontFace(f.family, bytes, { weight: f.weight });
        await face.load();
        document.fonts.add(face);
    }
}, fonts);
const { FPS, DURATION } = await page.evaluate(() => window.REEL);

const frame = async (t, type) => {
    const url = await page.evaluate(
        ([time, kind]) => {
            window.render(time);
            return document.getElementById('c').toDataURL(kind, 0.94);
        },
        [t, type],
    );
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
};

if (stillsAt) {
    const dir = path.join(HERE, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    for (const t of stillsAt) fs.writeFileSync(path.join(dir, `t${t.toFixed(2)}.png`), await frame(t, 'image/png'));
    console.log(`reel: ${stillsAt.length} stills in ${path.relative(ROOT, dir)}`);
} else {
    const out = path.join(ASSETS, 'indaba-reel.mp4');
    const tmp = path.join(ASSETS, 'indaba-reel.partial.mp4');
    const ff = spawn(
        'ffmpeg',
        ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
         '-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level:v', '4.0', '-movflags', '+faststart', '-an', tmp],
        { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    const done = new Promise((resolve) => ff.on('close', resolve));
    const total = Math.round(FPS * DURATION);
    for (let f = 0; f < total; f++) {
        const jpg = await frame(f / FPS, 'image/jpeg');
        if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
        if (f % 60 === 0) console.log(`reel: frame ${f}/${total}`);
    }
    ff.stdin.end();
    const code = await done;
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
    fs.renameSync(tmp, out);
    // The poster is the last frame: the mark, for browsers that do not play the film and for reduced motion.
    fs.writeFileSync(path.join(ASSETS, 'indaba-reel-poster.jpg'), await frame(DURATION - 1 / FPS, 'image/jpeg'));
    console.log(`reel: wrote ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
}
await browser.close();
