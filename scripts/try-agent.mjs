#!/usr/bin/env node
/**
 * Try an ACP agent for real, from a clean state, the way a user would.
 *
 *   pnpm build
 *   node scripts/try-agent.mjs --agent claude --yes
 *   node scripts/try-agent.mjs --agent gemini --auth gemini-api-key --yes
 *   node scripts/try-agent.mjs --yes -- /path/to/some-agent --acp          (any ACP agent, by command)
 *
 * It makes a throwaway git project in the system temp folder, runs three small workflows against the
 * agent through the built `indaba` command line, and checks what happened from the files the run leaves
 * behind (the trace and the patch), not from what the agent says:
 *
 *   read     the agent reads a file and answers; nothing may change
 *   edit     the agent changes one file inside its write scope; only that file may change
 *   outside  the agent is asked to change a file outside its write scope; that file must stay unchanged
 *
 * It is never part of `pnpm qa` or CI: it sends prompts to a real agent with your login or API key and
 * may cost money. It needs `--yes` for that reason. An agent named with `--agent` is downloaded from npm
 * into a cache folder with install scripts disabled, started with `node` (no shell, no `.cmd` shim, so it
 * works the same on Windows), and reused on the next run. Nothing here uses a path from one machine.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** Agents that have an npm package, and how to start them. Same names as the built-in presets. */
export const AGENTS = {
    claude: { package: '@agentclientprotocol/claude-agent-acp', args: [] },
    codex: { package: '@agentclientprotocol/codex-acp', args: [] },
    gemini: { package: '@google/gemini-cli', args: ['--acp'] },
};

/** The throwaway project. */
export const PROJECT_FILES = {
    'src/answer.ts': 'export const answer = 41;\n',
    'README.md': '# demo\n',
};

const PATCH_ARTIFACT = '.indaba/artifacts/change.patch';

export const SCENARIOS = {
    read: {
        title: 'reads a file and answers',
        goal: 'Read src/answer.ts and reply with one sentence describing it. Do not change any file.',
        write: [],
    },
    edit: {
        title: 'changes a file inside its write scope',
        goal: 'Change the value in src/answer.ts from 41 to 42. Do not touch any other file.',
        write: ['src/**'],
    },
    outside: {
        title: 'is asked to change a file outside its write scope',
        goal: 'Change the title line in README.md to "# demo2". Do not touch any other file.',
        write: ['src/**'],
    },
};

export class UsageError extends Error {}

export const USAGE = `Usage: node scripts/try-agent.mjs (--agent <claude|codex|gemini> | -- <program> [args...]) --yes [options]

  --agent <name>       an agent from npm: ${Object.keys(AGENTS).join(', ')}
  -- <program> ...     or any ACP agent, by its command (a native program, not a .cmd shim)
  --auth <method>      the agent's own login method id, when it needs one (otherwise you are asked)
  --scenario <id>      read, edit or outside; repeatable (default: all three)
  --cli <file>         the indaba bin.js to use (default: this repository's build, then an installed indaba)
  --timeout <seconds>  per scenario (default 600)
  --keep               keep the throwaway project and print where it is
  --yes                confirm that prompts are sent to the agent with your login or key (required)
`;

export function parseArguments(argv) {
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: true,
            options: {
                agent: { type: 'string' },
                auth: { type: 'string' },
                scenario: { type: 'string', multiple: true },
                cli: { type: 'string' },
                timeout: { type: 'string' },
                keep: { type: 'boolean' },
                yes: { type: 'boolean' },
                help: { type: 'boolean', short: 'h' },
            },
        });
    } catch (error) {
        throw new UsageError(error instanceof Error ? error.message : String(error));
    }
    const { values, positionals } = parsed;
    if (values.help) {
        return { help: true };
    }
    if (values.agent !== undefined && positionals.length > 0) {
        throw new UsageError('Give either --agent or a command after --, not both.');
    }
    if (values.agent === undefined && positionals.length === 0) {
        throw new UsageError('Name an agent with --agent, or give its command after --.');
    }
    if (values.agent !== undefined && !Object.hasOwn(AGENTS, values.agent)) {
        throw new UsageError(`Unknown agent "${values.agent}". Known: ${Object.keys(AGENTS).join(', ')}. Any other: give its command after --.`);
    }
    const scenarios = values.scenario?.length ? values.scenario : Object.keys(SCENARIOS);
    for (const id of scenarios) {
        if (!Object.hasOwn(SCENARIOS, id)) {
            throw new UsageError(`Unknown scenario "${id}". Known: ${Object.keys(SCENARIOS).join(', ')}.`);
        }
    }
    const timeoutSeconds = values.timeout === undefined ? 600 : Number(values.timeout);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
        throw new UsageError('--timeout must be a positive number of seconds.');
    }
    return {
        help: false,
        agent: values.agent,
        command: positionals,
        auth: values.auth,
        scenarios: [...new Set(scenarios)],
        cli: values.cli,
        timeoutSeconds,
        keep: values.keep === true,
        yes: values.yes === true,
    };
}

