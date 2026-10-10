# Plan: Step variants

The files that change, by package, in dependency order. The contracts are in `api-surface.md`; this says where.

## `@indaba/core`

- `src/workflow/model.ts`: `VariantsDefinition`, `DEFAULT_MAX_VARIANTS`, `DEFAULT_VARIANT_CONCURRENCY`, and `variants` / `examineWith` on
  `StepDefinition`; `defineStep` defaults (`examineWith: []`).
- `src/mesh/message.ts`: the optional `choice` and `fromBallotReply`. The anchored first-line parse lives here, pure.
- `src/mesh/consensus.ts`: `QuorumRule`, `AGREEMENT_QUORUM` (the existing logic moved, not changed), `BALLOT_QUORUM`,
  `tallyBallot`, the `quorum` option, `ConsensusResult.ballot` and `choice()`.
- `src/mesh/adjudicator.ts`: `Ballot`, `RulingRequest.ballot`, `Ruling.choice`.
- `src/workflow/state.ts` or the events module: `VariantFinished`, `SelectionMade`.
- `src/index.ts`: exports.

## `@indaba/engine`

- `src/parser/parser.ts`, `validator.ts`: read and validate the fields (`variants` as one integer checked against `maxVariants`, the
  isolation requirement, `examine_with` roles); error paths use the field path.
  `arbiter` validation widens from "debate step" to "debate step or step with `examine_with`".
- `src/workspace/workspace.ts`, `git-worktree.ts`: `snapshot()` (`git add -A -- . :(exclude).indaba`, then
  `git write-tree`) and `diff(since?)` (`git diff --cached --binary <tree>`, or `HEAD` when omitted).
- `src/engine/variants.ts` (new): the attempts. Create each worktree with `create(taskId, "<stepId>-v<n>")`, seed it by
  applying the step workspace's diff with `PatchService`, snapshot it, stage input artifacts, run the attempt through
  the existing agent path with the variant's runner plan, run outputs and guards in that worktree, diff since the
  snapshot, redact and write the artifact, destroy the worktree. Concurrency is a small bounded pool. A `finally`
  destroys whatever was created, with the abort signal not passed down.
- `src/engine/step-executor.ts`: dispatch to `variants.ts`; build the examination topic (candidate ids, counts, diff
  file paths, verdicts) and the examiner participants; run `runConsensus` with `BALLOT_QUORUM`; the workspace snapshot
  check (AC-13); on a failed examination, the arbiter with the `ballot`; application (`PatchService.canApply`, then
  `apply`); `selection.md`; span attributes and events. The ledger is bypassed for this path.
- `src/engine/chain.ts`: unchanged; every variant uses the step's own runner plan.
- `src/engine/workflow-engine.ts`: pass the step workspace into the executor for a variants step; the existing patch
  export runs after the step as for any isolated step.

## `indaba` (CLI)

- `src/arbiter-prompt.ts`: show the ballot, accept a candidate id.
- `plan` output in `main.ts`.

## Documentation

`docs/workflow-format.md` (a section after Consensus steps, plain about what is not isolated and what examiners
cannot know), `docs/extending.md` (`Ruling.choice`, `RulingRequest.ballot`, `Workspace.snapshot`), `README.md`,
`CHANGELOG.md`, `specs/DEPENDENCY_MAP.md`, and `examples/variants.workflow.ai.yml` that passes `indaba validate` and
`indaba plan`.

## Order of risk

1. The seeding and `since` logic (C-03) is where a variant's diff could stop matching the workspace it will be applied
   to. It gets tests against a temporary git repository first, with a binary file, an untracked file, a deleted file,
   and a workspace that already holds an earlier step's changes.
2. The quorum seam must leave every existing debate byte-identical. The regression test (api-surface checks) comes
   before the ballot code.
3. The reply parse is the one place untrusted text decides an outcome; it is exact-match against known ids and has the
   hostile-input tests.
