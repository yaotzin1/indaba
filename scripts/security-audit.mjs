/**
 * The security gate. Blocking, dependency-free (it runs before `pnpm install` has), and fast enough
 * for the pre-commit hook.
 *
 *   node scripts/security-audit.mjs            source, manifests, tsconfig and biome.json
 *   node scripts/security-audit.mjs --source   the same (the pre-commit hook). There is no built
 *                                              artifact to scan; the flag exists so the gate has
 *                                              the same shape as its siblings.
 *
 * It enforces `.agents/skills/application_security/SKILL.md`. Every rule is a pattern that has no safe
 * use in this repository; there is no inline suppression, by design. A rule that is wrong is changed
 * here, in a reviewed commit, together with the skill.
 *
 * How TypeScript is read: comments and the contents of string literals are blanked before the code
 * rules run (`stripTs`), so a doc comment that says "never call eval()" is not a finding. This is a
 * scanner, not a parser: template literals are blanked whole. It narrows what review has to catch;
 * it does not replace review.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = path.relative(ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

/** Directories scanned for source rules. Tests are included: a test is code that runs too. */
export const SOURCE_DIRECTORIES = ['scripts', '.githooks', 'packages', 'apps'];
const SOURCE_EXTENSIONS = new Set(['.mjs', '.js', '.ts', '.mts']);
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', '.indaba', 'dist']);

/** Directories holding decision logic, where the clock, randomness and environment must be injected. */
export const DETERMINISTIC_DIRECTORIES = ['packages/core/src/', 'packages/engine/src/'];

/** The files in those directories that are the edge: they own the system clock, the id source or a process. */
export const DETERMINISTIC_EDGE_FILES = [
    'packages/engine/src/workspace/git.ts',
    'packages/engine/src/observability/system.ts',
    'packages/engine/src/observability/jsonl-span-exporter.ts',
];

/** The files that may name a shell interpreter: the declared-command runner, and the test that pins its argument array. */
export const SHELL_LINE_ALLOWED = ['packages/runners/src/shell-runner.ts', 'packages/runners/test/runners.test.ts'];

