#!/usr/bin/env node
/**
 * Open the web view over the runs of a project, from a checkout, read-only (specs/web-app, T-11). Kept for `--demo`;
 * `pnpm indaba ui` serves the full page (Run and Stop, Workflows, the editor, Settings).
 *
 *   pnpm build
 *   pnpm try:ui                          the runs of the current folder
 *   pnpm try:ui -- --root /path/to/proj  the runs of another project (repeat --root for more than one)
 *   pnpm try:ui -- --demo                make a throwaway project, run a small workflow in it, and open that
 *   pnpm try:ui -- --port 4173           a fixed port instead of a free one
 *
 * It starts the built @indaba/server over `<root>/.indaba/traces` with the built page of @indaba/web, prints the
 * address with its token, and keeps serving until Ctrl+C. It gives the server no backend, so the page reads and never
 * writes: it starts no run, except the one `--demo` starts before serving. The demo needs no agent and no API key: its steps are `node`
 * commands, so it behaves the same on Windows, macOS and Linux, and its `verify` step fails once so the run shows a
 * retry. Nothing here is part of `pnpm qa`; it is a way to look at the page.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SERVER = path.join(ROOT, 'packages', 'server', 'dist', 'index.js');
const PAGE = path.join(ROOT, 'packages', 'web', 'dist');
const CLI = path.join(ROOT, 'packages', 'cli', 'dist', 'bin.js');

/** The demo's steps. Each is `node step.mjs <name>`: no quoting, so sh and cmd.exe read it the same way. */
export const DEMO_STEP = `// One step of the indaba ui demo. "code" counts its tries; "verify" fails until code has run twice.
import fs from 'node:fs';
const name = process.argv[2] ?? '';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tries = () => Number(fs.existsSync('.tries') ? fs.readFileSync('.tries', 'utf8') : '0');
if (name === 'rfc') {
  console.log('Writing the specification...');
  await wait(800);
  console.log('Specification written: 3 requirements, 2 open questions.');
} else if (name === 'code') {
  const n = tries() + 1;
  fs.writeFileSync('.tries', String(n));
  console.log('Implementing the change, attempt ' + n + '...');
  await wait(1200);
  console.log('Changed 4 files.');
} else if (name === 'verify') {
  console.log('> tests');
  await wait(900);
  if (tries() < 2) {
    console.log('1 test failed: totals do not add up');
    process.exit(2);
  }
  console.log('All 26 tests passed.');
} else if (name === 'review') {
  console.log('Reviewing the change against the specification...');
  await wait(700);
  console.log('Approved.');
} else {
  console.error('unknown step: ' + name);
  process.exit(64);
}
`;

export const DEMO_WORKFLOW = `version: "1.0"
name: ui-demo
steps:
  - id: rfc
    runner: shell
    commands: ["node step.mjs rfc"]
  - id: code
    depends_on: [rfc]
    runner: shell
    commands: ["node step.mjs code"]
  - id: verify
    depends_on: [code]
    runner: shell
    commands: ["node step.mjs verify"]
    on_failure: {action: retry_step, target: code, max_retries: 2}
  - id: review
    depends_on: [verify]
    runner: shell
    commands: ["node step.mjs review"]
`;

function fail(message) {
    process.stderr.write(`try-ui: ${message}\n`);
    process.exit(1);
}

/** Makes the throwaway project and runs the demo workflow in it with the built command line. */
function runDemo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'indaba-ui-demo-'));
    fs.writeFileSync(path.join(dir, 'step.mjs'), DEMO_STEP);
    fs.writeFileSync(path.join(dir, 'workflow.ai.yml'), DEMO_WORKFLOW);
    const git = spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
    if (git.status !== 0) {
        fail('git is needed for the demo (it is a prerequisite of Indaba).');
    }
    process.stdout.write(`Running the demo workflow in ${dir} ...\n`);
    const run = spawnSync(process.execPath, [CLI, 'run', 'workflow.ai.yml', '-w', dir], { cwd: dir, stdio: 'inherit' });
    if (run.status !== 0) {
        fail(`the demo run ended with exit code ${run.status}.`);
    }
    return dir;
}

async function main() {
    const { values, positionals } = parseArgs({
        options: {
            root: { type: 'string', multiple: true },
            port: { type: 'string' },
            demo: { type: 'boolean', default: false },
            help: { type: 'boolean', short: 'h', default: false },
        },
        allowPositionals: true,
    });
    if (values.help) {
        process.stdout.write('Usage: pnpm try:ui -- [--root <dir>]... [--port <n>] [--demo]\n');
        return;
    }
    for (const [file, what] of [
        [SERVER, '@indaba/server'],
        [path.join(PAGE, 'index.html'), 'the page (@indaba/web)'],
        [CLI, 'the command line'],
    ]) {
        if (!fs.existsSync(file)) {
            fail(`${what} is not built. Run pnpm build first.`);
        }
    }
    const port = values.port === undefined ? undefined : Number(values.port);
    if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) {
        fail(`--port must be a port number, not "${values.port}".`);
    }

    const roots = values.demo ? [runDemo()] : [...(values.root ?? []), ...positionals];
    const resolved = (roots.length === 0 ? [process.cwd()] : roots).map((root) => path.resolve(root));
    for (const root of resolved) {
        if (!fs.existsSync(path.join(root, '.indaba', 'traces'))) {
            process.stdout.write(`Note: ${root} has no runs yet; the list fills in as runs start there.\n`);
        }
    }

    const { startServer } = await import(pathToFileURL(SERVER).href);
    const server = await startServer({ roots: resolved, staticDir: PAGE, ...(port === undefined ? {} : { port }) });
    process.stdout.write(`\nOpen this address in a browser (it carries the token, so keep it to yourself):\n\n  ${server.url}\n\n`);
    process.stdout.write('Reading runs from:\n');
    for (const root of resolved) {
        process.stdout.write(`  ${root}\n`);
    }
    process.stdout.write('\nPress Ctrl+C to stop.\n');

    const stop = () => {
        server.close().then(() => process.exit(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
    await main();
}
