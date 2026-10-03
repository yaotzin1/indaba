# AGENTS.md: Indaba

The operating rules for every agent working in this repository. `workflow.ai.yml` outranks this
file; the cycle section below is generated from it.

## 1. What this project is

Indaba is a deterministic orchestration, debate and observability engine for multi-agent AI
workflows, in PHP 8.4+, MIT licensed. The founding requirement is `docs/vision.md`. It provides:
a workflow DAG with quality gates, a mesh where agents cross-examine each other to consensus,
unified runners (CLI PTY, OpenRouter SSE, shell), git-worktree isolation, and OpenTelemetry GenAI
traces with token and cost accounting.

**Two different `workflow.ai.yml`s.** The one at the root of this repository is the *development*
workflow: how agents and people change Indaba. It is not the file format Indaba executes (that
contract is in `docs/vision.md`, section 4, and `docs/`). They share a name and nothing else.
Running this repository's own stages with Indaba is a future goal and a non-goal today.

## 2. Repository map

| Path | Holds |
| :--- | :--- |
| `src/Core/` | exceptions and shared types: pure domain |
| `src/Workflow/` | `Model`, `Graph`, `State` (pure domain); `Parser`, `Guard`, `Engine` |
| `src/Mesh/` | `AgentMessage`, `Blackboard`, `ConsensusArbiter`, `PingPongDetector`: pure domain |
| `src/Runners/` | `RunnerInterface`, the runners, `RunnerRegistry`, `SseParser` |
| `src/Workspace/` | `Git`, `GitWorktreeManager` |
| `src/Observability/` | `Tracer`, `Span`, `TokenUsage`, `PricingTable` |
| `src/Console/` | Symfony Console commands, the composition root; `bin/indaba` |
| `tests/Unit/` | unit tests, mirroring `src/`; `tests/Unit/Architecture/` guards the boundary |
| `scripts/` | Node gates: validation, doc sync, workflow and security checks, hooks |
| `specs/` | one directory per feature: spec, API surface, review, plus optional artifacts |
| `docs/` | `vision.md`, and the user documentation (index: `docs/README.md`) |
| `.agents/` | canonical skills and rules |
| `.indaba/` | Indaba's own runtime state (worktrees, traces, artifacts), gitignored |

## 3. Commands

PHP 8.4 is **not installed on the host**. It runs only in the Docker image:

```bash
docker compose run --rm php composer install
docker compose run --rm php composer qa          # cs, stan (level 9), test
docker compose run --rm php composer test        # one gate; also stan, cs, cs:fix
docker compose run --rm php vendor/bin/phpunit --filter Name

node scripts/install-hooks.mjs                   # once per clone
node scripts/check-workflow.mjs                  # the node gates run on the host
```

`composer qa` plus the node gates is the definition of done. Report their actual output.

## 4. The rules that are easiest to skip

**The domain imports no framework.** `src/Core`, `src/Workflow/Model|Graph|State` and `src/Mesh` use
no Symfony class. `tests/Unit/Architecture/BoundaryTest.php` fails the build.

**PHPStan level 9, no ignoring.** No `ignoreErrors`, no baseline, no `@phpstan-ignore`. Fix the type.

**Determinism.** Decision logic gets the clock, ids and configuration injected; it reads no
`time()`, `random_int()` or `getenv()`.

**Untrusted data never reaches a shell, a path or a log.** Argument arrays only; paths are confined
to their root; secrets are in no trace, event, exception or artifact. `eval`, the shell functions,
backticks, `@` and `unserialize` of untrusted data are banned and
`scripts/security-audit.mjs` blocks the commit.

**Retries are isolated and bounded**: the next prompt carries only the last failure.

**Classify the semver impact before writing the code.** A changed default, workflow field meaning,
CLI option, event or span attribute is a major. See `.agents/skills/api_surface/SKILL.md`.

**Every feature has `specs/<name>/`**, and every commit declares `Track: feature|fix|chore|release`,
checked by `scripts/check-track.mjs`. A commit touching the workflow, its checks, the hooks, CI or
the analyser configuration also carries `Workflow-Change: <why>`.

## 5. Agent skills

Canonical text lives in `.agents/skills/<name>/SKILL.md`. Claude Code reads the generated pointers
in `.claude/skills/`, where underscores become hyphens (`api_surface` is `/api-surface`). After
editing anything under `.agents/skills/`, run `node scripts/sync-claude-skills.mjs`.

## 6. Operating cycle

<!-- BEGIN GENERATED: ai-workflow-cycle (scripts/sync-agent-docs.mjs) -->

> Generated from `workflow.ai.yml`. Do not edit by hand: run `node scripts/sync-agent-docs.mjs`.
> Each track's deliverables, the stage table and the skill table are in `.agents/rules/workflow_cycle.md`; every rule with what enforces it is in `.agents/rules/workflow_rules.md`.

