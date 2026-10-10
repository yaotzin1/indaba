# Plan: Run blackboard

How the specification is delivered. Order is dependency order: core first, then the engine, then the command
line and the TUI. The contract is [`api-surface.md`](api-surface.md); the file is
[`data-model.md`](data-model.md).

## 1. `@indaba/core` (pure; `architecture.test.ts` guards it)

New module `packages/core/src/mesh/board.ts` (beside `blackboard.ts`, which is untouched) and
`packages/core/src/mesh/board-digest.ts`:

- `BoardKind`, `BoardEntry`, the four record types, `BoardLimits`, `DEFAULT_BOARD_LIMITS`.
- `RunBoard`. State: an array of records, the current `seq`, a map from `(stepId, attempt, scope)` to the list of
  entries it covers, the used characters. `post` cleans (`\r`, `\n`, tabs to a space, other C0/C1 removed, runs of
  spaces collapsed), redacts (the injected function; a throw stores nothing), cuts, checks the allowance
  (`truncated` once), numbers and calls the sink. `settle` marks pending entries; `supersede` marks accepted
  ones. `stateOf` is computed from the latest following settlement, so there is a single source of truth: the
  record list. `replay` feeds records back through the same code with the sink disabled.
- `buildDigest`: select (steps, kinds, accepted, not `forStep`) in `seq` order; facts = latest per key; build
  the preamble, the facts block and the entries block newest-first within `maxChars`, then emit entries
  oldest-first with the `| ` prefix and the omitted line. Pure; no `Date`, no `Math.random`.
- `parseBoardLines`: split on line ends; track fenced blocks (a line starting with three backticks or tildes
  toggles); for each line outside a fence that starts with `BOARD `, match the two grammars; count the rest.
  Total; a 1 MiB reply is scanned in one pass without a regex that can backtrack (anchored, bounded classes).
- `BoardRecorded` in `observability/` beside `StepOutput`; `StepDefinition.board` and `StepBoard` in
  `workflow/model.ts`; `ConsensusArbiter.deliberate` fourth parameter (one call after `board.post`).

## 2. `@indaba/engine`

- **Parser and validator** (`parser/`): read `board`, check every rule of the field table with the field path;
  ancestors come from the DAG builder, so the check runs after the graph is built. Default `digestChars` 4000.
  Unknown keys inside `board` are refused.
- **Run wiring** (`engine/workflow-engine.ts`): at the start of a run make the `RunBoard` with the injected clock,
  the redaction function and a sink that dispatches `BoardRecorded`; pass it, and `attempt` (`state.attempts() + 1`
  already used for the span), in `StepRunOptions`. Settlement:
  - after `execute`: ok settles the step's pending entries `accepted`; not ok (failed or escalated) settles them
    `discarded`; cancelled settles nothing;
  - in the retry reset loop (the `for` over `[target, ...descendantsOf(target)]`): call `supersede` with those ids
    before the target runs again.
  Debate entries are already `accepted` when the debate ends, so the later settle finds nothing pending to change.
- **Reading** (`engine/step-executor.ts`, `prompt-builder.ts`): in `runAgent` and for the topic in
  `runConsensus`, when `step.board?.read` exists, build the digest (`forStep` = the step, `steps` = the author's
  list or the ancestors) and pass it as `PromptBuilder.build(step, feedback, digest.text)`. Set the three digest
  attributes on the span.
- **Posting** (`runAgent`): after the chain returns and the result succeeded, if `step.board?.post` is non-empty,
  `parseBoardLines(result.output, post)`, post each as `source: 'agent'`, `sender` the role (or the step id),
  and set `indaba.board.posted` and `.ignored`. A failed runner result is not scanned.
- **Debates** (`runConsensus`): pass an observer to `deliberate` that posts each message (`kind` from
  `MessageType`, `round`, `sender` the role); after the result post the outcome as a `result`; after a ruling post
  a `decision`; settle the debate's entries `accepted`. The ledger, artifacts and memo paths do not change. A
  debate skipped by the ledger posts the `decision` with the memo's note and nothing else.
- **File** (`trace/board-writer.ts`, `board-reader.ts`, `board-records.ts`): modelled on `event-writer.ts`,
  `trace-reader.ts` and `records.ts`: one promise queue, `appendFile`, `isRunId` on the trace id, the first
  failure reported once. `parseBoardRecord` is total. The writer does not truncate; the board already enforced
  its limits.

## 3. `indaba` (CLI)

- `engine-factory.ts`: construct `BoardWriter` with the same directory as the event writer and add it as a
  listener of `BoardRecorded`; on its `onError`, add the span event `indaba.board.degraded` (class name only).
- `plan`: the `board:` line per step. `validate` needs nothing beyond the parser.
- `watch.ts`: with `--plain`, read the board file when it exists and print the section (AC-39).

## 4. `@indaba/tui`

- `board-state.ts`: `reduceBoard`, `emptyBoard`, derived views (filtered list, facts, detail), pure and covered
  by tests with no terminal.
- A board pane component in `ink/`, switchable with the transcript pane; keys and legend as in `spec.md` C-13;
  every string passes `sanitize` first; glyph + word per kind; ASCII fallback when Unicode is missing.
- `watch` follows `BoardReader.follow` beside the trace reader; on abort it stops both.

## 5. Order of work and checkpoints

1. Core: model, digest, parser, event. Tests for each. `pnpm qa`.
2. Engine: parser/validator; run wiring and settlement; digest in prompts; scanning replies. Unit tests with a
   fake runner; the retry-isolation test of AC-24.
3. Engine: debate mirroring; file writer and reader. Tests with temporary directories.
4. CLI: factory, `plan`, `watch --plain`. End-to-end through the built CLI: a two-step workflow where the second
   step reads what the first posted (a scripted runner), and a debate workflow.
5. TUI: reducer, then the pane. Terminal tests with the Ink test renderer.
6. Documentation and gates.

## 6. Risks

- **Prompt injection through the digest.** Mitigated by the grammar, the prefix, the preamble and the author
  choosing which steps are read; not eliminated. Tests are the only evidence this spec claims for it (AC-16),
  and a real model's behaviour is unverified.
- **Settlement bugs hide stale data.** The retry and variant cases are where an entry would be read that should
  not be. The tests of AC-23 and AC-24 are written first.
- **An unmeasured size.** The limits are guesses. They are constants in one place, and the first real runs
  decide.
- **Two sources of one debate.** The debate's working board and the copy on the run board can drift if a message
  is posted in one and not the other. The observer is the only path to the copy, and a test compares the two for
  a full debate.