/** Rules for the Node scripts and hooks. */
export const NODE_RULES = [
    { id: 'node/eval', pattern: /(?<![\w.])eval\s*\(/, message: 'eval executes a string as code.' },
    { id: 'node/new-function', pattern: /\bnew\s+Function\s*\(/, message: 'new Function executes a string as code.' },
    { id: 'node/exec-string', pattern: /(?<![\w.])(?:exec|execSync)\s*\(/, message: 'A command given as a string goes through a shell. Use execFileSync with an argument array.' },
    { id: 'node/shell-true', pattern: /\bshell\s*:\s*true\b/, message: 'shell: true parses the command line with a shell. Use an argument array.' },
];

/**
 * Blanks comments and string contents in TypeScript source, keeping line structure. Template literal
 * bodies are blanked, expressions inside them with it: a scanner, not a parser.
 */
export function stripTs(text) {
    let out = '';
    let i = 0;
    const blank = (chunk) => chunk.replace(/[^\n]/g, ' ');
    while (i < text.length) {
        const char = text[i];
        const next = text[i + 1];
        if (char === '/' && next === '/') {
            const end = text.indexOf('\n', i);
            const stop = end === -1 ? text.length : end;
            out += blank(text.slice(i, stop));
            i = stop;
        } else if (char === '/' && next === '*') {
            const end = text.indexOf('*/', i + 2);
            const stop = end === -1 ? text.length : end + 2;
            out += blank(text.slice(i, stop));
            i = stop;
        } else if (char === "'" || char === '"' || char === '`') {
            let j = i + 1;
            while (j < text.length && text[j] !== char && (char === '`' || text[j] !== '\n')) j += text[j] === '\\' ? 2 : 1;
            out += char + blank(text.slice(i + 1, j)) + (j < text.length && text[j] === char ? char : '');
            i = j + 1;
        } else {
            out += char;
            i += 1;
        }
    }
    return out;
}

/** Rules applied to the stripped code of every TypeScript file. */
export const TS_RULES = [
    { id: 'ts/eval', pattern: /(?<![\w.$])eval\s*\(/, message: 'eval executes a string as code.' },
    { id: 'ts/new-function', pattern: /\bnew\s+Function\s*\(|(?<![\w.$])Function\s*\(/, message: 'Function() executes a string as code.' },
    { id: 'ts/vm', pattern: /from\s+['"](?:node:)?vm['"]|require\s*\(\s*['"](?:node:)?vm['"]/, message: 'The vm module executes strings as code.', raw: true },
    {
        id: 'ts/exec-string',
        pattern: /(?<![\w$.])(?:exec|execSync)\s*\(|\b(?:child_process|childProcess|cp)\s*\.\s*(?:exec|execSync)\s*\(/,
        message: 'A command given as a string goes through a shell. Use spawn or execFile with an argument array.',
    },
    { id: 'ts/shell-true', pattern: /\bshell\s*:\s*true\b/, message: 'shell: true parses the command line with a shell. Use an argument array.' },
    { id: 'ts/any', pattern: /:\s*any\b|\bas\s+any\b|<any>|\bany\[\]|Array<any>|Record<[^>]*,\s*any>/, message: 'any switches the type checker off. Use unknown and narrow it.' },
    { id: 'ts/non-null-assertion', pattern: /[\w)\]]!(?:[.[(]|\s*[,;)])/, message: 'A non-null assertion hides a possible undefined. Handle the case.' },
    {
        id: 'ts/shell-line',
        pattern: /['"](?:\/bin\/)?(?:sh|bash|zsh|cmd(?:\.exe)?|powershell|pwsh)['"]\s*,\s*(?:\[\s*)?['"]\/?-?(?:c|d|Command)['"]/,
        message: 'A command line parsed by a shell. Only the declared-command runner may build one (SHELL_LINE_ALLOWED); everything else passes an argument array.',
        raw: true,
        allowedIn: SHELL_LINE_ALLOWED,
    },
    {
        id: 'ts/debug-output',
        pattern: /\bconsole\s*\.\s*(?:log|debug|dir|trace)\s*\(/,
        message: 'Debug output in shipped code can print prompts, paths and credentials. Write through the injected output.',
        shippedOnly: true,
    },
];

/** Rules for decision logic in TypeScript: the clock, randomness and environment are injected. */
export const TS_DETERMINISTIC_RULES = [
    { id: 'determinism/wall-clock', pattern: /\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(\s*\)|\bperformance\s*\.\s*now\s*\(|\bhrtime\b/, message: 'Decision logic reads no wall clock. Take a Clock in the constructor.' },
    { id: 'determinism/randomness', pattern: /\bMath\s*\.\s*random\s*\(|\brandomUUID\s*\(|\brandomBytes\s*\(|\brandomInt\s*\(|\bgetRandomValues\s*\(/, message: 'Decision logic draws no randomness. Inject an IdGenerator so a run can be replayed.' },
    { id: 'determinism/environment', pattern: /\bprocess\s*\.\s*env\b/, message: 'Decision logic reads no environment. Configuration arrives as constructor arguments.' },
];

/** Inline suppressions are an ignoreErrors in disguise, whatever the tool. Read in the raw text. */
const TS_SUPPRESSION = /@ts-ignore|@ts-expect-error|@ts-nocheck|biome-ignore|eslint-disable|istanbul ignore/;

/** Secret and credential shapes, scanned in the raw text of every file, comments included. */
export const SECRET_PATTERNS = [
    { id: 'secrets/openai-style-key', pattern: /\bsk-(?:proj-|ant-|or-v1-)?[a-zA-Z0-9_-]{20,}\b/ },
    { id: 'secrets/google-key', pattern: /\bAIzaSy[a-zA-Z0-9_-]{33}\b/ },
    { id: 'secrets/github-token', pattern: /\b(?:ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82})\b/ },
    { id: 'secrets/aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
    { id: 'secrets/jwt', pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\b/ },
    { id: 'secrets/private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
    { id: 'secrets/connection-string', pattern: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[a-zA-Z0-9_]+:[^@\s]+@[^\s]+\b/i },
    {
        id: 'secrets/literal-assignment',
        pattern: /\b(?:api[_-]?key|secret|token|password)\b['"]?\s*(?:=>|=|:)\s*['"][A-Za-z0-9_\-/+=]{16,}['"]/i,
    },
];

const finding = (file, line, rule, message) => ({ file, line, rule, message });

/** Scans one file's text. Exported for the tests. */
export function auditSource(relativePath, text) {
    const findings = [];
    const extension = path.extname(relativePath);
    const isTs = extension === '.ts' || extension === '.mts';
    const isTestFile = /(^|\/)tests?\//.test(relativePath) || /\.test\.[mc]?[jt]s$/.test(relativePath);
    const isShipped = isTs && /^(packages|apps)\/[^/]+\/src\//.test(relativePath);
    const isDeterministic = DETERMINISTIC_DIRECTORIES.some((directory) => relativePath.startsWith(directory)) && !DETERMINISTIC_EDGE_FILES.includes(relativePath);

    // Secrets are read in the raw text: a key in a comment is still a leaked key.
    text.split(/\r?\n/).forEach((line, index) => {
        for (const rule of SECRET_PATTERNS) {
            if (rule.pattern.test(line)) findings.push(finding(relativePath, index + 1, rule.id, 'Something shaped like a credential is committed. Use an environment variable, and rotate the key if it was real.'));
        }
        if (isTs && TS_SUPPRESSION.test(line)) {
            findings.push(finding(relativePath, index + 1, 'suppression/static-analysis-ignore', 'An inline ignore is an ignoreErrors in disguise. Fix the type, or change the rule in a reviewed commit.'));
        }
    });

    if (isTs) {
        const code = stripTs(text).split(/\r?\n/);
        const raw = text.split(/\r?\n/);
        const rules = [...TS_RULES, ...(isDeterministic && !isTestFile ? TS_DETERMINISTIC_RULES : [])];
        code.forEach((line, index) => {
            for (const rule of rules) {
                if (rule.shippedOnly && !isShipped) continue;
                if (rule.allowedIn?.includes(relativePath)) continue;
                if (!rule.pattern.test(rule.raw ? (raw[index] ?? '') : line)) continue;
                findings.push(finding(relativePath, index + 1, rule.id, rule.message));
            }
        });
    } else {
        text.split(/\r?\n/).forEach((line, index) => {
            for (const rule of NODE_RULES) {
                if (rule.pattern.test(line)) findings.push(finding(relativePath, index + 1, rule.id, rule.message));
            }
        });
    }
    return findings;
}

/** A package.json: no install-time code, no unbounded versions. Exported for the tests. */
export function auditPackageJson(pkg, file = 'package.json') {
    const findings = [];
    const add = (rule, message) => findings.push(finding(file, 0, rule, message));
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'preprepare', 'postprepare']) {
        if (pkg.scripts?.[hook]) add('supply-chain/lifecycle-script', `The "${hook}" script runs code on a machine that installs this package.`);
    }
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        for (const [name, range] of Object.entries(pkg[section] ?? {})) {
            const value = String(range);
            if (value.startsWith('workspace:')) continue;
            if (/^\*$|^latest$|^x$|^(?:git|github|https?|file|link):|\//.test(value)) add('supply-chain/unpinned-dependency', `${section} ${name} "${value}" is not a released, bounded version.`);
        }
    }
    return findings;
}

/** tsconfig.base.json: the strictness flags, the TypeScript counterpart of "no ignoreErrors". Exported for the tests. */
export function auditTsconfig(config, file = 'tsconfig.base.json') {
    const findings = [];
    const options = config.compilerOptions ?? {};
    for (const flag of ['strict', 'noUncheckedIndexedAccess', 'exactOptionalPropertyTypes', 'verbatimModuleSyntax']) {
        if (options[flag] !== true) findings.push(finding(file, 0, 'tsconfig/strictness', `compilerOptions.${flag} must be true.`));
    }
    for (const flag of ['allowJs', 'checkJs']) {
        if (options[flag] === true) findings.push(finding(file, 0, 'tsconfig/strictness', `compilerOptions.${flag} must not be enabled.`));
    }
    if (options.noImplicitAny === false) findings.push(finding(file, 0, 'tsconfig/strictness', 'compilerOptions.noImplicitAny must not be false.'));
    return findings;
}

/** biome.json: the lint rules that ban the escape hatches cannot be weakened. Exported for the tests. */
export function auditBiome(config, file = 'biome.json') {
    const findings = [];
    const rules = config.linter?.rules ?? {};
    const required = [['suspicious', 'noExplicitAny'], ['suspicious', 'noTsIgnore'], ['style', 'noNonNullAssertion']];
    for (const [group, rule] of required) {
        if (rules[group]?.[rule] !== 'error') findings.push(finding(file, 0, 'biome/escape-hatch', `linter.rules.${group}.${rule} must be "error".`));
    }
    if (config.linter?.enabled === false) findings.push(finding(file, 0, 'biome/disabled', 'The linter must stay enabled.'));
    return findings;
}

function* walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else if (entry.isFile()) yield full;
    }
}

const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/');

export function runAudit() {
    const findings = [];

    for (const directory of SOURCE_DIRECTORIES) {
        for (const file of walk(path.join(ROOT, directory))) {
            const rel = relative(file);
            if (rel === SELF) continue;
            if (!SOURCE_EXTENSIONS.has(path.extname(file)) && !rel.startsWith('.githooks/')) continue;
            findings.push(...auditSource(rel, fs.readFileSync(file, 'utf8')));
        }
    }

    const readJson = (name) => {
        const file = path.join(ROOT, name);
        return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    };
    const rootPackage = readJson('package.json');
    if (rootPackage) findings.push(...auditPackageJson(rootPackage));
    for (const directory of ['packages', 'apps']) {
        const base = path.join(ROOT, directory);
        if (!fs.existsSync(base)) continue;
        for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
            const manifest = path.join(base, entry.name, 'package.json');
            if (entry.isDirectory() && fs.existsSync(manifest)) {
                findings.push(...auditPackageJson(JSON.parse(fs.readFileSync(manifest, 'utf8')), relative(manifest)));
            }
        }
    }
    const tsconfig = readJson('tsconfig.base.json');
    if (tsconfig) findings.push(...auditTsconfig(tsconfig));
    const biome = readJson('biome.json');
    if (biome) findings.push(...auditBiome(biome));

    // A committed .env is a leaked secret waiting for a push. Only .env.example belongs in git.
    for (const name of fs.readdirSync(ROOT)) {
        if (/^\.env(\..+)?$/.test(name) && !name.endsWith('.example')) {
            findings.push(finding(name, 0, 'secrets/env-file', `${name} exists in the working tree; it must be gitignored and never committed.`));
        }
    }

    return { findings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const { findings } = runAudit();
    if (findings.length === 0) {
        console.log('security audit: no findings (source, manifests, tsconfig, biome.json)');
        process.exit(0);
    }
    console.error(`security audit: ${findings.length} finding(s). There are no exceptions; fix the code.\n`);
    for (const item of findings) {
        console.error(`  ${item.file}${item.line ? `:${item.line}` : ''}  [${item.rule}]  ${item.message}`);
    }
    process.exit(1);
}
