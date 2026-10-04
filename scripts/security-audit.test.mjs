import assert from 'node:assert/strict';
import test from 'node:test';
import { auditBiome, auditComposer, auditPackageJson, auditPhpstanNeon, auditSource, auditTsconfig, stripPhp, stripTs } from './security-audit.mjs';

// Hostile strings are built from fragments so this file does not trip the audit it tests.
const eva = 'ev' + 'al';
const shell = 'shell_' + 'exec';
const unser = 'un' + 'serialize';
const rules = (findings) => findings.map((finding) => finding.rule);
const php = (body) => `<?php\ndeclare(strict_types=1);\n${body}\n`;

test('stripPhp blanks comments and strings but keeps line structure', () => {
    const out = stripPhp(php(`// ${eva}(1)\n$a = "${eva}(2)"; /* ${shell}() */\n$b = 1;`));
    assert.equal(out.split('\n').length, php(`// ${eva}(1)\n$a = "${eva}(2)"; /* ${shell}() */\n$b = 1;`).split('\n').length);
    assert.ok(!out.includes(eva));
    assert.ok(out.includes('$b = 1;'));
});

test('stripPhp keeps attributes as code and blanks heredoc bodies', () => {
    assert.ok(stripPhp('#[Test]\nfunction f() {}').includes('#[Test]'));
    assert.ok(!stripPhp(`$x = <<<TXT\n${eva}(1)\nTXT;\n`).includes(eva));
});

test('flags eval, shell functions, backticks, the @ operator and unserialize', () => {
    assert.ok(rules(auditSource('src/A.php', php(`${eva}('1');`))).includes('php/eval'));
    assert.ok(rules(auditSource('src/A.php', php(`${shell}('ls');`))).includes('php/shell-function'));
    assert.ok(rules(auditSource('src/A.php', php('$o = `ls`;'))).includes('php/backtick-operator'));
    assert.ok(rules(auditSource('src/A.php', php('$f = @file_get_contents($p);'))).includes('php/error-suppression'));
    assert.ok(rules(auditSource('src/A.php', php(`$x = ${unser}($raw);`))).includes('php/unserialize'));
});

test('allows unserialize with allowed_classes false, and method calls named like the banned functions', () => {
    assert.deepEqual(rules(auditSource('src/A.php', php(`$x = ${unser}($raw, ['allowed_classes' => false]);`))), []);
    assert.deepEqual(rules(auditSource('src/A.php', php('$this->' + 'ex' + 'ec($x); $y = $process->' + 'system();'))), []);
});

test('mentions in comments and strings are not findings', () => {
    assert.deepEqual(rules(auditSource('src/A.php', php(`/** Never call ${eva}(). */\n$m = 'use ${shell}( here';`))), []);
});

test('fromShellCommandline is allowed only in ShellRunner', () => {
    const body = php("$p = Process::fromShellCommandline($c);");
    assert.ok(rules(auditSource('src/Runners/ClaudeRunner.php', body)).includes('php/shell-command-line'));
    assert.deepEqual(rules(auditSource('src/Runners/ShellRunner.php', body)), []);
});

test('determinism rules apply to the domain directories only', () => {
    const body = php('$t = time(); $r = random_int(1, 2); $d = new \\DateTimeImmutable();');
    const domain = rules(auditSource('src/Workflow/Engine/E.php', body));
    assert.ok(domain.includes('determinism/wall-clock'));
    assert.ok(domain.includes('determinism/randomness'));
    assert.deepEqual(rules(auditSource('src/Console/C.php', body)), []);
});

test('a missing strict_types declaration is a finding in src and tests', () => {
    assert.ok(rules(auditSource('src/A.php', '<?php\nfinal class A {}\n')).includes('php/strict-types'));
    assert.deepEqual(rules(auditSource('bin/indaba', '#!/usr/bin/env php\n')), []);
});

