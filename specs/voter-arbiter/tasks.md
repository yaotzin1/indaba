# Tasks: Voter arbiter

Each task is checkable on its own; tests come with the code. Run `pnpm qa` after each group.

## `@indaba/core`

- [ ] T1. `Vote`, `Voter`, `VoterRegistry` (register, replace, get, names), `VotersDefinition`; export. Tests: duplicate without `replace` throws, with it replaces, order of `names()`.
- [ ] T2. `AGREEMENT_VOTER` and `OVERLAP_VOTER` per the plan. Tests: all agree, none, empty transcript; overlap identical, disjoint, one participant, no files, `:line` stripped, case, the 20,000 character cap, near-match input.
- [ ] T3. `Ruling` gains optional `score` and `votes`; `RulingRequest.voters`; `StepDefinition.fallbackArbiters` and `.voters`; `PluginHost.registerVoter`.
- [ ] T4. `VotersAdjudicator`: mean, both thresholds and the band between, no scores, unknown voter, voter throws, invalid score (NaN, 11, -1, Infinity), reasons cleaned and cut at 300, deterministic (same request twice). `architecture.test.ts` still passes.

## `@indaba/engine`

- [ ] T5. Parse `arbiter` as a name or a list and `voters`; validator errors from AC-01 and AC-02.
- [ ] T6. `runConsensus` tries the chain: first ruling wins; a `null` or unregistered name falls through; the list ending escalates naming each; `kind`, `score` and `votes` attributes; the ledger entry carries `kind`, `score`, `votes`.
- [ ] T7. Failures: unknown voter and invalid score fail the step naming the voter; a throw from a later arbiter after an earlier `null`.
- [ ] T8. Negative test: no span attribute contains a reason or transcript text.

## `indaba` (CLI)

- [ ] T9. `RegistryPluginHost.registerVoter`; `createEngine` registers the built-in voters and the `voters` arbiter through the host.
- [ ] T10. End to end: a plugin adds a voter and another replaces `overlap` with `{ replace: true }`; `[voters, human]` where voters decide, and where they cannot and the human rules. `layers.test.ts` still passes.

## Documentation and gates

- [ ] T11. `docs/workflow-format.md` (the list form, `voters`, the two voters, what the scores do not mean, the defaults are not measured), `docs/extending.md`, `README.md`, `CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`; add `arbiter: [voters, human]` to `examples/review-debate.workflow.ai.yml`.
- [ ] T12. `pnpm qa`, `pnpm e2e`, the node gates; coverage at least 85% on all four metrics.
- [ ] T12b. `Voter.description?`, `VoterRegistry.describe()`; the built-in voters described (AC-13).
- [ ] T13. Fill `review.md`.
