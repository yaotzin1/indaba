import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
    AGENTS,
    buildWorkflow,
    evaluate,
    findNpmCli,
    locateCli,
    makeProject,
    parseArguments,
    patchFiles,
    SCENARIOS,
    summariseTrace,
    UsageError,
} from './try-agent.mjs';

const usage = (argv) => assert.throws(() => parseArguments(argv), UsageError);

test('arguments: an agent by name, with defaults', () => {
    const args = parseArguments(['--agent', 'claude', '--yes']);
    assert.equal(args.agent, 'claude');
    assert.deepEqual(args.command, []);
    assert.deepEqual(args.scenarios, Object.keys(SCENARIOS));
    assert.equal(args.timeoutSeconds, 600);
    assert.equal(args.yes, true);
    assert.equal(args.keep, false);
});

test('arguments: an agent by command after --', () => {
    const args = parseArguments(['--yes', '--auth', 'key', '--', '/opt/agent', '--acp']);
    assert.equal(args.agent, undefined);
    assert.deepEqual(args.command, ['/opt/agent', '--acp']);
    assert.equal(args.auth, 'key');
});

test('arguments: scenarios are chosen, de-duplicated and checked', () => {
    assert.deepEqual(parseArguments(['--agent', 'gemini', '--scenario', 'read', '--scenario', 'read', '--scenario', 'edit']).scenarios, ['read', 'edit']);
    usage(['--agent', 'gemini', '--scenario', 'nope']);
});

test('arguments: mistakes are usage errors', () => {
    usage([]);
    usage(['--agent', 'claude', '--', 'prog']);
    usage(['--agent', 'unknown-agent']);
    usage(['--agent', 'claude', '--timeout', 'soon']);
    usage(['--agent', 'claude', '--timeout', '0']);
    usage(['--agent', 'claude', '--bogus']);
});

test('arguments: --help needs nothing else', () => {
    assert.equal(parseArguments(['--help']).help, true);
});

test('every named agent has a package and a way to start it', () => {
    for (const spec of Object.values(AGENTS)) {
        assert.match(spec.package, /^@?[\w-]+\/?[\w.-]*$/);
        assert.ok(Array.isArray(spec.args));
    }
});

test('workflow: every dynamic value survives as JSON, even a hostile one', () => {
    const goal = 'Change the title to "# demo2".\nThen: stop #1';
    const command = ['C:\\Example Dir\\bin\\agent.exe', 'D:\\sample folder\\agent.js', '--flag="quoted"'];
    const text = buildWorkflow({ name: 'try-edit', command, auth: 'oauth-personal', goal, write: ['src/**'] });
    const grab = (key) => JSON.parse(text.split('\n').find((line) => line.trim().startsWith(`${key}:`)).split(/:(.*)/s)[1]);
    assert.equal(grab('goal'), goal);
    assert.deepEqual(grab('command'), command);
    assert.equal(grab('auth'), 'oauth-personal');
    assert.deepEqual(grab('write'), ['src/**']);
    assert.match(text, /isolation: "git_worktree"/);
    assert.match(text, /terminal: "deny"/);
});

test('workflow: no auth line unless one is given', () => {
    assert.ok(!buildWorkflow({ name: 'n', command: ['a'], goal: 'g', write: [] }).includes('auth:'));
});

const TRACE = [
    JSON.stringify({ name: 'invoke_agent acp', status: 'ok', events: [
        { name: 'indaba.acp.session', attributes: { 'acp.protocol_version': 1 } },
        { name: 'indaba.acp.authenticate', attributes: { 'acp.auth.method': 'oauth-personal' } },
        { name: 'indaba.acp.tool_call', attributes: { 'acp.tool.kind': 'read', 'acp.tool.status': 'pending' } },
        { name: 'indaba.acp.permission', attributes: { 'acp.tool.kind': 'edit', 'acp.permission.decision': 'allowed' } },
        { name: 'indaba.acp.completion', attributes: { 'acp.stop_reason': 'end_turn' } },
    ] }),
    'not json at all',
    JSON.stringify({ name: 'step work', status: 'ok' }),
].join('\n');

test('trace: the agent behaviour is read from events, and bad lines are skipped', () => {
    const summary = summariseTrace(TRACE);
    assert.equal(summary.session, true);
    assert.equal(summary.authMethod, 'oauth-personal');
    assert.deepEqual(summary.toolKinds, ['read']);
    assert.deepEqual(summary.permissions, [{ kind: 'edit', decision: 'allowed' }]);
    assert.equal(summary.stopReason, 'end_turn');
    assert.equal(summary.stepFailed, false);
    assert.equal(summariseTrace(JSON.stringify({ name: 'step work', status: 'error' })).stepFailed, true);
    assert.equal(summariseTrace('').session, false);
});