test('flags inline analysis ignores and logged credentials', () => {
    assert.ok(rules(auditSource('src/A.php', php('/** @phpstan-' + 'ignore-next-line */'))).includes('suppression/static-analysis-ignore'));
    assert.ok(rules(auditSource('src/A.php', php('$this->logger->info("key " . $apiKey);'))).includes('secrets/logged-credential'));
});

test('flags credential shapes in any file', () => {
    const key = 'sk-' + 'or-v1-' + 'a'.repeat(32);
    assert.ok(rules(auditSource('tests/A.php', php(`// ${key}`))).includes('secrets/openai-style-key'));
});

test('node scripts may not use exec given a string or the shell option', () => {
    assert.ok(rules(auditSource('scripts/x.mjs', 'exec' + "Sync('ls');")).includes('node/exec-string'));
    assert.deepEqual(rules(auditSource('scripts/x.mjs', "execFileSync('git', ['status']); re.exec(text);")), []);
});

test('phpstan.neon: ignoreErrors, baselines and a lowered level are findings', () => {
    assert.deepEqual(auditPhpstanNeon('parameters:\n    level: 9\n    paths:\n        - src\n'), []);
    assert.ok(rules(auditPhpstanNeon('parameters:\n    level: 9\n    ignoreErrors:\n        - foo\n')).includes('phpstan/ignore-errors'));
    assert.ok(rules(auditPhpstanNeon('includes:\n    - phpstan-baseline.neon\nparameters:\n    level: 9\n')).includes('phpstan/baseline'));
    assert.ok(rules(auditPhpstanNeon('parameters:\n    level: 8\n')).includes('phpstan/level'));
    assert.ok(rules(auditPhpstanNeon('parameters:\n    paths: [src]\n')).includes('phpstan/level'));
    assert.deepEqual(auditPhpstanNeon('parameters:\n    level: 9 # ignoreErrors would be banned\n'), []);
});

test('composer.json: lifecycle scripts, wildcard plugins and unbounded constraints are findings', () => {
    assert.deepEqual(auditComposer({ require: { php: '>=8.4' }, scripts: { test: 'phpunit' } }), []);
    assert.ok(rules(auditComposer({ scripts: { 'post-install-cmd': 'x' } })).includes('supply-chain/lifecycle-script'));
    assert.ok(rules(auditComposer({ config: { 'allow-plugins': { '*': true } } })).includes('supply-chain/allow-plugins'));
    assert.ok(rules(auditComposer({ require: { 'a/b': 'dev-main' } })).includes('supply-chain/unpinned-dependency'));
    assert.ok(rules(auditComposer({ config: { 'secure-http': false } })).includes('supply-chain/insecure-http'));
});

const tsAny = 'an' + 'y';
const tsIgnore = '@ts-' + 'ignore';
const biomeIgnore = 'biome-' + 'ignore';
const execFn = 'ex' + 'ec';

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
    assert.deepEqual(ts('const ok = a !== b && !c;'), []);
    assert.deepEqual(ts(`// ${eva}() and ${tsAny} are fine in a comment`), []);
});

test('flags inline suppressions in TypeScript, including in comments', () => {
    assert.ok(rules(auditSource('packages/core/src/a.ts', `// ${tsIgnore}\nconst x = 1;\n`)).includes('suppression/static-analysis-ignore'));
    assert.ok(rules(auditSource('packages/core/src/a.ts', `// ${biomeIgnore} lint/x: why\nconst x = 1;\n`)).includes('suppression/static-analysis-ignore'));
});

test('decision logic in TypeScript takes no clock, randomness or environment; tests and other packages may', () => {
    const found = rules(auditSource('packages/core/src/a.ts', 'const t = Date.now(); const r = Math.random(); const e = process.env.X;\n'));
    assert.ok(found.includes('determinism/wall-clock'));
    assert.ok(found.includes('determinism/randomness'));
    assert.ok(found.includes('determinism/environment'));
    assert.deepEqual(rules(auditSource('packages/core/test/a.test.ts', 'const t = Date.now();\n')), []);
    assert.deepEqual(rules(auditSource('packages/cli/src/a.ts', 'const t = Date.now();\n')), []);
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
