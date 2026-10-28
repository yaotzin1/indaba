# The development workflow: `workflow.ai.yml` at the repository root

This page explains the file at the root of the repository, the one that governs **how Indaba itself is changed**. It is not
the file you write for Indaba to run: that format is in [workflow-format.md](workflow-format.md). The two share a name and a
family resemblance (stages, gates, roles) and have different schemas, different parsers and different readers.

| | Root `workflow.ai.yml` (this page) | A workflow file you write |
| :--- | :--- | :--- |
| What it is | the rules for people and agents changing Indaba | what Indaba executes |
| Schema | its own, version `"2.0"` | [workflow-format.md](workflow-format.md) |
| Parsed by | `scripts/lib/workflow-yaml.mjs`, a deliberately small YAML subset with no block scalars | `parseWorkflow` in `@indaba/engine`, with the `yaml` package |
| Read by | Node scripts, git hooks and CI; agents through generated files | the engine, `indaba validate`, `plan` and `run` |

Do not run one through the other, and do not make their schemas agree. Running this file's stages with Indaba is a possible
future, and not a feature today.

## What it is for

One place that says what every contributor, human or AI agent, must do to change the repository, and what the repository
checks. No agent tool loads the file by itself. It reaches them through files generated from it, and what it claims about the
repository is checked by scripts:

| Generated or checked | By |
| :--- | :--- |
| the operating-cycle block of `AGENTS.md`, `GEMINI.md`, and `.agents/rules/workflow_cycle.md` and `workflow_rules.md` | `node scripts/sync-agent-docs.mjs` (`--check` in the hook and CI) |
| the pointers under `.claude/skills/` | `node scripts/sync-claude-skills.mjs` (`--check`) |
| every statement about the repository: packages, dependencies, toolchain, scripts, coverage floor, CI jobs, the gates | `node scripts/check-workflow.mjs` |

The direction is fixed: **edit the YAML, run the sync scripts, never the other way round.** Where any other document
disagrees with it, the YAML wins and the other text is a defect to fix.

## Enforced and guidance

Every statement in the file is one of two kinds, and the file keeps them apart:

- **Enforced:** a hook, a CI job, a test or a script fails when it is broken. These are `project`, `spec_kit`, the skill
  registry, `quality_gates`, `ci`, `enforcement`, and each architectural rule whose `enforced_by` names something.
- **Guidance:** what an agent is expected to do, with nothing that fails when it does not. These are `tracks`, `stages`, and
  the rules whose `enforced_by` says `review`.

A rule marked `review` is exactly as strong as the review. When you report a change, say which stages you ran and which you
did not. A setting that reads as configuration but that nothing reads must not be added: if it matters, give it a check;
otherwise write it as guidance.

## The sections

| Section | Holds | Kind |
| :--- | :--- | :--- |
| `governance` | the order of authority: this file first, then `.agents/rules` and `.agents/skills`, `AGENTS.md`, `GEMINI.md`, `CLAUDE.md`, a feature's `specs/`, and `docs/vision.md`; what to do on a conflict | enforced where checked |
| `project` | facts about the repository: packages, the runtime and optional dependencies, the toolchain versions, the strictness flags, the scripts, the coverage floor, the operating systems | enforced: compared with `package.json`, each `packages/*/package.json`, `tsconfig.base.json`, `biome.json` and the CI file on every commit |
| `tracks` | `feature`, `fix`, `chore`, `release`: when each applies, its stages and its deliverables | guidance |
| `agents` | which agent reads which file, and the largest file each takes (`max_chars`) | enforced: a file is held to the smallest limit of the agents that load it |
| `stages` | the eight stages, from Specify to Review and ship: the leading skills, the deliverables, the procedure each follows | guidance |
| `enforcement` | the part of the tracks a script can check: the baseline commit, the paths that count as source, tests, changelog and release, and the protected paths | enforced by `scripts/check-track.mjs` |
| `spec_kit` | what a `specs/<feature>/` directory must contain: `spec.md`, `api-surface.md`, `review.md` required; `plan.md`, `tasks.md`, `data-model.md`, `research.md`, `events.md` optional, or named under `## Artifacts not written` with the reason | enforced by `check-workflow.mjs` |
| `skills` | the registry of skills under `.agents/skills/`, and their mirror under `.claude/skills/` | enforced: the registry must match the directory |
| `quality_gates` | the gates the pre-commit and commit-msg hooks run | enforced |
| `ci` | the workflow file, the protected branch, and the checks a pull request needs before it merges | enforced: compared with the job names in the CI file |
| `architectural_rules` | the rules about the design, each with what enforces it | enforced or review, per rule |

## Tracks: pick one before you start

