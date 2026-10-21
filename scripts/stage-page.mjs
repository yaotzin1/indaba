/**
 * Puts the built page of `indaba ui` into the package that serves it (task T-10 of specs/web-app).
 *
 *   node scripts/stage-page.mjs           copy packages/web/dist to packages/server/page
 *   node scripts/stage-page.mjs --clean   remove packages/server/page
 *
 * `@indaba/web` is private and never published: the page reaches a consumer as static files inside
 * `@indaba/server`, in its `page` folder, which is where `defaultPageDirectory()` looks first. The server's
 * `prepack` runs this, so every tarball of `@indaba/server` (the smoke test's, a release's) carries the page built
 * from the same commit, and its `postpack` removes the copy again, so a checkout keeps serving `packages/web/dist`
 * and never a stale copy. A missing build is an error: a server package without its page is not shipped.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'packages', 'web', 'dist');
const TARGET = path.join(ROOT, 'packages', 'server', 'page');

const WEB = path.join(ROOT, 'packages', 'web');
export const NOTICES = 'THIRD-PARTY-LICENSES.txt';

/**
 * The devDependencies of `@indaba/web` that end up inside the built page. Each is bundled with its own dependencies,
 * and the page carries their licence texts (MIT and ISC ask for the notice in every copy, the SIL OFL for the fonts
 * asks for the licence). Every devDependency is either here or in TOOLS, so a library added without that decision
 * fails the pack instead of shipping without its notice.
 */
export const BUNDLED = [
    'react',
    'react-dom',
    'apsw-gridwright',
    '@xyflow/react',
    '@dagrejs/dagre',
    '@fontsource/atkinson-hyperlegible-next',
    '@fontsource/atkinson-hyperlegible-mono',
];
/** Build and test tools: nothing of them reaches the page. `@indaba/core` gives the page types only. */
export const TOOLS = ['vite', 'happy-dom', '@indaba/core', '@testing-library/dom', '@testing-library/react', '@types/react', '@types/react-dom'];

function findPackage(fromDir, name) {
    for (let dir = fromDir; ; dir = path.dirname(dir)) {
        const candidate = path.join(dir, 'node_modules', ...name.split('/'));
        if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
        if (path.dirname(dir) === dir) return undefined;
    }
}

function licenceText(dir) {
    const name = fs.readdirSync(dir).find((file) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(file));
    return name === undefined ? undefined : fs.readFileSync(path.join(dir, name), 'utf8').trim();
}

/**
 * The licence notices of every bundled library and what it depends on, in name order. Throws when a devDependency is
 * neither bundled nor a tool, or when a bundled package has neither a licence file nor a licence field.
 */
export function thirdPartyNotices(web = WEB) {
    const manifest = JSON.parse(fs.readFileSync(path.join(web, 'package.json'), 'utf8'));
    const declared = Object.keys(manifest.devDependencies ?? {});
    const undecided = declared.filter((name) => !BUNDLED.includes(name) && !TOOLS.includes(name));
    if (undecided.length > 0) {
        throw new Error(`decide whether these reach the page (BUNDLED or TOOLS in scripts/stage-page.mjs): ${undecided.join(', ')}`);
    }
    const seen = new Map();
    const visit = (fromDir, name) => {
        const dir = findPackage(fromDir, name);
        if (dir === undefined) throw new Error(`cannot find ${name}, which the page bundles; run \`pnpm install\``);
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        const key = `${pkg.name}@${pkg.version}`;
        if (seen.has(key)) return;
        const text = licenceText(dir);
        if (text === undefined && typeof pkg.license !== 'string') throw new Error(`${key} names no licence`);
        seen.set(key, { license: pkg.license ?? 'see text', text: text ?? `Licensed under ${pkg.license}; the package ships no licence file.` });
        for (const dependency of Object.keys(pkg.dependencies ?? {})) visit(dir, dependency);
    };
    for (const name of BUNDLED) visit(web, name);
    const header = 'The page of indaba ui bundles the following packages. Their licences follow.\n';
    const sections = [...seen]
        // By name, then version: `react` before `react-dom`, as a reader looks for them.
        .sort(([a], [b]) => {
            const name = (key) => key.slice(0, key.lastIndexOf('@'));
            return name(a).localeCompare(name(b)) || a.localeCompare(b);
        })
        .map(([key, { license, text }]) => `${'='.repeat(72)}\n${key} (${license})\n${'='.repeat(72)}\n\n${text}\n`);
    return { count: seen.size, text: [header, ...sections].join('\n') };
}

/** Copies the built page; returns the number of files, or throws when there is no build to copy. */
export function stagePage(source = SOURCE, target = TARGET, web = WEB) {
    if (!fs.existsSync(path.join(source, 'index.html'))) {
        throw new Error(`no built page at ${source}; run \`pnpm build\` first`);
    }
    const notices = thirdPartyNotices(web);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true });
    fs.writeFileSync(path.join(target, NOTICES), notices.text);
    let files = 0;
    const count = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) count(path.join(dir, entry.name));
            else files += 1;
        }
    };
    count(target);
    return files;
}

export function cleanPage(target = TARGET) {
    fs.rmSync(target, { recursive: true, force: true });
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.includes('--clean')) {
            cleanPage();
            console.log('stage-page: removed packages/server/page');
        } else {
            console.log(`stage-page: ${stagePage()} files copied to packages/server/page`);
        }
    } catch (error) {
        console.error(`stage-page: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
