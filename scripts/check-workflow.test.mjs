import assert from 'node:assert/strict';
import test from 'node:test';
import {
    checkAgents,
    checkCi,
    checkEnforcement,
    checkGates,
    checkProject,
    checkSpecDirectory,
    checkStructure,
    ciJobNames,
    floorOf,
    majorOf,
    matchesLoad,
    runChecks,
    runsCommand,
} from './check-workflow.mjs';
import { parseWorkflowYaml } from './lib/workflow-yaml.mjs';

const composer = {
    require: { php: '>=8.4', 'symfony/yaml': '^7.2', 'symfony/process': '^7.2', 'psr/clock': '^1.0' },
    'require-dev': { 'phpstan/phpstan': '^2.1', 'phpunit/phpunit': '^11.5', 'friendsofphp/php-cs-fixer': '^3.75' },
    scripts: { test: 'phpunit', qa: ['@test'] },
};
const project = {
    runtime: { php: '>=8.4' },
    runtime_dependencies: ['psr/clock', 'symfony/process', 'symfony/yaml'],
    symfony_constraint: '^7.2',
    toolchain: { phpstan: 2, phpunit: 11, php_cs_fixer: 3 },
    composer_scripts: ['test', 'qa'],
    phpstan_level: 9,
};

test('version helpers', () => {
    assert.equal(majorOf('^2.1'), 2);
    assert.equal(floorOf('>=8.4'), '8.4');
});

test('checkProject passes for a matching composer.json and phpstan.neon', () => {
    assert.deepEqual(checkProject(project, composer, 'parameters:\n    level: 9\n'), []);
});

test('checkProject reports every kind of drift', () => {
    const drifted = {
        ...project,
        runtime: { php: '>=8.3' },
        runtime_dependencies: ['psr/clock', 'symfony/yaml'],
        symfony_constraint: '^6.4',
        toolchain: { phpstan: 1, phpunit: 11 },
        composer_scripts: ['test', 'missing'],
    };
    const errors = checkProject(drifted, composer, 'parameters:\n    level: 8\n').join('\n');
    assert.match(errors, /runtime\.php/);
    assert.match(errors, /requires symfony\/process, which project\.runtime_dependencies does not list/);
    assert.match(errors, /symfony_constraint/);
    assert.match(errors, /toolchain\.phpstan is 1/);
    assert.match(errors, /"missing"/);
    assert.match(errors, /level 8/);
});

const ciText = [
    'jobs:',
    '  a:',
    '    name: Agent instruction set',
    '  verify:',
    '    name: Verify on PHP ${{ matrix.php }}',
    '    strategy:',
    '      matrix:',
    '        php: ["8.4", "8.5"]',
].join('\n');

test('ciJobNames expands the PHP matrix', () => {
    assert.deepEqual(ciJobNames(ciText).names, ['Agent instruction set', 'Verify on PHP 8.4', 'Verify on PHP 8.5']);
});

test('checkCi compares required checks and the matrix floor', () => {
    const ci = { workflow: 'ci.yml', required_checks: ['Agent instruction set', 'Verify on PHP 8.4', 'Verify on PHP 8.5'] };
    assert.deepEqual(checkCi(ci, ciText, composer), []);
    assert.match(checkCi({ ...ci, required_checks: ['Agent instruction set'] }, ciText, composer).join(), /does not require/);
    assert.match(checkCi(ci, ciText, { require: { php: '>=8.3' } }).join(), /matrix starts at PHP 8\.4/);
});

test('runsCommand matches whole commands', () => {
    assert.ok(runsCommand('docker compose run --rm php composer qa', 'composer qa'));
    assert.ok(!runsCommand('composer qatar', 'composer qa'));
});

test('checkGates needs the hook and CI to run each gate', () => {
    const gates = [{ name: 'g', command: 'node scripts/x.mjs' }];
    assert.deepEqual(checkGates(gates, 'node scripts/x.mjs', 'run: node scripts/x.mjs'), []);
    assert.equal(checkGates(gates, '', '').length, 2);
});

