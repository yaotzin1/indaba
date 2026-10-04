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
commit. The hook runs the node gates and then `pnpm qa` on the host. It needs `pnpm install` to have
run; without `node_modules` it refuses the commit instead of skipping the gate.

## The traps in this repository

- **`main` is protected (GitHub flow).** Never commit or push to it. Work on a `feat/`, `fix/`, `chore/`,
  `docs/` or `release/` branch, open a pull request, and squash-merge when the required checks
  are green. Merged branches are deleted; start the next change from a fresh `main`.

- **One toolchain, on the host.** Node 22 and pnpm 9 run natively on Windows, macOS and Linux, and
  `pnpm qa` plus the node gates (`node scripts/...`) is the definition of done. A result from another
  Node major or from a stale `node_modules` is not evidence: run `pnpm install` first. Write shell
  steps for the Bash tool with POSIX syntax and for PowerShell with its own; a command that works in
  one is not a result in the other. `OPENROUTER_API_KEY` comes from the host environment; never write
  it to a file.

- **`.indaba/worktrees/` is Indaba's runtime, not yours.** It is where the engine puts its task
  worktrees. Do not create your own agent worktrees there (put them next to the repository), and do
  not delete what you did not create. `.indaba/` is gitignored.

- **CLI runners and the pseudo-terminal.** `node-pty` is an optional dependency. When it loads, the
  agent CLI runners use a PTY; when it does not (no prebuilt binary, a failed native build), they fall
  back to piped stdio and the span says which mode ran. A test of PTY behaviour on a machine where
  `node-pty` is absent proves nothing about the PTY path, and a unit test never depends on a real agent
  CLI. On Windows, an npm `.cmd` shim cannot be started without a shell, and Indaba never uses one:
  point a runner at a native executable.

- **Do not confuse the two workflow files.** The root `workflow.ai.yml` is for developing Indaba and
  is parsed by `scripts/lib/workflow-yaml.mjs`, a deliberately tiny YAML subset with no block scalars.
  The Indaba runtime format is parsed by `parseWorkflow` in `packages/engine` with the `yaml` package.
  Do not run one through the other.

- **The baseline.** `enforcement.baseline` is the commit the track check starts after; earlier
  commits are not held to it. It is `"none"` only in a repository with no commit. Touching
  protected paths (the workflow, the gates, the compiler and linter configuration, the layers
  tests) needs a `Workflow-Change:` trailer. Move the baseline only on purpose, to a full hash.

- **Branch protection is invisible to a commit.** A CI job renamed or an operating system dropped from
  the matrix leaves GitHub requiring a check nothing produces. Run
  `node scripts/check-workflow.mjs --remote` after changing `.github/workflows/ci.yml`.

- **There is no inline way around the security gate.** `scripts/security-audit.mjs` runs without
  `node_modules` and scans the TypeScript under `packages/`, the scripts and hooks, every
  `package.json`, `tsconfig.base.json` and `biome.json`. If it fires, the design changes: there is no
  suppression comment for it, and `@ts-ignore` and `biome-ignore` are findings themselves. Build
  hostile test strings from fragments so test files stay clean.

- **A pushed `v*` tag is a release.** The release workflow publishes the packages to npm with
  provenance and creates the GitHub release; neither can be undone. Push a tag only when the
  maintainer asks, and say what it starts. Never run `npm publish` by hand.

- **Line endings are LF** (`.gitattributes`, `.editorconfig`). Shell hooks with CRLF fail on Linux and
  macOS, and a Windows editor that rewrites them breaks the hook for everyone else.

## Local environment

```bash
pnpm install
node scripts/install-hooks.mjs
pnpm qa
pnpm vitest run packages/core/test/mesh.test.ts -t "consensus"
```

Node 22 and pnpm 9 on the host, any OS. No database, no server, no container.

