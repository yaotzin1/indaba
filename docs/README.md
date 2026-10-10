# Documentation

The repository's main README is the tour; these are the parts that need more room.

## Using Indaba

| Page | Read it when |
| :--- | :--- |
| [positioning.md](positioning.md) | You want to know what Indaba is for, who it is for, what it is not, and which parts exist today |
| [roadmap.md](roadmap.md) | You want the order in which the parts are built, and what "done" means for each phase |
| [using-the-alpha.md](using-the-alpha.md) | You want to try this alpha: which transport (API, ACP or CLI) to choose when, a first run, and what to expect to break |
| [getting-started.md](getting-started.md) | You want to run a workflow: prerequisites, the commands, environment variables, runners, what a run leaves on disk |
| [workflow-format.md](workflow-format.md) | You are writing a workflow file: every field, guards, retries, MCP servers, with examples |
| [extending.md](extending.md) | You want to add a runner, a guard type or an event listener with a plugin |
| [vision.md](vision.md) | You want the founding requirement: mission, modules, the runtime workflow contract. Kept verbatim, with a note on what the TypeScript port superseded |

## Two kinds of `workflow.ai.yml`

| File | Is | Read by |
| :--- | :--- | :--- |
| `workflow.ai.yml` at the repository root | the *development* workflow: the tracks, stages, gates and rules for people and agents changing Indaba | Node scripts (`scripts/check-workflow.mjs` and friends), through `scripts/lib/workflow-yaml.mjs` |
| a workflow file a user writes ([workflow-format.md](workflow-format.md)) | what *Indaba executes*: roles, steps, guards, retries | the parser in `@indaba/engine` |

They share a file name and a family resemblance, and have different schemas. Running the
development workflow with Indaba itself is a possible future, not a current feature.

## For people changing Indaba

| Page | Read it when |
| :--- | :--- |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | You are setting up, or about to make your first change |
| [../AGENTS.md](../AGENTS.md) | You are an AI agent working in this repository |
| [../specs/DEPENDENCY_MAP.md](../specs/DEPENDENCY_MAP.md) | You want to know which package depends on which |
| [../specs/](../specs/) | You want to know why a feature is shaped as it is, and what it promises |
| [../specs/typescript-port/](../specs/typescript-port/) | You want the contract of the packages as they are now |

Documentation moves with the change: a page here is updated in the same change as any workflow field,
guard, runner option, CLI option or default it describes.
