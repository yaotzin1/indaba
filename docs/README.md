# Documentation

The repository's main README is the tour; these are the parts that need more room.

| Page | Read it when |
| :--- | :--- |
| [vision.md](vision.md) | You want the founding requirement: mission, modules, the runtime workflow contract. Kept verbatim |

User documentation (the runtime workflow file reference, runners, guards, the command line,
observability, extending Indaba) is added here as features are documented, one page per topic, in the
same change as the feature.

## Two kinds of `workflow.ai.yml`

| File | Is | Read by |
| :--- | :--- | :--- |
| `workflow.ai.yml` at the repository root | the *development* workflow: the tracks, stages, gates and rules for people and agents changing Indaba | Node scripts (`scripts/check-workflow.mjs` and friends), through `scripts/lib/workflow-yaml.mjs` |
| a workflow file a user writes (contract in `vision.md`, section 4) | what *Indaba executes*: roles, steps, guards, retries | `Indaba\Workflow\Parser\WorkflowParser` |

They share a file name and a family resemblance, and have different schemas. Running the
development workflow with Indaba itself is a possible future, not a current feature.

## For people changing Indaba

| Page | Read it when |
| :--- | :--- |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | You are setting up, or about to make your first change |
| [../AGENTS.md](../AGENTS.md) | You are an AI agent working in this repository |
| [../specs/DEPENDENCY_MAP.md](../specs/DEPENDENCY_MAP.md) | You want to know which module depends on which |
| [../specs/](../specs/) | You want to know why a feature is shaped as it is, and what it promises |