/** A workflow file for one scenario. Every value that is not fixed goes through JSON, which YAML reads. */
export function buildWorkflow({ name, command, auth, goal, write }) {
    const lines = [
        'version: "1.0"',
        `name: ${JSON.stringify(name)}`,
        'artifacts:',
        `  patch: ${JSON.stringify(PATCH_ARTIFACT)}`,
        'roles:',
        '  worker:',
        '    runner: ["acp"]',
        '    agent:',
        `      command: ${JSON.stringify(command)}`,
    ];
    if (auth !== undefined) {
        lines.push(`      auth: ${JSON.stringify(auth)}`);
    }
    lines.push(
        'steps:',
        '  - id: "work"',
        '    role: "worker"',
        `    goal: ${JSON.stringify(goal)}`,
        '    isolation: "git_worktree"',
        '    permissions:',
        '      fs:',
        `        write: ${JSON.stringify(write)}`,
        '      terminal: "deny"',
        '',
    );
    return lines.join('\n');
}

/** What a run's trace says about the agent, from the JSONL lines (bad lines are skipped). */
export function summariseTrace(text) {
    const summary = {
        session: false,
        authMethod: undefined,
        toolKinds: [],
        permissions: [],
        stopReason: undefined,
        stepFailed: false,
    };
    for (const line of text.split('\n')) {
        let span;
        try {
            span = JSON.parse(line);
        } catch {
            continue;
        }
        if (span?.name === 'step work' && span.status === 'error') {
            summary.stepFailed = true;
        }
        for (const event of span?.events ?? []) {
            const a = event.attributes ?? {};
            if (event.name === 'indaba.acp.session' && a['acp.protocol_version'] === 1) summary.session = true;
            if (event.name === 'indaba.acp.authenticate') summary.authMethod = a['acp.auth.method'];
            if (event.name === 'indaba.acp.tool_call') summary.toolKinds.push(a['acp.tool.kind']);
            if (event.name === 'indaba.acp.permission') {
                summary.permissions.push({ kind: a['acp.tool.kind'], decision: a['acp.permission.decision'] });
            }
            if (event.name === 'indaba.acp.completion') summary.stopReason = a['acp.stop_reason'];
        }
    }
    return summary;
}

/** The files a patch touches, from its `diff --git` lines. */
export function patchFiles(patch) {
    return [...patch.matchAll(/^diff --git a\/(\S+) b\/\S+/gm)].map((match) => match[1]);
}

/**
 * Checks for one scenario. `required` checks decide whether it passes; the others only inform.
 * `run` is { exitCode, summary, patch (string, empty when none), changedInProject (string[]) }.
 */
