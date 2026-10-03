import assert from 'node:assert/strict';
import test from 'node:test';
import { checkCommit, checkRange, globToRegExp, isMergeMessage, matchesAny, parseTrailers } from './check-track.mjs';

const config = {
    tracks: ['feature', 'fix', 'chore', 'release'],
    source_paths: ['src/', 'bin/'],
    test_paths: ['tests/'],
    changelogs: ['CHANGELOG.md'],
    release_paths: ['CHANGELOG.md', 'composer.json'],
    protected_paths: ['workflow.ai.yml', 'scripts/check-*', '.githooks/'],
    spec_directory: 'specs',
    spec_required: ['spec.md', 'api-surface.md', 'review.md'],
};

test('globs: a trailing slash is a directory, * does not cross a slash', () => {
    assert.ok(globToRegExp('src/').test('src/Mesh/A.php'));
    assert.ok(globToRegExp('scripts/check-*').test('scripts/check-track.mjs'));
    assert.ok(!globToRegExp('scripts/check-*').test('scripts/lib/check-x.mjs'));
    assert.ok(matchesAny('composer.json', ['composer.json']));
});

test('trailers: the last one wins, comments are ignored', () => {
    const trailers = parseTrailers('feat: x\n\nTrack: fix\n# Track: chore\nTrack: feature\n');
    assert.equal(trailers.get('track'), 'feature');
});

test('a commit without a Track trailer is refused', () => {
    assert.match(checkCommit('feat: x', ['src/A.php'], config)[0], /no "Track:" trailer/);
    assert.match(checkCommit('x\n\nTrack: huge', [], config)[0], /not a track/);
});

test('a chore may not change source', () => {
    assert.equal(checkCommit('x\n\nTrack: chore', ['docs/a.md'], config).length, 0);
    assert.match(checkCommit('x\n\nTrack: chore', ['src/A.php'], config)[0], /changes source/);
    assert.match(checkCommit('x\n\nTrack: chore', ['bin/indaba'], config)[0], /changes source/);
});

test('a release touches only the changelog and composer.json', () => {
    assert.equal(checkCommit('x\n\nTrack: release', ['CHANGELOG.md', 'composer.json'], config).length, 0);
    assert.match(checkCommit('x\n\nTrack: release', ['CHANGELOG.md', 'src/A.php'], config)[0], /more than a release does/);
});

test('touching the workflow needs a Workflow-Change trailer', () => {
    assert.match(checkCommit('x\n\nTrack: chore', ['workflow.ai.yml'], config)[0], /Workflow-Change/);
    assert.equal(checkCommit('x\n\nTrack: chore\nWorkflow-Change: tighten a gate', ['workflow.ai.yml'], config).length, 0);
});

test('merge commits are exempt', () => {
    assert.ok(isMergeMessage('Merge branch main'));
    assert.deepEqual(checkCommit('Merge branch main', ['src/A.php'], config), []);
});

const spec = (name, files) => ({ name, files });

test('a range with a fix that changes source needs a test and a changelog', () => {
    const commits = [{ message: 'x\n\nTrack: fix', files: ['src/A.php'] }];
    assert.equal(checkRange(commits, [], config).length, 2);
    const ok = [{ message: 'x\n\nTrack: fix', files: ['src/A.php', 'tests/Unit/ATest.php', 'CHANGELOG.md'] }];
    assert.deepEqual(checkRange(ok, [], config), []);
});

test('a range with a feature needs a complete spec directory and a changelog', () => {
    const feature = [{ message: 'x\n\nTrack: feature', files: ['src/A.php', 'specs/a/spec.md'] }];
    const incomplete = checkRange(feature, [spec('a', ['spec.md'])], config);
    assert.ok(incomplete.some((e) => /spec/.test(e)));
    assert.ok(incomplete.some((e) => /CHANGELOG/.test(e)));
    const done = [{ message: 'x\n\nTrack: feature', files: ['src/A.php', 'specs/a/spec.md', 'CHANGELOG.md'] }];
    assert.deepEqual(checkRange(done, [spec('a', ['spec.md', 'api-surface.md', 'review.md'])], config), []);
});

test('splitting a feature into chore commits does not shed its deliverables', () => {
    const commits = [
        { message: 'x\n\nTrack: chore', files: ['docs/a.md'] },
        { message: 'y\n\nTrack: feature', files: ['src/A.php'] },
    ];
    assert.ok(checkRange(commits, [], config).length > 0);
});
