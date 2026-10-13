/**
 * Points git at the versioned hooks in `.githooks/`.
 *
 * `.git/hooks` is not versioned, so a hook written there exists on one machine and nowhere else.
 * `core.hooksPath` moves the hook directory into the repository, where a clone picks it up as soon
 * as this script is run once.
 *
 *   node scripts/install-hooks.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS_DIR = '.githooks';

for (const name of ['pre-commit', 'commit-msg']) {
    if (!fs.existsSync(path.join(ROOT_DIR, HOOKS_DIR, name))) {
        console.error(`Missing ${HOOKS_DIR}/${name}. Nothing to install.`);
        process.exit(1);
    }
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT_DIR, encoding: 'utf8' }).trim();

git('config', 'core.hooksPath', HOOKS_DIR);

// Git only runs a hook it can execute. The hooks are committed with the executable bit, so a clone has it; the
// index is touched only for a hook whose recorded mode is not executable, which would otherwise stay staged.
for (const name of ['pre-commit', 'commit-msg']) {
    const recorded = git('ls-files', '-s', `${HOOKS_DIR}/${name}`);
    if (recorded !== '' && !recorded.startsWith('100755')) {
        git('update-index', '--chmod=+x', `${HOOKS_DIR}/${name}`);
    }
}

console.log(`core.hooksPath set to ${HOOKS_DIR}`);
console.log('The pre-commit gates and the track check now run on every commit in this clone.');
console.log('Document gates always run; the quality gate (pnpm qa) runs on the host.');
if (!fs.existsSync(path.join(ROOT_DIR, 'node_modules'))) {
    console.warn('node_modules is missing: run `pnpm install` (Node 22 and pnpm 9), or the pre-commit hook will refuse every commit.');
}
