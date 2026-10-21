/**
 * The packed-install smoke test: what a consumer's `npm install` gets, not the source tree.
 *
 *   pnpm build && pnpm smoke
 *
 * It packs every package under packages/ that is published (`pnpm pack` rewrites `workspace:` ranges
 * to real versions), audits the files in each tarball, and installs them twice into empty temporary
 * projects: once with only `indaba` and what it needs, which must boot and validate a workflow without
 * the optional @indaba/tui and @indaba/server (and say what to install for `indaba ui`), and once with
 * everything, where @indaba/server must carry the built page of `indaba ui` and find it (T-10 of
 * specs/web-app). The private @indaba/web is never packed: its build ships inside @indaba/server.
 * It needs the packages built, and it must run through pnpm (`pnpm smoke`) so that `npm_execpath`
 * names pnpm's own script: Node refuses to start a `.cmd` shim without a shell, and this repository
 * never starts one with a shell.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpmScript = process.env.npm_execpath;

function fail(message) {
    console.error(`smoke-pack: ${message}`);
    process.exit(1);
}

function pnpm(args, cwd) {
    const result = spawnSync(process.execPath, [pnpmScript, ...args], { cwd, encoding: 'utf8' });
    if (result.status !== 0) fail(`pnpm ${args.join(' ')} failed in ${cwd}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
}


/** The file names in a .tgz, read with Node alone (no `tar` on the path is assumed), `package/` removed. */
export function tarballFiles(file) {
    const data = gunzipSync(fs.readFileSync(file));
    const files = [];
    let longName;
    for (let offset = 0; offset + 512 <= data.length; ) {
        const header = data.subarray(offset, offset + 512);
        if (header.every((byte) => byte === 0)) break;
        const text = (from, to) => header.subarray(from, to).toString('utf8').replace(/\0.*$/s, '');
        const size = Number.parseInt(text(124, 136).trim() || '0', 8);
        const type = text(156, 157);
        const body = data.subarray(offset + 512, offset + 512 + size);
        if (type === 'x') {
            longName = body.toString('utf8').match(/\d+ path=([^\n]*)\n/)?.[1];
        } else if (type === '0' || type === '') {
            const prefix = text(345, 500);
            const name = longName ?? (prefix === '' ? text(0, 100) : `${prefix}/${text(0, 100)}`);
            files.push(name.replace(/^package\//, ''));
            longName = undefined;
        }
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    return files.sort();
}

/** What may ship: the build, the manifest, the readme and the licence; for @indaba/server, its page as well. */
const SHIPS = [/^package\.json$/, /^README\.md$/, /^LICENSE$/, /^dist\/.+\.(js|d\.ts)(\.map)?$/];
const SHIPS_TOO = { '@indaba/server': [/^page\/[\w./-]+$/] };
const MUST_SHIP = {
    indaba: ['dist/bin.js', 'dist/index.js'],
    '@indaba/server': ['dist/index.js', 'page/index.html', 'page/THIRD-PARTY-LICENSES.txt'],
};

/** The files of one tarball that should not be in it, and the ones that should and are missing. */
export function auditFiles(name, files) {
    const allowed = [...SHIPS, ...(SHIPS_TOO[name] ?? [])];
    const leaks = files.filter((file) => !allowed.some((pattern) => pattern.test(file)) || /\.tsbuildinfo$|(^|\/)\.env/.test(file));
    const required = MUST_SHIP[name] ?? ['dist/index.js', 'dist/index.d.ts'];
    const missing = required.filter((file) => !files.includes(file));
    if (name === '@indaba/server' && !files.some((file) => /^page\/assets\/.+\.js$/.test(file))) missing.push('page/assets/*.js');
    return { leaks, missing };
}

function install(work, label, names, tarballs) {
    const consumer = path.join(work, label);
    fs.mkdirSync(consumer);
    // None of the packages is on the registry yet, so each name points at its tarball: the consumer installs exactly
    // what would be published. Only the names listed are dependencies; the overrides do not add any.
    const overrides = Object.fromEntries([...tarballs].map(([name, file]) => [name, `file:${file.split(path.sep).join('/')}`]));
    const dependencies = Object.fromEntries(names.map((name) => [name, overrides[name]]));
    fs.writeFileSync(
        path.join(consumer, 'package.json'),
        JSON.stringify({ name: `indaba-smoke-${label}`, private: true, type: 'module', dependencies, pnpm: { overrides } }, null, 2),
    );
    pnpm(['install', '--ignore-scripts', '--no-frozen-lockfile'], consumer);
    return consumer;
}

function node(args, cwd) {
    return spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

function main() {
    if (!pnpmScript || !/pnpm/i.test(pnpmScript)) fail('run it through pnpm: `pnpm smoke` (npm_execpath does not name pnpm).');

    const packagesDir = path.join(ROOT, 'packages');
    const manifests = fs
        .readdirSync(packagesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(packagesDir, entry.name, 'package.json')))
        .map((entry) => ({ dir: path.join(packagesDir, entry.name), ...JSON.parse(fs.readFileSync(path.join(packagesDir, entry.name, 'package.json'), 'utf8')) }));
    const published = manifests.filter((manifest) => manifest.private !== true);

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'indaba-smoke-'));
    try {
        const tarballs = new Map();
        const destination = path.join(work, 'tarballs');
        fs.mkdirSync(destination, { recursive: true });
        for (const manifest of published) {
            if (!fs.existsSync(path.join(manifest.dir, 'dist'))) fail(`${manifest.name} has no dist/; run \`pnpm build\` first.`);
            pnpm(['pack', '--pack-destination', destination], manifest.dir);
            const file = fs.readdirSync(destination).find((name) => !Array.from(tarballs.values()).includes(path.join(destination, name)));
            if (!file) fail(`pnpm pack produced no tarball for ${manifest.name}`);
            tarballs.set(manifest.name, path.join(destination, file));
        }
        if (fs.existsSync(path.join(ROOT, 'packages', 'server', 'page'))) fail('packing left packages/server/page behind (its postpack did not run)');

        // The published-files audit: what each tarball holds, against what may ship.
        for (const [name, file] of tarballs) {
            const { leaks, missing } = auditFiles(name, tarballFiles(file));
            if (leaks.length > 0) fail(`${name} would publish files that do not belong in it:\n  ${leaks.join('\n  ')}`);
            if (missing.length > 0) fail(`${name} would publish without:\n  ${missing.join('\n  ')}`);
        }

        // 1. indaba alone: the optional packages are absent, and the CLI still boots and works.
        const bare = install(work, 'bare', ['indaba'], tarballs);
        for (const optional of ['@indaba/tui', '@indaba/server', '@indaba/web']) {
            if (fs.existsSync(path.join(bare, 'node_modules', ...optional.split('/')))) fail(`installing indaba alone installed ${optional}`);
        }
        const bin = path.join(bare, 'node_modules', 'indaba', 'dist', 'bin.js');
        if (!fs.existsSync(bin)) fail('the installed indaba package has no dist/bin.js');
        const version = node([bin, '--version'], bare);
        if (version.status !== 0) fail(`indaba --version exited ${version.status}\n${version.stdout}\n${version.stderr}`);
        const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'cli', 'package.json'), 'utf8')).version;
        if (!version.stdout.includes(expected)) fail(`indaba --version printed "${version.stdout.trim()}", expected ${expected}`);
        const validate = node([bin, 'validate', path.join(ROOT, 'examples', 'task-pipeline.workflow.ai.yml')], bare);
        if (validate.status !== 0) fail(`indaba validate on the example failed\n${validate.stdout}\n${validate.stderr}`);
        const ui = node([bin, 'ui', '--no-open'], bare);
        if (ui.status !== 1 || !ui.stdout.includes('npm install -g @indaba/server')) {
            fail(`indaba ui without @indaba/server should say what to install and exit 1; it exited ${ui.status}\n${ui.stdout}\n${ui.stderr}`);
        }

        // 2. everything: @indaba/server carries the page and finds it in its own package.
        const full = install(work, 'full', [...tarballs.keys()], tarballs);
        const found = node(['--input-type=module', '-e', "import { defaultPageDirectory } from '@indaba/server'; console.log(defaultPageDirectory() ?? '')"], full);
        const page = found.stdout.trim();
        const shipped = fs.realpathSync(path.join(full, 'node_modules', '@indaba', 'server', 'page'));
        if (found.status !== 0 || page === '' || fs.realpathSync(page) !== shipped) {
            fail(`the installed @indaba/server did not find its own page (found "${page}")\n${found.stderr}`);
        }

        console.log(
            `smoke-pack: ${tarballs.size} packages packed and audited; indaba ${expected} boots without @indaba/tui and @indaba/server, and the installed server finds its page`,
        );
    } finally {
        fs.rmSync(work, { recursive: true, force: true });
    }
}
