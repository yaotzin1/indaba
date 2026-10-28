# Documentation

The repository's main README is the tour; these are the parts that need more room. The same pages are the
documentation site, [yaotzin1.github.io/indaba](https://yaotzin1.github.io/indaba/), built by `pnpm site`
(`scripts/build-site.mjs`) and published from `main`; a new page here is added to its navigation there.

## Using Indaba

| Page | Read it when |
| :--- | :--- |
| [positioning.md](positioning.md) | You want to know what Indaba is for, who it is for, what it is not, and which parts exist today |
| [roadmap.md](roadmap.md) | You want the order in which the parts are built, and what "done" means for each phase |
| [hosted-service.md](hosted-service.md) | You want to know what a hosted Indaba would need and which seams the local work keeps for it |
| [using-the-alpha.md](using-the-alpha.md) | You want to try this alpha: which transport (API, ACP or CLI) to choose when, a first run, and what to expect to break |
| [getting-started.md](getting-started.md) | You want to run a workflow: prerequisites, the commands, environment variables, runners, what a run leaves on disk |
| [workflow-format.md](workflow-format.md) | You are writing a workflow file: every field, guards, retries, MCP servers, with examples |
| [web-view.md](web-view.md) | You want to use `indaba ui`: follow runs, start and stop them, list your workflows, edit a workflow as a form, a graph or text, change the logging settings, and how it keeps your work private |
| [logging.md](logging.md) | You want to find what went wrong, change where logs go (`indaba.config`, `indaba settings`, Graylog, a collector), or report an issue with `indaba report` |
| [extending.md](extending.md) | You want to add a runner, a guard type, an event listener or a log sink with a plugin |
| [vision.md](vision.md) | You want the founding requirement: mission, modules, the runtime workflow contract, as built in TypeScript |

## Two kinds of `workflow.ai.yml`

| File | Is | Read by |
| :--- | :--- | :--- |
| `workflow.ai.yml` at the repository root | the *development* workflow: the tracks, stages, gates and rules for people and agents changing Indaba | Node scripts (`scripts/check-workflow.mjs` and friends), through `scripts/lib/workflow-yaml.mjs` |
| a workflow file a user writes ([workflow-format.md](workflow-format.md)) | what *Indaba executes*: roles, steps, guards, retries | the parser in `@indaba/engine` |

They share a file name and a family resemblance, and have different schemas. The development one is explained in
[development-workflow.md](development-workflow.md). Running the
development workflow with Indaba itself is a possible future, not a current feature.

## For people changing Indaba

| Page | Read it when |
| :--- | :--- |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | You are setting up, or about to make your first change |
| [development-workflow.md](development-workflow.md) | You want to understand the root `workflow.ai.yml`: its sections, what is enforced and what is guidance, the tracks, the gates, and how to change it |
| [../AGENTS.md](../AGENTS.md) | You are an AI agent working in this repository |
| [web-view-development.md](web-view-development.md) | You are changing the web view: its packages, the rules it keeps, theming, `apsw-gridwright` and React Flow, adding something it shows, tests |
| [../specs/DEPENDENCY_MAP.md](../specs/DEPENDENCY_MAP.md) | You want to know which package depends on which |
| [../specs/](../specs/) | You want to know why a feature is shaped as it is, and what it promises |
| [../specs/typescript-port/](../specs/typescript-port/) | You want the contract of the packages as they are now |

Documentation moves with the change: a page here is updated in the same change as any workflow field,
guard, runner option, CLI option or default it describes.
