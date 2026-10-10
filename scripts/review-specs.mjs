#!/usr/bin/env node
/**
 * Review one or more Indaba specifications through Indaba itself.
 *
 *   pnpm build
 *   node scripts/review-specs.mjs specs/run-blackboard
 *   node scripts/review-specs.mjs specs/run-blackboard specs/workspace-without-git --workdir ../Indaba-wsnogit
 *   node scripts/review-specs.mjs specs/tui --reviewers claude-code,antigravity,opencode --dry-run
 *
 * For every path you give it, the script writes a small read-only workflow (one `consensus` step: the first
 * reviewer leads, the others answer it, and they debate until they agree or the rounds run out) and runs it with
 * the built `indaba` command line. Specs are reviewed one run each, so one that does not reach consensus does not
 * stop the others. Nothing is modified: the reviewers are told to read only, and the workflow files live in the
 * system temp folder, not in your project.
 *
 * It sends prompts to the agents you name, with your logins or keys, and may cost money, so it is never part
 * of `pnpm qa` or CI. A stop-gap until workflows can take inputs themselves (specs/workflow-inputs).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** The runners that can review. The first one named leads the debate. */
export const REVIEWER_RUNNERS = ['claude-code', 'antigravity', 'codex', 'cursor', 'opencode'];
export const DEFAULT_REVIEWERS = ['claude-code', 'antigravity'];
export const MAX_SPECS = 10;

/** Only these characters may appear in a path that is written into a prompt. */
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;

export class UsageError extends Error {}

export const USAGE = `Usage: node scripts/review-specs.mjs <spec> [<spec> ...] [options]

  <spec>               a specification folder (e.g. specs/run-blackboard) or its spec.md
  --workdir <dir>      the project that holds the specs (default: the current folder)
  --reviewers <list>   comma-separated runners, the first leads; at least two
                       (default: ${DEFAULT_REVIEWERS.join(',')}; known: ${REVIEWER_RUNNERS.join(', ')})
  --arbiter human      if the reviewers cannot agree, ask you to rule (needs a terminal)
  --cli <file>         the built indaba command line (default: packages/cli/dist/bin.js here)
  --dry-run            write and validate the workflows, but do not call any agent
  -h, --help           this text

Up to ${MAX_SPECS} specifications. Exit code: 0 when every review reached consensus, 1 when any did not or failed,
2 for a usage error.`;

export function parseArguments(argv) {
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: true,
            options: {
                workdir: { type: 'string' },
                reviewers: { type: 'string' },
                arbiter: { type: 'string' },
                cli: { type: 'string' },
                'dry-run': { type: 'boolean' },
                help: { type: 'boolean', short: 'h' },
            },
        });
    } catch (error) {
        throw new UsageError(error.message);
    }
    const { values, positionals } = parsed;
    if (values.help) return { help: true };

    if (positionals.length === 0) throw new UsageError('Give the path of at least one specification to review.');
    if (positionals.length > MAX_SPECS) throw new UsageError(`Give at most ${MAX_SPECS} specifications at a time (you gave ${positionals.length}).`);

    const reviewers = values.reviewers === undefined ? DEFAULT_REVIEWERS : values.reviewers.split(',').map((name) => name.trim());
    for (const name of reviewers) {
        if (!REVIEWER_RUNNERS.includes(name)) {
            throw new UsageError(`Unknown reviewer "${name}". Choose from: ${REVIEWER_RUNNERS.join(', ')}.`);
        }
    }
    if (reviewers.length < 2) throw new UsageError('A review is a debate: name at least two reviewers.');
    if (new Set(reviewers).size !== reviewers.length) throw new UsageError('Name each reviewer once.');

    if (values.arbiter !== undefined && values.arbiter !== 'human') {
        throw new UsageError('--arbiter accepts only "human".');
    }

    return {
        help: false,
        specs: positionals,
        workdir: path.resolve(values.workdir ?? process.cwd()),
        reviewers,
        arbiter: values.arbiter,
        cli: path.resolve(values.cli ?? path.join(ROOT, 'packages', 'cli', 'dist', 'bin.js')),
        dryRun: values['dry-run'] === true,
    };
}