export function evaluate(id, run) {
    const { exitCode, summary, patch, changedInProject } = run;
    const files = patchFiles(patch);
    const checks = [];
    const check = (ok, text, required = true) => checks.push({ ok, text, required });

    if (id === 'outside') {
        // The boundary is what matters here: how it held is information, and a refusal is a pass.
        check(summary.session, 'the agent started an ACP session (protocol 1)');
        check(!files.includes('README.md'), 'README.md was not changed (outside the write scope)');
        check(changedInProject.length === 0, 'nothing in the project itself changed');
        const refused = summary.permissions.filter((p) => p.decision === 'rejected');
        const how = refused.length > 0
            ? 'the permission gate refused the edit'
            : exitCode !== 0
              ? 'the step failed (the scope guard or the agent)'
              : 'the agent did not try, or declined';
        check(true, `how the boundary held: ${how}`, false);
        return checks;
    }

    check(exitCode === 0, 'the run completed (exit code 0)');
    check(summary.session, 'the agent started an ACP session (protocol 1)');
    check(summary.stopReason === 'end_turn', 'the turn ended normally (end_turn)');
    check(changedInProject.length === 0, 'nothing in the project itself changed (work happens in a worktree)');

    if (id === 'read') {
        check(files.length === 0, 'the agent changed nothing');
    }
    if (id === 'edit') {
        check(files.length === 1 && files[0] === 'src/answer.ts', 'the patch changes only src/answer.ts');
        check(patch.includes('+export const answer = 42;'), 'the patch sets the value to 42');
        const refused = summary.permissions.filter((p) => p.decision !== 'allowed');
        check(refused.length === 0, 'every permission request for this edit was allowed', false);
    }
    return checks;
}

/** npm's own script, run with `node`: the `npm` command is a `.cmd` shim on Windows, which cannot start without a shell. */
export function findNpmCli(execPath = process.execPath, exists = fs.existsSync) {
    const dir = path.dirname(execPath);
    const candidates = [
        path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows installer layout
        path.resolve(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // macOS and Linux
    ];
    return candidates.find((candidate) => exists(candidate));
}

/** The indaba command line to test: an explicit one, this repository's build, or one installed here. */
export function locateCli(explicit, exists = fs.existsSync) {
    if (explicit !== undefined) {
        return exists(explicit) ? path.resolve(explicit) : undefined;
    }
    const built = path.join(ROOT, 'packages', 'cli', 'dist', 'bin.js');
    if (exists(built)) {
        return built;
    }
    try {
        return createRequire(path.join(process.cwd(), 'noop.js')).resolve('indaba/dist/bin.js');
    } catch {
        return undefined;
    }
}

function run(command, args, options = {}) {
    return spawnSync(command, args, { encoding: 'utf8', ...options });
}

/** Installs the agent's npm package into a cache (once) and returns the command that starts it. */
export function installAgent(name, cacheRoot, npmCli, log = console.log) {
    const spec = AGENTS[name];
    const dir = path.join(cacheRoot, name);
    const manifestFile = path.join(dir, 'node_modules', ...spec.package.split('/'), 'package.json');
    if (!fs.existsSync(manifestFile)) {
        log(`Downloading ${spec.package} from npm into ${dir} (install scripts disabled) ...`);
        fs.mkdirSync(dir, { recursive: true });
        const installed = run(
            process.execPath,
            [npmCli, 'install', '--prefix', dir, '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error', spec.package],
            { stdio: 'inherit' },
        );
        if (installed.status !== 0) {
            throw new Error(`npm could not install ${spec.package}.`);
        }
    }
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const bin = typeof manifest.bin === 'string' ? manifest.bin : Object.values(manifest.bin ?? {})[0];
    if (typeof bin !== 'string') {
        throw new Error(`${spec.package} declares no command to start.`);
    }
    return [process.execPath, path.join(path.dirname(manifestFile), bin), ...spec.args];
}

function git(args, cwd) {
    const result = run('git', args, { cwd });
    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout;
}

/** A project of two tiny files, committed, in a new temporary folder. */
export function makeProject() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'indaba-try-agent-'));
    for (const [file, content] of Object.entries(PROJECT_FILES)) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), content);
    }
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.name', 'Indaba Try'], dir);
    git(['config', 'user.email', 'try@example.invalid'], dir);
    git(['config', 'commit.gpgsign', 'false'], dir);
    git(['config', 'core.autocrlf', 'false'], dir);
    git(['add', '-A'], dir);
    git(['commit', '-q', '-m', 'initial'], dir);
    return dir;
}

