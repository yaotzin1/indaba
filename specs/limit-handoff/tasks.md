# Tasks: Limit handoff

`@indaba/core` first, then infrastructure, tests alongside each, the CLI and documentation last. Each task is
independently checkable.

- [ ] **T-01.** Research: collect real samples of what `claude-code`, `codex` and `gemini` print and exit with when a
      limit is hit, whether a structured field or a reset instant exists, and what the OpenAI-compatible APIs return.
      Write `research.md` with the samples (secrets and account names removed). Blocks T-08 to T-10; does not block core.
- [ ] **T-02.** `@indaba/core`: `RunLimit`, `LimitKind`, `RunResult.limit`, `RunnerLimitError`. Tests for the types'
      construction and the error's place in the hierarchy.
- [ ] **T-03.** `@indaba/core`: `classifyLimit` (AC-03 to AC-06). Tests: structured beats text; text only on failure;
      no `resetsAt` from text; a successful answer mentioning a limit is not one; the tail bound.
- [ ] **T-04.** `@indaba/core`: `LimitLedger` (AC-09, AC-10). Tests with a fake clock: cooling until the instant, for the
      run when unknown, expiry restores the original position.
- [ ] **T-05.** `@indaba/core`: `decideOnLimit` (AC-08, AC-11 to AC-13). Table test over every row of spec section 5.
- [ ] **T-06.** `@indaba/core` and `@indaba/engine`: `on_limit` and `max_wait` in the model, parser and validator
      (AC-07, AC-19), with field paths. `docs/workflow-format.md` in the same change.
- [ ] **T-07.** `@indaba/engine`: the step executor carries out the decision: skip events, limit and handoff events,
      the handoff note (AC-14), no retry consumed (AC-15), guard after a handoff (AC-16). Tests with fake runners and a
      fake clock, and a temporary git repository as the fixture.
- [ ] **T-08.** `@indaba/engine`: the wait through the ruling channel and the `ask` path, with no terminal (`escalated`)
      and cancel while waiting (spec section 5). Tests.
- [ ] **T-09.** `@indaba/runners`: the OpenAI-compatible runner's signal (429, `Retry-After`) and the CLI and ACP
      adapters for the signals T-01 verified. One test per pattern against a recorded sample. Contract test that a
      runner without `limit` is unchanged.
- [ ] **T-10.** Consensus: a limited speaker follows its own list; quorum unchanged (clarification 6). Test.
- [ ] **T-11.** `indaba`, `@indaba/tui`, `@indaba/web`: show limit, reset time and handoff derived from events
      (AC-18). Tests of the derivation.
- [ ] **T-12.** Documentation: `docs/` pages, both playbooks, `llms.txt`, the docs site build, a note in the cookbook,
      CHANGELOG, README, `specs/DEPENDENCY_MAP.md`.
- [ ] **T-13.** Verify: `pnpm qa`, `pnpm e2e`, the node gates; report real output. Write `review.md`.