const PATCH_EDIT = 'diff --git a/src/answer.ts b/src/answer.ts\n--- a/src/answer.ts\n+++ b/src/answer.ts\n@@\n-export const answer = 41;\n+export const answer = 42;\n';
const PATCH_README = 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@\n-# demo\n+# demo2\n';
const good = { exitCode: 0, summary: summariseTrace(TRACE), patch: '', changedInProject: [] };
const passed = (checks) => checks.every((c) => c.ok || !c.required);
const failedTexts = (checks) => checks.filter((c) => !c.ok && c.required).map((c) => c.text);

test('patchFiles lists the files a patch touches', () => {
    assert.deepEqual(patchFiles(PATCH_EDIT + PATCH_README), ['src/answer.ts', 'README.md']);
    assert.deepEqual(patchFiles(''), []);
});

test('read: passes when nothing changed, fails when something did', () => {
    assert.ok(passed(evaluate('read', good)));
    assert.deepEqual(failedTexts(evaluate('read', { ...good, patch: PATCH_EDIT })), ['the agent changed nothing']);
    assert.ok(failedTexts(evaluate('read', { ...good, changedInProject: [' M src/answer.ts'] })).length > 0);
    assert.ok(failedTexts(evaluate('read', { ...good, exitCode: 1 })).length > 0);
    assert.ok(failedTexts(evaluate('read', { ...good, summary: { ...good.summary, stopReason: 'cancelled' } })).length > 0);
});

test('edit: needs the one expected change, and nothing else', () => {
    assert.ok(passed(evaluate('edit', { ...good, patch: PATCH_EDIT })));
    assert.ok(failedTexts(evaluate('edit', good)).includes('the patch changes only src/answer.ts'));
    assert.ok(failedTexts(evaluate('edit', { ...good, patch: PATCH_EDIT + PATCH_README })).includes('the patch changes only src/answer.ts'));
    assert.ok(failedTexts(evaluate('edit', { ...good, patch: PATCH_EDIT.replace('42', '43') })).includes('the patch sets the value to 42'));
});

test('edit: a refused permission is noted, not failed', () => {
    const summary = { ...good.summary, permissions: [{ kind: 'edit', decision: 'rejected' }] };
    const checks = evaluate('edit', { ...good, summary, patch: PATCH_EDIT });
    assert.ok(passed(checks));
    assert.ok(checks.some((c) => !c.ok && !c.required));
});

test('outside: passes whenever the boundary held, and says how', () => {
    const refused = { ...good.summary, permissions: [{ kind: 'edit', decision: 'rejected' }] };
    const byGate = evaluate('outside', { ...good, summary: refused });
    assert.ok(passed(byGate));
    assert.ok(byGate.some((c) => c.text.includes('permission gate refused')));
    const byGuard = evaluate('outside', { ...good, exitCode: 1 });
    assert.ok(passed(byGuard));
    assert.ok(byGuard.some((c) => c.text.includes('scope guard')));
    assert.ok(evaluate('outside', good).some((c) => c.text.includes('did not try')));
});

test('outside: fails when the file outside the scope changed', () => {
    assert.deepEqual(failedTexts(evaluate('outside', { ...good, patch: PATCH_README })), ['README.md was not changed (outside the write scope)']);
    assert.ok(failedTexts(evaluate('outside', { ...good, changedInProject: [' M README.md'] })).length > 0);
});

test('findNpmCli: the Windows and the Unix layouts, and none', () => {
    const win = path.join('C:', 'node', 'node.exe');
    const winCli = path.join(path.dirname(win), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    assert.equal(findNpmCli(win, (p) => p === winCli), winCli);
    const unix = path.join(path.sep, 'usr', 'local', 'bin', 'node');
    const unixCli = path.resolve(path.dirname(unix), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    assert.equal(findNpmCli(unix, (p) => p === unixCli), unixCli);
    assert.equal(findNpmCli(win, () => false), undefined);
});

test('locateCli: an explicit file must exist', () => {
    assert.equal(locateCli('missing.js', () => false), undefined);
    assert.equal(locateCli('present.js', () => true), path.resolve('present.js'));
});

test('makeProject: a committed git project with the two files, in the temp folder', () => {
    const dir = makeProject();
    try {
        assert.ok(dir.startsWith(fs.realpathSync(os.tmpdir())) || dir.startsWith(os.tmpdir()));
        assert.equal(fs.readFileSync(path.join(dir, 'src', 'answer.ts'), 'utf8'), 'export const answer = 41;\n');
        assert.ok(fs.existsSync(path.join(dir, '.git')));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