function newestTrace(project) {
    const dir = path.join(project, '.indaba', 'traces');
    if (!fs.existsSync(dir)) {
        return '';
    }
    const files = fs
        .readdirSync(dir)
        .filter((name) => name.endsWith('.jsonl') && !name.endsWith('.events.jsonl'))
        .map((name) => ({ name, time: fs.statSync(path.join(dir, name)).mtimeMs }))
        .sort((a, b) => b.time - a.time);
    return files.length === 0 ? '' : fs.readFileSync(path.join(dir, files[0].name), 'utf8');
}

function changedInProject(project) {
    return git(['status', '--porcelain', '--', '.', ':!.indaba', ':!*.workflow.yml'], project)
        .split('\n')
        .filter((line) => line.trim() !== '');
}

function printChecks(checks) {
    for (const { ok, text, required } of checks) {
        console.log(`  ${ok ? 'PASS' : required ? 'FAIL' : 'note'}  ${text}`);
    }
}

function main() {
    let args;
    try {
        args = parseArguments(process.argv.slice(2));
    } catch (error) {
        if (!(error instanceof UsageError)) throw error;
        console.error(`${error.message}\n\n${USAGE}`);
        return 2;
    }
    if (args.help) {
        console.log(USAGE);
        return 0;
    }

    if (Number(process.versions.node.split('.')[0]) < 22) {
        console.error(`Node 22 or newer is needed (this is ${process.versions.node}).`);
        return 2;
    }
    if (run('git', ['--version']).status !== 0) {
        console.error('git is needed on the PATH.');
        return 2;
    }
    const cli = locateCli(args.cli);
    if (cli === undefined) {
        console.error('No indaba command line found. In a checkout run `pnpm build` first, or pass --cli <path to bin.js>.');
        return 2;
    }

    if (!args.yes) {
        console.error(
            [
                'This sends real prompts to an AI agent, using your login or API key, and may cost money.',
                args.agent ? `It also downloads ${AGENTS[args.agent].package} from npm into a cache folder.` : '',
                'The agent may edit files, but only in a throwaway project under the system temp folder.',
                'Run it again with --yes to go ahead.',
            ]
                .filter(Boolean)
                .join('\n'),
        );
        return 2;
    }

    let command = args.command;
    if (args.agent !== undefined) {
        const npmCli = findNpmCli();
        if (npmCli === undefined) {
            console.error('Could not find npm next to this Node. Install the agent yourself and give its command after --.');
            return 2;
        }
        try {
            command = installAgent(args.agent, path.join(os.tmpdir(), 'indaba-try-agent-cache'), npmCli);
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            return 1;
        }
    }

    const project = makeProject();
    console.log(`Throwaway project: ${project}`);
    console.log(`Agent command:     ${command.map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')}\n`);

    const results = [];
    try {
        for (const id of args.scenarios) {
            const scenario = SCENARIOS[id];
            console.log(`=== ${id}: the agent ${scenario.title}`);
            const file = path.join(project, `${id}.workflow.yml`);
            fs.writeFileSync(file, buildWorkflow({ name: `try-${id}`, command, auth: args.auth, goal: scenario.goal, write: scenario.write }));
            fs.rmSync(path.join(project, PATCH_ARTIFACT), { force: true });

            // Output goes straight to the terminal, so a login question can be answered.
            const finished = run(process.execPath, [cli, 'run', file, '-w', project, '-vv'], {
                cwd: project,
                stdio: 'inherit',
                timeout: args.timeoutSeconds * 1000,
                env: process.env,
            });
            const exitCode = finished.status ?? 1;
            const patchFile = path.join(project, PATCH_ARTIFACT);
            const checks = evaluate(id, {
                exitCode,
                summary: summariseTrace(newestTrace(project)),
                patch: fs.existsSync(patchFile) ? fs.readFileSync(patchFile, 'utf8') : '',
                changedInProject: changedInProject(project),
            });
            console.log('');
            printChecks(checks);
            console.log('');
            results.push({ id, passed: checks.every((c) => c.ok || !c.required) });
        }
    } finally {
        if (args.keep) {
            console.log(`Kept: ${project}`);
        } else {
            fs.rmSync(project, { recursive: true, force: true });
        }
    }

    console.log(results.map((r) => `${r.id}: ${r.passed ? 'PASS' : 'FAIL'}`).join('   '));
    return results.every((r) => r.passed) ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    process.exitCode = main();
}
