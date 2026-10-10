import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
    buildWorkflow,
    DEFAULT_REVIEWERS,
    MAX_SPECS,
    parseArguments,
    resolveSpecs,
    reviewGoal,
    slug,
    UsageError,
} from './review-specs.mjs';

const usage = (argv, pattern) => assert.throws(() => parseArguments(argv), (error) => error instanceof UsageError && (pattern === undefined || pattern.test(error.message)));

function project(files) {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'indaba-review-specs-test-')));
    for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), '# spec\n');
    }
    return dir;
}

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

test('arguments: a spec path is needed, and the defaults are the two default reviewers', () => {
    usage([], /at least one specification/);
    const args = parseArguments(['specs/a']);
    assert.deepEqual(args.specs, ['specs/a']);
    assert.deepEqual(args.reviewers, DEFAULT_REVIEWERS);
    assert.equal(args.arbiter, undefined);
    assert.equal(args.dryRun, false);
});

test('arguments: help is recognised without a path', () => {
    assert.equal(parseArguments(['--help']).help, true);
    assert.equal(parseArguments(['-h']).help, true);
});

test('arguments: reviewers are checked, at least two, each once', () => {
    usage(['specs/a', '--reviewers', 'claude-code'], /at least two/);
    usage(['specs/a', '--reviewers', 'claude-code,nobody'], /Unknown reviewer "nobody"/);
    usage(['specs/a', '--reviewers', 'claude-code,claude-code'], /each reviewer once/);
    assert.deepEqual(parseArguments(['specs/a', '--reviewers', 'claude-code, opencode,antigravity']).reviewers, ['claude-code', 'opencode', 'antigravity']);
});

test('arguments: only the human arbiter exists, and the number of specs is bounded', () => {
    usage(['specs/a', '--arbiter', 'robot'], /only "human"/);
    assert.equal(parseArguments(['specs/a', '--arbiter', 'human']).arbiter, 'human');
    usage(Array.from({ length: MAX_SPECS + 1 }, (_, i) => `specs/s${i}`), /at most/);
    usage(['specs/a', '--nonsense'], undefined);
});

test('specs: a folder with a spec.md, or the spec.md itself, resolves to a relative path; duplicates collapse', () => {
    const dir = project(['specs/alpha/spec.md', 'specs/beta/spec.md']);
    try {
        assert.deepEqual(resolveSpecs(['specs/alpha', 'specs/beta/spec.md', path.join(dir, 'specs', 'alpha')], dir), ['specs/alpha', 'specs/beta']);
    } finally {
        cleanup(dir);
    }
});

test('specs: a missing path, a folder without spec.md and another kind of file are refused in plain words', () => {
    const dir = project(['specs/alpha/spec.md', 'specs/empty/notes.md', 'docs/readme.md']);
    try {
        assert.throws(() => resolveSpecs(['specs/missing'], dir), /does not exist/);
        assert.throws(() => resolveSpecs(['specs/empty'], dir), /has no spec\.md/);
        assert.throws(() => resolveSpecs(['docs/readme.md'], dir), /not a specification/);
    } finally {
        cleanup(dir);
    }
});

test('specs: a path outside the working directory is refused', () => {
    const dir = project(['specs/alpha/spec.md']);
    const other = project(['specs/outside/spec.md']);
    try {
        assert.throws(() => resolveSpecs([path.join(other, 'specs', 'outside')], dir), /outside the working directory/);
        assert.throws(() => resolveSpecs([path.join('..', path.basename(other), 'specs', 'outside')], dir), /outside the working directory/);
    } finally {
        cleanup(dir);
        cleanup(other);
    }
});

test('specs: a name with characters that could change a prompt is refused, not escaped', () => {
    const hostile = ['spec', 's', 'with'].join(' ') + ' ' + ['$', '{{ x }}'].join('');
    const dir = project([`specs/${hostile}/spec.md`]);
    try {
        assert.throws(() => resolveSpecs([`specs/${hostile}`], dir), /characters that are not allowed/);
    } finally {
        cleanup(dir);
    }
});

test('specs: a link that leads out of the working directory is refused when links can be made', (t) => {
    const dir = project(['specs/alpha/spec.md']);
    const outside = project(['specs/outside/spec.md']);
    try {
        try {
            fs.symlinkSync(path.join(outside, 'specs', 'outside'), path.join(dir, 'specs', 'link'), 'junction');
        } catch {
            t.skip('this machine does not allow creating links');
            return;
        }
        assert.throws(() => resolveSpecs(['specs/link'], dir), /outside the working directory/);
    } finally {
        cleanup(dir);
        cleanup(outside);
    }
});

test('slug: everything but letters and digits becomes one dash', () => {
    assert.equal(slug('specs/run-blackboard'), 'specs-run-blackboard');
    assert.equal(slug('./a//b.c/'), 'a-b-c');
});

test('workflow: the first reviewer leads and the others answer; it is read-only and names the spec', () => {
    const workflow = buildWorkflow('specs/run-blackboard', ['claude-code', 'antigravity', 'opencode']);
    assert.equal(workflow.version, '1.0');
    assert.equal(workflow.name, 'spec-review-specs-run-blackboard');
    assert.deepEqual(workflow.roles, { reviewer_1: { runner: 'claude-code' }, reviewer_2: { runner: 'antigravity' }, reviewer_3: { runner: 'opencode' } });
    const [step] = workflow.steps;
    assert.equal(step.role, 'reviewer_1');
    assert.deepEqual(step.consensus_with, ['reviewer_2', 'reviewer_3']);
    assert.equal(step.decision_type, 'consensus');
    assert.equal(step.arbiter, undefined);
    assert.match(step.goal, /specs\/run-blackboard/);
    assert.match(step.goal, /Do not modify any file and do not run commands/);
    assert.match(step.goal, /AGREEMENT:/);
    assert.match(step.goal, /CRITIQUE:/);
    assert.equal(step.goal, reviewGoal('specs/run-blackboard'));
});

test('workflow: the human arbiter is added only when asked, and the file is valid JSON (so valid YAML)', () => {
    const workflow = buildWorkflow('specs/a', DEFAULT_REVIEWERS, 'human');
    assert.equal(workflow.steps[0].arbiter, 'human');
    assert.deepEqual(JSON.parse(JSON.stringify(workflow)), workflow);
});
