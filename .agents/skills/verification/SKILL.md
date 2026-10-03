---
name: verification
description: Use at stage 7 of every change, and whenever a gate fails. Covers composer qa in Docker, the node gates, reading a failing gate from its own output, and the manual checks no gate can make.
---

# Verification

Stage 7. A change is unverified until this has passed end to end.

## The commands

```bash
# PHP toolchain: only inside the container
docker compose run --rm php composer qa        # cs, stan, test, in that order
docker compose run --rm php composer audit

# Document gates: plain node on the host
node scripts/validate-skills.mjs
node scripts/sync-claude-skills.mjs --check
node scripts/sync-agent-docs.mjs --check
node scripts/check-workflow.mjs
node scripts/security-audit.mjs --source
node --test scripts/*.test.mjs
```

| Gate | Catches |
| :--- | :--- |
| `composer cs` | PER-CS 2.0 violations (`composer cs:fix` repairs them) |
| `composer stan` | everything PHPStan level 9 can prove; no ignores allowed |
| `composer test` | unit, architecture and integration tests |
| `composer audit` | known vulnerabilities in installed packages |
| `validate-skills` | malformed or unsafe skill files |
| `sync-*` `--check` | AGENTS.md, GEMINI.md or the skill pointers drifting from the YAML |
| `check-workflow` | the YAML describing a toolchain, gate, CI job or spec directory the repository does not have |
| `security-audit` | banned constructs, secrets, phpstan.neon and composer.json weakening |

The pre-commit hook runs the node gates always and `composer qa` through Docker when Docker is
reachable; if it is not, the hook says so loudly and CI is the wall. CI also runs the smoke test from
`smoke_tests`.

## When a gate fails

Run that gate alone and read its actual output.

```bash
docker compose run --rm php vendor/bin/phpunit tests/Unit/Workflow --filter Retry
docker compose run --rm php vendor/bin/phpstan analyse src/Runners --memory-limit=512M
```

On the feature track, write the remediation as a task in `tasks.md`. After three attempts at the same
gate, stop: the plan is wrong, not the implementation, and the work returns to Plan.

## What not to do

- Do not add an ignore, a baseline, a skip or a lowered level to pass.
- Do not use `--no-verify` to get past a gate.
- Do not report a summary instead of the run. If two tests failed, say which two and what they said.
- Do not trust a PHP result from outside the container.

## Manual checks the gates cannot make

- Run the CLI against a sample workflow and read the output as a user would.
- Kill a run midway and check no process or `.indaba/worktrees/*` directory is left behind.
- Look at a trace for a planted secret.
- `git archive HEAD | tar -t` and read the listing before a release.
