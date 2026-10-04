# Security Rules

Binding, blocking, and without exceptions. The detail and the reasons are in
`.agents/skills/application_security/SKILL.md` (code) and `.agents/skills/security_guard/SKILL.md`
(supply chain). `scripts/security-audit.mjs` enforces what a machine can check; review enforces the
rest.

## 1. Banned constructs, everywhere

`packages/`, `scripts/`, `.githooks/`:

- `eval`, `new Function`, and the `node:vm` module.
- `exec` and `execSync` (a command given as a string), and `shell: true`: processes are started with
  `spawn` or `execFile` and an argument array.
- A shell interpreter named with its command flag (`sh -c`, `cmd.exe /c`) anywhere but
  `packages/runners/src/shell-runner.ts`.
- `any`, the `!` non-null assertion, and inline suppressions (`@ts-ignore`, `@ts-expect-error`,
  `@ts-nocheck`, `biome-ignore`, `eslint-disable`); weakening a strictness flag in
  `tsconfig.base.json` or a rule in `biome.json`.

In shipped source (`packages/*/src`) additionally: `console.log` and its siblings, which can print
prompts, paths and credentials. Under `packages/core/src` and `packages/engine/src`: the wall clock,
randomness and the environment, except in the three engine edge files the audit names.

## 2. Untrusted data never becomes a command line

Processes take an argument array. The one place a declared command string reaches a shell is
`ShellRunner`, and what it runs is what the workflow author wrote, never something composed from a
model's output, a file name or a branch name.

## 3. Paths are confined

A path from a workflow, a guard, a model or an artifact name is resolved and checked to lie under its
root before use (compare with `path.relative`, and resolve symlinks for artifacts). Worktrees live
under `.indaba/worktrees/<taskId>`. Symlinks are not followed out of a root.

## 4. Secrets are never logged

Keys come from the environment of the process that needs them. They are absent from traces, events,
error messages, artifacts, prompts and the `RunResult`. Redaction is tested, not assumed.

## 5. HTTP is bounded

Global `fetch` with an explicit timeout through an `AbortSignal`, a bounded body, TLS verification
on, redirects off or limited. The host a runner calls is configuration, not data from a model.

## 6. Nothing runs at install

No `preinstall`, `install`, `postinstall` or `prepare` script in any `package.json`, and no
dependency on a git URL, a tarball URL or a local path. `node-pty`, which builds or downloads a
native module, is optional and its absence is handled.

## 7. A package publishes an allowlist

Each package's `files` lists `dist` and nothing else; tests, specs, `.agents`, `.claude`, `.github`,
`.githooks` and `scripts` never reach npm. `scripts/smoke-pack.mjs` installs the packed tarballs in
a clean directory to check it.

## 8. Dependencies are audited

`pnpm audit` is a required check at any severity. A new advisory failing an unrelated pull request
is the point: the fix is an upgrade, not a waiver.

## 9. Skill files are scanned

`scripts/validate-skills.mjs` audits every `SKILL.md` for leaked credentials, prompt-injection
patterns and unsafe path references.

## 10. No secrets in the repository

No tokens, no internal URLs, no real transcripts in fixtures. `.env` is gitignored and a present one
fails the audit.

## 11. Vulnerabilities are reported privately

As `SECURITY.md` describes.
