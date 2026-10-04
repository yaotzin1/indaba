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
    majorOf,
    matchesLoad,
    runChecks,
    runsCommand,
} from './check-workflow.mjs';
import { parseWorkflowYaml } from './lib/workflow-yaml.mjs';

const manifests = {
    root: {
        engines: { node: '>=22' },
        packageManager: 'pnpm@9.15.1',
        scripts: { test: 'vitest run', qa: 'pnpm lint && pnpm test' },
        devDependencies: { typescript: '^5.9.3', vitest: '^5.0.3', '@biomejs/biome': '2.5.15' },
    },
    packages: [
        { file: 'packages/core/package.json', json: { name: '@indaba/core', engines: { node: '>=22' } } },
        {
            file: 'packages/engine/package.json',
            json: { name: '@indaba/engine', engines: { node: '>=22' }, dependencies: { '@indaba/core': 'workspace:*', yaml: '^2.9.1' } },
        },
        {
            file: 'packages/runners/package.json',
            json: { name: '@indaba/runners', engines: { node: '>=22' }, optionalDependencies: { 'node-pty': '^1.1.0' } },
        },
    ],
};
const tsconfig = { compilerOptions: { strict: true, noUncheckedIndexedAccess: true } };
const biome = { linter: { rules: { suspicious: { noExplicitAny: 'error' } } } };
const project = {
    runtime: { node: '>=22' },
    package_manager: 9,
    packages: ['@indaba/core', '@indaba/engine', '@indaba/runners'],
    runtime_dependencies: ['yaml'],
    optional_dependencies: ['node-pty'],
    toolchain: { typescript: 5, vitest: 5, biome: 2 },
    scripts: ['test', 'qa'],
    strictness: ['strict', 'noUncheckedIndexedAccess'],
    biome_rules: ['suspicious.noExplicitAny'],
    supported_os: ['ubuntu-latest', 'windows-latest'],
};

test('version helpers', () => {
    assert.equal(majorOf('^2.1'), 2);
    assert.equal(majorOf('pnpm@9.15.1'), 9);
    assert.equal(majorOf(undefined), null);
});

test('checkProject passes for matching manifests, tsconfig and biome.json', () => {
    assert.deepEqual(checkProject(project, manifests, tsconfig, biome), []);
});

test('checkProject reports every kind of drift', () => {
    const drifted = {
        ...project,
        runtime: { node: '>=20' },
        package_manager: 8,
        packages: ['@indaba/core', '@indaba/ghost'],
        runtime_dependencies: [],
        optional_dependencies: ['node-pty', 'fsevents'],
        toolchain: { typescript: 4, vitest: 5, jest: 1 },
        scripts: ['test', 'missing'],
        strictness: ['strict', 'exactOptionalPropertyTypes'],
        biome_rules: ['suspicious.noExplicitAny', 'style.noNonNullAssertion'],
    };
    const errors = checkProject(drifted, manifests, tsconfig, biome).join('\n');
    assert.match(errors, /project\.runtime\.node is ">=20"/);
    assert.match(errors, /engines\.node is ">=22" but project\.runtime\.node is ">=20"/);
    assert.match(errors, /package_manager is 8/);
    assert.match(errors, /@indaba\/ghost, which no packages/);
    assert.match(errors, /publishes @indaba\/engine, which project\.packages does not list/);
    assert.match(errors, /has yaml, which project\.runtime_dependencies does not list/);
    assert.match(errors, /fsevents, which no package\.json optionalDependencies has/);
    assert.match(errors, /toolchain\.typescript is 4/);
    assert.match(errors, /jest/);
    assert.match(errors, /"missing"/);
    assert.match(errors, /exactOptionalPropertyTypes/);
    assert.match(errors, /style\.noNonNullAssertion/);
});

test('checkProject treats workspace links as internal, not as dependencies', () => {
    const linked = structuredClone(manifests);
    linked.packages[0].json.dependencies = { '@indaba/engine': 'workspace:*' };
    assert.deepEqual(checkProject(project, linked, tsconfig, biome), []);
    linked.packages[0].json.dependencies = { left: '^1.0.0' };
    assert.match(checkProject(project, linked, tsconfig, biome).join(), /has left, which project\.runtime_dependencies does not list/);
});

test('checkProject reports a missing tsconfig or biome.json when it claims flags', () => {
    const errors = checkProject(project, manifests, null, null).join('\n');
    assert.match(errors, /tsconfig\.base\.json does not exist/);
    assert.match(errors, /biome\.json does not exist/);
});

const ciText = [
    'jobs:',
    '  a:',
    '    name: Agent instruction set',
    '  verify:',
    '    name: Verify on ${{ matrix.os }}',
    '    runs-on: ${{ matrix.os }}',
    '    strategy:',
    '      fail-fast: false',
    '      matrix:',
    '        os: [ubuntu-latest, windows-latest]',
].join('\n');

test('ciJobNames expands the os matrix', () => {
    const { names, matrices } = ciJobNames(ciText);
    assert.deepEqual(names, ['Agent instruction set', 'Verify on ubuntu-latest', 'Verify on windows-latest']);
    assert.deepEqual(matrices.verify, ['ubuntu-latest', 'windows-latest']);
});

test('checkCi compares required checks and the os matrix with project.supported_os', () => {
    const ci = { workflow: 'ci.yml', required_checks: ['Agent instruction set', 'Verify on ubuntu-latest', 'Verify on windows-latest'] };
    assert.deepEqual(checkCi(ci, ciText, project), []);
    assert.match(checkCi({ ...ci, required_checks: ['Agent instruction set'] }, ciText, project).join(), /does not require/);
    assert.match(checkCi({ ...ci, required_checks: [...ci.required_checks, 'Gone'] }, ciText, project).join(), /"Gone", which no job/);
    assert.match(checkCi(ci, ciText, { supported_os: ['ubuntu-latest', 'windows-latest', 'macos-latest'] }).join(), /macos-latest, but no verify job runs on it/);
    assert.match(checkCi(ci, ciText, { supported_os: ['ubuntu-latest'] }).join(), /runs windows-latest, which project\.supported_os does not list/);
});

test('runsCommand matches whole commands', () => {
    assert.ok(runsCommand('      run: pnpm qa', 'pnpm qa'));
    assert.ok(!runsCommand('pnpm qatar', 'pnpm qa'));
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
        architectural_rules: [{ rule: 'r', enforced_by: '`packages/x/test/X.test.ts`' }, { rule: 'only a rule' }],
    };
    const errors = checkStructure(workflow, { fileExists: () => false, skillDirectories: ['a', 'extra'] }).join('\n');
    assert.match(errors, /not in skills\.registry/);
    assert.match(errors, /ghost/);
    assert.match(errors, /g\.md, which does not exist/);
    assert.match(errors, /packages\/x\/test\/X\.test\.ts/);
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
