# Security policy

## Reporting a vulnerability

Please report it privately, not in a public issue: use GitHub's private vulnerability reporting
("Report a vulnerability" under the repository's Security tab). Include the version, a minimal
reproduction, and what an attacker controls in it (a workflow file, an agent's output, a repository's
contents, an environment variable).

You will get an acknowledgement within a few days. A confirmed issue is fixed in a patch release and
recorded under "Security" in `CHANGELOG.md` once the fix is published.

## What is in scope

- Command injection: anything that lets a workflow file, a model's output, a branch or file name reach
  a shell or an option of an external program.
- Path traversal: an artifact, guard or task id that reads or writes outside its root, or a patch that
  applies outside its worktree.
- Secret exposure: an API key reaching a log, trace, event, exception message, artifact or prompt.
- Server-side request forgery or unsafe deserialization in the HTTP and parsing code.
- Leaked processes or worktrees that keep running or holding data after a run.

## What is out of scope

An agent doing what a workflow author told it to do. Indaba runs agent CLIs and commands the workflow
declares, with the privileges of the user who runs it; run untrusted workflow files in a sandbox,
the way you would run an untrusted script.

## How the project defends itself

The rules are in `.agents/rules/security.md` and are enforced on every commit by
`scripts/security-audit.mjs`, with the checks that need the toolchain running in CI: no `eval`,
`new Function`, `vm`, string-form `exec` or `shell: true`; processes started with argument arrays;
paths confined to their root; secrets absent from telemetry; TypeScript strict with no `any`, no
non-null assertion and no suppression comment; `pnpm audit` as a required check; no install-time
scripts in any package. Packages are published with provenance.
