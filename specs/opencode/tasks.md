# Tasks: OpenCode integration

## Infrastructure

- [x] **T-01** `opencode` ACP preset and the widened key type in `acp-runner.ts`
- [x] **T-02** `OpenCodeRunner` (`opencode run`, model through `--model`, no `--auto` by default)
- [x] **T-03** Register it in `RunnerRegistry.withDefaults`; export it from the index

## Tests

- [x] **T-04** Preset resolves to `['opencode', 'acp']`; the six prefixes pass, others do not
- [x] **T-05** Runner command vector with and without a model; `extraArgs` after the binary; prompt as one argument
- [x] **T-06** Registry lists `opencode`; a missing binary is "cannot run" and the chain falls through
- [x] **T-07** Architecture and layers tests still green

## Documentation

- [x] **T-08** `docs/getting-started.md` and `docs/workflow-format.md`: tables and snippets
- [x] **T-09** CHANGELOG entry under Unreleased; README runner list
- [x] **T-10** `specs/DEPENDENCY_MAP.md` (no dependency added: say so)

## Stage 7: Verification

- [ ] `pnpm qa` and `node scripts/check-workflow.mjs` green, output recorded in review.md