| Track | When | Stages |
| :--- | :--- | :--- |
| `feature` | anything a consumer would notice: a new or changed public class, method, CLI option, workflow field, guard type, runner, default, event or trace attribute, or a change to how a run behaves | Specify, Clarify, Plan, Tasks, Analyze, Implement, Verify, Review and ship |
| `fix` | restores behaviour that is already documented or specified; no new surface | Implement, Verify, Review and ship |
| `chore` | documentation, agent instructions, tests, CI, tooling or development dependencies, with nothing a consumer installs changing | Verify, Review and ship |
| `release` | moving Unreleased under a version number and tagging | Verify, Review and ship |

When the work turns out bigger than its track, move up to the larger track and do the stages it adds. Never move down to skip
them. Every commit declares its track in a `Track:` trailer, and `scripts/check-track.mjs` holds the diff to it: a chore
touches no source, a release touches only the changelog and the package manifests, a fix that changes source also changes a
test and the changelog, and a feature carries a complete spec directory and a changelog entry. A pull request is held to the
heaviest track any of its commits declares.

## The gates

Run `node scripts/install-hooks.mjs` once in a clone. The hook (`.githooks/pre-commit`) then runs, in order:

1. `node scripts/validate-skills.mjs`
2. `node scripts/sync-claude-skills.mjs --check`
3. `node scripts/sync-agent-docs.mjs --check`
4. `node scripts/check-workflow.mjs`
5. `node scripts/security-audit.mjs --source`
6. `node scripts/build-site.mjs --check` (every page of `docs/` is on the documentation site)
7. `node --test scripts/*.test.mjs`
8. `pnpm qa` (Biome, `tsc` strict, Vitest with the coverage floor)

and the `commit-msg` hook runs `node scripts/check-track.mjs`. A missing `node_modules` fails the hook instead of skipping the
gate, and CI runs every gate again. `main` is protected: nothing is pushed to it, and a pull request merges when every check in
`ci.required_checks` is green (`Agent instruction set`, `Track and deliverables`, `Dependency audit`, and `Verify on`
`ubuntu-latest`, `windows-latest` and `macos-latest`). `node scripts/check-workflow.mjs --remote` compares that list with the branch protection on
GitHub, and must be run after the CI file changes, because a commit cannot see branch protection.

The security audit has no inline way around it: there is no suppression comment, and `@ts-ignore` and `biome-ignore` are
findings themselves. If it fires, the design changes.

## Changing the file

The file and the scripts that read it are **protected paths** (`enforcement.protected_paths`): the workflow itself, the
`check-*` and `sync-*` scripts, `validate-skills.mjs`, `security-audit.mjs`, `install-hooks.mjs` and `scripts/lib/`, the
hooks, the CI workflows, `.claude/settings*.json`, the compiler, linter, Vitest and Stryker configuration, the root and
workspace manifests, and the architecture and layers tests. A commit that touches one carries a second trailer, so that weakening a check shows
in the history:

```
Track: chore
Workflow-Change: <why this changes the workflow or its checks>
```

To change the file:

1. Edit `workflow.ai.yml`. Keep to the small YAML subset its parser reads: no block scalars (`|` and `>`), strings on one line.
2. Run `node scripts/sync-agent-docs.mjs` and `node scripts/sync-claude-skills.mjs`.
3. Run `node scripts/check-workflow.mjs`. It fails when the file claims something the repository does not do, or the repository
   does something the file does not list (for example a new package missing from `project.packages`).
4. Commit with both trailers. If you changed `.github/workflows/ci.yml`, also run `node scripts/check-workflow.mjs --remote`.

Two settings deserve care:

- **`enforcement.baseline`** is the commit the track check starts after; earlier commits are not held to it. It is `"none"` only
  in a repository with no commit. Move it only on purpose, to a full hash.
- **`project.runtime_dependencies`** and `optional_dependencies` are exactly the packages the manifests may depend on, apart from
  links between workspace packages. A new runtime dependency needs the decision recorded in the feature's spec (what it does, why
  the standard library or an existing dependency cannot, its maintenance and licence), and `pnpm audit` must stay clean.

## Where the detail is

| You want | Read |
| :--- | :--- |
| the tracks, the stage table and the skill table, generated | `.agents/rules/workflow_cycle.md` |
| every rule, with what enforces it | `.agents/rules/workflow_rules.md` |
| how to run a change through the stages | `.agents/skills/spec_driven_development/SKILL.md` |
| the seven review questions | `.agents/rules/review.md` |
| branches, commits and pull requests | `.agents/skills/branching/SKILL.md` |
| the entry point for AI agents | [../AGENTS.md](../AGENTS.md) |
| setting up and your first change | [../CONTRIBUTING.md](../CONTRIBUTING.md) |
