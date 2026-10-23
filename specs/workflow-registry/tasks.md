# Tasks: The workflow registry, slice 1

Ordered by dependency. Each task brings its tests. Run `pnpm qa` after each group.

## Domain

- [x] **T-01** `@indaba/core` `registry/`: the types, `RegistryError`, `PluginHost.registerRegistry?`.

## Engine

- [x] **T-02** `registry/files.ts`: `scanWorkflowFiles`, `readWorkflowFile`, the limits, moved from the command line,
  which keeps its exports as wrappers; the step 2 and 3a tests stay green unchanged.
- [x] **T-03** `registry/index-file.ts`: read, recover, check, write whole, `.gitignore`.
- [x] **T-04** `FileWorkflowRegistry`: scan (incremental, moves, missing, roots gone), list and get (prefixes), last runs.
- [x] **T-05** `annotate`, `remove`, `copy`, `add`.

## Command line

- [x] **T-06** `workflows.ts`: the six subcommands, the roots file, output, exit codes; the plugin host keeps a
  registered registry and `main.ts` uses it; `indaba --help`.
- [x] **T-07** End to end: the built `indaba workflows` in a temporary project: list, annotate, copy, remove.

## Documentation and gates

- [x] **T-08** `docs/getting-started.md`, `docs/extending.md` (`registerRegistry`), `README.md`,
  `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`, `docs/roadmap.md`.
- [ ] **T-09** The gates of `workflow.ai.yml`, `pnpm e2e`, `pnpm smoke`; per-file coverage; CI on the three systems.
- [x] **T-10** `review.md`.