test('checkEnforcement accepts "none" as the baseline before the first commit', () => {
    const enforcement = { baseline: 'none', tracks: ['feature'], source_paths: ['src/'], test_paths: ['t/'], changelogs: ['C'], release_paths: ['C'], protected_paths: ['w'] };
    assert.deepEqual(checkEnforcement(enforcement, [{ id: 'feature' }]), []);
    assert.match(checkEnforcement({ ...enforcement, baseline: 'abc' }, [{ id: 'feature' }]).join(), /baseline/);
});

const specKit = { required: ['spec.md', 'api-surface.md', 'review.md'], optional: ['plan.md', 'events.md'], omission_heading: '## Artifacts not written' };

test('spec directories: optional files are present or omitted with a reason', () => {
    const files = ['spec.md', 'api-surface.md', 'review.md'];
    const omit = '# S\n\n## Artifacts not written\n\n- `plan.md`: retroactive.\n- `events.md`: emits nothing.\n';
    assert.deepEqual(checkSpecDirectory('a', files, omit, specKit), []);
    assert.match(checkSpecDirectory('a', files, '# S\n', specKit).join(), /has no plan\.md/);
    assert.match(checkSpecDirectory('a', files, omit.replace('retroactive.', ''), specKit).join(), /without a reason/);
    assert.match(checkSpecDirectory('a', ['spec.md'], omit, specKit).join(), /missing api-surface\.md/);
});

test('the template example bullet inside a comment omits nothing', () => {
    const text = '## Artifacts not written\n\n<!--\n- `plan.md`: example\n-->\n';
    assert.match(checkSpecDirectory('a', ['spec.md', 'api-surface.md', 'review.md'], text, specKit).join(), /has no plan\.md/);
});

test('checkStructure finds unregistered skills, unknown stages and missing files', () => {
    const workflow = {
        stages: [{ id: 's', phase: 1, lead_skills: ['nope'], guidance: 'g.md' }],
        tracks: [{ id: 't', stages: ['s', 'ghost'] }],
        skills: { registry: [{ name: 'a', path: 'a.md' }] },
        architectural_rules: [{ rule: 'r', enforced_by: '`tests/X.php`' }, { rule: 'only a rule' }],
    };
    const errors = checkStructure(workflow, { fileExists: () => false, skillDirectories: ['a', 'extra'] }).join('\n');
    assert.match(errors, /not in skills\.registry/);
    assert.match(errors, /ghost/);
    assert.match(errors, /g\.md, which does not exist/);
    assert.match(errors, /tests\/X\.php/);
    assert.match(errors, /needs both/);
    assert.match(errors, /extra is not in skills\.registry/);
});

test('agent file limits use the smallest limit among the loading agents', () => {
    const agents = [{ id: 'a', loads: ['AGENTS.md'], max_chars: 100, verified: 'x' }, { id: 'b', loads: ['AGENTS.md'], max_chars: 0, verified: 'x' }];
    assert.deepEqual(checkAgents(agents, { 'AGENTS.md': 100 }), []);
    assert.match(checkAgents(agents, { 'AGENTS.md': 101 }).join(), /over the 100/);
    assert.ok(matchesLoad('.agents/rules/*.md', '.agents/rules/a.md'));
    assert.ok(!matchesLoad('.agents/rules/*.md', '.agents/rules/sub/a.md'));
});

test('the workflow YAML subset parser reads lists of mappings and refuses block scalars', () => {
    const parsed = parseWorkflowYaml('a:\n  - id: x\n    n: 1\n  - id: y\n    tags: [p, "q:r"]\n');
    assert.deepEqual(parsed, { a: [{ id: 'x', n: 1 }, { id: 'y', tags: ['p', 'q:r'] }] });
    assert.throws(() => parseWorkflowYaml('a: |\n  text\n'), /block scalars/);
    assert.throws(() => parseWorkflowYaml('a: 1\na: 2\n'), /duplicate key/);
});

test('this repository passes its own checks', () => {
    assert.deepEqual(runChecks(), []);
});
