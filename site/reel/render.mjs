/**
 * Films site/reel/reel.html into the reel on the landing page.
 *
 *   node site/reel/render.mjs                      docs/assets/indaba-reel.mp4 and docs/assets/indaba-reel-poster.jpg
 *   node site/reel/render.mjs --stills 2.4,5.6     PNG stills of those moments into site/reel/stills/ (not committed)
 *   node site/reel/render.mjs --short --out x.mp4  the vertical cut for YouTube Shorts (1080x1920), with a soundtrack
 *                                                 synthesized from the same timeline; add --stills to check it
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
const short = args.includes('--short');
const outArg = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : null;
const [VW, VH] = short ? [1080, 1920] : [1920, 1080];

const fonts = [
    ['Next', 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-400-normal.woff2', '400'],
    ['Next', 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-700-normal.woff2', '700'],
    ['Next', 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-800-normal.woff2', '800'],
    ['Mono', 'atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-400-normal.woff2', '400'],
    ['Mono', 'atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-700-normal.woff2', '700'],
].map(([family, file, weight]) => ({ family, weight, data: fs.readFileSync(path.join(FONTS, file)).toString('base64') }));

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
await page.goto(`${pathToFileURL(path.join(HERE, 'reel.html')).href}${short ? '?short' : ''}`);
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
    for (const t of stillsAt) fs.writeFileSync(path.join(dir, `${short ? 's' : 't'}${t.toFixed(2)}.png`), await frame(t, 'image/png'));
    console.log(`reel: ${stillsAt.length} stills in ${path.relative(ROOT, dir)}`);
} else {
    const out = outArg ?? path.join(ASSETS, short ? 'indaba-short.mp4' : 'indaba-reel.mp4');
    const tmp = out.replace(/\.mp4$/, '.partial.mp4');
    const wav = out.replace(/\.mp4$/, '.partial.wav');
    if (short) fs.writeFileSync(wav, soundtrack(DURATION));
    // The site's film is silent (it autoplays muted) and kept small; the Short carries sound and more bits.
    const audio = short ? ['-i', wav, '-c:a', 'aac', '-b:a', '192k', '-shortest'] : ['-an'];
    const ff = spawn(
        'ffmpeg',
        ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', ...audio,
         '-c:v', 'libx264', '-preset', 'slow', '-crf', short ? '19' : '25', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level:v', short ? '4.2' : '4.0',
         '-movflags', '+faststart', tmp],
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
    if (short) fs.rmSync(wav);
    // The poster is the last frame: the mark, for browsers that do not play the film and for reduced motion.
    else fs.writeFileSync(path.join(ASSETS, 'indaba-reel-poster.jpg'), await frame(DURATION - 1 / FPS, 'image/jpeg'));
    console.log(`reel: wrote ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
}
await browser.close();

/**
 * The Short's soundtrack, synthesized from the same timeline as reel.html (its cue times are copied from there):
 * a drone, a spark, a pluck per agent, a tick per message, a riser into the fire, a buzz on the failed gate,
 * chimes on the pass and the finish, and a chord on the mark. Deterministic: a seeded noise, no clock.
 * Returns a 16-bit stereo WAV.
 */
