/**
 * The packed-install smoke test: what a consumer's `npm install` gets, not the source tree.
 *
 *   pnpm build && pnpm smoke
 *
 * It packs every package under packages/ with `pnpm pack` (which rewrites `workspace:` ranges to real
 * versions), installs the tarballs into an empty temporary project, and boots the `indaba` binary.
 * It needs the packages built, and it must run through pnpm (`pnpm smoke`) so that `npm_execpath`
 * names pnpm's own script: Node refuses to start a `.cmd` shim without a shell, and this repository
 * never starts one with a shell.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpmScript = process.env.npm_execpath;

function fail(message) {
    console.error(`smoke-pack: ${message}`);
    process.exit(1);
}

if (!pnpmScript || !/pnpm/i.test(pnpmScript)) fail('run it through pnpm: `pnpm smoke` (npm_execpath does not name pnpm).');

function pnpm(args, cwd) {
    const result = spawnSync(process.execPath, [pnpmScript, ...args], { cwd, encoding: 'utf8' });
    if (result.status !== 0) fail(`pnpm ${args.join(' ')} failed in ${cwd}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
}

const packagesDir = path.join(ROOT, 'packages');
const packageDirs = fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(packagesDir, entry.name, 'package.json')))
    .map((entry) => path.join(packagesDir, entry.name));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'indaba-smoke-'));
try {
    const tarballs = new Map();
    for (const dir of packageDirs) {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (!fs.existsSync(path.join(dir, 'dist'))) fail(`${manifest.name} has no dist/; run \`pnpm build\` first.`);
        const destination = path.join(work, 'tarballs');
        fs.mkdirSync(destination, { recursive: true });
        pnpm(['pack', '--pack-destination', destination], dir);
        const file = fs.readdirSync(destination).find((name) => !Array.from(tarballs.values()).includes(path.join(destination, name)));
        if (!file) fail(`pnpm pack produced no tarball for ${manifest.name}`);
        tarballs.set(manifest.name, path.join(destination, file));
    }

    // The packages depend on each other by version; none is on the registry yet, so point each
    // name at its tarball. The consumer project then installs exactly what would be published.
    const consumer = path.join(work, 'consumer');
    fs.mkdirSync(consumer);
    const overrides = Object.fromEntries([...tarballs].map(([name, file]) => [name, `file:${file.split(path.sep).join('/')}`]));
    fs.writeFileSync(
        path.join(consumer, 'package.json'),
        JSON.stringify({ name: 'indaba-smoke-consumer', private: true, type: 'module', dependencies: overrides, pnpm: { overrides } }, null, 2),
    );
    pnpm(['install', '--ignore-scripts', '--no-frozen-lockfile'], consumer);

    const bin = path.join(consumer, 'node_modules', 'indaba', 'dist', 'bin.js');
    if (!fs.existsSync(bin)) fail('the installed indaba package has no dist/bin.js');
    const run = spawnSync(process.execPath, [bin, '--version'], { cwd: consumer, encoding: 'utf8' });
    if (run.status !== 0) fail(`indaba --version exited ${run.status}\n${run.stdout}\n${run.stderr}`);

    const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'cli', 'package.json'), 'utf8')).version;
    if (!run.stdout.includes(expected)) fail(`indaba --version printed "${run.stdout.trim()}", expected ${expected}`);

    const validate = spawnSync(process.execPath, [bin, 'validate', path.join(ROOT, 'examples', 'task-pipeline.workflow.ai.yml')], {
        cwd: consumer,
        encoding: 'utf8',
    });
    if (validate.status !== 0) fail(`indaba validate on the example failed\n${validate.stdout}\n${validate.stderr}`);

    console.log(`smoke-pack: ${tarballs.size} packages packed, installed and booted (indaba ${expected})`);
} finally {
    fs.rmSync(work, { recursive: true, force: true });
}