### Precedence

**This file is the supreme instruction source for every agent working in this repository. Where any other document disagrees with it, this file wins, and the other document is a defect to be fixed rather than a rule to be followed.**

1. workflow.ai.yml (this file) - supreme. Tracks, stages, the skill registry, quality gates and architectural rules are defined here and nowhere else.
2. .agents/rules/** and .agents/skills/** - binding detail, procedures included (spec_driven_development, verification, branching, release, create_runner, create_guard). They elaborate this file and may not contradict it.
3. AGENTS.md - loaded automatically by AGENTS.md-aware agents. Its cycle section is generated from this file; never hand-edit the generated block.
4. GEMINI.md - generated, and it carries no rule of its own. Google documents no order between it and AGENTS.md, so neither may hold a rule the other lacks; it imports AGENTS.md and the order is then harmless.
5. CLAUDE.md - Claude Code entry point. Imports AGENTS.md and may add tool-specific notes, never overrides.
6. specs/<feature-name>/** - binding for one feature only, subordinate to everything above.
7. docs/vision.md - the founding requirement, kept verbatim. Everything above outranks it where they differ.

On conflict: Stop. Correct the subordinate document, re-run the sync scripts, then continue. Never settle a conflict by following the subordinate text.

### Enforced or guidance

Every statement in this cycle is **enforced** (a hook, a CI job, a lint rule, a test or
`scripts/check-workflow.mjs` fails when it is broken) or **guidance** (nothing fails when you do not).
The gates, the required checks, the spec directory rule and every rule with a named enforcer are
enforced. The tracks, the stages and every rule marked "review" are guidance, and exactly as strong
as your honesty about following them.

### Tracks: pick one before starting

When the work turns out bigger than its track, move up to the larger track and do the stages it
adds. Never move down to skip them. The stages, and which skill leads each, are in `.agents/rules/workflow_cycle.md`.

| Track | When | Stages |
| :--- | :--- | :--- |
| `feature` | Anything a consumer would notice: a new or changed public class, method, interface, CLI command or option, workflow field, guard type, runner, default, emitted event or trace attribute, or a change to how a run behaves. | 1. Specify<br>2. Clarify<br>3. Plan<br>4. Tasks<br>5. Analyze<br>6. Implement<br>7. Verify<br>8. Review and ship |
| `fix` | Restores behaviour that is already documented or specified. No new surface. A fix that has to change a public signature or a default is a feature. | 6. Implement<br>7. Verify<br>8. Review and ship |
| `chore` | Documentation, agent instructions, tests, CI, tooling or dev dependencies, with nothing a consumer installs changing. | 7. Verify<br>8. Review and ship |
| `release` | Cutting a version: moving Unreleased under a number and tagging. | 7. Verify<br>8. Review and ship |

### Blocking gates before a commit

A real git hook: run `node scripts/install-hooks.mjs` once per clone. The pure-Node gates always run, the PHP
toolchain gates run through Docker when it is available (and say loudly when skipped), and CI enforces all of them.

- **Skills Syntax & Security Validation** — `node scripts/validate-skills.mjs`
- **Claude Code Skill Pointer Sync** — `node scripts/sync-claude-skills.mjs --check`
- **Operating Cycle Mirrored Into AGENTS.md** — `node scripts/sync-agent-docs.mjs --check`
- **Workflow Claims Match the Repository** — `node scripts/check-workflow.mjs`
- **Security Audit (banned constructs, secrets, phpstan.neon, composer.json)** — `node scripts/security-audit.mjs --source`
- **Script Self-Tests** — `node --test scripts/*.test.mjs`
- **PHP Quality Gate (PHP-CS-Fixer, PHPStan level 9, PHPUnit)** — `composer qa`
- **Commit Declares Its Track and Matches It** — `node scripts/check-track.mjs`

### Architectural rules

One line each. The reason and what enforces it are in `.agents/rules/workflow_rules.md`.

- The core is framework-agnostic.
- PHPStan runs at level 9 with zero errors and no ignoreErrors: not in phpstan.neon, not as a baseline file, not as an inline @phpstan-ignore comment.
- The engine is deterministic.
- Retry-loop isolation.
- One runner contract.
- Secrets are never logged.
- No shell string interpolation of untrusted data.
- Paths are confined.
- Observability follows the OpenTelemetry GenAI semantic conventions.
- Every feature has a specs/&lt;feature-name&gt;/ directory containing spec.md, api-surface.md and review.md.
- Runtime dependencies are a recorded decision.
- Public API changes are classified before they are written.
- PHP runs in Docker.
- Repository documentation moves with the change: AGENTS.md, README.md, CHANGELOG.md and specs/DEPENDENCY_MAP.md whenever the public surface, the architecture or the release contents change, and the files under docs/ in...
- No invented numbers.

<!-- END GENERATED: ai-workflow-cycle -->
