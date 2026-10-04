import assert from 'node:assert/strict';
import test from 'node:test';
import { auditBiome, auditPackageJson, auditSource, auditTsconfig, stripTs } from './security-audit.mjs';

// Hostile strings are built from fragments so this file does not trip the audit it tests.
const eva = 'ev' + 'al';
const rules = (findings) => findings.map((finding) => finding.rule);

const tsAny = 'an' + 'y';
const tsIgnore = '@ts-' + 'ignore';
const biomeIgnore = 'biome-' + 'ignore';
const execFn = 'ex' + 'ec';

test('flags credential shapes in any file', () => {
    const key = 'sk-' + 'or-v1-' + 'a'.repeat(32);
    assert.ok(rules(auditSource('packages/core/test/a.test.ts', `// ${key}\n`)).includes('secrets/openai-style-key'));
    assert.ok(rules(auditSource('scripts/x.mjs', `const k = '${key}';\n`)).includes('secrets/openai-style-key'));
});

test('node scripts may not use exec given a string or the shell option', () => {
    assert.ok(rules(auditSource('scripts/x.mjs', `${execFn}Sync('ls');`)).includes('node/exec-string'));
    assert.deepEqual(rules(auditSource('scripts/x.mjs', `execFileSync('git', ['status']); re.${execFn}(text);`)), []);
});

test('stripTs blanks comments, strings and templates but keeps line structure', () => {
    const source = `// ${eva}(1)\nconst a = "${eva}(2)"; /* ${eva}(3) */\nconst b = \`${eva}(4)\n\`;\nconst c = 1;`;
    const out = stripTs(source);
    assert.equal(out.split('\n').length, source.split('\n').length);
    assert.ok(!out.includes(eva));
    assert.ok(out.includes('const c = 1;'));
});

test('flags eval, string exec, the shell option, the vm module, any and non-null assertions in TypeScript', () => {
    const ts = (body) => rules(auditSource('packages/engine/src/a.ts', `${body}\n`));
    assert.ok(ts(`${eva}('1');`).includes('ts/eval'));
    assert.ok(ts(`${execFn}('ls');`).includes('ts/exec-string'));
    assert.ok(ts(`spawn('ls', { shell: ${'tr' + 'ue'} });`).includes('ts/shell-true'));
    assert.ok(ts("import vm from 'node:vm';").includes('ts/vm'));
    assert.ok(ts(`const x: ${tsAny} = 1;`).includes('ts/any'));
    assert.ok(ts('const x = map.get(k)!.value;').includes('ts/non-null-assertion'));
    assert.ok(ts(`cp.${execFn}('ls');`).includes('ts/exec-string'));
    assert.deepEqual(ts(`const m = /a/.${execFn}(s);`), []);
    assert.deepEqual(ts('const ok = a !== b && !c;'), []);
    assert.deepEqual(ts(`// ${eva}() and ${tsAny} are fine in a comment`), []);
});

test('flags inline suppressions in TypeScript, including in comments', () => {
    assert.ok(rules(auditSource('packages/core/src/a.ts', `// ${tsIgnore}\nconst x = 1;\n`)).includes('suppression/static-analysis-ignore'));
    assert.ok(rules(auditSource('packages/core/src/a.ts', `// ${biomeIgnore} lint/x: why\nconst x = 1;\n`)).includes('suppression/static-analysis-ignore'));
});

test('decision logic takes no clock, randomness or environment; tests, other packages and the engine edge files may', () => {
    const body = 'const t = Date.now(); const r = Math.random(); const e = process.env.X;\n';
    const found = rules(auditSource('packages/core/src/a.ts', body));
    assert.ok(found.includes('determinism/wall-clock'));
    assert.ok(found.includes('determinism/randomness'));
    assert.ok(found.includes('determinism/environment'));
    assert.ok(rules(auditSource('packages/engine/src/engine/a.ts', body)).includes('determinism/wall-clock'));
    assert.deepEqual(rules(auditSource('packages/core/test/a.test.ts', body)), []);
    assert.deepEqual(rules(auditSource('packages/cli/src/a.ts', body)), []);
    assert.deepEqual(rules(auditSource('packages/runners/src/a.ts', body)), []);
    for (const edge of ['workspace/git.ts', 'observability/system.ts', 'observability/jsonl-span-exporter.ts']) {
        assert.deepEqual(rules(auditSource(`packages/engine/src/${edge}`, body)), [], edge);
    }
});

test('a shell interpreter named with its command flag is allowed only where declared commands run', () => {
    const body = "const command = ['/bin/sh', '-c', line];\nconst win = ['cmd.exe', '/d', '/s', '/c', line];\n";
    assert.ok(rules(auditSource('packages/runners/src/claude-runner.ts', body)).includes('ts/shell-line'));
    assert.ok(rules(auditSource('packages/cli/src/a.ts', body)).includes('ts/shell-line'));
    assert.deepEqual(rules(auditSource('packages/runners/src/shell-runner.ts', body)), []);
    assert.deepEqual(rules(auditSource('packages/runners/src/a.ts', "const c = ['git', 'status'];\n")), []);
});

test('console output is a finding in shipped TypeScript only', () => {
    assert.ok(rules(auditSource('packages/cli/src/a.ts', 'console.log(1);\n')).includes('ts/debug-output'));
    assert.deepEqual(rules(auditSource('packages/cli/test/a.test.ts', 'console.log(1);\n')), []);
});

test('package.json: install scripts and unbounded ranges are findings, workspace links are not', () => {
    assert.deepEqual(auditPackageJson({ scripts: { test: 'vitest' }, dependencies: { a: '^1.2.3', b: 'workspace:*' } }), []);
    assert.ok(rules(auditPackageJson({ scripts: { postinstall: 'x' } })).includes('supply-chain/lifecycle-script'));
    assert.ok(rules(auditPackageJson({ dependencies: { a: '*' } })).includes('supply-chain/unpinned-dependency'));
    assert.ok(rules(auditPackageJson({ dependencies: { a: 'github:x/y' } })).includes('supply-chain/unpinned-dependency'));
});

test('tsconfig and biome: the strictness flags and escape-hatch rules cannot be weakened', () => {
    const strict = { strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true };
    assert.deepEqual(auditTsconfig({ compilerOptions: strict }), []);
    assert.ok(rules(auditTsconfig({ compilerOptions: { ...strict, strict: false } })).includes('tsconfig/strictness'));
    assert.ok(rules(auditTsconfig({ compilerOptions: { ...strict, allowJs: true } })).includes('tsconfig/strictness'));
    const biome = { linter: { enabled: true, rules: { suspicious: { noExplicitAny: 'error', noTsIgnore: 'error' }, style: { noNonNullAssertion: 'error' } } } };
    assert.deepEqual(auditBiome(biome), []);
    assert.ok(rules(auditBiome({ linter: { rules: { suspicious: { noExplicitAny: 'off' } } } })).includes('biome/escape-hatch'));
});
