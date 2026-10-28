import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { auditFiles, auditTarballs, tarballFiles, tarballManifest, unresolvedRanges } from './smoke-pack.mjs';

/** A tar entry: a 512-byte ustar header, then the body padded to 512. */
function entry(name, body = '', type = '0') {
    const header = Buffer.alloc(512);
    header.write(name.slice(0, 100), 0);
    header.write(`${Buffer.byteLength(body).toString(8).padStart(11, '0')}\0`, 124);
    header.write(type, 156);
    header.write('ustar\0', 257);
    const content = Buffer.alloc(Math.ceil(Buffer.byteLength(body) / 512) * 512);
    content.write(body);
    return Buffer.concat([header, content]);
}

test('a tarball is listed with Node alone, long names included, directories left out', () => {
    const long = `package/page/assets/${'a'.repeat(120)}.js`;
    const pax = `${long.length + 9 + String(long.length + 9).length} path=${long}\n`;
    const tgz = gzipSync(
        Buffer.concat([
            entry('package/package.json', '{}'),
            entry('package/dist/', '', '5'),
            entry('package/dist/index.js', 'export {};'),
            entry('PaxHeader', pax, 'x'),
            entry(long.slice(0, 100), ''),
            Buffer.alloc(1024),
        ]),
    );
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-')), 'p.tgz');
    fs.writeFileSync(file, tgz);
    assert.deepEqual(tarballFiles(file), ['dist/index.js', 'package.json', long.replace('package/', '')]);
});

test('the audit lets the build, the manifest, the readme and the licence through', () => {
    const files = ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts', 'dist/a.js.map', 'dist/a.d.ts.map'];
    assert.deepEqual(auditFiles('@indaba/core', files), { leaks: [], missing: [] });
});

test('the audit names what leaks: sources, tests, specs, build info and secrets', () => {
    const files = ['package.json', 'dist/index.js', 'dist/index.d.ts', 'src/a.ts', 'test/a.test.ts', 'dist/.tsbuildinfo', '.env', 'dist/.env.js', 'page/index.html'];
    assert.deepEqual(auditFiles('@indaba/engine', files).leaks, ['src/a.ts', 'test/a.test.ts', 'dist/.tsbuildinfo', '.env', 'dist/.env.js', 'page/index.html']);
});

test('@indaba/server must carry its page, its script and the licences of what it bundles', () => {
    const base = ['package.json', 'dist/index.js', 'dist/index.d.ts'];
    assert.deepEqual(auditFiles('@indaba/server', base).missing, ['page/index.html', 'page/THIRD-PARTY-LICENSES.txt', 'page/assets/*.js']);
    const page = [...base, 'page/index.html', 'page/THIRD-PARTY-LICENSES.txt', 'page/assets/index-x1.js', 'page/assets/a.woff2'];
    assert.deepEqual(auditFiles('@indaba/server', page), { leaks: [], missing: [] });
});

test('indaba must carry its bin', () => {
    assert.deepEqual(auditFiles('indaba', ['package.json', 'dist/index.js']).missing, ['dist/bin.js']);
});

/** A tarball on disk with these files under package/. */
function tarball(files) {
    const tgz = gzipSync(Buffer.concat([...Object.entries(files).map(([name, body]) => entry(`package/${name}`, body)), Buffer.alloc(1024)]));
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-')), 'p.tgz');
    fs.writeFileSync(file, tgz);
    return file;
}

const library = (name, dependencies = {}) =>
    tarball({ 'package.json': JSON.stringify({ name, version: '1.2.3', dependencies }), 'dist/index.js': '', 'dist/index.d.ts': '' });

test('the manifest a tarball would publish is read from it', () => {
    assert.equal(tarballManifest(library('@indaba/core')).name, '@indaba/core');
});

test('workspace, link, file and portal ranges cannot be resolved by a registry; versions and tags can', () => {
    const manifest = {
        dependencies: { a: 'workspace:*', b: '^1.0.0', c: 'file:../c' },
        optionalDependencies: { d: 'link:../d' },
        peerDependencies: { e: 'portal:../e', f: 'next' },
    };
    assert.deepEqual(unresolvedRanges(manifest), [
        'dependencies.a: workspace:*',
        'dependencies.c: file:../c',
        'optionalDependencies.d: link:../d',
        'peerDependencies.e: portal:../e',
    ]);
});

test('a release set with a workspace range, a missing package or another version is refused', () => {
    const core = library('@indaba/core');
    const engine = library('@indaba/engine', { '@indaba/core': 'workspace:*' });
    assert.deepEqual(auditTarballs([core, engine], ['@indaba/core', '@indaba/engine', '@indaba/runners'], '1.2.4'), [
        '@indaba/runners: no tarball (every published package must be released together)',
        '@indaba/core: version 1.2.3, expected 1.2.4',
        '@indaba/engine: version 1.2.3, expected 1.2.4',
        '@indaba/engine: dependencies.@indaba/core: workspace:* cannot be installed from the registry',
    ]);
});

test('a complete release set with real ranges passes', () => {
    const core = library('@indaba/core');
    const engine = library('@indaba/engine', { '@indaba/core': '1.2.3' });
    assert.deepEqual(auditTarballs([core, engine], ['@indaba/core', '@indaba/engine'], '1.2.3'), []);
});
