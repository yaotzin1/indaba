import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { auditFiles, tarballFiles } from './smoke-pack.mjs';

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
