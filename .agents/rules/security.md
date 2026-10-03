# Security Rules

Binding, blocking, and without exceptions. The detail and the reasons are in
`.agents/skills/application_security/SKILL.md` (code) and `.agents/skills/security_guard/SKILL.md`
(supply chain). `scripts/security-audit.mjs` enforces what a machine can check; review enforces the
rest.

## 1. Banned constructs, everywhere

`src/`, `tests/`, `bin/`, `scripts/`:

- `eval`; `shell_exec`, `exec`, `system`, `passthru`, `popen`, `proc_open`, `pcntl_exec`; the
  backtick operator.
- The `@` error-suppression operator.
- `unserialize` of data that is not provably ours (JSON, or `['allowed_classes' => false]`).
- `include` or `require` of a path held in a variable; `extract`.
- Raw `curl_*` and socket functions: HTTP goes through `symfony/http-client`.
- Inline analysis ignores (`@phpstan-ignore*`) and `ignoreErrors` or a baseline in `phpstan.neon`.
- In the node scripts: `eval`, `new Function`, `exec`/`execSync` with a string, `shell: true`.

Under `src/` additionally: debug output (`var_dump`, `dump`, `print_r`), and `Process::fromShellCommandline`
outside `ShellRunner`. Under `src/Core`, `src/Workflow` and `src/Mesh`: the wall clock, randomness
and the environment.

## 2. Untrusted data never becomes a command line

Processes take an argument array. The one place a declared command string reaches a shell is
`ShellRunner`, and what it runs is what the workflow author wrote, never something composed from a
model's output, a file name or a branch name.

## 3. Paths are confined

A path from a workflow, a guard, a model or an artifact name is resolved and checked to lie under its
root before use. Worktrees live under `.indaba/worktrees/<taskId>`. Symlinks are not followed out of
a root.

## 4. Secrets are never logged

Keys come from the environment of the process that needs them. They are absent from traces, events,
exception messages, artifacts, prompts and the `RunResult`. Redaction is tested, not assumed.

## 5. HTTP is bounded

One shared client, explicit timeouts, a bounded body, TLS verification on, redirects off or
limited. The host a runner calls is configuration, not data from a model.

## 6. Nothing runs at install

No `pre-install-cmd`, `post-install-cmd` or `post-autoload-dump` script, no wildcard
`allow-plugins`. A Composer plugin is a recorded decision.

## 7. The dist archive is an allowlist

`.gitattributes` `export-ignore`s everything a consumer does not need: tests, specs, `.agents`,
`.claude`, `.github`, `.githooks`, `scripts`, Docker files. Check with `git archive`.

## 8. Dependencies are audited

`composer audit` is a required check at any severity. A new advisory failing an unrelated pull
request is the point: the fix is an upgrade, not a waiver.

## 9. Skill files are scanned

`scripts/validate-skills.mjs` audits every `SKILL.md` for leaked credentials, prompt-injection
patterns and unsafe path references.

## 10. No secrets in the repository

No tokens, no internal URLs, no real transcripts in fixtures. `.env` is gitignored and a present one
fails the audit.

## 11. Vulnerabilities are reported privately

As `SECURITY.md` describes.
