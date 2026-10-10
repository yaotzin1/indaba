# Tasks: Step verdicts

Ordered by dependency. Domain first, infrastructure second, console and documentation last. Each task
independently checkable. Tests are written with each task, not after (qa skill).

## `@indaba/core`

- [ ] T-01. `ReviewDefinition`, `StepDefinition.review`, `isReviewStep`; export.
- [ ] T-02. `review.ts`: the constants and `parseReview`. Tests: a single `AGREEMENT:`; a single `CRITIQUE:` with a
      multi-line reason; narration before the tag; `\r\n` line ends; a tag that is indented, bulleted, quoted,
      bold, lower-case or without the colon (all `missing`); both kinds (`conflicting`); several `AGREEMENT:` lines;
      a `CRITIQUE:` quoted after an `AGREEMENT:` (still `conflicting`); an empty reply and a whitespace-only one
      (`empty`); a reply over the scan limit (`too_long`) and one just under it; a reason cut at 4000 with the head
      kept; a property test over arbitrary strings (never throws; `agreement` only without a `CRITIQUE:` line).
- [ ] T-03. `reviewProtocolReminder` states the protocol and contains no reply text.
- [ ] T-04. The five `ATTR_VERDICT*` constants on `Tracer`. `architecture.test.ts` still passes.

## `@indaba/engine`

- [ ] T-05. Parse `review` with field paths; reject unknown keys.
- [ ] T-06. Validator: every error in `api-surface.md`, each with a test (shell step, debate, only one of the two
      keys, `send_back_to` not a step, not an ancestor, the step itself accepted, `max_iterations` 0, 11, 1.5).
- [ ] T-07. `StepOutcome.verdict` and `okWithVerdict`.
- [ ] T-08. `PromptBuilder`: the `## Verdict` section for a review step; a snapshot test that a step without `review`
      is byte-identical to before, with and without feedback.
- [ ] T-09. `runAgent` parses the reply after a successful run; an invalid reply is a `failed` outcome with the
      protocol reminder and sets `indaba.verdict.invalid`. A failed run reads nothing; an aborted signal reads
      nothing (AC-14). The fallback chain is untouched.
- [ ] T-10. Extract the reset-and-jump code of `on_failure` into one method; the existing retry tests stay green
      unchanged.
- [ ] T-11. Route the verdict after `validate`: agreement; critique within the limit; critique at the limit (step
      and run `ESCALATED`); critique with no `send_back_to`. Tests with a scripted runner: approve on the first
      pass; critique twice then approve; never approve (escalates at the limit, exact number of runs); a guard
      failure with an `AGREEMENT:` printed (verdict ignored); `on_failure` on the reviewer for an invalid reply; the
      target's prompt on the third pass contains only the last critique (isolation test).
- [ ] T-12. Attributes and status reasons from `events.md`; a negative test that no attribute, event or reason
      contains text from the reply (hostile string built from fragments).
- [ ] T-13. The mesh: `AgentMessage` parsing and every debate test unchanged and green.

## `indaba` (CLI)

- [ ] T-14. `plan` prints the review lines and the loop bound.
- [ ] T-15. End to end through the built CLI: a `code` / `review` workflow with a scripted reviewer that critiques
      once and then agrees, and one that never agrees and ends `escalated` (exit 2).

## Tests

- [ ] T-16. Unit coverage for new behaviour, success and failure paths (85% floor on all four metrics).
- [ ] T-17. Hostile-input tests: a reply with the tags inside a code fence, with ANSI escapes, with a very long
      line, with a path or a command after the tag; none reaches a shell, a path or a log.

## Documentation

- [ ] T-18. `docs/workflow-format.md`: `review`, the protocol, the loop bound, and a plain statement that the
      verdict is the agent's own word.
- [ ] T-19. An example in `examples/` (`review-loop.workflow.ai.yml`) that passes `indaba validate` and
      `indaba plan`; a test keeps it parsing.
- [ ] T-20. README, `CHANGELOG.md` under Unreleased, `specs/DEPENDENCY_MAP.md`, `AGENTS.md` only if a path
      changed.

## Stage 7: Verification

- [ ] `pnpm qa` and the node gates (`node scripts/check-workflow.mjs`) green end to end, output recorded in review.md.
- [ ] `pnpm e2e` and `pnpm smoke` green.