function isInside(root, target) {
    const relative = path.relative(root, target);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * The specification folders to review, as forward-slash paths relative to the working directory. Each path must
 * name a folder that holds a spec.md (or that spec.md itself), stay inside the working directory once links are
 * resolved, and use only plain characters, because the path is written into the reviewers' instructions.
 */
export function resolveSpecs(inputs, workdir) {
    const root = fs.realpathSync(workdir);
    const found = [];
    for (const input of inputs) {
        const absolute = path.resolve(root, input);
        let real;
        try {
            real = fs.realpathSync(absolute);
        } catch {
            throw new UsageError(`"${input}" does not exist (looked in ${root}).`);
        }
        if (!isInside(root, real)) {
            throw new UsageError(`"${input}" is outside the working directory ${root}. Only files inside it can be reviewed.`);
        }
        const stats = fs.statSync(real);
        const folder = stats.isDirectory() ? real : path.basename(real) === 'spec.md' ? path.dirname(real) : undefined;
        if (folder === undefined) {
            throw new UsageError(`"${input}" is not a specification: give a folder that holds a spec.md, or the spec.md itself.`);
        }
        if (!fs.existsSync(path.join(folder, 'spec.md'))) {
            throw new UsageError(`"${input}" has no spec.md, so it is not a specification folder.`);
        }
        if (!isInside(root, folder)) {
            throw new UsageError(`"${input}" is outside the working directory ${root}. Only files inside it can be reviewed.`);
        }
        const relative = path.relative(root, folder).split(path.sep).join('/');
        if (!SAFE_PATH.test(relative) || relative.split('/').includes('..')) {
            throw new UsageError(`The path "${relative}" contains characters that are not allowed. Use letters, digits and . _ - / only.`);
        }
        if (!found.includes(relative)) found.push(relative);
    }
    return found;
}

/** A name for a trace and a file: the path with everything but letters and digits turned into dashes. */
export function slug(specPath) {
    return specPath.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function reviewGoal(specPath) {
    return [
        `You are reviewing the specification in ${specPath} of the project in the working directory.`,
        `Read ${specPath} (spec.md, api-surface.md, plan.md, tasks.md, events.md, data-model.md where present).`,
        'You may also read AGENTS.md, docs/, the other folders under specs/, and the code under packages/*/src to check',
        'the spec against what exists. Do not modify any file and do not run commands.',
        'Look for: contradictions inside the spec or with the other specs and the code; a rule in AGENTS.md that the',
        'design breaks (the domain imports no node: module, determinism, retry isolation, untrusted data reaching a',
        'shell, a path or a log, no invented numbers, extension through PluginHost, minor versus major classification);',
        'security gaps; failure cases that are missing; wording a person who is not a developer could not follow; and',
        'anything in api-surface.md that does not match spec.md.',
        'Keep your reply under 250 words. Begin it with exactly AGREEMENT: (the spec is sound as written, optionally with',
        'minor notes) or CRITIQUE: (at most six concrete findings, each naming the file and the section or acceptance',
        "criterion, and what to change), and answer the other reviewer's points.",
    ].join(' ');
}

/**
 * The workflow for one spec, as an object. It is written as JSON, which is valid YAML, so no value is ever
 * assembled into YAML text.
 */
export function buildWorkflow(specPath, reviewers, arbiter) {
    const roles = {};
    reviewers.forEach((runner, index) => {
        roles[`reviewer_${index + 1}`] = { runner };
    });
    const names = Object.keys(roles);
    const step = {
        id: 'review',
        role: names[0],
        consensus_with: names.slice(1),
        decision_type: 'consensus',
        goal: reviewGoal(specPath),
    };
    if (arbiter === 'human') step.arbiter = 'human';
    return { version: '1.0', name: `spec-review-${slug(specPath)}`, roles, steps: [step] };
}

function runCli(cli, args, options = {}) {
    return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...options });
}

export function main(argv = process.argv.slice(2)) {
    let args;
    try {
        args = parseArguments(argv);
        if (args.help) {
            console.log(USAGE);
            return 0;
        }
        args.resolved = resolveSpecs(args.specs, args.workdir);
    } catch (error) {
        if (error instanceof UsageError) {
            console.error(`${error.message}\n\n${USAGE}`);
            return 2;
        }
        throw error;
    }
    if (!fs.existsSync(args.cli)) {
        console.error(`The indaba command line is not built: ${args.cli} is missing. Run "pnpm build" first, or pass --cli.`);
        return 2;
    }

    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'indaba-review-specs-'));
    const results = [];
    try {
        for (const specPath of args.resolved) {
            const file = path.join(temp, `${slug(specPath)}.workflow.ai.yml`);
            fs.writeFileSync(file, `${JSON.stringify(buildWorkflow(specPath, args.reviewers, args.arbiter), null, 2)}\n`);

            const check = runCli(args.cli, ['validate', file]);
            if (check.status !== 0) {
                console.error(`The generated workflow for ${specPath} is not valid:\n${check.stdout}${check.stderr}`);
                results.push({ specPath, code: 2, note: 'invalid workflow' });
                continue;
            }
            if (args.dryRun) {
                console.log(`${specPath}: workflow is valid (dry run, no agent called)`);
                results.push({ specPath, code: 0, note: 'dry run' });
                continue;
            }
            console.log(`\n=== Reviewing ${specPath} with ${args.reviewers.join(' + ')} ===`);
            const run = runCli(args.cli, ['run', file, '--workdir', args.workdir], { stdio: 'inherit' });
            results.push({ specPath, code: run.status ?? 1, note: run.status === 0 ? 'consensus' : 'no consensus, or failed' });
        }
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }

    console.log('\nSummary');
    for (const { specPath, code, note } of results) console.log(`  ${code === 0 ? 'ok  ' : 'FAIL'} ${specPath}: ${note} (exit ${code})`);
    return results.every((r) => r.code === 0) ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    process.exitCode = main();
}
