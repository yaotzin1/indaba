# Claude Code entry point

**`workflow.ai.yml` outranks this file and every other document in the repository.** It defines the
stages, the skill registry, the quality gates and the architectural rules. Where anything here
disagrees with it, the YAML wins, and the disagreeing text is a defect to fix rather than a rule to
follow. (That file is the *development* workflow of Indaba, not the format Indaba executes.)

The operating rules are in `AGENTS.md`, shared with every other agent that works here. The line
below imports it into this session automatically.

@AGENTS.md

Section 6 of that file carries the operating cycle, generated from `workflow.ai.yml` by
`scripts/sync-agent-docs.mjs`. Pick the track before starting.

**Enforced versus guidance.** Only what the cycle marks as enforced will stop you. The stages and
every rule enforced by "review" depend on you following them, so say in your report which stages you
ran and which you did not.

**Splitting work.** `.agents/rules/agent_orchestration.md` describes the roles. Nothing in the
repository creates those agents; in Claude Code, use a subagent per role with worktree isolation,
only when the contract (`api-surface.md`) is written.

## Claude Code specifics

**Skills.** Entries under `.claude/skills/` are pointers to `.agents/skills/<name>/SKILL.md`. Read the
canonical file; the pointer's summary is not the skill. After editing a skill run
`node scripts/sync-claude-skills.mjs`.

**Hooks.** Run `node scripts/install-hooks.mjs` once in a fresh clone so the gates actually block a
commit. The hook runs the node gates always, and `composer qa` through Docker when Docker is up.

## The traps in this repository

- **`main` is protected (GitHub flow).** Never commit or push to it. Work on a `feat/`, `fix/`, `chore/`,
  `docs/` or `release/` branch, open a pull request, and squash-merge when the required checks
  are green. Merged branches are deleted; start the next change from a fresh `main`.

- **PHP exists only in Docker.** `php`, `composer` and `vendor/bin/*` are not on the host. Every PHP
  command is `docker compose run --rm php composer <script>`. A result from another interpreter is
  not evidence, and the Node scripts (`node scripts/...`) are the only thing that runs on the host.
  `OPENROUTER_API_KEY` reaches the container from the host environment; never write it to a file.

- **`.indaba/worktrees/` is Indaba's runtime, not yours.** It is where the engine puts its task
  worktrees. Do not create your own agent worktrees there (put them next to the repository), and do
  not delete what you did not create. `.indaba/` is gitignored.

- **PTY runners only work on Linux.** `ClaudeRunner` and `CursorRunner` need a pseudo-terminal, which
  PHP's `Process` supports on Linux and macOS, not on a Windows host. Inside the Docker container it
  works only with `tty: true` (the compose file sets it). A test of a PTY runner on the host proves
  nothing; run it in the container, and never make a unit test depend on a real agent CLI.

- **Do not confuse the two workflow files.** The root `workflow.ai.yml` is for developing Indaba and
  is parsed by `scripts/lib/workflow-yaml.mjs`, a deliberately tiny YAML subset with no block scalars.
  The Indaba runtime format is parsed by `src/Workflow/Parser` with `symfony/yaml`. Do not run one
  through the other.

- **The first commit is special.** `enforcement.baseline` is `"none"` because the repository had no
  commit when the track check was written. The first commit touches protected paths, so it needs
  `Track: feature` and a `Workflow-Change:` trailer. After it exists, set the baseline to its hash.

- **Branch protection is invisible to a commit.** A CI job renamed or a PHP version dropped leaves
  GitHub requiring a check nothing produces. Run `node scripts/check-workflow.mjs --remote` after
  changing `.github/workflows/ci.yml`.

- **There is no inline way around the security gate.** `scripts/security-audit.mjs` runs without PHP
  and scans source, tests, `bin/` and scripts, plus `phpstan.neon` and `composer.json`. If it fires,
  the design changes. Build hostile test strings from fragments so test files stay clean.

- **A pushed `v*` tag is a release.** Packagist reads tags by webhook; the release workflow creates
  the GitHub release. Push a tag only when the maintainer asks, and say what it starts.

- **Line endings are LF** (`.gitattributes`, `.editorconfig`). Shell hooks with CRLF fail on Linux.

## Local environment

```bash
node scripts/install-hooks.mjs
docker compose run --rm php composer install
docker compose run --rm php composer qa
docker compose run --rm php vendor/bin/phpunit tests/Unit/Mesh --filter Consensus
```

Node 22 on the host for the scripts. PHP 8.4, git and Composer in the image. No database, no server.
