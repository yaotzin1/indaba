import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BUNDLED, cleanPage, NOTICES, stagePage, TOOLS, thirdPartyNotices } from './stage-page.mjs';

/** A fake @indaba/web with a node_modules of its own: each bundled library, one with a dependency of its own. */
function fixture({ extra = {}, licence = true } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-page-'));
    const web = path.join(root, 'web');
    const devDependencies = Object.fromEntries([...BUNDLED, ...TOOLS].map((name) => [name, '1.0.0']));
    fs.mkdirSync(web, { recursive: true });
    fs.writeFileSync(path.join(web, 'package.json'), JSON.stringify({ name: '@indaba/web', devDependencies: { ...devDependencies, ...extra } }));
    const write = (name, manifest, text) => {
        const dir = path.join(web, 'node_modules', ...name.split('/'));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }));
        if (text !== undefined) fs.writeFileSync(path.join(dir, 'LICENSE'), text);
    };
    for (const name of BUNDLED) {
        write(name, name === 'react-dom' ? { license: 'MIT', dependencies: { scheduler: '1' } } : { license: 'MIT' }, licence ? `licence of ${name}` : undefined);
    }
    write('scheduler', { license: 'MIT' }, 'licence of scheduler');
    const dist = path.join(root, 'dist');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(dist, 'assets', 'index.js'), '');
    return { root, web, dist, target: path.join(root, 'server', 'page') };
}

test('the notices carry every bundled library and what it depends on, once each, in name order', () => {
    const { web } = fixture();
    const notices = thirdPartyNotices(web);
    assert.equal(notices.count, BUNDLED.length + 1);
    assert.match(notices.text, /scheduler@1\.0\.0 \(MIT\)\n=+\n\nlicence of scheduler/);
    const names = [...notices.text.matchAll(/^(\S+)@1\.0\.0 /gm)].map((match) => match[1]);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test('a library with only a licence field still gets a notice; one with neither stops the pack', () => {
    const { web } = fixture({ licence: false });
    assert.match(thirdPartyNotices(web).text, /Licensed under MIT; the package ships no licence file/);
    fs.writeFileSync(path.join(web, 'node_modules', 'react', 'package.json'), JSON.stringify({ name: 'react', version: '1.0.0' }));
    assert.throws(() => thirdPartyNotices(web), /react@1\.0\.0 names no licence/);
});

test('a devDependency that is neither bundled nor a tool stops the pack', () => {
    const { web } = fixture({ extra: { 'left-pad': '1.0.0' } });
    assert.throws(() => thirdPartyNotices(web), /decide whether these reach the page .*left-pad/);
});

test('a bundled library that is not installed stops the pack', () => {
    const { web } = fixture();
    fs.rmSync(path.join(web, 'node_modules', 'apsw-gridwright'), { recursive: true });
    assert.throws(() => thirdPartyNotices(web), /cannot find apsw-gridwright/);
});

test('staging copies the build with its notices, replaces an older copy, and cleaning removes it', () => {
    const { web, dist, target } = fixture();
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'stale.js'), '');
    assert.equal(stagePage(dist, target, web), 3);
    assert.ok(fs.existsSync(path.join(target, 'index.html')));
    assert.ok(fs.existsSync(path.join(target, NOTICES)));
    assert.ok(!fs.existsSync(path.join(target, 'stale.js')));
    cleanPage(target);
    assert.ok(!fs.existsSync(target));
});

test('there is no page to stage before the build', () => {
    const { web, root, target } = fixture();
    assert.throws(() => stagePage(path.join(root, 'nothing'), target, web), /no built page .* run `pnpm build` first/);
    assert.ok(!fs.existsSync(target));
});
