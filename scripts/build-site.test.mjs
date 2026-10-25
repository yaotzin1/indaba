import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkNavigation, htmlName, REPO, rewriteHref, slug } from './build-site.mjs';

test('a docs page missing from the navigation is reported', () => {
    const problems = checkNavigation(['README.md', 'getting-started.md', 'brand-new.md']);
    assert.ok(problems.some((p) => p.includes('docs/brand-new.md is not on the site')));
});

test('a navigation entry without its file is reported', () => {
    const problems = checkNavigation(['README.md']);
    assert.ok(problems.some((p) => p.includes('PAGES names docs/getting-started.md')));
});

test('headings get the ids GitHub gives them', () => {
    assert.equal(slug('<code>run</code> options'), 'run-options');
    assert.equal(slug('Pseudo-terminal, and the piped fallback'), 'pseudo-terminal-and-the-piped-fallback');
    assert.equal(slug('Windows: use a native executable'), 'windows-use-a-native-executable');
});

test('links become site pages, assets, or files on GitHub', () => {
    const pages = new Set(['workflow-format.md', 'README.md']);
    assert.equal(rewriteHref('workflow-format.md#guards', pages), 'workflow-format.html#guards');
    assert.equal(rewriteHref('README.md', pages), 'docs.html');
    assert.equal(rewriteHref('assets/indaba-logo.svg', pages), 'assets/indaba-logo.svg');
    assert.equal(rewriteHref('../examples/', pages), `${REPO}/tree/main/examples`);
    assert.equal(rewriteHref('../CONTRIBUTING.md', pages), `${REPO}/blob/main/CONTRIBUTING.md`);
    assert.equal(rewriteHref('#logs', pages), '#logs');
    assert.equal(rewriteHref('https://example.com/x.md', pages), 'https://example.com/x.md');
    assert.equal(htmlName('logging.md'), 'logging.html');
});