function soundtrack(duration) {
    const SR = 48000, N = Math.round(SR * duration);
    const L = new Float32Array(N), R = new Float32Array(N);
    let seed = 1234567;
    const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    const add = (i, v, pan = 0) => { if (i >= 0 && i < N) { L[i] += v * (1 - Math.max(0, pan)); R[i] += v * (1 + Math.min(0, pan)); } };
    const TAU = Math.PI * 2;
    const tone = (t0, dur, f0, f1, amp, { decay = 4, attack = 0.004, pan = 0, wave = 'sine' } = {}) => {
        let ph = 0;
        for (let i = 0; i < dur * SR; i++) {
            const t = i / SR, k = t / dur, f = f0 * Math.pow(f1 / f0, k);
            ph += (TAU * f) / SR;
            const env = Math.min(1, t / attack) * Math.exp(-decay * t);
            const w = wave === 'square' ? Math.sign(Math.sin(ph)) * 0.6 : wave === 'tri' ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : Math.sin(ph);
            add(Math.round((t0 + t) * SR), w * env * amp, pan);
        }
    };
    const burst = (t0, dur, amp, { decay = 12, lp = 0.2, pan = 0 } = {}) => {
        let y = 0;
        for (let i = 0; i < dur * SR; i++) { const t = i / SR; y += lp * (noise() - y); add(Math.round((t0 + t) * SR), y * amp * Math.exp(-decay * t), pan); }
    };
    const thump = (t0, amp) => { tone(t0, 1.2, 90, 32, amp, { decay: 3.2 }); burst(t0, 0.25, amp * 0.6, { decay: 18, lp: 0.08 }); };
    const chord = (t0, freqs, amp, decay) => freqs.forEach((f, j) => { tone(t0 + j * 0.012, 4 / decay + 1, f, f, amp, { decay, attack: 0.01, pan: (j % 2 ? 0.3 : -0.3) }); tone(t0, 4 / decay, f * 2, f * 2, amp * 0.25, { decay: decay * 1.6 }); });

    // drone: two low partials, breathing, swelling into the debate, gone in the dive, back for the run
    for (let i = 0; i < N; i++) {
        const t = i / SR;
        const env = Math.min(1, t / 1.5) * (t < 7.7 ? 0.7 + 0.3 * Math.min(1, Math.max(0, (t - 4) / 3)) : t < 8.4 ? Math.max(0, 1 - (t - 7.7) / 0.5) : Math.min(0.75, (t - 8.4) / 0.8)) * (t > 14.4 ? Math.max(0, 1 - (t - 14.4) / 0.6) : 1);
        const v = (Math.sin(TAU * 55 * t) * 0.6 + Math.sin(TAU * 82.4 * t + 0.4 * Math.sin(TAU * 0.3 * t)) * 0.35 + Math.sin(TAU * 110 * t) * 0.12) * (0.8 + 0.2 * Math.sin(TAU * 0.5 * t));
        add(i, v * env * 0.16);
    }
    // the spark rising, and the fire catching
    tone(0, 0.62, 260, 1100, 0.07, { decay: 0, attack: 0.3 });
    burst(0.05, 0.6, 0.05, { decay: 1, lp: 0.5 });
    thump(0.62, 0.9);
    // agents arrive: a rising pentatonic pluck each
    [392, 440, 523.3, 587.3, 659.3, 784].forEach((f, i) => tone(1.55 + i * 0.09 + 0.25, 0.6, f, f, 0.3, { decay: 7, pan: Math.sin(i) * 0.6, wave: 'tri' }));
    // the debate: a tick per message as it lands
    for (let m = 0; m < 16; m++) {
        const t = 4.15 + m * 0.165 + 0.5;
        tone(t, 0.08, m >= 10 ? 1568 : 1200 + (m % 4) * 110, m >= 10 ? 1568 : 1100, 0.26, { decay: 38, pan: m % 2 ? 0.5 : -0.5 });
        burst(t - 0.45, 0.4, 0.025, { decay: 6, lp: 0.6, pan: m % 2 ? -0.4 : 0.4 });
    }
    // consensus
    thump(7.38, 0.8);
    chord(7.38, [261.6, 329.6, 392, 523.3], 0.11, 1.6);
    // the dive into the fire: a riser, then the cut
    for (let i = 0; i < 0.9 * SR; i++) { const t = i / SR, k = t / 0.9; add(Math.round((7.5 + t) * SR), noise() * 0.12 * k * k + Math.sin(TAU * (200 + 1400 * k * k) * t) * 0.04 * k); }
    thump(8.4, 0.6);
    // the run: a soft blip per node, a swish per leg
    for (let i = 0; i < 6; i++) tone(8.45 + i * 0.08 + 0.2, 0.15, 660 + i * 66, 660 + i * 66, 0.14, { decay: 22 });
    for (const t of [8.85, 9.25, 9.65, 10.25, 10.9, 11.3, 11.7]) burst(t, 0.35, 0.05, { decay: 8, lp: 0.35 });
    // the gate fails: buzz and glitch
    tone(10.0, 0.28, 110, 98, 0.16, { decay: 6, wave: 'square' });
    for (let j = 0; j < 6; j++) burst(10.0 + j * 0.04, 0.03, 0.18, { decay: 60, lp: 0.9, pan: j % 2 ? 0.7 : -0.7 });
    thump(10.0, 0.4);
    // retry, pass, finish
    tone(10.25, 0.6, 330, 494, 0.05, { decay: 2 });
    tone(11.25, 0.5, 880, 880, 0.13, { decay: 6 }); tone(11.33, 0.7, 1318.5, 1318.5, 0.12, { decay: 5 });
    tone(12.05, 0.8, 1046.5, 1046.5, 0.12, { decay: 4 }); tone(12.1, 0.8, 1568, 1568, 0.07, { decay: 4 });
    // the trace: a soft whoosh as the nodes turn into bars, a shimmer with the sweep
    burst(12.2, 0.7, 0.06, { decay: 4, lp: 0.25 });
    tone(12.85, 0.5, 2000, 3200, 0.025, { decay: 3 });
    // the collapse and the mark
    for (let i = 0; i < 0.35 * SR; i++) { const t = i / SR, k = t / 0.35; add(Math.round((13.5 + t) * SR), noise() * 0.1 * k * k); }
    thump(13.84, 1.0);
    chord(13.84, [130.8, 196, 261.6, 329.6, 392], 0.1, 0.9);

    // master: soft clip, normalize, fade the last 80 ms
    let peak = 0;
    for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * 1.2); R[i] = Math.tanh(R[i] * 1.2); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
    const gain = 0.89 / (peak || 1);
    const buf = Buffer.alloc(44 + N * 4);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
    buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
    for (let i = 0; i < N; i++) {
        const fade = Math.min(1, (N - i) / (0.08 * SR));
        buf.writeInt16LE(Math.round(L[i] * gain * fade * 32767), 44 + i * 4);
        buf.writeInt16LE(Math.round(R[i] * gain * fade * 32767), 46 + i * 4);
    }
    return buf;
}
